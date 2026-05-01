'use client';

import { useCallback, useState, useEffect } from 'react';
import { IconBrandTelegram, IconDeviceFloppy, IconRefresh, IconSettings } from '@tabler/icons-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

interface AgentConfig {
  timezone?: string;
  day_mode_start?: string;
  day_mode_end?: string;
  communication_style?: string;
  approval_rules?: {
    always_ask?: string[];
    never_ask?: string[];
  };
  model?: string;
  dangerously_skip_permissions?: boolean;
  max_session_seconds?: number;
  max_crashes_per_day?: number;
  startup_delay?: number;
}

interface SettingsTabProps {
  agentName: string;
  org?: string;
}

const APPROVAL_CATEGORIES = ['external-comms', 'financial', 'deployment', 'data-deletion'] as const;

type MessageState = { type: 'success' | 'error'; text: string } | null;

const TIME_REGEX = /^\d{2}:\d{2}$/;

interface TelegramPairing {
  code: string;
  userId: string;
  userName: string;
  userIdMasked: string;
  ageMinutes: number | null;
}

interface TelegramApprovedPairing {
  userId: string;
  userName: string;
  userIdMasked: string;
  approvedAt: number | null;
}

interface TelegramValidation {
  ok: boolean;
  error?: string;
  botUsername?: string;
  chatType?: string;
  selfChat?: boolean;
}

interface TelegramSettings {
  agent: { name: string; org: string };
  envPath: string;
  botTokenConfigured: boolean;
  botTokenMasked: string;
  chatId: string;
  allowedUser: string;
  allowedUserConfigured: boolean;
  configured: boolean;
  gatewayBotTokenConfigured: boolean;
  pendingPairings: TelegramPairing[];
  approvedPairings: TelegramApprovedPairing[];
  validation?: TelegramValidation;
}

interface TelegramForm {
  botToken: string;
  chatId: string;
  allowedUser: string;
  pairingCode: string;
  useGatewayBotToken: boolean;
}

function telegramSettingsUrl(agentName: string, org?: string): string {
  const query = org ? `?org=${encodeURIComponent(org)}` : '';
  return `/api/agents/${encodeURIComponent(agentName)}/telegram${query}`;
}

function agentConfigUrl(agentName: string, org?: string): string {
  const query = org ? `?org=${encodeURIComponent(org)}` : '';
  return `/api/agents/${encodeURIComponent(agentName)}/config${query}`;
}

