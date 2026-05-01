import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import Database from 'better-sqlite3';
import { auth } from '@/lib/auth';
import { ELEVATE_FRAMEWORK_ROOT, ELEVATE_INSTANCE_ID, ELEVATE_ROOT, getAllAgents } from '@/lib/config';
import {
  getElevateOrchestration,
  probeElevateGateway,
  type ElevateOrchestrationAgent,
  type ElevateOrchestrationRun,
} from '@/lib/elevate-gateway-client';

export const dynamic = 'force-dynamic';

type JsonRecord = Record<string, unknown>;
type RuntimePathKind = 'file' | 'directory' | 'other';

function commandPath(command: string): string | null {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(lookup, [command], {
    encoding: 'utf-8',
    stdio: 'pipe',
    timeout: 2000,
  });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

function readJson(filePath: string): JsonRecord | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonRecord : null;
  } catch {
    return null;
  }
}

function readJsonValue(filePath: string): unknown | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
  } catch {
    return null;
  }
}

function launchdStatus(label: string): { loaded: boolean; pid: number | null; lastExitStatus: number | null } {
  if (process.platform !== 'darwin') return { loaded: false, pid: null, lastExitStatus: null };
  const result = spawnSync('launchctl', ['list', label], {
    encoding: 'utf-8',
    stdio: 'pipe',
    timeout: 2000,
  });
  if (result.status !== 0) return { loaded: false, pid: null, lastExitStatus: null };

  const pidMatch = result.stdout.match(/"PID"\s=\s(\d+)/);
  const exitMatch = result.stdout.match(/"LastExitStatus"\s=\s(-?\d+)/);
  return {
    loaded: true,
    pid: pidMatch ? Number(pidMatch[1]) : null,
    lastExitStatus: exitMatch ? Number(exitMatch[1]) : null,
  };
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function boolValue(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed === 'null' || trimmed === '~') return null;
  if (trimmed === '[]') return [];
  if (trimmed === '{}') return {};
  if (/^(true|yes|on)$/i.test(trimmed)) return true;
  if (/^(false|no|off)$/i.test(trimmed)) return false;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseYamlLike(filePath: string): JsonRecord {
  if (!fs.existsSync(filePath)) return {};
  const rows = fs.readFileSync(filePath, 'utf-8')
    .split(/\r?\n/)
    .map((raw) => ({ indent: raw.match(/^ */)?.[0].length ?? 0, text: raw.trim() }))
    .filter((row) => row.text && !row.text.startsWith('#'));

  const root: JsonRecord = {};
  const stack: Array<{ indent: number; value: JsonRecord | unknown[] }> = [{ indent: -1, value: root }];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    while (stack.length > 1 && row.indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;

    if (row.text.startsWith('- ')) {
      if (Array.isArray(parent)) parent.push(parseScalar(row.text.slice(2)));
      continue;
    }

    const match = row.text.match(/^([^:]+):(.*)$/);
    if (!match || Array.isArray(parent)) continue;
    const key = match[1].trim();
    const rest = match[2].trim();

    if (rest) {
      parent[key] = parseScalar(rest);
      continue;
    }

    const next = rows.slice(i + 1).find((candidate) => candidate.indent > row.indent);
    const value: JsonRecord | unknown[] = next?.text.startsWith('- ') ? [] : {};
    parent[key] = value;
    stack.push({ indent: row.indent, value });
  }

  return root;
}

function readEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const env: Record<string, string> = {};
  for (const raw of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function maskSecret(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return 'set';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function maskIdentifier(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 6) return 'configured';
  return `${trimmed.slice(0, 3)}...${trimmed.slice(-2)}`;
}

function secretStatus(label: string, key: string, env: Record<string, string>) {
  const value = env[key] || process.env[key];
  return {
    label,
    key,
    configured: Boolean(value),
    masked: maskSecret(value),
  };
}

function yamlPath(root: JsonRecord, parts: string[]): unknown {
  let current: unknown = root;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as JsonRecord)[part];
  }
  return current;
}

