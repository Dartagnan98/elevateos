'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOrg } from '@/hooks/use-org';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  IconAffiliate,
  IconAlertCircle,
  IconArrowsMaximize,
  IconBrain,
  IconDatabase,
  IconFileText,
  IconFocusCentered,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
  IconZoomIn,
  IconZoomOut,
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

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  degree: number;
  homeX: number;
  homeY: number;
  fx?: number;
  fy?: number;
}

interface SimEdge extends GraphEdge {
  sourceNode: SimNode;
  targetNode: SimNode;
}

interface MemoryGraphClientProps {
  initialOrg: string;
}

const VIEW_WIDTH = 1120;
const VIEW_HEIGHT = 700;
const CENTER = { x: VIEW_WIDTH / 2, y: VIEW_HEIGHT / 2 };
const DEFAULT_TRANSFORM = { x: -90, y: -48, k: 1.16 };

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'facts', label: 'Facts' },
  { id: 'entities', label: 'Entities' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'vectors', label: 'Vectors' },
] as const;

const NODE_STYLES: Record<NodeType, { fill: string; stroke: string; text: string; halo: string }> = {
  core: { fill: '#1B2A4A', stroke: '#9CAFD5', text: '#FFFFFF', halo: '#1B2A4A' },
  hub: { fill: '#044B35', stroke: '#B7D4C8', text: '#FFFFFF', halo: '#044B35' },
  fact: { fill: '#FEFBF4', stroke: '#CE823E', text: '#3F2B18', halo: '#CE823E' },
  entity: { fill: '#FFF8EF', stroke: '#CE823E', text: '#3F2B18', halo: '#CE823E' },
  category: { fill: '#EEF2F8', stroke: '#8094BC', text: '#1B2A4A', halo: '#8094BC' },
  session: { fill: '#E8F8F1', stroke: '#044B35', text: '#044B35', halo: '#044B35' },
  day: { fill: '#F6F7F6', stroke: '#94A3B8', text: '#334155', halo: '#94A3B8' },
  collection: { fill: '#EEF4FF', stroke: '#4D6DAB', text: '#1B2A4A', halo: '#4D6DAB' },
  embedding: { fill: '#F8F1FF', stroke: '#8B3CF1', text: '#5A238C', halo: '#8B3CF1' },
  file: { fill: '#F6F7F6', stroke: '#64748B', text: '#334155', halo: '#64748B' },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(value: string): number {
  return hashString(value) / 4294967295;
}

function shortLabel(label: string, max = 26): string {
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1)}...`;
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

function homeRadius(type: NodeType): number {
  switch (type) {
    case 'core': return 0;
    case 'hub': return 122;
    case 'category': return 210;
    case 'fact': return 275;
    case 'entity': return 350;
    case 'session': return 235;
    case 'day': return 320;
    case 'collection': return 355;
    case 'embedding': return 390;
    case 'file': return 300;
  }
}

function typeAngle(type: NodeType): number {
  const offsets: Record<NodeType, number> = {
    core: 0,
    hub: -0.25,
    category: 0.35,
    fact: 0.02,
    entity: 0.62,
    session: 2.1,
    day: 2.55,
    collection: 3.65,
    embedding: 4.82,
    file: 3.18,
  };
  return offsets[type];
}

function nodeRadius(node: GraphNode, degree: number): number {
  if (node.type === 'core') return 34;
  if (node.type === 'hub') return 24;
  return clamp(8 + node.size * 0.7 + Math.sqrt(degree) * 2.8, 10, 34);
}

function formatTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function typeLabel(type: NodeType): string {
  const labels: Record<NodeType, string> = {
    core: 'Core',
    hub: 'Hub',
    fact: 'Fact',
    entity: 'Entity',
    category: 'Category',
    session: 'Session',
    day: 'Day',
    collection: 'Collection',
    embedding: 'Vector',
    file: 'File',
  };
  return labels[type];
}

function createSimulationNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  previous: Map<string, SimNode>,
): Map<string, SimNode> {
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  const byType = nodes.reduce<Record<string, GraphNode[]>>((acc, node) => {
    acc[node.type] = acc[node.type] ?? [];
    acc[node.type].push(node);
    return acc;
  }, {});

  const simNodes = new Map<string, SimNode>();
  for (const [type, group] of Object.entries(byType) as Array<[NodeType, GraphNode[]]>) {
    const sorted = [...group].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.label.localeCompare(b.label));
    sorted.forEach((node, index) => {
      const existing = previous.get(node.id);
      const spread = type === 'hub' ? Math.PI * 2 : Math.PI * 1.72;
      const angle = typeAngle(type) + (sorted.length <= 1 ? 0 : (index / sorted.length) * spread) + seededUnit(node.id) * 0.22;
      const radius = homeRadius(type);
      const wobble = (seededUnit(`${node.id}:wobble`) - 0.5) * 44;
      const homeX = CENTER.x + Math.cos(angle) * (radius + wobble);
      const homeY = CENTER.y + Math.sin(angle) * (radius + wobble) * 0.72;
      const nodeDegree = degree.get(node.id) ?? 0;
      simNodes.set(node.id, {
        ...node,
        x: existing?.x ?? homeX,
        y: existing?.y ?? homeY,
        vx: existing?.vx ?? 0,
        vy: existing?.vy ?? 0,
        radius: nodeRadius(node, nodeDegree),
        degree: nodeDegree,
        homeX,
        homeY,
        fx: existing?.fx,
        fy: existing?.fy,
      });
    });
  }
  return simNodes;
}

function createSimulationEdges(edges: GraphEdge[], nodes: Map<string, SimNode>): SimEdge[] {
  return edges.flatMap((edge) => {
    const sourceNode = nodes.get(edge.source);
    const targetNode = nodes.get(edge.target);
    if (!sourceNode || !targetNode) return [];
    return [{ ...edge, sourceNode, targetNode }];
  });
}

function stepSimulation(nodes: SimNode[], edges: SimEdge[], selectedId: string | null) {
  for (const edge of edges) {
    const source = edge.sourceNode;
    const target = edge.targetNode;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const desired = source.radius + target.radius + (source.type === 'core' || target.type === 'core' ? 106 : 78);
    const pull = (distance - desired) * (0.004 + Math.min(edge.weight, 8) * 0.0014);
    const fx = (dx / distance) * pull;
    const fy = (dy / distance) * pull;
    if (source.fx === undefined) {
      source.vx += fx;
      source.vy += fy;
    }
    if (target.fx === undefined) {
      target.vx -= fx;
      target.vy -= fy;
    }
  }

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      const dx = b.x - a.x || 0.01;
      const dy = b.y - a.y || 0.01;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq > 42000) continue;
      const distance = Math.sqrt(distanceSq);
      const minDistance = a.radius + b.radius + 20;
      const push = ((minDistance * minDistance) / Math.max(distanceSq, 80)) * 0.9;
      const fx = (dx / distance) * push;
      const fy = (dy / distance) * push;
      if (a.fx === undefined) {
        a.vx -= fx;
        a.vy -= fy;
      }
      if (b.fx === undefined) {
        b.vx += fx;
        b.vy += fy;
      }
    }
  }

  for (const node of nodes) {
    const homeStrength = node.type === 'core' ? 0.035 : node.type === 'hub' ? 0.012 : 0.0055;
    const targetX = node.type === 'core' ? CENTER.x : node.homeX;
    const targetY = node.type === 'core' ? CENTER.y : node.homeY;
    if (node.fx === undefined) {
      node.vx += (targetX - node.x) * homeStrength;
      node.vy += (targetY - node.y) * homeStrength;
      if (selectedId && (node.id === selectedId || node.type === 'core')) {
        node.vx += (CENTER.x - node.x) * 0.002;
        node.vy += (CENTER.y - node.y) * 0.002;
      }
    }
    node.vx *= 0.86;
    node.vy *= 0.86;
    node.x = node.fx ?? clamp(node.x + node.vx, 36, VIEW_WIDTH - 36);
    node.y = node.fy ?? clamp(node.y + node.vy, 36, VIEW_HEIGHT - 36);
  }
}

export function MemoryGraphClient({ initialOrg }: MemoryGraphClientProps) {
  const { currentOrg } = useOrg();
  const org = currentOrg && currentOrg !== 'all' ? currentOrg : initialOrg;
  const [data, setData] = useState<MemoryGraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeFilter, setActiveFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [selectedId, setSelectedId] = useState<string>('core:memory');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [frame, setFrame] = useState(0);
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [transform, setTransform] = useState(DEFAULT_TRANSFORM);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const nodesRef = useRef<Map<string, SimNode>>(new Map());
  const edgesRef = useRef<SimEdge[]>([]);
  const dragRef = useRef<{ id: string; pointerId: number } | null>(null);
  const panRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const frameRef = useRef(0);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ org, limit: '220' });
      const res = await fetch(`/api/memory/graph?${params.toString()}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to load memory graph');
      setData(payload);
      setSelectedId((current) => (payload.nodes.some((node: GraphNode) => node.id === current) ? current : 'core:memory'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memory graph');
    } finally {
      setLoading(false);
    }
  }, [org]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setMotionEnabled(!query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

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

  useEffect(() => {
    const nextNodes = createSimulationNodes(visibleNodes, visibleEdges, nodesRef.current);
    nodesRef.current = nextNodes;
    edgesRef.current = createSimulationEdges(visibleEdges, nextNodes);
    for (let i = 0; i < 40; i++) {
      stepSimulation(Array.from(nodesRef.current.values()), edgesRef.current, selectedId);
    }
    setFrame((value) => value + 1);
  }, [selectedId, visibleEdges, visibleNodes]);

  useEffect(() => {
    if (!motionEnabled) return;
    let raf = 0;
    const loop = () => {
      stepSimulation(Array.from(nodesRef.current.values()), edgesRef.current, selectedId);
      frameRef.current += 1;
      if (frameRef.current % 2 === 0) {
        setFrame((value) => value + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [motionEnabled, selectedId]);

  useEffect(() => {
    if (selectedId && !visibleNodeIds.has(selectedId) && visibleNodes[0]) {
      setSelectedId(visibleNodes[0].id);
    }
  }, [selectedId, visibleNodeIds, visibleNodes]);

  const simNodes = useMemo(() => Array.from(nodesRef.current.values()), [frame]);
  const simEdges = useMemo(() => edgesRef.current, [frame]);
  const selected = data?.nodes.find((node) => node.id === selectedId) ?? visibleNodes[0] ?? null;
  const focusId = hoveredId ?? selected?.id ?? null;

  const neighborIds = useMemo(() => {
    const ids = new Set<string>();
    if (!focusId) return ids;
    ids.add(focusId);
    for (const edge of visibleEdges) {
      if (edge.source === focusId) ids.add(edge.target);
      if (edge.target === focusId) ids.add(edge.source);
    }
    return ids;
  }, [focusId, visibleEdges]);

  const selectedNeighbors = useMemo(() => {
    if (!selected) return [];
    const ids = new Set<string>();
    for (const edge of visibleEdges) {
      if (edge.source === selected.id) ids.add(edge.target);
      if (edge.target === selected.id) ids.add(edge.source);
    }
    return visibleNodes.filter((node) => ids.has(node.id)).slice(0, 8);
  }, [selected, visibleEdges, visibleNodes]);

  const stats = data?.stats ?? {};
  const selectedSimNode = selected ? nodesRef.current.get(selected.id) : null;

  const graphPoint = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: CENTER.x, y: CENTER.y };
    const viewX = ((clientX - rect.left) / rect.width) * VIEW_WIDTH;
    const viewY = ((clientY - rect.top) / rect.height) * VIEW_HEIGHT;
    return {
      x: (viewX - transform.x) / transform.k,
      y: (viewY - transform.y) / transform.k,
    };
  }, [transform]);

  const resetView = useCallback(() => {
    setTransform(DEFAULT_TRANSFORM);
  }, []);

  const zoomBy = useCallback((amount: number) => {
    setTransform((current) => ({ ...current, k: clamp(current.k * amount, 0.45, 2.4) }));
  }, []);

  const focusSelected = useCallback(() => {
    if (!selectedSimNode) return;
    setTransform((current) => ({
      k: clamp(Math.max(current.k, 1.08), 0.45, 2.4),
      x: CENTER.x - selectedSimNode.x * clamp(Math.max(current.k, 1.08), 0.45, 2.4),
      y: CENTER.y - selectedSimNode.y * clamp(Math.max(current.k, 1.08), 0.45, 2.4),
    }));
  }, [selectedSimNode]);

  const handleWheel = useCallback((event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewX = ((event.clientX - rect.left) / rect.width) * VIEW_WIDTH;
    const viewY = ((event.clientY - rect.top) / rect.height) * VIEW_HEIGHT;
    const before = graphPoint(event.clientX, event.clientY);
    const nextK = clamp(transform.k * Math.exp(-event.deltaY * 0.0012), 0.45, 2.4);
    setTransform({
      k: nextK,
      x: viewX - before.x * nextK,
      y: viewY - before.y * nextK,
    });
  }, [graphPoint, transform.k]);

  const handleSvgPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const dragging = dragRef.current;
    if (dragging?.pointerId === event.pointerId) {
      const node = nodesRef.current.get(dragging.id);
      const point = graphPoint(event.clientX, event.clientY);
      if (node) {
        node.fx = point.x;
        node.fy = point.y;
        node.x = point.x;
        node.y = point.y;
        node.vx = 0;
        node.vy = 0;
        setFrame((value) => value + 1);
      }
      return;
    }

    const panning = panRef.current;
    if (panning?.pointerId === event.pointerId) {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = ((event.clientX - panning.x) / rect.width) * VIEW_WIDTH;
      const dy = ((event.clientY - panning.y) / rect.height) * VIEW_HEIGHT;
      panRef.current = { ...panning, x: event.clientX, y: event.clientY };
      setTransform((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
    }
  }, [graphPoint]);

  const handlePointerUp = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const dragging = dragRef.current;
    if (dragging?.pointerId === event.pointerId) {
      const node = nodesRef.current.get(dragging.id);
      if (node) {
        node.fx = undefined;
        node.fy = undefined;
      }
      dragRef.current = null;
    }
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null;
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
  }, []);

  const startNodeDrag = useCallback((event: React.PointerEvent<SVGGElement>, nodeId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(nodeId);
    setHoveredId(nodeId);
    dragRef.current = { id: nodeId, pointerId: event.pointerId };
    const point = graphPoint(event.clientX, event.clientY);
    const node = nodesRef.current.get(nodeId);
    if (node) {
      node.fx = point.x;
      node.fy = point.y;
    }
    const svg = svgRef.current;
    try {
      svg?.setPointerCapture(event.pointerId);
    } catch {
      // Older SVG implementations can no-op here.
    }
  }, [graphPoint]);

  return (
    <div className="space-y-4">
      <div className="grid gap-2 md:grid-cols-4">
        <Metric label="Facts" value={stats.facts ?? 0} tone="navy" />
        <Metric label="Entities" value={stats.entities ?? 0} tone="green" />
        <Metric label="Sessions" value={stats.sessions ?? 0} tone="copper" />
        <Metric label="Vectors" value={stats.embeddings ?? 0} tone="violet" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <div className="flex flex-col gap-3 border-b bg-background/50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
                <IconAffiliate size={17} />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">Local Memory Graph</h2>
                <p className="text-xs text-muted-foreground">
                  {visibleNodes.length} nodes / {visibleEdges.length} links
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <IconSearch size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search nodes"
                  className="h-8 w-48 rounded-lg border bg-background pl-8 pr-2 text-xs outline-none focus:border-primary"
                />
              </div>
              <div className="flex items-center gap-1 rounded-lg border bg-background p-0.5">
                <IconButton label="Zoom out" onClick={() => zoomBy(0.84)} icon={<IconZoomOut size={14} />} />
                <IconButton label="Zoom in" onClick={() => zoomBy(1.18)} icon={<IconZoomIn size={14} />} />
                <IconButton label="Fit view" onClick={resetView} icon={<IconArrowsMaximize size={14} />} />
                <IconButton label="Center selected" onClick={focusSelected} icon={<IconFocusCentered size={14} />} />
                <IconButton
                  label={motionEnabled ? 'Pause motion' : 'Resume motion'}
                  onClick={() => setMotionEnabled((value) => !value)}
                  icon={motionEnabled ? <IconPlayerPause size={14} /> : <IconPlayerPlay size={14} />}
                />
              </div>
              <Button variant="outline" size="sm" onClick={loadGraph} disabled={loading}>
                <IconRefresh size={14} className={cn(loading && 'animate-spin')} />
                Refresh
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1 border-b bg-background/35 px-4 py-2">
            {FILTERS.map((filter) => (
              <button
                key={filter.id}
                onClick={() => setActiveFilter(filter.id)}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                  activeFilter === filter.id
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="relative bg-[#f8f6f0] dark:bg-[#101827]">
            {error ? (
              <div className="m-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
                <IconAlertCircle size={16} />
                {error}
              </div>
            ) : (
              <>
                {loading && (
                  <div className="absolute inset-0 z-10 grid place-items-center bg-background/70 text-sm text-muted-foreground backdrop-blur-[1px]">
                    Loading graph...
                  </div>
                )}
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
                  className="h-[620px] w-full cursor-grab touch-none select-none active:cursor-grabbing"
                  onWheel={handleWheel}
                  onPointerDown={handleSvgPointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  aria-label="Memory graph"
                >
                  <defs>
                    <pattern id="memory-grid" width="38" height="38" patternUnits="userSpaceOnUse">
                      <path d="M 38 0 L 0 0 0 38" fill="none" stroke="currentColor" strokeWidth="0.7" opacity="0.16" />
                    </pattern>
                    <filter id="node-shadow" x="-35%" y="-35%" width="170%" height="170%">
                      <feDropShadow dx="0" dy="8" stdDeviation="9" floodColor="#101827" floodOpacity="0.13" />
                    </filter>
                  </defs>
                  <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="currentColor" className="text-[#f8f6f0] dark:text-[#101827]" />
                  <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="url(#memory-grid)" className="text-[#1B2A4A] dark:text-[#8DA2D1]" />
                  <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
                    {simEdges.map((edge) => {
                      const dimmed = neighborIds.size > 0 && !neighborIds.has(edge.source) && !neighborIds.has(edge.target);
                      const highlighted = focusId ? edge.source === focusId || edge.target === focusId : false;
                      return (
                        <line
                          key={edge.id}
                          x1={edge.sourceNode.x}
                          y1={edge.sourceNode.y}
                          x2={edge.targetNode.x}
                          y2={edge.targetNode.y}
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeOpacity={highlighted ? 0.64 : dimmed ? 0.09 : Math.min(0.34, 0.12 + edge.weight * 0.026)}
                          strokeWidth={highlighted ? Math.min(5.5, 1.8 + edge.weight * 0.42) : Math.min(3.4, 0.8 + edge.weight * 0.2)}
                          className={cn(
                            'text-[#95A0AE] transition-opacity duration-200 dark:text-[#697D9D]',
                            highlighted && 'text-[#CE823E] dark:text-[#CE823E]',
                          )}
                        />
                      );
                    })}

                    {simNodes.map((node, index) => {
                      const style = NODE_STYLES[node.type];
                      const selectedNode = selected?.id === node.id;
                      const hoveredNode = hoveredId === node.id;
                      const dimmed = neighborIds.size > 0 && !neighborIds.has(node.id);
                      const connected = neighborIds.has(node.id);
                      const showLabel = selectedNode || hoveredNode || connected || node.degree > 2 || node.radius > 20 || transform.k > 1.15;
                      const labelOpacity = showLabel ? (dimmed ? 0.28 : 0.92) : 0;
                      return (
                        <g
                          key={node.id}
                          role="button"
                          tabIndex={0}
                          onPointerDown={(event) => startNodeDrag(event, node.id)}
                          onMouseEnter={() => setHoveredId(node.id)}
                          onMouseLeave={() => setHoveredId((value) => (value === node.id ? null : value))}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') setSelectedId(node.id);
                          }}
                          className="cursor-grab outline-none active:cursor-grabbing"
                          style={{ animationDelay: `${Math.min(index * 12, 480)}ms` }}
                        >
                          {(selectedNode || hoveredNode) && (
                            <circle
                              cx={node.x}
                              cy={node.y}
                              r={node.radius + 15}
                              fill={style.halo}
                              opacity={selectedNode ? 0.14 : 0.09}
                            >
                              {motionEnabled && (
                                <animate attributeName="r" values={`${node.radius + 8};${node.radius + 18};${node.radius + 8}`} dur="2.8s" repeatCount="indefinite" />
                              )}
                            </circle>
                          )}
                          <circle
                            cx={node.x}
                            cy={node.y}
                            r={node.radius + (selectedNode ? 3 : hoveredNode ? 2 : 0)}
                            fill={style.fill}
                            stroke={selectedNode ? '#CE823E' : style.stroke}
                            strokeWidth={selectedNode ? 4 : hoveredNode ? 3 : 2}
                            opacity={dimmed ? 0.36 : 1}
                            filter={dimmed ? undefined : 'url(#node-shadow)'}
                            className="transition-[opacity,stroke-width] duration-200"
                          />
                          <circle
                            cx={node.x - node.radius * 0.28}
                            cy={node.y - node.radius * 0.32}
                            r={Math.max(2, node.radius * 0.22)}
                            fill="#FFFFFF"
                            opacity={dimmed ? 0.1 : 0.42}
                            className="pointer-events-none"
                          />
                          <text
                            x={node.x}
                            y={node.y + node.radius + 15}
                            textAnchor="middle"
                            fontSize={selectedNode ? 13 : 11}
                            fontWeight={selectedNode ? 800 : 650}
                            stroke="#f8f6f0"
                            strokeWidth="5"
                            paintOrder="stroke"
                            opacity={labelOpacity}
                            className="pointer-events-none select-none transition-opacity duration-200 dark:stroke-[#101827]"
                          >
                            {shortLabel(node.label)}
                          </text>
                          <text
                            x={node.x}
                            y={node.y + node.radius + 29}
                            textAnchor="middle"
                            fontSize="9"
                            fontWeight={700}
                            fill={style.text}
                            opacity={selectedNode || hoveredNode ? 0.68 : 0}
                            className="pointer-events-none select-none transition-opacity duration-200"
                          >
                            {typeLabel(node.type)}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                </svg>
              </>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border bg-card shadow-sm">
            <div className="border-b px-4 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <IconBrain size={17} />
                Selected Node
              </h2>
            </div>
            <div className="space-y-4 px-4 py-4">
              {selected ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{typeLabel(selected.type)}</Badge>
                    {selected.subtitle && <Badge variant="outline">{selected.subtitle}</Badge>}
                    <Badge variant="outline">{selectedSimNode?.degree ?? 0} links</Badge>
                  </div>
                  <div>
                    <div className="text-sm font-semibold leading-snug">{selected.label}</div>
                    {selected.detail && (
                      <p className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                        {selected.detail}
                      </p>
                    )}
                  </div>
                  {(selected.updatedAt || selected.createdAt) && (
                    <div className="rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
                      {selected.updatedAt ? `Updated ${formatTime(selected.updatedAt)}` : `Created ${formatTime(selected.createdAt)}`}
                    </div>
                  )}
                  {selected.source && (
                    <div className="break-all rounded-md bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">
                      {selected.source}
                    </div>
                  )}
                  {selectedNeighbors.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connected</div>
                      <div className="space-y-1.5">
                        {selectedNeighbors.map((node) => (
                          <button
                            key={node.id}
                            onClick={() => setSelectedId(node.id)}
                            className="flex w-full items-center justify-between gap-3 rounded-md bg-muted/55 px-2 py-2 text-left text-xs transition-colors hover:bg-muted"
                          >
                            <span className="min-w-0 truncate font-medium">{node.label}</span>
                            <span className="shrink-0 text-muted-foreground">{typeLabel(node.type)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No node selected.</p>
              )}
            </div>
          </section>

          <section className="rounded-lg border bg-card shadow-sm">
            <div className="border-b px-4 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <IconDatabase size={17} />
                Sources
              </h2>
            </div>
            <div className="space-y-3 px-4 py-4 text-xs text-muted-foreground">
              <SourceLine icon={<IconBrain size={13} />} label="Memory DB" value={data?.sources.memoryDb} />
              <SourceLine icon={<IconFileText size={13} />} label="Sessions" value={data?.sources.sessionsMap} />
              <SourceLine icon={<IconDatabase size={13} />} label="State Root" value={data?.sources.elevateRoot} />
              {data?.warnings.map((warning) => (
                <div key={warning} className="rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-700 dark:text-amber-300">
                  {warning}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function IconButton({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {icon}
    </button>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'navy' | 'green' | 'copper' | 'violet' }) {
  const toneClass = {
    navy: 'bg-[#1B2A4A] text-white',
    green: 'bg-[#044B35] text-white',
    copper: 'bg-[#CE823E] text-white',
    violet: 'bg-[#7C3AED] text-white',
  }[tone];

  return (
    <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 shadow-sm">
      <div>
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      </div>
      <div className={cn('size-2.5 rounded-full', toneClass)} />
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
