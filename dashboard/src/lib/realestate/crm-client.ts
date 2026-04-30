import { getOrgConfig, getSecretsPath, parseEnvFile } from './org-config';

export type CrmResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'not-configured' }
  | { kind: 'no-key' }
  | { kind: 'error'; message: string; status?: number };

export interface CrmLead {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  source?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

function getCrmConfig() {
  return getOrgConfig()?.integrations?.crm ?? null;
}

function getCrmKey(): string | null {
  const cfg = getCrmConfig();
  const envName = cfg?.api_key_env;
  if (!envName) return null;
  const env = parseEnvFile(getSecretsPath());
  return env[envName] || process.env[envName] || null;
}

function buildEndpoint(template: string | undefined, params: Record<string, string> = {}): string | null {
  if (!template) return null;
  return Object.entries(params).reduce(
    (path, [key, value]) => path.replace(`:${key}`, encodeURIComponent(value)),
    template
  );
}

async function crmFetch<T>(
  endpoint: string | null,
  opts: { method?: string; body?: unknown; params?: URLSearchParams } = {}
): Promise<CrmResult<T>> {
  const cfg = getCrmConfig();
  if (!cfg?.base_url || !endpoint) return { kind: 'not-configured' };
  const key = getCrmKey();
  if (!key) return { kind: 'no-key' };

  const base = cfg.base_url.replace(/\/+$/, '');
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const params = opts.params ? new URLSearchParams(opts.params) : new URLSearchParams();
  const authType = cfg.auth?.type ?? 'header';
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (authType === 'query') {
    params.set(cfg.auth?.query_param ?? 'api_key', key);
  } else {
    const header = cfg.auth?.header ?? 'Authorization';
    const prefix = cfg.auth?.prefix ?? 'Bearer ';
    headers[header] = `${prefix}${key}`;
  }

  const query = params.toString();
  const url = `${base}${path}${query ? `?${query}` : ''}`;

  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        ...headers,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      return { kind: 'error', message: await res.text(), status: res.status };
    }
    return { kind: 'ok', data: (await res.json()) as T };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'fetch failed' };
  }
}

export async function pullLeads(scrollId?: string): Promise<CrmResult<{ leads: CrmLead[]; scrollId?: string }>> {
  const cfg = getCrmConfig();
  const params = new URLSearchParams();
  if (scrollId) params.set('scrollId', scrollId);
  return crmFetch<{ leads: CrmLead[]; scrollId?: string }>(cfg?.endpoints?.leads ?? null, { params });
}

export async function getLeadById(id: string): Promise<CrmResult<CrmLead>> {
  const cfg = getCrmConfig();
  return crmFetch<CrmLead>(buildEndpoint(cfg?.endpoints?.lead, { id }));
}

export async function logNote(leadId: string, text: string): Promise<CrmResult<{ id: string }>> {
  const cfg = getCrmConfig();
  return crmFetch<{ id: string }>(buildEndpoint(cfg?.endpoints?.notes, { id: leadId }), {
    method: 'POST',
    body: { text },
  });
}