function pathInfo(filePath: string) {
  try {
    const stat = fs.statSync(filePath);
    const kind: RuntimePathKind = stat.isFile()
      ? 'file'
      : stat.isDirectory()
        ? 'directory'
        : 'other';
    return {
      path: filePath,
      exists: true,
      kind,
      modifiedAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
    };
  } catch {
    return {
      path: filePath,
      exists: false,
      kind: null,
      modifiedAt: null,
      sizeBytes: null,
    };
  }
}

function pidIsAlive(pid: number | null): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function launchdLabelStatus(label: string) {
  const status = launchdStatus(label);
  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
  return {
    label,
    installed: fs.existsSync(plistPath),
    loaded: status.loaded,
    pid: status.pid,
    pidAlive: pidIsAlive(status.pid),
    lastExitStatus: status.lastExitStatus,
    plistPath,
  };
}

function firstExistingPath(paths: string[]): string | null {
  return paths.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function countFiles(root: string, predicate: (filePath: string) => boolean, maxDepth = 4): number {
  if (!fs.existsSync(root) || maxDepth < 0) return 0;
  let total = 0;
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        total += countFiles(fullPath, predicate, maxDepth - 1);
      } else if (entry.isFile() && predicate(fullPath)) {
        total += 1;
      }
    }
  } catch {
    return total;
  }
  return total;
}

function collectSkillSamples(root: string, source: string, maxDepth = 4) {
  if (!fs.existsSync(root) || maxDepth < 0) return [];
  const samples: Array<{ name: string; source: string; path: string }> = [];
  const seen = new Set<string>();

  function walk(dir: string, depth: number) {
    if (samples.length >= 10 || depth < 0) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (samples.length >= 10) return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth - 1);
      } else if (entry.isFile() && ['SKILL.md', 'DESCRIPTION.md'].includes(entry.name)) {
        const skillDir = path.dirname(fullPath);
        const name = path.basename(skillDir);
        const key = `${source}:${skillDir}`;
        if (!seen.has(key)) {
          samples.push({ name, source, path: skillDir });
          seen.add(key);
        }
      }
    }
  }

  walk(root, maxDepth);
  return samples;
}

function sqliteCount(dbPath: string, table: string): number | null {
  if (!fs.existsSync(dbPath)) return null;
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count?: number } | undefined;
    return typeof row?.count === 'number' ? row.count : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function recentSessions(dbPath: string) {
  if (!fs.existsSync(dbPath)) return [];
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = db.prepare(`
      SELECT id, source, title, started_at, ended_at, message_count, api_call_count
      FROM sessions
      ORDER BY started_at DESC
      LIMIT 5
    `).all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: typeof row.id === 'string' ? row.id : '',
      source: typeof row.source === 'string' ? row.source : '',
      title: typeof row.title === 'string' ? row.title : null,
      startedAt: typeof row.started_at === 'number' ? new Date(row.started_at * 1000).toISOString() : null,
      endedAt: typeof row.ended_at === 'number' ? new Date(row.ended_at * 1000).toISOString() : null,
      messageCount: numberValue(row.message_count) ?? 0,
      apiCallCount: numberValue(row.api_call_count) ?? 0,
    }));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

