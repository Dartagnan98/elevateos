import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { ELEVATE_ROOT, getFrameworkRoot, getOrgs } from '@/lib/config';

export const dynamic = 'force-dynamic';

type GraphNodeType =
  | 'core'
  | 'hub'
  | 'fact'
  | 'entity'
  | 'category'
  | 'session'
  | 'day'
  | 'collection'
  | 'embedding'
  | 'file';

interface GraphNode {
  id: string;
  label: string;
  type: GraphNodeType;
  size: number;
  weight: number;
  subtitle?: string;
  detail?: string;
  source?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  metadata?: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label?: string;
  weight: number;
}

interface FactRow {
  fact_id: number;
  content: string;
  category: string | null;
  tags: string | null;
  trust_score: number | null;
  retrieval_count: number | null;
  helpful_count: number | null;
  created_at: string | null;
  updated_at: string | null;
}

interface EntityRow {
  entity_id: number;
  name: string;
  entity_type: string | null;
  aliases: string | null;
  created_at: string | null;
  fact_count: number;
}

interface FactEntityRow {
  fact_id: number;
  entity_id: number;
}

interface JournalSessionRow {
  session_id: string;
  session_day: string;
  total: number;
  pending: number;
  processed: number;
  failed: number;
  first_created_at: string | null;
  latest_created_at: string | null;
}

interface EmbeddingRow {
  target_type: string;
  target_id: number;
  provider: string;
  model: string;
  dimensions: number;
  updated_at: string | null;
  count?: number;
}

const DEFAULT_LIMIT = 120;
const MAX_LIMIT = 250;

function clampLimit(value: string | null): number {
  const parsed = Number(value ?? DEFAULT_LIMIT);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(25, Math.min(MAX_LIMIT, Math.floor(parsed)));
}

