'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  IconCheck,
  IconCopy,
  IconFolder,
  IconNetwork,
  IconPlugConnected,
  IconRobot,
  IconSparkles,
  IconTerminal2,
} from '@tabler/icons-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ElevateRuntime {
  product: string;
  agent: string;
  command: string;
  instanceId: string;
  stateRoot: string;
  frameworkRoot: string;
  dashboardEnvPath: string;
  enabledAgentsPath: string;
  activeAgents: string[];
  status: {
    stateRootExists: boolean;
    dashboardEnvExists: boolean;
    enabledAgentsExists: boolean;
    frameworkRootExists: boolean;
    elevateCommandPath: string | null;
    claudeCommandPath: string | null;
    pythonCommandPath: string | null;
  };
  claudeCode: {
    commandPath: string | null;
    home: RuntimePathInfo;
    userInstructions: RuntimePathInfo;
    userSettings: RuntimePathInfo;
    userLocalSettings: RuntimePathInfo;
    userSkills: RuntimePathInfo;
    userAgents: RuntimePathInfo;
    projectInstructions: RuntimePathInfo;
    projectClaudeDir: RuntimePathInfo;
    projectCommands: RuntimePathInfo;
    dashboardInstructions: RuntimePathInfo;
    templatesDir: RuntimePathInfo;
    templates: Array<{
      name: string;
      root: RuntimePathInfo;
      instructions: RuntimePathInfo;
      claudeDir: RuntimePathInfo;
      settings: RuntimePathInfo;
      skillsDir: RuntimePathInfo;
    }>;
  };
  gateway: {
    provider: string;
    owner: string;
    connectionMode: string;
    transport: string;
    networkEndpoint: string | null;
    connected: boolean;
    state: string;
    pid: number | null;
    pidAlive: boolean;
    kind: string;
    activeAgents: number;
    restartRequested: boolean;
    exitReason: string | null;
    updatedAt: string | null;
    platforms: Array<{
      name: string;
      state: string;
      errorCode: string | null;
      hasErrorMessage: boolean;
      updatedAt: string | null;
    }>;
    source: {
      elevateCliMainPath: string | null;
      command: string | null;
    };
    launchd: {
      label: string;
      installed: boolean;
      loaded: boolean;
      pid: number | null;
      pidAlive: boolean;
      lastExitStatus: number | null;
      plistPath: string;
    };
    logs: {
      stdout: RuntimePathInfo;
      stderr: RuntimePathInfo;
      tuiCrash: RuntimePathInfo;
    };
    files: {
      state: RuntimePathInfo;
      pid: RuntimePathInfo;
      lock: RuntimePathInfo;
    };
  };
  localWrapper: {
    elevateHome: string;
    elevateHomeExists: boolean;
    pm2LogDir: string;
    pm2LogDirExists: boolean;
    daemonProcess: string;
    dashboardProcess: string;
    tunnelPrefix: string;
    controlSurface: string;
  };
  env: {
    preferred: string[];
  };
}

interface RuntimePathInfo {
  path: string;
  exists: boolean;
  kind: 'file' | 'directory' | 'other' | null;
  modifiedAt: string | null;
  sizeBytes: number | null;
}

type ConnectorMode = 'gateway' | 'claude';

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge
      variant="outline"
      className={ok
        ? 'border-primary-foreground/25 bg-primary-foreground/12 text-primary-foreground'
        : 'border-primary-foreground/20 text-primary-foreground/60'}
    >
      {label}
    </Badge>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid gap-1">
      <div className="text-[11px] font-medium uppercase text-muted-foreground">{label}</div>
      <code className="break-all rounded-md bg-muted px-2 py-1.5 text-xs text-foreground">
        {value || 'Not found'}
      </code>
    </div>
  );
}

function BoolBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge variant={ok ? 'default' : 'secondary'}>
      {label}
    </Badge>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function PathField({ label, info }: { label: string; info: RuntimePathInfo }) {
  const details = [
    info.modifiedAt ? `updated ${formatTimestamp(info.modifiedAt)}` : 'found',
    info.kind === 'directory' ? 'directory' : null,
    info.kind === 'file' && typeof info.sizeBytes === 'number' ? formatBytes(info.sizeBytes) : null,
    info.kind === 'other' ? 'special path' : null,
  ].filter(Boolean);
  const suffix = info.exists
    ? details.join(' - ')
    : 'Not found';

  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase text-muted-foreground">{label}</div>
        <Badge variant={info.exists ? 'default' : 'secondary'}>{info.exists ? 'Found' : 'Missing'}</Badge>
      </div>
      <code className="break-all rounded-md bg-muted px-2 py-1.5 text-xs text-foreground">
        {info.path}
      </code>
      <div className="text-xs text-muted-foreground">{suffix}</div>
    </div>
  );
}

