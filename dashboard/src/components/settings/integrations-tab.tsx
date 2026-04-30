'use client';

import { useCallback, useEffect, useState } from 'react';
import { IconCheck, IconDeviceFloppy, IconPlugConnected, IconRefresh, IconShieldLock } from '@tabler/icons-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type CrmAuthType = 'header' | 'query';

interface IntegrationSettings {
  org: string;
  configPath: string | null;
  writableConfigPath: string;
  secretsPath: string;
  crm: CrmForm;
}

interface CrmForm {
  provider: string;
  label: string;
  apiKeyEnv: string;
  apiKey?: string;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  baseUrl: string;
  authType: CrmAuthType;
  authHeader: string;
  authPrefix: string;
  authQueryParam: string;
  dbColumns: {
    leadId: string;
    stage: string;
    tags: string;
  };
  endpoints: {
    leads: string;
    lead: string;
    notes: string;
  };
}

function FieldCode({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid gap-1">
      <div className="text-[11px] font-medium uppercase text-muted-foreground">{label}</div>
      <code className="break-all rounded-md bg-muted px-2 py-1.5 text-xs text-foreground">
        {value || 'Not created yet'}
      </code>
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  placeholder,
  type = 'text',
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function IntegrationsTab() {
  const [data, setData] = useState<IntegrationSettings | null>(null);
  const [form, setForm] = useState<CrmForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string; error?: string; status?: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setStatus('idle');
    setTestResult(null);
    try {
      const res = await fetch('/api/settings/integrations');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = await res.json() as IntegrationSettings;
      setData(next);
      setForm({ ...next.crm, apiKey: '' });
    } catch (err) {
      setData(null);
      setForm(null);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to load integration settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function patchForm(patch: Partial<CrmForm>) {
    setForm((prev) => prev ? { ...prev, ...patch } : prev);
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setStatus('idle');
    setError('');
    setTestResult(null);
    try {
      const res = await fetch('/api/settings/integrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const next = body as IntegrationSettings;
      setData(next);
      setForm({ ...next.crm, apiKey: '' });
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2200);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    if (!form) return;
    setTesting(true);
    setStatus('idle');
    setError('');
    setTestResult(null);
    try {
      const res = await fetch('/api/settings/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, action: 'test' }),
      });
      const body = await res.json();
      setTestResult({
        success: Boolean(body.success && res.ok),
        message: body.message,
        error: body.error,
        status: body.status,
      });
    } catch (err) {
      setTestResult({
        success: false,
        error: err instanceof Error ? err.message : 'Connection test failed',
      });
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return <div className="h-72 rounded-xl bg-muted/30 animate-pulse" />;
  }

  if (!data || !form) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          Integration settings could not be loaded.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconPlugConnected size={18} />
              CRM Connection
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{data.org}</Badge>
              <Badge variant={form.baseUrl ? 'default' : 'secondary'}>
                {form.baseUrl ? 'Endpoint set' : 'No endpoint'}
              </Badge>
              <Badge variant={form.hasApiKey ? 'default' : 'secondary'}>
                {form.hasApiKey ? 'Secret saved' : 'No secret'}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="grid gap-3">
            <TextField
              id="crm-label"
              label="Label"
              value={form.label}
              onChange={(label) => patchForm({ label })}
            />
            <TextField
              id="crm-provider"
              label="Provider ID"
              value={form.provider}
              onChange={(provider) => patchForm({ provider })}
            />
            <TextField
              id="crm-base-url"
              label="Base URL"
              value={form.baseUrl}
              placeholder="https://api.example.com"
              onChange={(baseUrl) => patchForm({ baseUrl })}
            />
            <div className="grid gap-3 sm:grid-cols-[0.85fr_1.15fr]">
              <TextField
                id="crm-api-key-env"
                label="API Key Env"
                value={form.apiKeyEnv}
                onChange={(apiKeyEnv) => patchForm({ apiKeyEnv })}
              />
              <TextField
                id="crm-api-key"
                label="API Key"
                type="password"
                value={form.apiKey ?? ''}
                placeholder={form.apiKeyPreview ?? 'Paste to save'}
                onChange={(apiKey) => patchForm({ apiKey })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Auth Type</Label>
              <Select
                value={form.authType}
                onValueChange={(value) => patchForm({ authType: value === 'query' ? 'query' : 'header' })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value="header">Header</SelectItem>
                  <SelectItem value="query">Query Param</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.authType === 'query' ? (
              <TextField
                id="crm-query-param"
                label="Query Param"
                value={form.authQueryParam}
                onChange={(authQueryParam) => patchForm({ authQueryParam })}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  id="crm-auth-header"
                  label="Header"
                  value={form.authHeader}
                  onChange={(authHeader) => patchForm({ authHeader })}
                />
                <TextField
                  id="crm-auth-prefix"
                  label="Prefix"
                  value={form.authPrefix}
                  onChange={(authPrefix) => patchForm({ authPrefix })}
                />
              </div>
            )}
          </div>

          <div className="grid gap-4 content-start">
            <div className="grid gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <IconShieldLock size={17} />
                Runtime Files
              </div>
              <FieldCode label="Active Config" value={data.configPath} />
              <FieldCode label="Writable Config" value={data.writableConfigPath} />
              <FieldCode label="Secrets" value={data.secretsPath} />
            </div>
            <div className="grid gap-3">
              <div className="text-sm font-semibold">Endpoints</div>
              <TextField
                id="crm-endpoint-leads"
                label="Leads"
                value={form.endpoints.leads}
                onChange={(leads) => patchForm({ endpoints: { ...form.endpoints, leads } })}
              />
              <TextField
                id="crm-endpoint-lead"
                label="Lead Detail"
                value={form.endpoints.lead}
                onChange={(lead) => patchForm({ endpoints: { ...form.endpoints, lead } })}
              />
              <TextField
                id="crm-endpoint-notes"
                label="Notes"
                value={form.endpoints.notes}
                onChange={(notes) => patchForm({ endpoints: { ...form.endpoints, notes } })}
              />
            </div>
            <div className="grid gap-3">
              <div className="text-sm font-semibold">Message DB Columns</div>
              <div className="grid gap-3 sm:grid-cols-3">
                <TextField
                  id="crm-column-lead"
                  label="Lead ID"
                  value={form.dbColumns.leadId}
                  onChange={(leadId) => patchForm({ dbColumns: { ...form.dbColumns, leadId } })}
                />
                <TextField
                  id="crm-column-stage"
                  label="Stage"
                  value={form.dbColumns.stage}
                  onChange={(stage) => patchForm({ dbColumns: { ...form.dbColumns, stage } })}
                />
                <TextField
                  id="crm-column-tags"
                  label="Tags"
                  value={form.dbColumns.tags}
                  onChange={(tags) => patchForm({ dbColumns: { ...form.dbColumns, tags } })}
                />
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={saving} className="gap-2">
            {status === 'saved' ? <IconCheck size={16} /> : <IconDeviceFloppy size={16} />}
            {saving ? 'Saving...' : 'Save'}
          </Button>
          <Button variant="secondary" onClick={testConnection} disabled={saving || testing} className="gap-2">
            <IconPlugConnected size={16} />
            {testing ? 'Testing...' : 'Test connection'}
          </Button>
          <Button variant="outline" onClick={load} disabled={saving} className="gap-2">
            <IconRefresh size={16} />
            Refresh
          </Button>
          {status === 'saved' && <span className="text-sm text-green-600">Saved.</span>}
          {status === 'error' && <span className="text-sm text-destructive">{error}</span>}
          {testResult && (
            <span className={testResult.success ? 'text-sm text-green-600' : 'text-sm text-destructive'}>
              {testResult.message ?? testResult.error ?? 'Connection test finished.'}
            </span>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