function excerpt(value: string, max = 96): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}...`;
}

function nodeId(prefix: string, value: string | number): string {
  return `${prefix}:${String(value).replace(/[^a-zA-Z0-9_.:-]/g, '_')}`;
}

function readJsonValue(filePath: string): unknown {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
  } catch {
    return null;
  }
}

function tableExists(db: Database.Database, table: string): boolean {
  try {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
    ).get(table) as { name?: string } | undefined;
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

function safeAll<T>(db: Database.Database, sql: string, params: unknown[] = []): T[] {
  try {
    return db.prepare(sql).all(...params) as T[];
  } catch {
    return [];
  }
}

function addNode(nodes: Map<string, GraphNode>, node: GraphNode): void {
  const existing = nodes.get(node.id);
  if (!existing) {
    nodes.set(node.id, node);
    return;
  }
  existing.weight = Math.max(existing.weight, node.weight);
  existing.size = Math.max(existing.size, node.size);
}

function addEdge(edges: Map<string, GraphEdge>, edge: Omit<GraphEdge, 'id'>): void {
  if (edge.source === edge.target) return;
  const id = `${edge.source}->${edge.target}:${edge.type}`;
  const existing = edges.get(id);
  if (existing) {
    existing.weight += edge.weight;
    return;
  }
  edges.set(id, { id, ...edge });
}

function readMemoryStoreGraph(memoryDbPath: string, limit: number, warnings: string[]) {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const stats = {
    facts: 0,
    entities: 0,
    sessions: 0,
    journalDays: 0,
    embeddings: 0,
  };

  addNode(nodes, {
    id: 'core:memory',
    label: 'Local Memory',
    type: 'core',
    size: 28,
    weight: 10,
    subtitle: '~/.elevate memory store',
    source: memoryDbPath,
  });
  addNode(nodes, { id: 'hub:facts', label: 'Facts', type: 'hub', size: 20, weight: 8 });
  addNode(nodes, { id: 'hub:entities', label: 'Entities', type: 'hub', size: 20, weight: 8 });
  addNode(nodes, { id: 'hub:sessions', label: 'Sessions', type: 'hub', size: 20, weight: 8 });
  addNode(nodes, { id: 'hub:embeddings', label: 'Embeddings', type: 'hub', size: 18, weight: 7 });
  addEdge(edges, { source: 'core:memory', target: 'hub:facts', type: 'contains', weight: 5 });
  addEdge(edges, { source: 'core:memory', target: 'hub:entities', type: 'contains', weight: 5 });
  addEdge(edges, { source: 'core:memory', target: 'hub:sessions', type: 'contains', weight: 5 });
  addEdge(edges, { source: 'core:memory', target: 'hub:embeddings', type: 'contains', weight: 4 });

  if (!fs.existsSync(memoryDbPath)) {
    warnings.push('Memory DB not found yet. The graph will fill in after Elevate memory writes begin.');
    return { nodes, edges, stats };
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(memoryDbPath, { readonly: true, fileMustExist: true });

    if (tableExists(db, 'facts')) {
      const facts = safeAll<FactRow>(
        db,
        `
          SELECT fact_id, content, category, tags, trust_score, retrieval_count,
                 helpful_count, created_at, updated_at
          FROM facts
          ORDER BY COALESCE(updated_at, created_at) DESC, fact_id DESC
          LIMIT ?
        `,
        [limit],
      );
      stats.facts = facts.length;
      for (const fact of facts) {
        const category = fact.category || 'general';
        const categoryId = nodeId('category', category);
        const factId = nodeId('fact', fact.fact_id);
        addNode(nodes, {
          id: categoryId,
          label: category,
          type: 'category',
          size: 13,
          weight: 3,
          subtitle: 'memory category',
        });
        addNode(nodes, {
          id: factId,
          label: excerpt(fact.content, 52),
          type: 'fact',
          size: 9 + Math.round((fact.trust_score ?? 0.5) * 8),
          weight: 2 + (fact.retrieval_count ?? 0),
          subtitle: `${category} - trust ${(fact.trust_score ?? 0).toFixed(2)}`,
          detail: fact.content,
          createdAt: fact.created_at,
          updatedAt: fact.updated_at,
          metadata: {
            factId: fact.fact_id,
            category,
            tags: fact.tags,
            trustScore: fact.trust_score,
            retrievalCount: fact.retrieval_count,
            helpfulCount: fact.helpful_count,
          },
        });
        addEdge(edges, { source: 'hub:facts', target: categoryId, type: 'category', weight: 2 });
        addEdge(edges, { source: categoryId, target: factId, type: 'contains', weight: 1 });
      }
    }

    if (tableExists(db, 'entities')) {
      const entities = safeAll<EntityRow>(
        db,
        `
          SELECT e.entity_id, e.name, e.entity_type, e.aliases, e.created_at,
                 COUNT(fe.fact_id) AS fact_count
          FROM entities e
          LEFT JOIN fact_entities fe ON fe.entity_id = e.entity_id
          GROUP BY e.entity_id
          ORDER BY fact_count DESC, e.created_at DESC
          LIMIT ?
        `,
        [Math.min(limit, 120)],
      );
      stats.entities = entities.length;
      for (const entity of entities) {
        const id = nodeId('entity', entity.entity_id);
        addNode(nodes, {
          id,
          label: entity.name,
          type: 'entity',
          size: 10 + Math.min(14, Number(entity.fact_count || 0)),
          weight: Number(entity.fact_count || 1),
          subtitle: entity.entity_type || 'entity',
          detail: entity.aliases ? `Aliases: ${entity.aliases}` : undefined,
          createdAt: entity.created_at,
          metadata: {
            entityId: entity.entity_id,
            entityType: entity.entity_type,
            aliases: entity.aliases,
            factCount: entity.fact_count,
          },
        });
        addEdge(edges, { source: 'hub:entities', target: id, type: 'entity', weight: 1 });
      }
    }

    if (tableExists(db, 'fact_entities')) {
      const factEdges = safeAll<FactEntityRow>(
        db,
        `
          SELECT fact_id, entity_id
          FROM fact_entities
          ORDER BY fact_id DESC
          LIMIT ?
        `,
        [Math.min(limit * 4, 800)],
      );
      for (const edge of factEdges) {
        const factId = nodeId('fact', edge.fact_id);
        const entityId = nodeId('entity', edge.entity_id);
        if (nodes.has(factId) && nodes.has(entityId)) {
          addEdge(edges, {
            source: factId,
            target: entityId,
            type: 'mentions',
            label: 'mentions',
            weight: 2,
          });
        }
      }
    }

    if (tableExists(db, 'memory_turn_journal')) {
      const rows = safeAll<JournalSessionRow>(
        db,
        `
          SELECT session_id,
                 session_day,
                 COUNT(*) AS total,
                 SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
                 SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) AS processed,
                 SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
                 MIN(created_at) AS first_created_at,
                 MAX(created_at) AS latest_created_at
          FROM memory_turn_journal
          GROUP BY session_id, session_day
          ORDER BY latest_created_at DESC
          LIMIT ?
        `,
        [Math.min(limit, 120)],
      );
      const uniqueSessions = new Set<string>();
      const uniqueDays = new Set<string>();
      for (const row of rows) {
        const sessionLabel = row.session_id || 'unknown-session';
        const sessionId = nodeId('session', sessionLabel);
        const dayId = nodeId('day', row.session_day || 'unknown-day');
        uniqueSessions.add(sessionLabel);
        uniqueDays.add(row.session_day || 'unknown-day');
        addNode(nodes, {
          id: sessionId,
          label: sessionLabel.slice(0, 18),
          type: 'session',
          size: 10 + Math.min(14, Number(row.total || 0)),
          weight: Number(row.total || 1),
          subtitle: `${row.total} turns`,
          createdAt: row.first_created_at,
          updatedAt: row.latest_created_at,
          metadata: row as unknown as Record<string, unknown>,
        });
        addNode(nodes, {
          id: dayId,
          label: row.session_day || 'unknown day',
          type: 'day',
          size: 11 + Math.min(10, Number(row.total || 0)),
          weight: Number(row.total || 1),
          subtitle: 'session day',
        });
        addEdge(edges, { source: 'hub:sessions', target: sessionId, type: 'session', weight: 1 });
        addEdge(edges, { source: sessionId, target: dayId, type: 'happened_on', label: 'day', weight: 2 });
      }
      stats.sessions = uniqueSessions.size;
      stats.journalDays = uniqueDays.size;
    }

    if (tableExists(db, 'memory_embeddings')) {
      const embeddings = safeAll<EmbeddingRow>(
        db,
        `
          SELECT target_type, target_id, provider, model, dimensions, MAX(updated_at) AS updated_at, COUNT(*) AS count
          FROM memory_embeddings
          GROUP BY target_type, target_id, provider, model, dimensions
          ORDER BY updated_at DESC
          LIMIT ?
        `,
        [Math.min(limit * 2, 400)],
      );
      stats.embeddings = embeddings.length;
      for (const embedding of embeddings) {
        const modelId = nodeId('embedding', `${embedding.provider}:${embedding.model}:${embedding.dimensions}`);
        addNode(nodes, {
          id: modelId,
          label: `${embedding.provider}/${embedding.model}`,
          type: 'embedding',
          size: 12,
          weight: 2,
          subtitle: `${embedding.dimensions} dimensions`,
          updatedAt: embedding.updated_at,
          metadata: {
            provider: embedding.provider,
            model: embedding.model,
            dimensions: embedding.dimensions,
          },
        });
        addEdge(edges, { source: 'hub:embeddings', target: modelId, type: 'model', weight: 1 });
        const targetId = nodeId(embedding.target_type, embedding.target_id);
        if (nodes.has(targetId)) {
          addEdge(edges, { source: targetId, target: modelId, type: 'embedded_by', label: 'vector', weight: 1 });
        }
      }
    }
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : 'Could not read memory DB.');
  } finally {
    db?.close();
  }

  return { nodes, edges, stats };
}

function addActiveSessions(nodes: Map<string, GraphNode>, edges: Map<string, GraphEdge>, sessionsMapPath: string) {
  const raw = readJsonValue(sessionsMapPath);
  const entries = Array.isArray(raw)
    ? raw.map((value, index) => [String(index), value] as const)
    : raw && typeof raw === 'object'
      ? Object.entries(raw as Record<string, unknown>)
      : [];

  let count = 0;
  for (const [key, value] of entries.slice(0, 60)) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    const sessionIdRaw = typeof item.session_id === 'string'
      ? item.session_id
      : typeof item.sessionId === 'string'
        ? item.sessionId
        : key;
    const id = nodeId('session', sessionIdRaw);
    const platform = typeof item.platform === 'string' ? item.platform : undefined;
    const updatedAt = typeof item.updated_at === 'string'
      ? item.updated_at
      : typeof item.updatedAt === 'string'
        ? item.updatedAt
        : null;
    addNode(nodes, {
      id,
      label: sessionIdRaw.slice(0, 18),
      type: 'session',
      size: 14,
      weight: 4,
      subtitle: platform ? `${platform} active` : 'active session',
      updatedAt,
      metadata: item,
    });
    addEdge(edges, { source: 'hub:sessions', target: id, type: 'active', label: 'active', weight: 3 });
    count += 1;
  }
  return count;
}

function addKnowledgeCollections(
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  org: string,
  warnings: string[],
) {
  const kbRoot = path.join(ELEVATE_ROOT, 'orgs', org, 'knowledge-base');
  const chromaSqlite = path.join(kbRoot, 'chromadb', 'chroma.sqlite3');
  const frameworkKnowledge = path.join(getFrameworkRoot(), 'orgs', org, 'knowledge.md');
  const stateKnowledge = path.join(ELEVATE_ROOT, 'orgs', org, 'knowledge.md');

  addNode(nodes, { id: 'hub:knowledge', label: 'Knowledge', type: 'hub', size: 20, weight: 7 });
  addEdge(edges, { source: 'core:memory', target: 'hub:knowledge', type: 'contains', weight: 4 });

  const knowledgePath = fs.existsSync(stateKnowledge) ? stateKnowledge : frameworkKnowledge;
  if (fs.existsSync(knowledgePath)) {
    addNode(nodes, {
      id: nodeId('file', 'knowledge.md'),
      label: 'knowledge.md',
      type: 'file',
      size: 13,
      weight: 3,
      subtitle: org,
      source: knowledgePath,
    });
    addEdge(edges, { source: 'hub:knowledge', target: nodeId('file', 'knowledge.md'), type: 'file', weight: 2 });
  }

  if (!fs.existsSync(chromaSqlite)) return 0;

  let db: Database.Database | null = null;
  let count = 0;
  try {
    db = new Database(chromaSqlite, { readonly: true, fileMustExist: true });
    if (!tableExists(db, 'collections')) return 0;
    const collections = safeAll<{ id?: string; name: string }>(
      db,
      'SELECT id, name FROM collections ORDER BY name LIMIT 80',
    );
    for (const collection of collections) {
      const id = nodeId('collection', collection.name);
      addNode(nodes, {
        id,
        label: collection.name,
        type: 'collection',
        size: 13,
        weight: 3,
        subtitle: 'RAG collection',
        source: chromaSqlite,
        metadata: { collectionId: collection.id, org },
      });
      addEdge(edges, { source: 'hub:knowledge', target: id, type: 'collection', weight: 2 });
      count += 1;
    }
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : 'Could not read knowledge collections.');
  } finally {
    db?.close();
  }
  return count;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const orgs = getOrgs();
  const requestedOrg = searchParams.get('org') || orgs[0] || '';
  if (requestedOrg && !/^[a-zA-Z0-9_-]+$/.test(requestedOrg)) {
    return Response.json({ error: 'Invalid org' }, { status: 400 });
  }
  const org = requestedOrg || 'default';
  const limit = clampLimit(searchParams.get('limit'));
  const elevateHome = path.join(os.homedir(), '.elevate');
  const memoryDbPath = path.join(elevateHome, 'memory_store.db');
  const sessionsMapPath = path.join(elevateHome, 'sessions', 'sessions.json');
  const warnings: string[] = [];

  const graph = readMemoryStoreGraph(memoryDbPath, limit, warnings);
  const activeSessions = addActiveSessions(graph.nodes, graph.edges, sessionsMapPath);
  const knowledgeCollections = addKnowledgeCollections(graph.nodes, graph.edges, org, warnings);

  const nodes = Array.from(graph.nodes.values());
  const edges = Array.from(graph.edges.values())
    .filter((edge) => graph.nodes.has(edge.source) && graph.nodes.has(edge.target));

  return Response.json({
    generatedAt: new Date().toISOString(),
    org,
    sources: {
      memoryDb: memoryDbPath,
      sessionsMap: sessionsMapPath,
      elevateRoot: ELEVATE_ROOT,
    },
    stats: {
      ...graph.stats,
      activeSessions,
      knowledgeCollections,
      nodes: nodes.length,
      edges: edges.length,
    },
    warnings,
    nodes,
    edges,
  });
}
