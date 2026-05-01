'use client';

import { useEffect, useMemo, useState } from 'react';
import { useOrg } from '@/hooks/use-org';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  IconAffiliate,
  IconAlertCircle,
  IconBrain,
  IconDatabase,
  IconFileText,
  IconRefresh,
  IconSearch,
} from '@tabler/icons-react';
import { cn } from '@/lib/utils';

type NodeType =
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
  type: NodeType;
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

interface MemoryGraphResponse {
  generatedAt: string;
  org: string;
  sources: {
    memoryDb: string;
    sessionsMap: string;
    elevateRoot: string;
  };
  stats: Record<string, number>;
  warnings: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface PositionedNode extends GraphNode {
  x: number;
  y: number;
}

interface MemoryGraphClientProps {
  initialOrg: string;
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'facts', label: 'Facts' },
  { id: 'entities', label: 'Entities' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'vectors', label: 'Vectors' },
] as const;

const NODE_STYLES: Record<NodeType, { fill: string; stroke: string; text: string }> = {
  core: { fill: '#1B2A4A', stroke: '#8DA2D1', text: '#FFFFFF' },
  hub: { fill: '#044B35', stroke: '#7FB39E', text: '#FFFFFF' },
  fact: { fill: '#F7F7F7', stroke: '#CE823E', text: '#2B2B2B' },
  entity: { fill: '#FFF7ED', stroke: '#CE823E', text: '#2B2B2B' },
  category: { fill: '#EEF2FF', stroke: '#8DA2D1', text: '#1B2A4A' },
  session: { fill: '#ECFDF5', stroke: '#044B35', text: '#044B35' },
  day: { fill: '#F8FAFC', stroke: '#94A3B8', text: '#334155' },
  collection: { fill: '#EFF6FF', stroke: '#2563EB', text: '#1E3A8A' },
  embedding: { fill: '#FAF5FF', stroke: '#9333EA', text: '#581C87' },
  file: { fill: '#F8FAFC', stroke: '#64748B', text: '#334155' },
};

function shortLabel(label: string, max = 18): string {
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

function matchesFilter(node: GraphNode, filter: string): boolean {
  if (filter === 'all') return true;
  if (node.type === 'core' || node.type === 'hub') return true;
  if (filter === 'facts') return node.type === 'fact' || node.type === 'category' || node.type === 'entity';
  if (filter === 'entities') return node.type === 'entity' || node.type === 'fact';
  if (filter === 'sessions') return node.type === 'session' || node.type === 'day';
  if (filter === 'knowledge') return node.type === 'collection' || node.type === 'file';
  if (filter === 'vectors') return node.type === 'embedding' || node.type === 'fact';
  return true;
}

function nodeRadius(type: NodeType): number {
  switch (type) {
    case 'core': return 0;
    case 'hub': return 105;
    case 'category': return 180;
    case 'fact': return 250;
    case 'entity': return 330;
    case 'session': return 205;
    case 'day': return 285;
    case 'collection': return 310;
    case 'embedding': return 360;
    case 'file': return 250;
  }
}

function typeOffset(type: NodeType): number {
  const offsets: Record<NodeType, number> = {
    core: 0,
    hub: -0.4,
    category: 0.25,
    fact: -0.1,
    entity: 0.45,
    session: 1.9,
    day: 2.35,
    collection: 3.55,
    embedding: 4.7,
    file: 3.25,
  };
  return offsets[type];
}

function buildLayout(nodes: GraphNode[]): Map<string, PositionedNode> {
  const grouped = nodes.reduce<Record<string, GraphNode[]>>((acc, node) => {
    acc[node.type] = acc[node.type] ?? [];
    acc[node.type].push(node);
    return acc;
  }, {});

  const positioned = new Map<string, PositionedNode>();
  const center = { x: 540, y: 330 };
  for (const [type, group] of Object.entries(grouped) as Array<[NodeType, GraphNode[]]>) {
    const sorted = [...group].sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));
    const radius = nodeRadius(type);
    sorted.forEach((node, index) => {
      if (type === 'core') {
        positioned.set(node.id, { ...node, ...center });
        return;
      }
      const span = type === 'hub' ? Math.PI * 2 : Math.PI * 1.75;
      const angle = typeOffset(type) + (sorted.length <= 1 ? 0 : (index / sorted.length) * span);
      const x = center.x + Math.cos(angle) * radius;
      const y = center.y + Math.sin(angle) * radius * 0.66;
      positioned.set(node.id, { ...node, x, y });
    });
  }
  return positioned;
}

function formatTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function MemoryGraphClient({ initialOrg }: MemoryGraphClientProps) {
  const { currentOrg } = useOrg();
  const org = currentOrg && currentOrg !== 'all' ? currentOrg : initialOrg;
  const [data, setData] = useState<MemoryGraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeFilter, setActiveFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [selectedId, setSelectedId] = useState<string>('core:memory');
  const [query, setQuery] = useState('');

  async function loadGraph() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ org, limit: '180' });
      const res = await fetch(`/api/memory/graph?${params.toString()}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to load memory graph');
      setData(payload);
      if (!payload.nodes.some((node: GraphNode) => node.id === selectedId)) {
        setSelectedId('core:memory');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memory graph');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org]);

  const visibleNodes = useMemo(() => {
    if (!data) return [];
    const cleanQuery = query.trim().toLowerCase();
    return data.nodes.filter((node) => {
      if (!matchesFilter(node, activeFilter)) return false;
      if (!cleanQuery) return true;
      return [
        node.label,
        node.subtitle,
        node.detail,
        node.type,
        JSON.stringify(node.metadata ?? {}),
      ].some((value) => value?.toLowerCase().includes(cleanQuery));
    });
  }, [activeFilter, data, query]);

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(() => {
    if (!data) return [];
    return data.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));
  }, [data, visibleNodeIds]);

  const layout = useMemo(() => buildLayout(visibleNodes), [visibleNodes]);
  const selected = data?.nodes.find((node) => node.id === selectedId) ?? visibleNodes[0] ?? null;

  const stats = data?.stats ?? {};

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Facts" value={stats.facts ?? 0} />
        <Metric label="Entities" value={stats.entities ?? 0} />
        <Metric label="Sessions" value={stats.sessions ?? 0} />
        <Metric label="Vectors" value={stats.embeddings ?? 0} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader className="gap-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <IconAffiliate size={18} />
                Local Memory Graph
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <IconSearch size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search nodes"
                    className="h-8 w-44 rounded-md border bg-background pl-8 pr-2 text-xs outline-none focus:border-primary"
                  />
                </div>
                <Button variant="outline" size="sm" onClick={loadGraph} disabled={loading}>
                  <IconRefresh size={14} className={cn(loading && 'animate-spin')} />
                  Refresh
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  onClick={() => setActiveFilter(filter.id)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs transition-colors',
                    activeFilter === filter.id
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
                <IconAlertCircle size={16} />
                {error}
              </div>
            ) : (
              <div className="relative overflow-hidden rounded-md border bg-[#fbfaf7] dark:bg-[#101827]">
                {loading && (
                  <div className="absolute inset-0 z-10 grid place-items-center bg-background/70 text-sm text-muted-foreground">
                    Loading graph...
                  </div>
                )}
                <svg viewBox="0 0 1080 660" className="h-[560px] w-full">
                  <rect width="1080" height="660" fill="transparent" />
                  {visibleEdges.map((edge) => {
                    const source = layout.get(edge.source);
                    const target = layout.get(edge.target);
                    if (!source || !target) return null;
                    return (
                      <line
                        key={edge.id}
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                        stroke="currentColor"
                        strokeOpacity={Math.min(0.42, 0.12 + edge.weight * 0.04)}
                        strokeWidth={Math.min(4, 0.6 + edge.weight * 0.25)}
                        className="text-slate-500 dark:text-slate-400"
                      />
                    );
                  })}
                  {visibleNodes.map((node) => {
                    const positioned = layout.get(node.id);
                    if (!positioned) return null;
                    const style = NODE_STYLES[node.type];
                    const selectedNode = selectedId === node.id;
                    const radius = Math.max(8, Math.min(28, node.size));
                    return (
                      <g
                        key={node.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedId(node.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') setSelectedId(node.id);
                        }}
                        className="cursor-pointer outline-none"
                      >
                        <circle
                          cx={positioned.x}
                          cy={positioned.y}
                          r={selectedNode ? radius + 4 : radius}
                          fill={style.fill}
                          stroke={selectedNode ? '#CE823E' : style.stroke}
                          strokeWidth={selectedNode ? 4 : 2}
                          className="transition-all"
                        />
                        <text
                          x={positioned.x}
                          y={positioned.y + radius + 14}
                          textAnchor="middle"
                          fontSize="11"
                          fontWeight={selectedNode ? 700 : 500}
                          fill={style.text}
                          className="pointer-events-none select-none"
                        >
                          {shortLabel(node.label)}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <IconBrain size={18} />
                Selected Node
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {selected ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{selected.type}</Badge>
                    {selected.subtitle && <Badge variant="outline">{selected.subtitle}</Badge>}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{selected.label}</div>
                    {selected.detail && (
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                        {selected.detail}
                      </p>
                    )}
                  </div>
                  {(selected.updatedAt || selected.createdAt) && (
                    <div className="text-xs text-muted-foreground">
                      {selected.updatedAt ? `Updated ${formatTime(selected.updatedAt)}` : `Created ${formatTime(selected.createdAt)}`}
                    </div>
                  )}
                  {selected.source && (
                    <div className="break-all rounded-md bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">
                      {selected.source}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No node selected.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <IconDatabase size={18} />
                Sources
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <SourceLine icon={<IconBrain size={13} />} label="Memory DB" value={data?.sources.memoryDb} />
              <SourceLine icon={<IconFileText size={13} />} label="Sessions" value={data?.sources.sessionsMap} />
              <SourceLine icon={<IconDatabase size={13} />} label="State Root" value={data?.sources.elevateRoot} />
              {data?.warnings.map((warning) => (
                <div key={warning} className="rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-700 dark:text-amber-300">
                  {warning}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function SourceLine({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string }) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-1.5 font-medium text-foreground">
        {icon}
        {label}
      </div>
      <div className="break-all rounded-md bg-muted px-2 py-1.5">{value || 'Not available'}</div>
    </div>
  );
}