export function ElevateAgentTab() {
  const [data, setData] = useState<ElevateRuntime | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectorMode, setConnectorMode] = useState<ConnectorMode>('gateway');
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/elevate-runtime');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  if (loading) {
    return <div className="h-72 rounded-xl bg-muted/30 animate-pulse" />;
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          Elevate runtime settings could not be loaded.
        </CardContent>
      </Card>
    );
  }

  const gatewayProcess = data.gateway.pid
    ? `pid ${data.gateway.pid}${data.gateway.pidAlive ? ' live' : ' stale'}`
    : 'No gateway PID';
  const connectorHealthy = connectorMode === 'gateway'
    ? data.gateway.connected
    : Boolean(data.status.claudeCommandPath);
  const commands = connectorMode === 'gateway'
    ? [
        `elevate status --instance ${data.instanceId}`,
        `elevate dashboard --instance ${data.instanceId}`,
        `elevate ecosystem --instance ${data.instanceId}`,
        data.gateway.source.command,
        `tail -80 ${data.gateway.logs.stdout.path}`,
        `tail -80 ${data.gateway.logs.stderr.path}`,
        `pm2 status ${data.localWrapper.daemonProcess}`,
      ].filter((command): command is string => Boolean(command))
    : [
        `${data.claudeCode.commandPath || 'claude'} --version`,
        `ls -la ${data.claudeCode.home.path}`,
        `ls -la ${data.claudeCode.projectClaudeDir.path}`,
        `find ${data.claudeCode.templatesDir.path} -maxdepth 2 -name CLAUDE.md`,
      ];

  return (
    <div className="grid gap-4">
      <Card className="overflow-hidden">
        <CardContent className="grid gap-4 p-0 md:grid-cols-[1.15fr_0.85fr]">
          <div className="bg-primary px-5 py-5 text-primary-foreground">
            <div className="flex items-center gap-2">
              <div className="flex size-9 items-center justify-center rounded-md bg-primary-foreground/12">
                <IconRobot size={20} />
              </div>
              <div>
                <h2 className="text-lg font-semibold">{data.agent}</h2>
                <p className="text-sm text-primary-foreground/75">
                  Local wrapper for {data.product}
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <StatusBadge ok={data.status.stateRootExists} label="State root" />
              <StatusBadge ok={data.status.dashboardEnvExists} label="Dashboard auth" />
              <StatusBadge ok={data.localWrapper.elevateHomeExists} label="Elevate home" />
              <StatusBadge ok={connectorHealthy} label={connectorMode === 'gateway' ? 'Gateway selected' : 'Claude selected'} />
            </div>
          </div>
          <div className="grid gap-3 p-5">
            <Field label="Instance" value={data.instanceId} />
            <Field
              label="Command"
              value={connectorMode === 'gateway'
                ? data.status.elevateCommandPath || data.command
                : data.claudeCode.commandPath || 'claude'}
            />
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{data.activeAgents.length} active agents</Badge>
              <Badge variant="secondary">{data.localWrapper.daemonProcess}</Badge>
              <Badge variant="secondary">{data.localWrapper.dashboardProcess}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-[0.85fr_1.15fr]">
          <div className="grid gap-1">
            <div className="text-sm font-semibold">Connector</div>
            <div className="text-sm text-muted-foreground">
              {connectorMode === 'gateway' ? 'Elevate Gateway selected' : 'Claude Code selected'}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant={connectorMode === 'gateway' ? 'default' : 'outline'}
              className="h-auto justify-start gap-3 px-3 py-3"
              aria-pressed={connectorMode === 'gateway'}
              onClick={() => setConnectorMode('gateway')}
            >
              <IconNetwork size={18} />
              <span className="grid gap-0.5 text-left">
                <span>Elevate Gateway</span>
                <span className={connectorMode === 'gateway' ? 'text-primary-foreground/70 text-xs' : 'text-muted-foreground text-xs'}>
                  Local state, launch agent, logs
                </span>
              </span>
            </Button>
            <Button
              variant={connectorMode === 'claude' ? 'default' : 'outline'}
              className="h-auto justify-start gap-3 px-3 py-3"
              aria-pressed={connectorMode === 'claude'}
              onClick={() => setConnectorMode('claude')}
            >
              <IconSparkles size={18} />
              <span className="grid gap-0.5 text-left">
                <span>Claude Code</span>
                <span className={connectorMode === 'claude' ? 'text-primary-foreground/70 text-xs' : 'text-muted-foreground text-xs'}>
                  CLI, user config, template roots
                </span>
              </span>
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <IconFolder size={18} />
              Local Runtime
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field label="State Root" value={data.stateRoot} />
            <Field label="Framework Root" value={data.frameworkRoot} />
            <Field label="Dashboard Credentials" value={data.dashboardEnvPath} />
            <Field label="Enabled Agents" value={data.enabledAgentsPath} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <IconPlugConnected size={18} />
              Selected Connector
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {connectorMode === 'gateway' ? (
              <>
                <Field label="Elevate Home" value={data.localWrapper.elevateHome} />
                <Field label="Connector Owner" value={data.localWrapper.controlSurface} />
                <Field label="Python Runtime" value={data.status.pythonCommandPath} />
                <Field label="PM2 Logs" value={data.localWrapper.pm2LogDir} />
              </>
            ) : (
              <>
                <Field label="Claude Command" value={data.claudeCode.commandPath} />
                <Field label="Config Home" value={data.claudeCode.home.path} />
                <Field label="Project Root" value={data.frameworkRoot} />
                <Field label="Template Coverage" value={`${data.claudeCode.templates.length} template roots found`} />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {connectorMode === 'claude' ? (
        <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconSparkles size={18} />
            Claude Code Paths
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-2">
          <div className="grid gap-3">
            <Field label="Claude Command" value={data.claudeCode.commandPath} />
            <PathField label="Claude Home" info={data.claudeCode.home} />
            <PathField label="User Instructions" info={data.claudeCode.userInstructions} />
            <PathField label="User Settings" info={data.claudeCode.userSettings} />
            <PathField label="Local Settings" info={data.claudeCode.userLocalSettings} />
            <PathField label="User Skills" info={data.claudeCode.userSkills} />
            <PathField label="User Agents" info={data.claudeCode.userAgents} />
          </div>
          <div className="grid gap-3">
            <PathField label="Project Instructions" info={data.claudeCode.projectInstructions} />
            <PathField label="Project .claude" info={data.claudeCode.projectClaudeDir} />
            <PathField label="Project Commands" info={data.claudeCode.projectCommands} />
            <PathField label="Dashboard Instructions" info={data.claudeCode.dashboardInstructions} />
            <div className="grid gap-2">
              <div className="text-[11px] font-medium uppercase text-muted-foreground">Agent Template Claude Roots</div>
              <div className="grid gap-2">
                {data.claudeCode.templates.map((template) => (
                  <div key={template.name} className="grid gap-2 rounded-md border bg-background px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium capitalize">{template.name}</div>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={template.instructions.exists ? 'default' : 'secondary'}>CLAUDE.md</Badge>
                        <Badge variant={template.settings.exists ? 'default' : 'secondary'}>settings</Badge>
                        <Badge variant={template.skillsDir.exists ? 'default' : 'secondary'}>skills</Badge>
                      </div>
                    </div>
                    <code className="break-all rounded-md bg-muted px-2 py-1.5 text-xs text-foreground">
                      {template.claudeDir.path}
                    </code>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      ) : (
        <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconNetwork size={18} />
            Gateway Connector
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              <BoolBadge ok={data.gateway.connected} label={data.gateway.connected ? 'Connected' : 'Stopped'} />
              <BoolBadge ok={data.gateway.pidAlive} label={data.gateway.pidAlive ? 'PID live' : 'PID stale'} />
              <BoolBadge ok={data.gateway.launchd.loaded} label={data.gateway.launchd.loaded ? 'Service loaded' : 'Service idle'} />
              <BoolBadge ok={data.gateway.files.state.exists} label={data.gateway.files.state.exists ? 'State file' : 'No state file'} />
            </div>
            <Field label="Provider" value={`${data.gateway.owner} - ${data.gateway.connectionMode}`} />
            <Field label="Transport" value={data.gateway.transport} />
            <Field label="State" value={data.gateway.state} />
            <Field label="Process" value={gatewayProcess} />
            <div className="grid gap-2">
              <div className="text-[11px] font-medium uppercase text-muted-foreground">Platforms</div>
              {data.gateway.platforms.length > 0 ? (
                <div className="grid gap-2">
                  {data.gateway.platforms.map((platform) => (
                    <div key={platform.name} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm">
                      <div className="font-medium capitalize">{platform.name}</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={platform.state === 'connected' ? 'default' : 'secondary'}>{platform.state}</Badge>
                        {platform.errorCode && <Badge variant="outline">{platform.errorCode}</Badge>}
                        {platform.hasErrorMessage && <Badge variant="outline">Error details logged</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <code className="rounded-md bg-muted px-2 py-1.5 text-xs text-foreground">No platforms reporting</code>
              )}
            </div>
          </div>
          <div className="grid gap-3">
            <Field label="Active Agents" value={`${data.gateway.activeAgents}`} />
            <Field label="Last Update" value={data.gateway.updatedAt} />
            <Field label="Launch Agent" value={`${data.gateway.launchd.label}${data.gateway.launchd.pid ? ` pid ${data.gateway.launchd.pid}` : ''}`} />
            <PathField label="Gateway State" info={data.gateway.files.state} />
            <PathField label="Gateway Log" info={data.gateway.logs.stdout} />
            <PathField label="Gateway Errors" info={data.gateway.logs.stderr} />
          </div>
        </CardContent>
      </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Environment</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-2">
              <div className="text-[11px] font-medium uppercase text-muted-foreground">Runtime Keys</div>
              <div className="flex flex-wrap gap-2">
                {data.env.preferred.map((key) => (
                  <Badge key={key} variant="outline">{key}</Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <IconTerminal2 size={18} />
              Commands
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {commands.map((command) => (
              <div key={command} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
                <code className="min-w-0 flex-1 truncate text-xs">{command}</code>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => copy(command, command)}
                  title="Copy command"
                >
                  {copied === command ? <IconCheck size={15} /> : <IconCopy size={15} />}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
