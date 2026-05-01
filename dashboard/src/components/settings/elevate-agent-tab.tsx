'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  IconApi,
  IconBrain,
  IconCalendarClock,
  IconCheck,
  IconCopy,
  IconDatabase,
  IconDeviceFloppy,
  IconFolder,
  IconKey,
  IconMessageCircle,
  IconNetwork,
  IconPlugConnected,
  IconPuzzle,
  IconRoute,
  IconRobot,
  IconSparkles,
  IconTerminal2,
  IconRefresh,
  IconUsers,
} from '@tabler/icons-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ElevateRuntime {
  product: string;
  agent: string;
  command: string;
  agentCommand: string;
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
    elevateOsCommandPath: string | null;
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
    http: {
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
    };
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
  runtimeMirror: RuntimeMirror;
}

interface RuntimePathInfo {
  path: string;
  exists: boolean;
  kind: 'file' | 'directory' | 'other' | null;
  modifiedAt: string | null;
  sizeBytes: number | null;
}

interface RuntimeMirror {
  model: {
    provider: string;
    model: string;
    baseUrl: string | null;
    maxTurns: number;
    reasoningEffort: string | null;
  };
  orchestration: {
    appCommand: string | null;
    agentCommand: string | null;
    enabledToolsets: string[];
    platformToolsets: Record<string, unknown>;
    agents: Array<{
      name: string;
      displayName: string;
      role: string;
      org: string;
      enabled: boolean;
      running: boolean;
      status: string;
      lastHeartbeat: string | null;
      orchestration: string;
      activeRouteLabel: string | null;
      activeTask: string | null;
      reportsTo: string | null;
    }>;
    delegation: {
      enabled: boolean;
      maxChildren: number | null;
      maxSpawnDepth: number | null;
      timeoutSeconds: number | null;
    };
  };
  platforms: Array<{
    name: string;
    state: string;
    enabled: boolean;
    tokenKey: string;
    tokenConfigured: boolean;
    tokenMasked: string | null;
    toolsets: string[];
    channelCount: number;
    channels: Array<{ name: string | null; type: string | null; id: string | null }>;
    updatedAt: string | null;
    errorCode: string | null;
  }>;
  secrets: Array<{ label: string; key: string; configured: boolean; masked: string | null }>;
  api: {
    endpoint: string;
    v1Endpoint: string;
    reachable: boolean;
    apiServerEnabled: boolean;
    apiServerHost: string;
    apiServerPort: number;
    apiServerAuthConfigured: boolean;
  };
  messages: {
    channelDirectory: RuntimePathInfo;
    platformsWithChannels: Array<{ name: string; count: number }>;
    telegramApprovedUsers: number;
  };
  cron: {
    jobsFile: RuntimePathInfo;
    total: number;
    enabled: number;
    disabled: number;
    outputDir: RuntimePathInfo;
    lock: RuntimePathInfo;
    jobs: Array<{
      id: string | null;
      name: string;
      enabled: boolean;
      schedule: string;
      nextRun: string | null;
      deliver: string | null;
      skills: string[];
      promptPreview: string | null;
    }>;
  };
  skills: {
    installedRoot: RuntimePathInfo;
    builtinRoot: RuntimePathInfo | null;
    appRoot: RuntimePathInfo;
    installedCount: number;
    builtinCount: number;
    appCount: number;
    samples: Array<{ name: string; source: string; path: string }>;
  };
  memory: {
    provider: string;
    enabled: boolean;
    pluginEnabled: boolean;
    embeddingEnabled: boolean;
    embeddingProvider: string | null;
    embeddingModel: string | null;
    organizeEveryTurns: number | null;
    dailyOrganizeEnabled: boolean;
    dailyOrganizeTime: string;
    db: RuntimePathInfo;
    dailyState: {
      path: RuntimePathInfo;
      lastRunLocalDate: string | null;
      lastRunAt: string | null;
    };
    counts: {
      facts: number | null;
      entities: number | null;
      journalTurns: number | null;
      embeddings: number | null;
    };
  };
  sessions: {
    sessionsMap: RuntimePathInfo;
    activeCount: number;
    active: Array<{
      sessionId: string | null;
      displayName: string | null;
      platform: string | null;
      chatType: string | null;
      updatedAt: string | null;
      suspended: boolean;
      resumePending: boolean;
      lastPromptTokens: number | null;
    }>;
    stateDb: RuntimePathInfo;
    totalInDb: number | null;
    recent: Array<{
      id: string;
      source: string;
      title: string | null;
      startedAt: string | null;
      endedAt: string | null;
      messageCount: number;
      apiCallCount: number;
    }>;
  };
  files: {
    config: RuntimePathInfo;
    secrets: RuntimePathInfo;
    auth: RuntimePathInfo;
    logs: RuntimePathInfo;
    memories: RuntimePathInfo;
  };
}