function compactSchedule(value: unknown): string {
  if (!value) return 'unscheduled';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function claudeTemplatePaths(frameworkRoot: string) {
  const templatesDir = path.join(frameworkRoot, 'templates');
  if (!fs.existsSync(templatesDir)) return [];

  try {
    return fs.readdirSync(templatesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const templateRoot = path.join(templatesDir, entry.name);
        return {
          name: entry.name,
          root: pathInfo(templateRoot),
          instructions: pathInfo(path.join(templateRoot, 'AGENTS.md')),
          claudeDir: pathInfo(path.join(templateRoot, '.claude')),
          settings: pathInfo(path.join(templateRoot, '.claude', 'settings.json')),
          skillsDir: pathInfo(path.join(templateRoot, '.claude', 'skills')),
        };
      })
      .filter((template) => (
        template.instructions.exists ||
        template.claudeDir.exists ||
        template.settings.exists ||
        template.skillsDir.exists
      ))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function sectionValue(content: string, heading: string): string | null {
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (index < 0) return null;
  for (let i = index + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith('<!--')) continue;
    if (line.startsWith('##')) return null;
    return line.replace(/^- /, '');
  }
  return null;
}

function collectAgentRoster(
  enabledAgents: JsonRecord,
  gatewayAgents: ElevateOrchestrationAgent[] = [],
  gatewayRuns: ElevateOrchestrationRun[] = [],
) {
  const activeRunsByAgent = new Map(
    gatewayRuns
      .filter((run) => run.status === 'queued' || run.status === 'running')
      .map((run) => [run.agent_id, run]),
  );
  const rows = getAllAgents().map((agent) => {
    const fileConfigPath = path.join(ELEVATE_FRAMEWORK_ROOT, 'orgs', agent.org, 'agents', agent.name, 'config.json');
    const cfg = {
      ...objectValue(enabledAgents[agent.name]),
      ...objectValue(readJson(fileConfigPath)),
    };
    const identityPath = path.join(ELEVATE_FRAMEWORK_ROOT, 'orgs', agent.org, 'agents', agent.name, 'IDENTITY.md');
    let displayName = stringValue(cfg.display_name, agent.name);
    let role = stringValue(cfg.role, 'Agent');
    if (fs.existsSync(identityPath)) {
      try {
        const identity = fs.readFileSync(identityPath, 'utf-8');
        displayName = sectionValue(identity, 'Name') ?? displayName;
        role = sectionValue(identity, 'Role') ?? role;
      } catch {
        // Keep registry fallback.
      }
    }

    const heartbeat = readJson(path.join(ELEVATE_ROOT, 'state', agent.name, 'heartbeat.json'));
    const lastHeartbeat = typeof heartbeat?.last_heartbeat === 'string'
      ? heartbeat.last_heartbeat
      : typeof heartbeat?.timestamp === 'string' ? heartbeat.timestamp : null;
    const running = lastHeartbeat ? Date.now() - new Date(lastHeartbeat).getTime() < 10 * 60 * 1000 : false;
    const orchestrationCfg = objectValue(cfg.orchestration);
    const orchestration = stringValue(
      orchestrationCfg.tier,
      typeof cfg.orchestration === 'string'
        ? cfg.orchestration
        : agent.name === 'executive-assistant' ? 'primary' : 'specialist',
    );
    const activeRun = activeRunsByAgent.get(agent.name);
    const activeRouteLabel = activeRun?.route_label ?? activeRun?.routing_label ?? null;

    return {
      name: agent.name,
      displayName,
      role,
      org: agent.org,
      enabled: cfg.enabled !== false,
      running,
      status: typeof heartbeat?.status === 'string' ? heartbeat.status : cfg.status === 'configured' ? 'configured' : 'stopped',
      lastHeartbeat,
      orchestration,
      activeRouteLabel,
      activeTask: activeRun?.task ?? null,
      reportsTo: typeof orchestrationCfg.reports_to === 'string'
        ? orchestrationCfg.reports_to
        : typeof cfg.reports_to === 'string' ? cfg.reports_to : null,
    };
  });

  const seen = new Set(rows.map((row) => row.name));
  for (const agent of gatewayAgents) {
    if (!agent.agent_id || seen.has(agent.agent_id)) continue;
    const activeRun = activeRunsByAgent.get(agent.agent_id);
    rows.push({
      name: agent.agent_id,
      displayName: agent.display_name || agent.agent_id,
      role: agent.role || 'Agent',
      org: agent.org || 'standalone',
      enabled: agent.enabled,
      running: agent.status === 'running' || (agent.run_counts?.active_runs ?? 0) > 0,
      status: agent.status,
      lastHeartbeat: agent.last_seen_at ?? agent.updated_at ?? null,
      orchestration: agent.tier || 'specialist',
      activeRouteLabel: activeRun?.route_label ?? activeRun?.routing_label ?? null,
      activeTask: activeRun?.task ?? null,
      reportsTo: agent.reports_to ?? null,
    });
    seen.add(agent.agent_id);
  }

  return rows.sort((a, b) => {
    if (a.orchestration === 'primary' && b.orchestration !== 'primary') return -1;
    if (b.orchestration === 'primary' && a.orchestration !== 'primary') return 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const dashboardEnvPath = path.join(ELEVATE_ROOT, 'dashboard.env');
  const enabledAgentsPath = path.join(ELEVATE_ROOT, 'config', 'enabled-agents.json');
  const elevateHome = process.env.ELEVATE_HOME || path.join(os.homedir(), '.elevate');
  const claudeHome = path.join(os.homedir(), '.claude');
  const gatewayStatePath = path.join(elevateHome, 'gateway_state.json');
  const gatewayPidPath = path.join(elevateHome, 'gateway.pid');
  const gatewayLockPath = path.join(elevateHome, 'gateway.lock');
  const gatewayLogPath = path.join(elevateHome, 'logs', 'gateway.log');
  const gatewayErrorLogPath = path.join(elevateHome, 'logs', 'gateway.error.log');
  const tuiGatewayCrashLogPath = path.join(elevateHome, 'logs', 'tui_gateway_crash.log');
  const pm2LogDir = path.join(os.homedir(), '.pm2', 'logs');
  const configPath = path.join(elevateHome, 'config.yaml');
  const secretsPath = path.join(elevateHome, '.env');
  const cronJobsPath = path.join(elevateHome, 'cron', 'jobs.json');
  const sessionsMapPath = path.join(elevateHome, 'sessions', 'sessions.json');
  const stateDbPath = path.join(elevateHome, 'state.db');
  const memoryDbPath = path.join(elevateHome, 'memory_store.db');
  const memoryDailyStatePath = path.join(elevateHome, 'memory_daily_state.json');
  const channelDirectoryPath = path.join(elevateHome, 'channel_directory.json');
  const telegramApprovedPath = path.join(elevateHome, 'platforms', 'pairing', 'telegram-approved.json');
  const config = parseYamlLike(configPath);
  const secrets = readEnvFile(secretsPath);
  const gatewayState = readJson(gatewayStatePath);
  const gatewayPid = numberValue(gatewayState?.pid);
  const gatewayStateName = stringValue(gatewayState?.gateway_state, gatewayState ? 'unknown' : 'not configured');
  const gatewayPidAlive = pidIsAlive(gatewayPid);
  const launchd = launchdLabelStatus('ai.elevate.gateway');
  const platformState = objectValue(gatewayState?.platforms);
  const platformEntries = Object.entries(platformState).map(([name, raw]) => {
    const platform = objectValue(raw);
    return {
      name,
      state: stringValue(platform.state, 'unknown'),
      errorCode: typeof platform.error_code === 'string' ? platform.error_code : null,
      hasErrorMessage: typeof platform.error_message === 'string' && platform.error_message.trim().length > 0,
      updatedAt: typeof platform.updated_at === 'string' ? platform.updated_at : null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const runningState = ['running', 'starting', 'draining'].includes(gatewayStateName);
  const serviceAlive = launchd.loaded && launchd.pidAlive;
  const gatewayProbe = await probeElevateGateway();
  const gatewayOrchestration = await getElevateOrchestration(1200).catch(() => null);
  const connected = serviceAlive || (runningState && gatewayPidAlive) || gatewayProbe.reachable;
  const elevateOsCommand = commandPath('elevateos');
  const elevateCommand = commandPath('elevate');
  const claudeCommand = commandPath('claude');
  const elevateCliMainPath = firstExistingPath([
    path.join(os.homedir(), 'elevate', 'cli', 'elevate_cli', 'main.py'),
    path.join(elevateHome, 'elevate', 'cli', 'elevate_cli', 'main.py'),
  ]);
  const pythonCommand = commandPath('python3') ?? commandPath('python');
  const enabledAgents = readJson(enabledAgentsPath) ?? {};
  const agentNames = Object.entries(enabledAgents)
    .filter(([, cfg]) => !cfg || typeof cfg !== 'object' || (cfg as { enabled?: boolean }).enabled !== false)
    .map(([name]) => name)
    .sort();
  const elevateRepoRoot = elevateCliMainPath ? path.dirname(path.dirname(elevateCliMainPath)) : null;
  const configuredPlatforms = objectValue(config.platforms);
  const platformToolsets = objectValue(config.platform_toolsets);
  const apiServerConfig = objectValue(configuredPlatforms.api_server);
  const apiServerExtra = objectValue(apiServerConfig.extra);
  const channelDirectory = objectValue(readJson(channelDirectoryPath));
  const directoryPlatforms = objectValue(channelDirectory.platforms);
  const telegramApproved = objectValue(readJson(telegramApprovedPath));
  const runtimePlatformNames = Array.from(new Set([
    'telegram',
    'api_server',
    ...Object.keys(configuredPlatforms),
    ...Object.keys(platformState),
    ...Object.keys(directoryPlatforms),
  ])).sort();
  const runtimePlatforms = runtimePlatformNames.map((name) => {
    const runtime = objectValue(platformState[name]);
    const configured = objectValue(configuredPlatforms[name]);
    const channels = arrayValue(directoryPlatforms[name]);
    const tokenKeyByPlatform: Record<string, string> = {
      telegram: 'TELEGRAM_BOT_TOKEN',
      discord: 'DISCORD_BOT_TOKEN',
      slack: 'SLACK_BOT_TOKEN',
      api_server: 'API_SERVER_KEY',
    };
    const tokenKey = tokenKeyByPlatform[name] ?? `${name.toUpperCase()}_TOKEN`;
    const tokenValue = secrets[tokenKey] || process.env[tokenKey];
    return {
      name,
      state: stringValue(runtime.state, configured.enabled ? 'configured' : channels.length > 0 ? 'known' : 'not configured'),
      enabled: boolValue(configured.enabled, Boolean(tokenValue || channels.length > 0 || runtime.state)),
      tokenKey,
      tokenConfigured: Boolean(tokenValue || (name === 'api_server' && typeof apiServerExtra.key === 'string' && apiServerExtra.key)),
      tokenMasked: maskSecret(tokenValue),
      toolsets: arrayValue(platformToolsets[name]).map(String),
      channelCount: channels.length,
      channels: channels.slice(0, 4).map((raw) => {
        const channel = objectValue(raw);
        return {
          name: typeof channel.name === 'string' ? channel.name : null,
          type: typeof channel.type === 'string' ? channel.type : null,
          id: maskIdentifier(channel.id),
        };
      }),
      updatedAt: typeof runtime.updated_at === 'string' ? runtime.updated_at : null,
      errorCode: typeof runtime.error_code === 'string' ? runtime.error_code : null,
    };
  });
  const cronRaw = readJsonValue(cronJobsPath);
  const cronObject = objectValue(cronRaw);
  const cronJobsSource = Array.isArray(cronRaw)
    ? cronRaw
    : Array.isArray(cronObject.jobs)
      ? cronObject.jobs
      : Object.values(cronObject);
  const cronJobs = cronJobsSource
    .filter((job): job is JsonRecord => Boolean(job && typeof job === 'object' && !Array.isArray(job)))
    .map((job) => ({
      id: typeof job.id === 'string' ? job.id : typeof job.job_id === 'string' ? job.job_id : null,
      name: typeof job.name === 'string' ? job.name : 'Scheduled job',
      enabled: boolValue(job.enabled, true),
      schedule: compactSchedule(job.schedule),
      nextRun: typeof job.next_run === 'string' ? job.next_run : null,
      deliver: typeof job.deliver === 'string' ? job.deliver : null,
      skills: arrayValue(job.skills).map(String),
      promptPreview: typeof job.prompt === 'string' ? job.prompt.slice(0, 120) : null,
    }));
  const activeSessionMap = objectValue(readJson(sessionsMapPath));
  const activeSessions = Object.values(activeSessionMap)
    .filter((entry): entry is JsonRecord => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)))
    .map((entry) => {
      const origin = objectValue(entry.origin);
      return {
        sessionId: typeof entry.session_id === 'string' ? entry.session_id : null,
        displayName: typeof entry.display_name === 'string' ? entry.display_name : null,
        platform: typeof entry.platform === 'string'
          ? entry.platform
          : typeof origin.platform === 'string' ? origin.platform : null,
        chatType: typeof entry.chat_type === 'string'
          ? entry.chat_type
          : typeof origin.chat_type === 'string' ? origin.chat_type : null,
        updatedAt: typeof entry.updated_at === 'string' ? entry.updated_at : null,
        suspended: boolValue(entry.suspended),
        resumePending: boolValue(entry.resume_pending),
        lastPromptTokens: numberValue(entry.last_prompt_tokens),
      };
    })
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
    .slice(0, 8);
  const memoryPlugin = objectValue(objectValue(config.plugins)['elevate-memory-store']);
  const memoryDailyState = objectValue(readJson(memoryDailyStatePath));
  const bundledSkillsRoot = elevateRepoRoot ? path.join(elevateRepoRoot, 'skills') : null;
  const installedSkillsRoot = path.join(elevateHome, 'skills');
  const localSkillsRoot = path.join(ELEVATE_FRAMEWORK_ROOT, 'skills');
  const skillSamples = [
    ...collectSkillSamples(installedSkillsRoot, 'installed'),
    ...(bundledSkillsRoot ? collectSkillSamples(bundledSkillsRoot, 'builtin') : []),
    ...collectSkillSamples(localSkillsRoot, 'app'),
  ].slice(0, 12);
  const runtimeMirror = {
    model: {
      provider: stringValue(yamlPath(config, ['model', 'provider']), 'default'),
      model: stringValue(yamlPath(config, ['model', 'default']), 'default'),
      baseUrl: typeof yamlPath(config, ['model', 'base_url']) === 'string' ? yamlPath(config, ['model', 'base_url']) as string : null,
      maxTurns: numberValue(yamlPath(config, ['agent', 'max_turns'])) ?? 0,
      reasoningEffort: typeof yamlPath(config, ['agent', 'reasoning_effort']) === 'string' ? yamlPath(config, ['agent', 'reasoning_effort']) as string : null,
    },
    orchestration: {
      appCommand: elevateOsCommand,
      agentCommand: elevateCommand,
      enabledToolsets: arrayValue(config.toolsets).map(String),
      platformToolsets,
      agents: collectAgentRoster(
        enabledAgents,
        gatewayOrchestration?.agents ?? [],
        gatewayOrchestration?.runs ?? [],
      ),
      gateway: gatewayOrchestration,
      delegation: {
        enabled: boolValue(yamlPath(config, ['delegation', 'orchestrator_enabled'])),
        maxChildren: numberValue(yamlPath(config, ['delegation', 'max_concurrent_children'])),
        maxSpawnDepth: numberValue(yamlPath(config, ['delegation', 'max_spawn_depth'])),
        timeoutSeconds: numberValue(yamlPath(config, ['delegation', 'child_timeout_seconds'])),
      },
    },
    platforms: runtimePlatforms,
    secrets: [
      secretStatus('Telegram bot token', 'TELEGRAM_BOT_TOKEN', secrets),
      secretStatus('Telegram allowed users', 'TELEGRAM_ALLOWED_USERS', secrets),
      secretStatus('Telegram home channel', 'TELEGRAM_HOME_CHANNEL', secrets),
      secretStatus('OpenAI API key', 'OPENAI_API_KEY', secrets),
      secretStatus('Gemini API key', 'GEMINI_API_KEY', secrets),
      secretStatus('Anthropic API key', 'ANTHROPIC_API_KEY', secrets),
      secretStatus('Gateway API key', 'API_SERVER_KEY', secrets),
      secretStatus('Dashboard gateway key', 'ELEVATE_GATEWAY_API_KEY', secrets),
    ],
    api: {
      endpoint: gatewayProbe.baseUrl,
      v1Endpoint: `${gatewayProbe.baseUrl}/v1`,
      reachable: gatewayProbe.reachable,
      apiServerEnabled: boolValue(apiServerConfig.enabled),
      apiServerHost: stringValue(apiServerExtra.host, stringValue(apiServerConfig.host, '127.0.0.1')),
      apiServerPort: numberValue(apiServerExtra.port) ?? numberValue(apiServerConfig.port) ?? 8642,
      apiServerAuthConfigured: Boolean(apiServerExtra.key || secrets.API_SERVER_KEY || process.env.API_SERVER_KEY),
    },
    messages: {
      channelDirectory: pathInfo(channelDirectoryPath),
      platformsWithChannels: Object.entries(directoryPlatforms)
        .map(([name, value]) => ({ name, count: arrayValue(value).length }))
        .filter((entry) => entry.count > 0),
      telegramApprovedUsers: Object.keys(telegramApproved).length,
    },
    cron: {
      jobsFile: pathInfo(cronJobsPath),
      total: cronJobs.length,
      enabled: cronJobs.filter((job) => job.enabled).length,
      disabled: cronJobs.filter((job) => !job.enabled).length,
      outputDir: pathInfo(path.join(elevateHome, 'cron', 'output')),
      lock: pathInfo(path.join(elevateHome, 'cron', '.tick.lock')),
      jobs: cronJobs.slice(0, 8),
    },
    skills: {
      installedRoot: pathInfo(installedSkillsRoot),
      builtinRoot: bundledSkillsRoot ? pathInfo(bundledSkillsRoot) : null,
      appRoot: pathInfo(localSkillsRoot),
      installedCount: countFiles(installedSkillsRoot, (file) => ['SKILL.md', 'DESCRIPTION.md'].includes(path.basename(file))),
      builtinCount: bundledSkillsRoot ? countFiles(bundledSkillsRoot, (file) => path.basename(file) === 'SKILL.md') : 0,
      appCount: countFiles(localSkillsRoot, (file) => path.basename(file) === 'SKILL.md'),
      samples: skillSamples,
    },
    memory: {
      provider: stringValue(yamlPath(config, ['memory', 'provider']), 'none'),
      enabled: boolValue(yamlPath(config, ['memory', 'memory_enabled'])),
      pluginEnabled: Object.keys(objectValue(config.plugins)).includes('elevate-memory-store'),
      embeddingEnabled: boolValue(memoryPlugin.embedding_enabled),
      embeddingProvider: typeof memoryPlugin.embedding_provider === 'string' ? memoryPlugin.embedding_provider : null,
      embeddingModel: typeof memoryPlugin.embedding_model === 'string' ? memoryPlugin.embedding_model : null,
      organizeEveryTurns: numberValue(memoryPlugin.organize_every_n_turns),
      dailyOrganizeEnabled: boolValue(memoryPlugin.daily_organize_enabled),
      dailyOrganizeTime: `${String(numberValue(memoryPlugin.daily_organize_hour) ?? 23).padStart(2, '0')}:${String(numberValue(memoryPlugin.daily_organize_minute) ?? 55).padStart(2, '0')}`,
      db: pathInfo(memoryDbPath),
      dailyState: {
        path: pathInfo(memoryDailyStatePath),
        lastRunLocalDate: typeof memoryDailyState.last_run_local_date === 'string' ? memoryDailyState.last_run_local_date : null,
        lastRunAt: typeof memoryDailyState.last_run_at === 'string' ? memoryDailyState.last_run_at : null,
      },
      counts: {
        facts: sqliteCount(memoryDbPath, 'facts'),
        entities: sqliteCount(memoryDbPath, 'entities'),
        journalTurns: sqliteCount(memoryDbPath, 'memory_turn_journal'),
        embeddings: sqliteCount(memoryDbPath, 'memory_embeddings'),
      },
    },
    sessions: {
      sessionsMap: pathInfo(sessionsMapPath),
      activeCount: activeSessions.length,
      active: activeSessions,
      stateDb: pathInfo(stateDbPath),
      totalInDb: sqliteCount(stateDbPath, 'sessions'),
      recent: recentSessions(stateDbPath),
    },
    files: {
      config: pathInfo(configPath),
      secrets: pathInfo(secretsPath),
      auth: pathInfo(path.join(elevateHome, 'auth.json')),
      logs: pathInfo(path.join(elevateHome, 'logs')),
      memories: pathInfo(path.join(elevateHome, 'memories')),
    },
  };

  return Response.json({
    product: 'ElevateOS',
    agent: 'Elevate Agent',
    command: 'elevateos',
    agentCommand: 'elevate',
    instanceId: ELEVATE_INSTANCE_ID,
    stateRoot: ELEVATE_ROOT,
    frameworkRoot: ELEVATE_FRAMEWORK_ROOT,
    dashboardEnvPath,
    enabledAgentsPath,
    activeAgents: agentNames,
    status: {
      stateRootExists: fs.existsSync(ELEVATE_ROOT),
      dashboardEnvExists: fs.existsSync(dashboardEnvPath),
      enabledAgentsExists: fs.existsSync(enabledAgentsPath),
      frameworkRootExists: fs.existsSync(ELEVATE_FRAMEWORK_ROOT),
      elevateOsCommandPath: elevateOsCommand,
      elevateCommandPath: elevateCommand,
      claudeCommandPath: claudeCommand,
      pythonCommandPath: pythonCommand,
    },
    claudeCode: {
      commandPath: claudeCommand,
      home: pathInfo(claudeHome),
      userInstructions: pathInfo(path.join(claudeHome, 'AGENTS.md')),
      userSettings: pathInfo(path.join(claudeHome, 'settings.json')),
      userLocalSettings: pathInfo(path.join(claudeHome, 'settings.local.json')),
      userSkills: pathInfo(path.join(claudeHome, 'skills')),
      userAgents: pathInfo(path.join(claudeHome, 'agents')),
      projectInstructions: pathInfo(path.join(ELEVATE_FRAMEWORK_ROOT, 'AGENTS.md')),
      projectClaudeDir: pathInfo(path.join(ELEVATE_FRAMEWORK_ROOT, '.claude')),
      projectCommands: pathInfo(path.join(ELEVATE_FRAMEWORK_ROOT, '.claude', 'commands')),
      dashboardInstructions: pathInfo(path.join(ELEVATE_FRAMEWORK_ROOT, 'dashboard', 'AGENTS.md')),
      templatesDir: pathInfo(path.join(ELEVATE_FRAMEWORK_ROOT, 'templates')),
      templates: claudeTemplatePaths(ELEVATE_FRAMEWORK_ROOT),
    },
    gateway: {
      provider: 'Elevate',
      owner: 'ElevateOS',
      connectionMode: 'local gateway connector',
      transport: gatewayProbe.reachable ? 'local HTTP gateway' : 'local state + service files',
      networkEndpoint: gatewayProbe.baseUrl,
      connected,
      state: gatewayStateName,
      pid: gatewayPid,
      pidAlive: gatewayPidAlive,
      kind: stringValue(gatewayState?.kind, 'elevate-gateway'),
      activeAgents: numberValue(gatewayState?.active_agents) ?? 0,
      restartRequested: boolValue(gatewayState?.restart_requested),
      exitReason: typeof gatewayState?.exit_reason === 'string' ? gatewayState.exit_reason : null,
      updatedAt: typeof gatewayState?.updated_at === 'string' ? gatewayState.updated_at : null,
      platforms: platformEntries,
      http: gatewayProbe,
      source: {
        elevateCliMainPath,
        command: elevateCliMainPath && pythonCommand ? `${pythonCommand} ${elevateCliMainPath} gateway status` : null,
      },
      launchd,
      logs: {
        stdout: pathInfo(gatewayLogPath),
        stderr: pathInfo(gatewayErrorLogPath),
        tuiCrash: pathInfo(tuiGatewayCrashLogPath),
      },
      files: {
        state: pathInfo(gatewayStatePath),
        pid: pathInfo(gatewayPidPath),
        lock: pathInfo(gatewayLockPath),
      },
    },
    localWrapper: {
      elevateHome,
      elevateHomeExists: fs.existsSync(elevateHome),
      pm2LogDir,
      pm2LogDirExists: fs.existsSync(pm2LogDir),
      daemonProcess: 'elevate-daemon',
      dashboardProcess: 'elevate-dashboard',
      tunnelPrefix: 'elevateos',
      controlSurface: 'Elevate-owned gateway wrapper',
    },
    env: {
      preferred: ['ELEVATE_HOME', 'ELEVATE_INSTANCE_ID', 'ELEVATE_ROOT', 'ELEVATE_FRAMEWORK_ROOT', 'ELEVATE_ORG'],
    },
    runtimeMirror,
  });
}