function TelegramConnectionCard({ agentName, org }: SettingsTabProps) {
  const [data, setData] = useState<TelegramSettings | null>(null);
  const [form, setForm] = useState<TelegramForm>({
    botToken: '',
    chatId: '',
    allowedUser: '',
    pairingCode: '',
    useGatewayBotToken: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<MessageState>(null);

  const loadTelegram = useCallback(async (resetForm = true) => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(telegramSettingsUrl(agentName, org));
      const body = await res.json();
      if (!res.ok) {
        setMessage({ type: 'error', text: body.error || 'Failed to load Telegram settings' });
        return;
      }

      setData(body);
      if (resetForm) {
        setForm({
          botToken: '',
          chatId: body.chatId || '',
          allowedUser: body.allowedUser || '',
          pairingCode: '',
          useGatewayBotToken: false,
        });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error loading Telegram settings' });
    } finally {
      setLoading(false);
    }
  }, [agentName, org]);

  useEffect(() => {
    loadTelegram();
  }, [loadTelegram]);

  async function saveTelegram() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(telegramSettingsUrl(agentName, org), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: form.botToken.trim() || undefined,
          chatId: form.chatId.trim() || undefined,
          allowedUser: form.allowedUser.trim() || undefined,
          pairingCode: form.pairingCode.trim() || undefined,
          useGatewayBotToken: form.useGatewayBotToken,
          validate: true,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMessage({ type: 'error', text: body.error || 'Failed to save Telegram settings' });
        return;
      }

      setData(body);
      setForm({
        botToken: '',
        chatId: body.chatId || '',
        allowedUser: body.allowedUser || '',
        pairingCode: '',
        useGatewayBotToken: false,
      });

      const validation = body.validation as TelegramValidation | undefined;
      if (validation?.ok && validation.selfChat) {
        setMessage({ type: 'error', text: 'Saved, but CHAT_ID points at the bot account. Use your Telegram user chat instead.' });
      } else if (validation?.ok) {
        const target = [validation.botUsername, validation.chatType].filter(Boolean).join(' - ');
        setMessage({ type: 'success', text: target ? `Saved and validated: ${target}` : 'Saved and validated' });
      } else if (validation) {
        setMessage({ type: 'error', text: `Saved, but validation failed: ${validation.error || 'unknown error'}` });
      } else {
        setMessage({ type: 'success', text: 'Saved Telegram settings' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error saving Telegram settings' });
    } finally {
      setSaving(false);
    }
  }

  const statusLabel = data?.configured
    ? 'Ready'
    : data?.botTokenConfigured
      ? 'Needs user gate'
      : 'Needs token';
  const statusClass = data?.configured
    ? 'bg-green-500/10 text-green-600'
    : data?.botTokenConfigured
      ? 'bg-amber-500/10 text-amber-600'
      : 'bg-muted text-muted-foreground';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <IconBrandTelegram size={16} className="text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Telegram</CardTitle>
            {data && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusClass}`}>
                {statusLabel}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => loadTelegram()}
            disabled={loading}
            title="Refresh Telegram settings"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <IconRefresh size={14} />
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !data ? (
          <div className="h-28 rounded-md bg-muted/40 animate-pulse" />
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="text-[11px] text-muted-foreground">Bot Token</div>
                <code className="mt-1 block truncate text-xs">{data?.botTokenMasked || 'not set'}</code>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="text-[11px] text-muted-foreground">Chat ID</div>
                <code className="mt-1 block truncate text-xs">{data?.chatId || 'not set'}</code>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="text-[11px] text-muted-foreground">Allowed User</div>
                <code className="mt-1 block truncate text-xs">{data?.allowedUser || 'not set'}</code>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground">Bot Token</label>
                <input
                  type="password"
                  value={form.botToken}
                  onChange={e => setForm(p => ({ ...p, botToken: e.target.value, useGatewayBotToken: false }))}
                  placeholder={data?.botTokenConfigured ? 'Leave blank to keep current token' : 'Paste bot token'}
                  className="mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Pairing Code</label>
                <input
                  type="text"
                  value={form.pairingCode}
                  onChange={e => setForm(p => ({ ...p, pairingCode: e.target.value.toUpperCase() }))}
                  placeholder="Pairing code"
                  className="mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm uppercase focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Chat ID</label>
                <input
                  type="text"
                  value={form.chatId}
                  onChange={e => setForm(p => ({ ...p, chatId: e.target.value }))}
                  placeholder="Telegram chat ID"
                  className="mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Allowed User ID</label>
                <input
                  type="text"
                  value={form.allowedUser}
                  onChange={e => setForm(p => ({ ...p, allowedUser: e.target.value }))}
                  placeholder="Numeric Telegram user ID"
                  className="mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.useGatewayBotToken}
                disabled={!data?.gatewayBotTokenConfigured}
                onChange={e => setForm(p => ({ ...p, useGatewayBotToken: e.target.checked, botToken: e.target.checked ? '' : p.botToken }))}
                className="rounded"
              />
              Use gateway bot token
              {!data?.gatewayBotTokenConfigured && (
                <span className="text-xs text-muted-foreground">not configured</span>
              )}
            </label>

            {(data?.pendingPairings.length || 0) > 0 && (
              <div className="rounded-md border">
                <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">Pending Pairings</div>
                <div className="divide-y">
                  {data?.pendingPairings.map(pairing => (
                    <div key={pairing.code} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <code className="font-mono">{pairing.code}</code>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {pairing.userName || pairing.userIdMasked || 'Telegram user'}
                          {pairing.ageMinutes !== null ? ` - ${pairing.ageMinutes}m` : ''}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setForm(p => ({
                          ...p,
                          pairingCode: pairing.code,
                          useGatewayBotToken: data?.gatewayBotTokenConfigured || p.useGatewayBotToken,
                        }))}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                      >
                        Use
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(data?.approvedPairings.length || 0) > 0 && (
              <div className="rounded-md border">
                <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">Approved Pairings</div>
                <div className="divide-y">
                  {data?.approvedPairings.map(pairing => (
                    <div key={pairing.userId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <span className="truncate">{pairing.userName || 'Telegram user'}</span>
                        <code className="ml-2 font-mono text-xs text-muted-foreground">{pairing.userIdMasked}</code>
                      </div>
                      <button
                        type="button"
                        onClick={() => setForm(p => ({
                          ...p,
                          chatId: pairing.userId,
                          allowedUser: pairing.userId,
                          useGatewayBotToken: data?.gatewayBotTokenConfigured || p.useGatewayBotToken,
                        }))}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                      >
                        Use
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {message && (
              <div className={`rounded-md px-3 py-2 text-xs ${message.type === 'success' ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500'}`}>
                {message.text}
              </div>
            )}

            <button
              type="button"
              onClick={saveTelegram}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <IconDeviceFloppy size={14} />
              {saving ? 'Saving...' : 'Save Telegram'}
            </button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function SettingsTab({ agentName, org }: SettingsTabProps) {
  const [config, setConfig] = useState<AgentConfig>({});
  const [loading, setLoading] = useState(true);

  // Section 1: Operational Config
  const [opSaving, setOpSaving] = useState(false);
  const [opMessage, setOpMessage] = useState<MessageState>(null);

  // Time validation errors
  const [startError, setStartError] = useState<string | null>(null);
  const [endError, setEndError] = useState<string | null>(null);

  // Section 2: Agent Config
  const [agSaving, setAgSaving] = useState(false);
  const [agMessage, setAgMessage] = useState<MessageState>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(agentConfigUrl(agentName, org), { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => {
        if (!controller.signal.aborted && d.config) setConfig(d.config);
        if (!controller.signal.aborted) setLoading(false);
      })
      .catch(err => { if (err.name !== 'AbortError') setLoading(false); });
    return () => controller.abort();
  }, [agentName, org]);

  const updateApprovalList = (list: 'always_ask' | 'never_ask', cat: string) => {
    const opposite = list === 'always_ask' ? 'never_ask' : 'always_ask';
    setConfig(prev => {
      const rules = prev.approval_rules || {};
      const current = rules[list] || [];
      const oppositeList = rules[opposite] || [];
      const next = current.includes(cat) ? current.filter(c => c !== cat) : [...current, cat];
      // Enforce mutual exclusion: remove from opposite list when adding to this one
      const nextOpposite = next.includes(cat) ? oppositeList.filter(c => c !== cat) : oppositeList;
      return {
        ...prev,
        approval_rules: {
          ...rules,
          [list]: next,
          [opposite]: nextOpposite,
        },
      };
    });
  };

  const validateTimes = (): boolean => {
    let valid = true;
    const start = config.day_mode_start || '';
    const end = config.day_mode_end || '';
    if (start && !TIME_REGEX.test(start)) {
      setStartError('Must be HH:MM format (e.g. 08:00)');
      valid = false;
    } else {
      setStartError(null);
    }
    if (end && !TIME_REGEX.test(end)) {
      setEndError('Must be HH:MM format (e.g. 00:00)');
      valid = false;
    } else {
      setEndError(null);
    }
    return valid;
  };

  const saveSection = async (
    fields: Partial<AgentConfig>,
    setSaving: (v: boolean) => void,
    setMessage: (m: MessageState) => void,
  ) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(agentConfigUrl(agentName, org), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      const d = await res.json();
      if (!res.ok) {
        setMessage({ type: 'error', text: d.error || 'Failed to save' });
      } else {
        if (d.config) setConfig(d.config);
        const gatewaySync = d.gateway_sync as { ok?: boolean; error?: string | null } | undefined;
        setMessage({
          type: 'success',
          text: gatewaySync && gatewaySync.ok === false
            ? `Saved locally. Gateway sync pending: ${gatewaySync.error || 'gateway unavailable'}`
            : 'Saved. Synced to gateway and agent notified to reload config.',
        });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setSaving(false);
    }
  };

  const saveOpConfig = () => {
    if (!validateTimes()) return;
    saveSection(
      {
        timezone: config.timezone,
        day_mode_start: config.day_mode_start,
        day_mode_end: config.day_mode_end,
        communication_style: config.communication_style,
        approval_rules: config.approval_rules,
      },
      setOpSaving,
      setOpMessage,
    );
  };

  const saveAgConfig = () =>
    saveSection(
      {
        model: config.model,
        dangerously_skip_permissions: config.dangerously_skip_permissions,
        max_session_seconds: config.max_session_seconds,
        max_crashes_per_day: config.max_crashes_per_day,
        startup_delay: config.startup_delay,
      },
      setAgSaving,
      setAgMessage,
    );

  if (loading) {
    return <div className="p-6 text-muted-foreground">Loading settings...</div>;
  }

  const alwaysAsk = config.approval_rules?.always_ask || [];
  const neverAsk = config.approval_rules?.never_ask || [];

  return (
    <div className="space-y-4 p-1">
      <TelegramConnectionCard agentName={agentName} org={org} />

      {/* Section 1: Operational Config */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <IconSettings size={16} className="text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Operational Config</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Timezone</label>
            <input
              type="text"
              value={config.timezone || ''}
              onChange={e => setConfig(p => ({ ...p, timezone: e.target.value }))}
              placeholder="America/New_York"
              className="mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Day Mode Start</label>
              <input
                type="text"
                value={config.day_mode_start || ''}
                onChange={e => setConfig(p => ({ ...p, day_mode_start: e.target.value }))}
                onBlur={() => {
                  const val = config.day_mode_start || '';
                  if (val && !TIME_REGEX.test(val)) {
                    setStartError('Must be HH:MM format (e.g. 08:00)');
                  } else {
                    setStartError(null);
                  }
                }}
                placeholder="08:00"
                className={`mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none${startError ? ' border-red-500' : ''}`}
              />
              {startError && <p className="mt-1 text-xs text-red-500">{startError}</p>}
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Day Mode End</label>
              <input
                type="text"
                value={config.day_mode_end || ''}
                onChange={e => setConfig(p => ({ ...p, day_mode_end: e.target.value }))}
                onBlur={() => {
                  const val = config.day_mode_end || '';
                  if (val && !TIME_REGEX.test(val)) {
                    setEndError('Must be HH:MM format (e.g. 00:00)');
                  } else {
                    setEndError(null);
                  }
                }}
                placeholder="00:00"
                className={`mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none${endError ? ' border-red-500' : ''}`}
              />
              {endError && <p className="mt-1 text-xs text-red-500">{endError}</p>}
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Communication Style</label>
            <input
              type="text"
              value={config.communication_style || ''}
              onChange={e => setConfig(p => ({ ...p, communication_style: e.target.value }))}
              placeholder="casual, brief, proactive"
              className="mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Always Require Approval</label>
            <div className="mt-2 flex flex-wrap gap-3">
              {APPROVAL_CATEGORIES.map(cat => (
                <label key={cat} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alwaysAsk.includes(cat)}
                    onChange={() => updateApprovalList('always_ask', cat)}
                    className="rounded"
                  />
                  {cat}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Never Require Approval</label>
            <div className="mt-2 flex flex-wrap gap-3">
              {APPROVAL_CATEGORIES.map(cat => (
                <label key={cat} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={neverAsk.includes(cat)}
                    onChange={() => updateApprovalList('never_ask', cat)}
                    className="rounded"
                  />
                  {cat}
                </label>
              ))}
            </div>
          </div>

          {opMessage && (
            <div className={`rounded-md px-3 py-2 text-xs ${opMessage.type === 'success' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
              {opMessage.text}
            </div>
          )}

          <button
            onClick={saveOpConfig}
            disabled={opSaving}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <IconDeviceFloppy size={14} />
            {opSaving ? 'Saving...' : 'Save Operational Config'}
          </button>
        </CardContent>
      </Card>

      {/* Section 2: Agent Config */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Agent Config</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Model</label>
            <input
              type="text"
              value={config.model || ''}
              onChange={e => setConfig(p => ({ ...p, model: e.target.value }))}
              placeholder="claude-sonnet-4-5"
              className="mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={config.dangerously_skip_permissions === true}
              onChange={e => setConfig(p => ({ ...p, dangerously_skip_permissions: e.target.checked }))}
              className="rounded"
            />
            <span>Bypass Claude Permissions</span>
          </label>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Max Session (sec)</label>
              <input
                type="number"
                value={config.max_session_seconds ?? ''}
                onChange={e => setConfig(p => ({ ...p, max_session_seconds: e.target.value ? Number(e.target.value) : undefined }))}
                placeholder="255600"
                className="mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Max Crashes/Day</label>
              <input
                type="number"
                value={config.max_crashes_per_day ?? ''}
                onChange={e => setConfig(p => ({ ...p, max_crashes_per_day: e.target.value ? Number(e.target.value) : undefined }))}
                placeholder="5"
                className="mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Startup Delay (sec)</label>
              <input
                type="number"
                value={config.startup_delay ?? ''}
                onChange={e => setConfig(p => ({ ...p, startup_delay: e.target.value ? Number(e.target.value) : undefined }))}
                placeholder="0"
                className="mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          {agMessage && (
            <div className={`rounded-md px-3 py-2 text-xs ${agMessage.type === 'success' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
              {agMessage.text}
            </div>
          )}

          <button
            onClick={saveAgConfig}
            disabled={agSaving}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <IconDeviceFloppy size={14} />
            {agSaving ? 'Saving...' : 'Save Agent Config'}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