interface GatewayTelegramPairing {
  code?: string;
  userId?: string;
  userName?: string;
  userIdMasked?: string;
  ageMinutes?: number | null;
  approvedAt?: number | null;
}

interface GatewayTelegramSettings {
  elevateHome: string;
  envPath: string;
  botTokenConfigured: boolean;
  botTokenMasked: string;
  homeChannel: string;
  homeChannelConfigured: boolean;
  approvedUserCount: number;
  pendingPairings: GatewayTelegramPairing[];
  approvedPairings: GatewayTelegramPairing[];
  validation?: {
    ok: boolean;
    error?: string;
    botUsername?: string;
    chatType?: string;
    selfChat?: boolean;
  };
  restart?: {
    ok: boolean;
    stdout: string;
    stderr: string;
    error: string | null;
  };
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

function MetricTile({ label, value, detail }: { label: string; value: string; detail?: string | null }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-[11px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
      {detail && <div className="mt-1 truncate text-xs text-muted-foreground">{detail}</div>}
    </div>
  );
}

function MirrorPanel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-3 rounded-md border bg-background p-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      {children}
    </div>
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

function GatewayTelegramSetupCard({ onRuntimeRefresh }: { onRuntimeRefresh: () => Promise<void> | void }) {
  const [settings, setSettings] = useState<GatewayTelegramSettings | null>(null);
  const [form, setForm] = useState({
    botToken: '',
    homeChannel: '',
    pairingCode: '',
    restartGateway: true,
    validate: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadTelegram = useCallback(async (resetForm = true) => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/elevate/telegram');
      const body = await res.json();
      if (!res.ok) {
        setMessage({ type: 'error', text: body.error || 'Failed to load gateway Telegram settings' });
        return;
      }
      setSettings(body);
      if (resetForm) {
        setForm((prev) => ({
          ...prev,
          botToken: '',
          homeChannel: body.homeChannel || '',
          pairingCode: '',
        }));
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error loading gateway Telegram settings' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTelegram();
  }, [loadTelegram]);

  async function saveTelegram() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/elevate/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) {
        setMessage({ type: 'error', text: body.error || 'Failed to save gateway Telegram settings' });
        return;
      }

      setSettings(body);
      setForm((prev) => ({
        ...prev,
        botToken: '',
        homeChannel: body.homeChannel || '',
        pairingCode: '',
      }));

      const validation = body.validation as GatewayTelegramSettings['validation'];
      const restart = body.restart as GatewayTelegramSettings['restart'];
      if (validation && !validation.ok) {
        setMessage({ type: 'error', text: `Saved, but Telegram validation failed: ${validation.error || 'unknown error'}` });
      } else if (restart && !restart.ok) {
        setMessage({ type: 'error', text: `Saved, but gateway restart failed: ${restart.error || restart.stderr || 'unknown error'}` });
      } else {
        const target = [validation?.botUsername, validation?.chatType].filter(Boolean).join(' - ');
        setMessage({ type: 'success', text: target ? `Saved, validated, and gateway restarted: ${target}` : 'Saved and gateway restarted' });
      }
      await onRuntimeRefresh();
    } catch {
      setMessage({ type: 'error', text: 'Network error saving gateway Telegram settings' });
    } finally {
      setSaving(false);
    }
  }

