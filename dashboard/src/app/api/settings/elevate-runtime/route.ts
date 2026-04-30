import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { ELEVATE_FRAMEWORK_ROOT, ELEVATE_INSTANCE_ID, ELEVATE_ROOT } from '@/lib/config';

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
          instructions: pathInfo(path.join(templateRoot, 'CLAUDE.md')),
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

export function GET() {
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
  const connected = serviceAlive || (runningState && gatewayPidAlive);
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

  return Response.json({
    product: 'ElevateOS',
    agent: 'Elevate Agent',
    command: 'elevate',
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
      elevateCommandPath: elevateCommand,
      claudeCommandPath: claudeCommand,
      pythonCommandPath: pythonCommand,
    },
    claudeCode: {
      commandPath: claudeCommand,
      home: pathInfo(claudeHome),
      userInstructions: pathInfo(path.join(claudeHome, 'CLAUDE.md')),
      userSettings: pathInfo(path.join(claudeHome, 'settings.json')),
      userLocalSettings: pathInfo(path.join(claudeHome, 'settings.local.json')),
      userSkills: pathInfo(path.join(claudeHome, 'skills')),
      userAgents: pathInfo(path.join(claudeHome, 'agents')),
      projectInstructions: pathInfo(path.join(ELEVATE_FRAMEWORK_ROOT, 'CLAUDE.md')),
      projectClaudeDir: pathInfo(path.join(ELEVATE_FRAMEWORK_ROOT, '.claude')),
      projectCommands: pathInfo(path.join(ELEVATE_FRAMEWORK_ROOT, '.claude', 'commands')),
      dashboardInstructions: pathInfo(path.join(ELEVATE_FRAMEWORK_ROOT, 'dashboard', 'CLAUDE.md')),
      templatesDir: pathInfo(path.join(ELEVATE_FRAMEWORK_ROOT, 'templates')),
      templates: claudeTemplatePaths(ELEVATE_FRAMEWORK_ROOT),
    },
    gateway: {
      provider: 'Elevate',
      owner: 'ElevateOS',
      connectionMode: 'local gateway connector',
      transport: 'local state + Elevate TUI JSON-RPC',
      networkEndpoint: null,
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
  });
}
