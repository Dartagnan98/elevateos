// ElevateOS Dashboard - Agent discovery and data reading module
// Discovers agents, reads identity/config files, returns typed agent data

import fs from 'fs/promises';
import path from 'path';
import {
  CTX_ROOT,
  getAgentDir,
  getHeartbeatPath,
  getAllAgents,
} from '@/lib/config';
import { IPCClient } from '@/lib/ipc-client';
import { getHeartbeat, getHealthStatus } from '@/lib/data/heartbeats';
import { getTasksByAgent } from '@/lib/data/tasks';
import { parseIdentityMd } from '@/lib/markdown-parser';
import {
  getElevateOrchestration,
  getElevateRuntimeTools,
  type ElevateOrchestrationAgent,
  type ElevateOrchestrationRun,
  type ElevateOrchestrationSnapshot,
} from '@/lib/elevate-gateway-client';
import type {
  AgentSummary,
  AgentDetail,
  AgentIdentity,
  AgentPaths,
  HealthStatus,
  Heartbeat,
  MemoryFile,
  LogFile,
  AgentToolHook,
  AgentToolSettings,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve all filesystem paths for an agent.
 */
export function getAgentPaths(name: string, org?: string): AgentPaths {
  const agentDir = getAgentDir(name, org);
  const claudeDir = path.join(agentDir, '.claude');
  return {
    agentDir,
    claudeDir,
    identityMd: path.join(agentDir, 'IDENTITY.md'),
    soulMd: path.join(agentDir, 'SOUL.md'),
    goalsMd: path.join(agentDir, 'GOALS.md'),
    toolsMd: path.join(agentDir, 'TOOLS.md'),
    memoryMd: path.join(agentDir, 'MEMORY.md'),
    memoryDir: path.join(agentDir, 'memory'),
    heartbeat: getHeartbeatPath(name),
    logsDir: path.join(CTX_ROOT, 'logs', name),
    claudeSettingsJson: path.join(claudeDir, 'settings.json'),
  };
}

// ---------------------------------------------------------------------------
// File reading helpers
// ---------------------------------------------------------------------------

async function readFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

async function readJsonOrNull(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function parseToolSettings(raw: unknown): AgentToolSettings {
  if (!raw || typeof raw !== 'object') {
    return { allow: [], hooks: [] };
  }

  const settings = raw as Record<string, unknown>;
  const permissions = settings.permissions && typeof settings.permissions === 'object'
    ? settings.permissions as Record<string, unknown>
    : {};
  const statusLine = settings.statusLine && typeof settings.statusLine === 'object'
    ? settings.statusLine as Record<string, unknown>
    : undefined;

  const hooks: AgentToolHook[] = [];
  const hooksConfig = settings.hooks && typeof settings.hooks === 'object'
    ? settings.hooks as Record<string, unknown>
    : {};

  for (const [event, entries] of Object.entries(hooksConfig)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const hookEntry = entry as Record<string, unknown>;
      const matcher = typeof hookEntry.matcher === 'string' ? hookEntry.matcher : undefined;
      const nestedHooks = Array.isArray(hookEntry.hooks) ? hookEntry.hooks : [];
      for (const nested of nestedHooks) {
        if (!nested || typeof nested !== 'object') continue;
        const hook = nested as Record<string, unknown>;
        if (typeof hook.command !== 'string') continue;
        hooks.push({
          event,
          matcher,
          command: hook.command,
          timeout: typeof hook.timeout === 'number' ? hook.timeout : undefined,
        });
      }
    }
  }

  return {
    allow: normalizeStringList(permissions.allow),
    statusLine: statusLine ? {
      command: typeof statusLine.command === 'string' ? statusLine.command : undefined,
      refreshInterval: typeof statusLine.refreshInterval === 'number' ? statusLine.refreshInterval : undefined,
      timeout: typeof statusLine.timeout === 'number' ? statusLine.timeout : undefined,
    } : undefined,
    hooks,
  };
}

// ---------------------------------------------------------------------------
// Agent identity
// ---------------------------------------------------------------------------

/**
 * Read and parse an agent's IDENTITY.md. Returns defaults if missing.
 */
export async function getAgentIdentity(
  name: string,
  org?: string,
): Promise<AgentIdentity> {
  const paths = getAgentPaths(name, org);
  const raw = await readFileOrEmpty(paths.identityMd);

  if (!raw) {
    return {
      name,
      role: '',
      emoji: '',
      vibe: '',
      workStyle: '',
      raw: '',
    };
  }

  const { fields } = parseIdentityMd(raw);
  return {
    name: fields.name || name,
    role: fields.role,
    emoji: fields.emoji,
    vibe: fields.vibe,
    workStyle: fields.workStyle,
    raw,
  };
}

// ---------------------------------------------------------------------------
// Agent discovery
// ---------------------------------------------------------------------------

type RuntimeStatus = 'running' | 'stopped' | 'crashed' | 'starting' | 'halted';

interface RuntimeAgentStatus {
  name: string;
  status: RuntimeStatus;
}

async function getGatewayOrchestrationOrNull(): Promise<ElevateOrchestrationSnapshot | null> {
  try {
    return await getElevateOrchestration(800);
  } catch {
    return null;
  }
}

async function getRuntimeToolsOrNull() {
  try {
    return await getElevateRuntimeTools(800);
  } catch {
    return null;
  }
}

function gatewayAgentMap(snapshot: ElevateOrchestrationSnapshot | null): Map<string, ElevateOrchestrationAgent> {
  return new Map((snapshot?.agents ?? []).map((agent) => [agent.agent_id, agent]));
}

function activeGatewayRun(
  snapshot: ElevateOrchestrationSnapshot | null,
  agentId: string,
): ElevateOrchestrationRun | undefined {
  return (snapshot?.runs ?? []).find((run) => (
    run.agent_id === agentId &&
    (run.status === 'queued' || run.status === 'running')
  ));
}

function healthFromGatewayAgent(agent?: ElevateOrchestrationAgent): HealthStatus | undefined {
  if (!agent) return undefined;
  if (!agent.enabled || agent.status === 'disabled' || agent.status === 'offline' || agent.status === 'error') {
    return 'down';
  }
  if (agent.status === 'running' || (agent.run_counts?.active_runs ?? 0) > 0) return 'starting';
  return 'healthy';
}

async function getRuntimeStatusMap(): Promise<Map<string, RuntimeStatus>> {
  const instanceId = process.env.ELEVATE_INSTANCE_ID ?? process.env.CTX_INSTANCE_ID ?? 'default';
  const ipc = new IPCClient(instanceId);

  try {
    const response = await ipc.send({ type: 'status' });
    if (!response.success || !Array.isArray(response.data)) return new Map();

    return new Map(
      response.data
        .filter((item): item is RuntimeAgentStatus => (
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as RuntimeAgentStatus).name === 'string' &&
          typeof (item as RuntimeAgentStatus).status === 'string'
        ))
        .map((item) => [item.name, item.status]),
    );
  } catch {
    return new Map();
  }
}