  const ready = Boolean(settings?.botTokenConfigured && settings?.approvedUserCount);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <IconMessageCircle size={18} />
            Telegram Bot Setup
          </CardTitle>
          <div className="flex items-center gap-2">
            {settings && (
              <Badge variant={ready ? 'default' : 'secondary'}>
                {ready ? 'Ready' : 'Needs setup'}
              </Badge>
            )}
            <Button variant="outline" size="xs" onClick={() => loadTelegram()} disabled={loading}>
              <IconRefresh size={14} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        {loading && !settings ? (
          <div className="h-44 rounded-md bg-muted/40 animate-pulse xl:col-span-2" />
        ) : (
          <>
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Gateway Env" value={settings?.envPath || null} />
                <Field label="Home Channel" value={settings?.homeChannel || null} />
              </div>
              <div className="grid gap-2">
                <div className="text-[11px] font-medium uppercase text-muted-foreground">Current Status</div>
                <div className="flex flex-wrap gap-2">
                  <BoolBadge ok={Boolean(settings?.botTokenConfigured)} label={settings?.botTokenConfigured ? 'Bot token set' : 'No bot token'} />
                  <BoolBadge ok={Boolean(settings?.homeChannelConfigured)} label={settings?.homeChannelConfigured ? 'Home channel set' : 'No home channel'} />
                  <Badge variant="outline">{settings?.approvedUserCount ?? 0} approved users</Badge>
                  {settings?.botTokenMasked && <Badge variant="outline">{settings.botTokenMasked}</Badge>}
                </div>
              </div>
              {(settings?.pendingPairings.length || 0) > 0 && (
                <div className="rounded-md border">
                  <div className="border-b px-3 py-2 text-xs font-medium uppercase text-muted-foreground">Pending Pairing Codes</div>
                  <div className="divide-y">
                    {settings?.pendingPairings.map((pairing) => (
                      <div key={pairing.code} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <code className="font-mono">{pairing.code}</code>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {pairing.userName || pairing.userIdMasked || 'Telegram user'}
                            {pairing.ageMinutes !== null && pairing.ageMinutes !== undefined ? ` - ${pairing.ageMinutes}m` : ''}
                          </span>
                        </div>
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => setForm((prev) => ({ ...prev, pairingCode: pairing.code || '' }))}
                        >
                          Use
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(settings?.approvedPairings.length || 0) > 0 && (
                <div className="flex flex-wrap gap-1">
                  {settings?.approvedPairings.slice(0, 6).map((pairing) => (
                    <Badge key={pairing.userId} variant="secondary">
                      {pairing.userName || pairing.userIdMasked || 'approved'}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">Bot Token</span>
                  <input
                    type="password"
                    value={form.botToken}
                    onChange={(event) => setForm((prev) => ({ ...prev, botToken: event.target.value }))}
                    placeholder={settings?.botTokenConfigured ? 'Leave blank to keep current token' : 'Paste Telegram bot token'}
                    className="block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">Pairing Code</span>
                  <input
                    type="text"
                    value={form.pairingCode}
                    onChange={(event) => setForm((prev) => ({ ...prev, pairingCode: event.target.value.toUpperCase() }))}
                    placeholder="PVZ2FKUM"
                    className="block w-full rounded-md border bg-background px-3 py-1.5 text-sm uppercase focus:border-primary focus:outline-none"
                  />
                </label>
              </div>
              <label className="grid gap-1.5 text-sm">
                <span className="text-xs text-muted-foreground">Home Channel</span>
                <input
                  type="text"
                  value={form.homeChannel}
                  onChange={(event) => setForm((prev) => ({ ...prev, homeChannel: event.target.value }))}
                  placeholder="Optional; pairing can fill this from your Telegram user ID"
                  className="block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                />
              </label>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.validate}
                    onChange={(event) => setForm((prev) => ({ ...prev, validate: event.target.checked }))}
                    className="rounded"
                  />
                  Validate with Telegram
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.restartGateway}
                    onChange={(event) => setForm((prev) => ({ ...prev, restartGateway: event.target.checked }))}
                    className="rounded"
                  />
                  Restart gateway after save
                </label>
              </div>
              {message && (
                <div className={`rounded-md px-3 py-2 text-xs ${message.type === 'success' ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500'}`}>
                  {message.text}
                </div>
              )}
              <Button onClick={saveTelegram} disabled={saving} className="w-fit gap-2">
                <IconDeviceFloppy size={16} />
                {saving ? 'Saving...' : 'Save Bot Setup'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
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
        `${data.command} status --instance ${data.instanceId}`,
        `${data.command} dashboard --instance ${data.instanceId}`,
        `${data.command} ecosystem --instance ${data.instanceId}`,
        `${data.agentCommand} gateway status`,
        `${data.agentCommand} memory status`,
        `curl -fsS ${data.gateway.http.healthUrl}`,
        data.gateway.source.command,
        `tail -80 ${data.gateway.logs.stdout.path}`,
        `tail -80 ${data.gateway.logs.stderr.path}`,
        `pm2 status ${data.localWrapper.daemonProcess}`,
      ].filter((command): command is string => Boolean(command))
    : [
        `${data.claudeCode.commandPath || 'claude'} --version`,
        `ls -la ${data.claudeCode.home.path}`,
        `ls -la ${data.claudeCode.projectClaudeDir.path}`,
        `find ${data.claudeCode.templatesDir.path} -maxdepth 2 -name AGENTS.md`,
      ];
  const mirror = data.runtimeMirror;
  const mirroredPlatforms = mirror.platforms
    .filter((platform) => platform.enabled || platform.channelCount > 0 || platform.state === 'connected')
    .slice(0, 8);
  const configuredSecrets = mirror.secrets.filter((secret) => secret.configured).length;
  const skillsTotal = mirror.skills.installedCount + mirror.skills.builtinCount + mirror.skills.appCount;
  const factsCount = mirror.memory.counts.facts ?? 0;
  const entitiesCount = mirror.memory.counts.entities ?? 0;
  const embeddingsCount = mirror.memory.counts.embeddings ?? 0;
  const journalCount = mirror.memory.counts.journalTurns ?? 0;
  const primaryAgent = mirror.orchestration.agents.find((agent) => agent.orchestration === 'primary');

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
              <StatusBadge ok={data.gateway.http.reachable} label="HTTP gateway" />
              <StatusBadge ok={connectorHealthy} label={connectorMode === 'gateway' ? 'Gateway selected' : 'Claude selected'} />
            </div>
          </div>
          <div className="grid gap-3 p-5">
            <Field label="Instance" value={data.instanceId} />
            <Field
              label="App Command"
              value={connectorMode === 'gateway'
                ? data.status.elevateOsCommandPath || data.command
                : data.claudeCode.commandPath || 'claude'}
            />
            <Field label="Agent Command" value={data.status.elevateCommandPath || data.agentCommand} />
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
                  HTTP connector, launch agent, logs
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
                <Field label="Network Endpoint" value={data.gateway.networkEndpoint} />
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
              <div className="text-[11px] font-medium uppercase text-muted-foreground">Agent Template Instruction Roots</div>
              <div className="grid gap-2">
                {data.claudeCode.templates.map((template) => (
                  <div key={template.name} className="grid gap-2 rounded-md border bg-background px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium capitalize">{template.name}</div>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={template.instructions.exists ? 'default' : 'secondary'}>AGENTS.md</Badge>
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
              <BoolBadge ok={data.gateway.http.reachable} label={data.gateway.http.reachable ? 'HTTP live' : 'HTTP down'} />
              <BoolBadge ok={data.gateway.pidAlive} label={data.gateway.pidAlive ? 'PID live' : 'PID stale'} />
              <BoolBadge ok={data.gateway.launchd.loaded} label={data.gateway.launchd.loaded ? 'Service loaded' : 'Service idle'} />
              <BoolBadge ok={data.gateway.files.state.exists} label={data.gateway.files.state.exists ? 'State file' : 'No state file'} />
            </div>
            <Field label="Provider" value={`${data.gateway.owner} - ${data.gateway.connectionMode}`} />
            <Field label="Transport" value={data.gateway.transport} />
            <Field label="Endpoint" value={data.gateway.networkEndpoint} />
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
            <Field
              label="HTTP Health"
              value={data.gateway.http.reachable
                ? `HTTP ${data.gateway.http.status}${typeof data.gateway.http.latencyMs === 'number' ? ` in ${data.gateway.http.latencyMs}ms` : ''}`
                : data.gateway.http.error}
            />
            <Field label="Last Update" value={data.gateway.updatedAt} />
            <Field label="Launch Agent" value={`${data.gateway.launchd.label}${data.gateway.launchd.pid ? ` pid ${data.gateway.launchd.pid}` : ''}`} />
            <PathField label="Gateway State" info={data.gateway.files.state} />
            <PathField label="Gateway Log" info={data.gateway.logs.stdout} />
            <PathField label="Gateway Errors" info={data.gateway.logs.stderr} />
          </div>
        </CardContent>
      </Card>
      )}

      {connectorMode === 'gateway' && (
        <GatewayTelegramSetupCard onRuntimeRefresh={load} />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconRoute size={18} />
            Runtime Mirror
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile label="Model" value={mirror.model.model} detail={mirror.model.provider} />
            <MetricTile
              label="API"
              value={mirror.api.reachable ? 'Live' : 'Offline'}
              detail={`${mirror.api.apiServerHost}:${mirror.api.apiServerPort}`}
            />
            <MetricTile
              label="Messages"
              value={`${mirror.messages.platformsWithChannels.length} channel groups`}
              detail={`${mirror.messages.telegramApprovedUsers} Telegram approved`}
            />
            <MetricTile
              label="Sessions"
              value={`${mirror.sessions.activeCount} active`}
              detail={`${mirror.sessions.totalInDb ?? 0} stored`}
            />
            <MetricTile label="Memory" value={`${factsCount} facts`} detail={`${embeddingsCount} embeddings`} />
            <MetricTile
              label="Agents"
              value={`${mirror.orchestration.agents.length} configured`}
              detail={primaryAgent ? `${primaryAgent.displayName} leads` : 'no primary agent'}
            />
            <MetricTile label="Skills" value={`${skillsTotal} visible`} detail={`${mirror.skills.builtinCount} builtin`} />
            <MetricTile label="Cron" value={`${mirror.cron.enabled}/${mirror.cron.total} enabled`} detail={mirror.cron.jobsFile.exists ? 'jobs file found' : 'no jobs file'} />
            <MetricTile label="Secrets" value={`${configuredSecrets}/${mirror.secrets.length} configured`} detail="redacted locally" />
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <MirrorPanel title="Messages + APIs" icon={<IconApi size={17} />}>
              <div className="grid gap-2">
                <div className="flex flex-wrap gap-2">
                  <BoolBadge ok={mirror.api.apiServerEnabled} label={mirror.api.apiServerEnabled ? 'API server enabled' : 'API server disabled'} />
                  <BoolBadge ok={mirror.api.reachable} label={mirror.api.reachable ? 'Gateway reachable' : 'Gateway unreachable'} />
                  <BoolBadge ok={mirror.api.apiServerAuthConfigured} label={mirror.api.apiServerAuthConfigured ? 'API auth configured' : 'Loopback auth only'} />
                </div>
                <Field label="OpenAI-compatible endpoint" value={mirror.api.v1Endpoint} />
                {mirroredPlatforms.length > 0 ? (
                  <div className="grid gap-2">
                    {mirroredPlatforms.map((platform) => (
                      <div key={platform.name} className="grid gap-2 rounded-md border bg-muted/20 px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-medium capitalize">{platform.name.replaceAll('_', ' ')}</div>
                          <div className="flex flex-wrap gap-1">
                            <Badge variant={platform.state === 'connected' ? 'default' : 'secondary'}>{platform.state}</Badge>
                            <Badge variant={platform.tokenConfigured ? 'default' : 'secondary'}>{platform.tokenConfigured ? 'token set' : 'no token'}</Badge>
                            <Badge variant="outline">{platform.channelCount} channels</Badge>
                          </div>
                        </div>
                        {platform.channels.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {platform.channels.map((channel, index) => (
                              <Badge key={`${platform.name}-${channel.id ?? index}`} variant="outline">
                                {channel.name || channel.type || channel.id || 'channel'}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {platform.toolsets.length > 0 && (
                          <div className="text-xs text-muted-foreground">
                            Toolsets: {platform.toolsets.join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                    No message platforms have reported channels yet.
                  </div>
                )}
              </div>
            </MirrorPanel>

            <MirrorPanel title="Agent Orchestration" icon={<IconUsers size={17} />}>
              <div className="grid gap-2">
                {mirror.orchestration.agents.length > 0 ? (
                  mirror.orchestration.agents.map((agent) => (
                    <div key={agent.name} className="grid gap-2 rounded-md border bg-muted/20 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{agent.displayName}</div>
                          <div className="text-xs text-muted-foreground">{agent.name} - {agent.org || 'no org'}</div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={agent.orchestration === 'primary' ? 'default' : 'secondary'}>
                            {agent.orchestration === 'primary' ? 'Primary' : 'Specialist'}
                          </Badge>
                          <Badge variant={agent.running ? 'default' : agent.enabled ? 'outline' : 'secondary'}>
                            {agent.running ? 'Running' : agent.enabled ? agent.status : 'Disabled'}
                          </Badge>
                          {agent.activeRouteLabel && (
                            <Badge variant="outline">{agent.activeRouteLabel}</Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">{agent.role}</div>
                      {agent.activeTask && (
                        <div className="text-xs text-muted-foreground">
                          {agent.activeRouteLabel ? `${agent.activeRouteLabel}: ` : ''}{agent.activeTask}
                        </div>
                      )}
                      {agent.reportsTo && (
                        <div className="text-xs text-muted-foreground">Reports to {agent.reportsTo}</div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                    No agents are configured yet. Run elevateos seed-agents to create the starter roster.
                  </div>
                )}
              </div>
            </MirrorPanel>

            <MirrorPanel title="Bot Tokens + Keys" icon={<IconKey size={17} />}>
              <div className="grid gap-2">
                {mirror.secrets.map((secret) => (
                  <div key={secret.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{secret.label}</div>
                      <code className="text-xs text-muted-foreground">{secret.key}</code>
                    </div>
                    <div className="flex items-center gap-2">
                      {secret.masked && <code className="text-xs text-muted-foreground">{secret.masked}</code>}
                      <Badge variant={secret.configured ? 'default' : 'secondary'}>
                        {secret.configured ? 'Configured' : 'Missing'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </MirrorPanel>

            <MirrorPanel title="Cron Jobs + Skills" icon={<IconCalendarClock size={17} />}>
              <div className="grid gap-3">
                <div className="grid gap-2">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{mirror.cron.total} jobs</Badge>
                    <Badge variant="outline">{mirror.cron.enabled} enabled</Badge>
                    <Badge variant="outline">{mirror.cron.disabled} disabled</Badge>
                  </div>
                  {mirror.cron.jobs.length > 0 ? (
                    mirror.cron.jobs.map((job) => (
                      <div key={job.id ?? job.name} className="grid gap-1 rounded-md border bg-muted/20 px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-medium">{job.name}</div>
                          <Badge variant={job.enabled ? 'default' : 'secondary'}>{job.enabled ? 'Enabled' : 'Disabled'}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">{job.schedule}</div>
                        {job.skills.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {job.skills.map((skill) => <Badge key={skill} variant="outline">{skill}</Badge>)}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                      No scheduled jobs are registered right now.
                    </div>
                  )}
                </div>
                <div className="grid gap-2">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{mirror.skills.installedCount} installed</Badge>
                    <Badge variant="outline">{mirror.skills.builtinCount} builtin</Badge>
                    <Badge variant="outline">{mirror.skills.appCount} app</Badge>
                  </div>
                  {mirror.skills.samples.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {mirror.skills.samples.map((skill) => (
                        <Badge key={`${skill.source}-${skill.path}`} variant="secondary">
                          {skill.name}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </MirrorPanel>

            <MirrorPanel title="Memory + Sessions" icon={<IconBrain size={17} />}>
              <div className="grid gap-3">
                <div className="flex flex-wrap gap-2">
                  <BoolBadge ok={mirror.memory.enabled} label={mirror.memory.enabled ? 'Memory enabled' : 'Memory off'} />
                  <BoolBadge ok={mirror.memory.embeddingEnabled} label={mirror.memory.embeddingEnabled ? 'Embeddings on' : 'Embeddings off'} />
                  <BoolBadge ok={mirror.memory.dailyOrganizeEnabled} label={mirror.memory.dailyOrganizeEnabled ? `Daily ${mirror.memory.dailyOrganizeTime}` : 'Daily off'} />
                </div>
                <div className="grid gap-2 sm:grid-cols-4">
                  <MetricTile label="Facts" value={`${factsCount}`} />
                  <MetricTile label="Entities" value={`${entitiesCount}`} />
                  <MetricTile label="Journal" value={`${journalCount}`} />
                  <MetricTile label="Embeddings" value={`${embeddingsCount}`} />
                </div>
                <div className="text-xs text-muted-foreground">
                  {mirror.memory.provider} memory, {mirror.memory.embeddingProvider || 'no'} embeddings,
                  organize every {mirror.memory.organizeEveryTurns ?? 0} turns.
                </div>
                {mirror.sessions.active.length > 0 ? (
                  <div className="grid gap-2">
                    {mirror.sessions.active.map((session, index) => (
                      <div key={session.sessionId ?? index} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {session.displayName || session.sessionId || 'Active session'}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {[session.platform, session.chatType, session.updatedAt ? formatTimestamp(session.updatedAt) : null].filter(Boolean).join(' - ')}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {session.suspended && <Badge variant="secondary">suspended</Badge>}
                          {session.resumePending && <Badge variant="secondary">resume pending</Badge>}
                          {typeof session.lastPromptTokens === 'number' && <Badge variant="outline">{session.lastPromptTokens} tokens</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                    No active sessions are registered right now.
                  </div>
                )}
              </div>
            </MirrorPanel>

            <MirrorPanel title="Local Files" icon={<IconDatabase size={17} />}>
              <div className="grid gap-3">
                <PathField label="Config" info={mirror.files.config} />
                <PathField label="Secrets" info={mirror.files.secrets} />
                <PathField label="Memory DB" info={mirror.memory.db} />
                <PathField label="Sessions Map" info={mirror.sessions.sessionsMap} />
              </div>
            </MirrorPanel>
          </div>
        </CardContent>
      </Card>

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
