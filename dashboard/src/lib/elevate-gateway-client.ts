import type { RuntimeToolsSnapshot } from '@/lib/types';

type JsonRecord = Record<string, unknown>;

const DEFAULT_GATEWAY_ORIGIN = 'http://127.0.0.1:8642';

export interface ElevateGatewayProbe {
  baseUrl: string;
  healthUrl: string;
  detailedUrl: string;
  reachable: boolean;
  status: number | null;
  statusText: string | null;
  latencyMs: number | null;
  error: string | null;
  health: unknown | null;
  detailed: unknown | null;
}

export interface ElevateChatRequest {
  message: string;
  sessionId?: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  timeoutMs?: number;
}

export interface ElevateOrchestrationAgent {
  agent_id: string;
  id?: string;
  display_name: string;
  name?: string;
  role: string;
  tier: string;
  reports_to: string | null;
  lane: string;
  org: string;
  enabled: boolean;
  status: string;
  current_task: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
  run_counts?: {
    active_runs: number;
    recent_runs: number;
  };
}

export interface ElevateOrchestrationRun {
  run_id: string;
  id?: string;
  agent_id: string;
  route_label?: string | null;
  routing_label?: string | null;
  parent_run_id: string | null;
  parent_session_key: string | null;
  session_key: string | null;
  task: string;
  status: string;
  mode: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  summary: string | null;
  error: string | null;
  metadata?: Record<string, unknown>;
}

export interface ElevateOrchestrationSnapshot {
  generated_at: string;
  db_path: string;
  agents: ElevateOrchestrationAgent[];
  runs: ElevateOrchestrationRun[];
  active_runs: number;
  run_counts: Record<string, { active_runs: number; recent_runs: number }>;
}

export interface ElevateAgentInput {
  agent_id?: string;
  id?: string;
  display_name?: string;
  name?: string;
  role?: string;
  tier?: string;
  reports_to?: string | null;
  lane?: string;
  org?: string;
  enabled?: boolean;
  status?: string;
  current_task?: string | null;
  metadata?: Record<string, unknown>;
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed.slice(0, -3) : trimmed;
}

export function getElevateGatewayBaseUrl(): string {
  return normalizeBaseUrl(
    process.env.ELEVATE_GATEWAY_URL ||
    process.env.ELEVATE_AGENT_GATEWAY_URL ||
    DEFAULT_GATEWAY_ORIGIN,
  );
}

function gatewayHeaders(extra?: HeadersInit): HeadersInit {
  const token = process.env.ELEVATE_GATEWAY_API_KEY || process.env.ELEVATE_AGENT_GATEWAY_API_KEY;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra || {}),
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.name === 'AbortError' ? 'Gateway probe timed out' : err.message;
  return 'Gateway probe failed';
}

async function gatewayJson<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const baseUrl = getElevateGatewayBaseUrl();
  const method = options.method ?? 'GET';
  const response = await fetchWithTimeout(`${baseUrl}${path}`, {
    method,
    headers: gatewayHeaders(),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }, options.timeoutMs ?? 1500);
  const body = await readJson(response);
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body
      ? JSON.stringify((body as JsonRecord).error)
      : `Elevate gateway returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export async function probeElevateGateway(timeoutMs = 1500): Promise<ElevateGatewayProbe> {
  const baseUrl = getElevateGatewayBaseUrl();
  const healthUrl = `${baseUrl}/health`;
  const detailedUrl = `${baseUrl}/health/detailed`;
  const started = Date.now();

  try {
    const healthResponse = await fetchWithTimeout(healthUrl, { headers: gatewayHeaders() }, timeoutMs);
    const health = await readJson(healthResponse);
    let detailed: unknown | null = null;

    try {
      const detailedResponse = await fetchWithTimeout(detailedUrl, { headers: gatewayHeaders() }, timeoutMs);
      detailed = await readJson(detailedResponse);
    } catch {
      detailed = null;
    }

    return {
      baseUrl,
      healthUrl,
      detailedUrl,
      reachable: healthResponse.ok,
      status: healthResponse.status,
      statusText: healthResponse.statusText || null,
      latencyMs: Date.now() - started,
      error: healthResponse.ok ? null : `HTTP ${healthResponse.status}`,
      health,
      detailed,
    };
  } catch (err) {
    return {
      baseUrl,
      healthUrl,
      detailedUrl,
      reachable: false,
      status: null,
      statusText: null,
      latencyMs: Date.now() - started,
      error: errorMessage(err),
      health: null,
      detailed: null,
    };
  }
}

export async function getElevateOrchestration(timeoutMs = 1500): Promise<ElevateOrchestrationSnapshot> {
  return gatewayJson<ElevateOrchestrationSnapshot>('/api/orchestration', { timeoutMs });
}

export async function getElevateRuntimeTools(timeoutMs = 1500): Promise<RuntimeToolsSnapshot> {
  return gatewayJson<RuntimeToolsSnapshot>('/api/tools', { timeoutMs });
}

export async function getElevateAgents(timeoutMs = 1500): Promise<ElevateOrchestrationAgent[]> {
  const body = await gatewayJson<{ agents: ElevateOrchestrationAgent[] }>('/api/agents', { timeoutMs });
  return Array.isArray(body.agents) ? body.agents : [];
}

export async function getElevateAgent(agentId: string, timeoutMs = 1500): Promise<ElevateOrchestrationAgent> {
  const body = await gatewayJson<{ agent: ElevateOrchestrationAgent }>(
    `/api/agents/${encodeURIComponent(agentId)}`,
    { timeoutMs },
  );
  return body.agent;
}

export async function createElevateAgent(input: ElevateAgentInput, timeoutMs = 3000): Promise<ElevateOrchestrationAgent> {
  const body = await gatewayJson<{ agent: ElevateOrchestrationAgent }>('/api/agents', {
    method: 'POST',
    body: input,
    timeoutMs,
  });
  return body.agent;
}

export async function updateElevateAgent(
  agentId: string,
  updates: ElevateAgentInput,
  timeoutMs = 3000,
): Promise<ElevateOrchestrationAgent> {
  const body = await gatewayJson<{ agent: ElevateOrchestrationAgent }>(
    `/api/agents/${encodeURIComponent(agentId)}`,
    {
      method: 'PATCH',
      body: updates,
      timeoutMs,
    },
  );
  return body.agent;
}

export async function sendElevateChat(request: ElevateChatRequest): Promise<{
  baseUrl: string;
  status: number;
  response: unknown;
}> {
  const baseUrl = getElevateGatewayBaseUrl();
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (request.systemPrompt?.trim()) {
    messages.push({ role: 'system', content: request.systemPrompt.trim() });
  }
  messages.push({ role: 'user', content: request.message });

  const response = await fetchWithTimeout(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: gatewayHeaders(request.sessionId ? { 'X-Elevate-Session-Id': request.sessionId } : undefined),
    body: JSON.stringify({
      model: request.model || 'elevate-agent',
      messages,
      stream: false,
      temperature: typeof request.temperature === 'number' ? request.temperature : undefined,
    }),
  }, request.timeoutMs ?? 120_000);

  const body = await readJson(response);
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body
      ? JSON.stringify((body as JsonRecord).error)
      : `Elevate gateway returned HTTP ${response.status}`;
    throw new Error(message);
  }

  return {
    baseUrl,
    status: response.status,
    response: body,
  };
}