function healthFromHeartbeatAndRuntime(
  heartbeat: Heartbeat | null,
  runtimeStatus?: RuntimeStatus,
): HealthStatus {
  const heartbeatHealth = heartbeat ? getHealthStatus(heartbeat) : 'down';

  if (heartbeatHealth === 'healthy') return 'healthy';
  if (runtimeStatus === 'running' || runtimeStatus === 'starting') return 'starting';
  if (runtimeStatus === 'crashed' || runtimeStatus === 'halted') return 'down';
  return heartbeatHealth;
}

/**
 * Discover all agents, enriched with heartbeat data.
 * If org is provided, filters to that org only.
 */
export async function discoverAgents(org?: string): Promise<AgentSummary[]> {
  const allAgents = getAllAgents();
  const gatewaySnapshot = await getGatewayOrchestrationOrNull();
  const gatewayAgents = gatewayAgentMap(gatewaySnapshot);
  const agents = org ? allAgents.filter((a) => a.org === org) : [...allAgents];
  const seen = new Set(agents.map((agent) => agent.name));

  for (const gatewayAgent of gatewaySnapshot?.agents ?? []) {
    if (org && gatewayAgent.org !== org) continue;
    if (seen.has(gatewayAgent.agent_id)) continue;
    agents.push({ name: gatewayAgent.agent_id, org: gatewayAgent.org ?? '' });
    seen.add(gatewayAgent.agent_id);
  }

  const runtimeStatuses = await getRuntimeStatusMap();

  const summaries = await Promise.all(
    agents.map(async (agent) => {
      const identity = await getAgentIdentity(agent.name, agent.org);
      const hb = await getHeartbeat(agent.name);
      const gatewayAgent = gatewayAgents.get(agent.name);
      const gatewayRun = activeGatewayRun(gatewaySnapshot, agent.name);
      const localHealth = healthFromHeartbeatAndRuntime(hb, runtimeStatuses.get(agent.name));
      const gatewayHealth = healthFromGatewayAgent(gatewayAgent);
      const health = localHealth === 'healthy' ? localHealth : gatewayHealth ?? localHealth;

      // Get tasks for today count and current task
      let currentTask: string | undefined;
      let tasksToday = 0;
      try {
        const agentTasks = getTasksByAgent(agent.name, agent.org);
        const inProgress = agentTasks.find((t) => t.status === 'in_progress');
        currentTask = inProgress?.title ?? hb?.current_task ?? undefined;

        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        const todayISO = todayStart.toISOString();
        tasksToday = agentTasks.filter(
          (t) => t.completed_at && t.completed_at >= todayISO,
        ).length;
      } catch {
        // Tasks DB may not be available
        currentTask = hb?.current_task ?? undefined;
      }

      const gatewayRouteLabel = gatewayRun?.route_label ?? gatewayRun?.routing_label ?? null;
      currentTask = gatewayRun?.task
        ? `${gatewayRouteLabel ? `${gatewayRouteLabel}: ` : ''}${gatewayRun.task}`
        : gatewayAgent?.current_task ?? currentTask;

      const summary: AgentSummary & {
        systemName: string;
        emoji: string;
        role: string;
        tasksToday: number;
      } = {
        systemName: agent.name,
        name: gatewayAgent?.display_name || identity.name,
        org: agent.org || gatewayAgent?.org || '',
        health,
        lastHeartbeat: hb?.last_heartbeat ?? gatewayAgent?.last_seen_at ?? gatewayAgent?.updated_at ?? undefined,
        currentTask,
        emoji: identity.emoji,
        role: gatewayAgent?.role || identity.role,
        tasksToday,
      };

      return summary;
    }),
  );

  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Agent detail
// ---------------------------------------------------------------------------

/**
 * Get comprehensive data for the agent detail page.
 */
export async function getAgentDetail(
  name: string,
  org?: string,
): Promise<AgentDetail> {
  const paths = getAgentPaths(name, org);

  const [
    identity,
    soulRaw,
    goalsRaw,
    toolsRaw,
    toolSettingsRaw,
    memoryRaw,
    hb,
    memoryFiles,
    logFiles,
  ] =
    await Promise.all([
      getAgentIdentity(name, org),
      readFileOrEmpty(paths.soulMd),
      readFileOrEmpty(paths.goalsMd),
      readFileOrEmpty(paths.toolsMd),
      readJsonOrNull(paths.claudeSettingsJson),
      readFileOrEmpty(paths.memoryMd),
      getHeartbeat(name),
      getAgentMemoryFiles(name, org),
      getAgentLogFiles(name, org),
    ]);

  const runtimeStatuses = await getRuntimeStatusMap();
  const [gatewaySnapshot, runtimeTools] = await Promise.all([
    getGatewayOrchestrationOrNull(),
    getRuntimeToolsOrNull(),
  ]);
  const gatewayAgent = gatewayAgentMap(gatewaySnapshot).get(name);
  const localHealth = healthFromHeartbeatAndRuntime(hb, runtimeStatuses.get(name));
  const gatewayHealth = healthFromGatewayAgent(gatewayAgent);
  const health = localHealth === 'healthy' ? localHealth : gatewayHealth ?? localHealth;
  const mergedIdentity = {
    ...identity,
    name: gatewayAgent?.display_name || identity.name,
    role: gatewayAgent?.role || identity.role,
  };

  return {
    name: mergedIdentity.name,
    org: org ?? gatewayAgent?.org ?? '',
    identity: mergedIdentity,
    soulRaw,
    goalsRaw,
    toolsRaw,
    toolSettings: parseToolSettings(toolSettingsRaw),
    memoryRaw,
    memoryFiles,
    heartbeat: hb,
    health,
    logFiles,
    agentDir: paths.agentDir,
    runtimeTools,
  };
}

// ---------------------------------------------------------------------------
// Memory file listing
// ---------------------------------------------------------------------------

/**
 * List daily memory files from agent's memory directory, sorted newest first.
 */
export async function getAgentMemoryFiles(
  name: string,
  org?: string,
): Promise<MemoryFile[]> {
  const paths = getAgentPaths(name, org);
  const memDir = paths.memoryDir;

  try {
    const entries = await fs.readdir(memDir, { withFileTypes: true });
    // Only include daily memory files matching YYYY-MM-DD.md pattern
    const datePattern = /^\d{4}-\d{2}-\d{2}\.md$/;
    const mdFiles = entries.filter(
      (e) => e.isFile() && datePattern.test(e.name),
    );

    const files: MemoryFile[] = await Promise.all(
      mdFiles.map(async (entry) => {
        const fullPath = path.join(memDir, entry.name);
        const stat = await fs.stat(fullPath);
        // Extract date from filename (e.g., 2025-01-15.md)
        const date = entry.name.replace(/\.md$/, '');
        return {
          date,
          path: fullPath,
          size: stat.size,
        };
      }),
    );

    // Sort newest first
    return files.sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Log file listing
// ---------------------------------------------------------------------------

const LOG_TYPES: Record<string, string> = {
  'activity.log': 'activity',
  'stdout.log': 'stdout',
  'stderr.log': 'stderr',
  'crash.log': 'crash',
  'fast-checker.log': 'fast-checker',
};

/**
 * List available log files for an agent.
 */
export async function getAgentLogFiles(
  name: string,
  org?: string,
): Promise<LogFile[]> {
  const paths = getAgentPaths(name, org);
  const logsDir = paths.logsDir;

  try {
    const entries = await fs.readdir(logsDir, { withFileTypes: true });
    const logEntries = entries.filter((e) => e.isFile());

    const allFiles: LogFile[] = await Promise.all(
      logEntries.map(async (entry) => {
        const fullPath = path.join(logsDir, entry.name);
        const stat = await fs.stat(fullPath);
        const type = LOG_TYPES[entry.name] ?? entry.name.replace(/\.log$/, '');
        return {
          type,
          path: fullPath,
          lastModified: stat.mtime.toISOString(),
          size: stat.size,
        };
      }),
    );

    // Filter out empty log files (size 0) and hidden files starting with .
    const files = allFiles.filter((f) => (f as LogFile & { size: number }).size > 0);

    return files.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  } catch {
    return [];
  }
}
