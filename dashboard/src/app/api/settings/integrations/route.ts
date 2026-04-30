import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { CTX_FRAMEWORK_ROOT, CTX_ROOT } from '@/lib/config';
import {
  clearOrgConfigCache,
  getActiveOrgName,
  getOrgConfig,
  getSecretsPath,
  parseEnvFile,
  type OrgConfig,
} from '@/lib/realestate/org-config';

export const dynamic = 'force-dynamic';

type JsonRecord = Record<string, unknown>;
type CrmAuthType = 'header' | 'query';
type CrmSettings = NonNullable<NonNullable<OrgConfig['integrations']>['crm']>;

interface CrmSettingsBody {
  action?: 'test';
  provider?: string;
  label?: string;
  apiKeyEnv?: string;
  apiKey?: string;
  baseUrl?: string;
  authType?: CrmAuthType;
  authHeader?: string;
  authPrefix?: string;
  authQueryParam?: string;
  dbColumns?: {
    leadId?: string;
    stage?: string;
    tags?: string;
  };
  endpoints?: {
    leads?: string;
    lead?: string;
    notes?: string;
  };
}

const DEFAULT_CRM = {
  provider: 'custom',
  label: 'CRM',
  apiKeyEnv: 'CRM_API_KEY',
  baseUrl: '',
  authType: 'header' as CrmAuthType,
  authHeader: 'Authorization',
  authPrefix: 'Bearer ',
  authQueryParam: 'api_key',
  dbColumns: {
    leadId: 'crm_lead_id',
    stage: 'crm_stage',
    tags: 'crm_tags',
  },
  endpoints: {
    leads: '/v1/leads',
    lead: '/v1/leads/:id',
    notes: '/v1/leads/:id/notes',
  },
};

function orgPaths(org: string) {
  return {
    frameworkPath: path.join(CTX_FRAMEWORK_ROOT, 'orgs', org, 'config.json'),
    frameworkSecretsPath: path.join(CTX_FRAMEWORK_ROOT, 'orgs', org, 'secrets.env'),
    statePath: path.join(CTX_ROOT, 'orgs', org, 'config.json'),
    stateSecretsPath: path.join(CTX_ROOT, 'orgs', org, 'secrets.env'),
    templatePath: path.join(CTX_FRAMEWORK_ROOT, 'customer-templates', org, 'config.json'),
  };
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

function readWritableConfig(org: string): JsonRecord {
  const paths = orgPaths(org);
  return (
    readJson(paths.statePath) ??
    readJson(paths.frameworkPath) ??
    readJson(paths.templatePath) ??
    { name: org, display_name: org }
  );
}

function cleanString(value: unknown, fallback: string, max = 250): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : fallback;
}

function cleanOptionalString(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanEnvName(value: unknown): string {
  const envName = cleanString(value, DEFAULT_CRM.apiKeyEnv, 80).toUpperCase();
  return /^[A-Z][A-Z0-9_]*$/.test(envName) ? envName : DEFAULT_CRM.apiKeyEnv;
}

function cleanColumn(value: unknown, fallback: string): string {
  const column = cleanString(value, fallback, 80);
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(column) ? column : fallback;
}

function cleanEndpoint(value: unknown, fallback: string): string {
  const endpoint = cleanString(value, fallback, 220);
  return endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
}

function maskSecret(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return '********';
  return `${value.slice(0, 4)}********${value.slice(-4)}`;
}

function encodeEnvValue(value: string): string {
  if (/[\r\n\0]/.test(value)) {
    throw new Error('Secret values cannot contain line breaks or null bytes');
  }
  if (/^[A-Za-z0-9_./:=+@%,-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function readCrmView() {
  const cfg = getOrgConfig();
  const crm = cfg?.integrations?.crm;
  const apiKeyEnv = crm?.api_key_env ?? DEFAULT_CRM.apiKeyEnv;
  const secrets = parseEnvFile(getSecretsPath());
  const secret = secrets[apiKeyEnv] || process.env[apiKeyEnv];
  const authType = crm?.auth?.type ?? DEFAULT_CRM.authType;

  return {
    provider: crm?.provider ?? DEFAULT_CRM.provider,
    label: crm?.label ?? DEFAULT_CRM.label,
    apiKeyEnv,
    hasApiKey: Boolean(secret),
    apiKeyPreview: maskSecret(secret),
    baseUrl: crm?.base_url ?? DEFAULT_CRM.baseUrl,
    authType,
    authHeader: crm?.auth?.header ?? DEFAULT_CRM.authHeader,
    authPrefix: crm?.auth?.prefix ?? DEFAULT_CRM.authPrefix,
    authQueryParam: crm?.auth?.query_param ?? DEFAULT_CRM.authQueryParam,
    dbColumns: {
      leadId: crm?.db_columns?.lead_id ?? DEFAULT_CRM.dbColumns.leadId,
      stage: crm?.db_columns?.stage ?? DEFAULT_CRM.dbColumns.stage,
      tags: crm?.db_columns?.tags ?? DEFAULT_CRM.dbColumns.tags,
    },
    endpoints: {
      leads: crm?.endpoints?.leads ?? DEFAULT_CRM.endpoints.leads,
      lead: crm?.endpoints?.lead ?? DEFAULT_CRM.endpoints.lead,
      notes: crm?.endpoints?.notes ?? DEFAULT_CRM.endpoints.notes,
    },
  };
}

function writeSecret(secretsPath: string, key: string, value: string): void {
  fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
  const lines = fs.existsSync(secretsPath)
    ? fs.readFileSync(secretsPath, 'utf-8').split(/\r?\n/)
    : [];
  const assignment = `${key}=${encodeEnvValue(value)}`;
  let found = false;
  const next = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (match?.[1] === key) {
      found = true;
      return assignment;
    }
    return line;
  });
  if (!found) {
    if (next.length > 0 && next[next.length - 1] !== '') next.push('');
    next.push(assignment);
  }
  fs.writeFileSync(secretsPath, `${next.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(secretsPath, 0o600);
  } catch {
    // chmod can fail on non-POSIX filesystems; the value was still written.
  }
}

function buildCrmSettings(body: CrmSettingsBody): CrmSettings {
  const authType: CrmAuthType = body.authType === 'query' ? 'query' : 'header';
  return {
    provider: cleanString(body.provider, DEFAULT_CRM.provider, 80),
    label: cleanString(body.label, DEFAULT_CRM.label, 80),
    api_key_env: cleanEnvName(body.apiKeyEnv),
    base_url: cleanOptionalString(body.baseUrl),
    auth: authType === 'query'
      ? {
          type: authType,
          query_param: cleanString(body.authQueryParam, DEFAULT_CRM.authQueryParam, 80),
        }
      : {
          type: authType,
          header: cleanString(body.authHeader, DEFAULT_CRM.authHeader, 120),
          prefix: typeof body.authPrefix === 'string' ? body.authPrefix.slice(0, 80) : DEFAULT_CRM.authPrefix,
        },
    db_columns: {
      lead_id: cleanColumn(body.dbColumns?.leadId, DEFAULT_CRM.dbColumns.leadId),
      stage: cleanColumn(body.dbColumns?.stage, DEFAULT_CRM.dbColumns.stage),
      tags: cleanColumn(body.dbColumns?.tags, DEFAULT_CRM.dbColumns.tags),
    },
    endpoints: {
      leads: cleanEndpoint(body.endpoints?.leads, DEFAULT_CRM.endpoints.leads),
      lead: cleanEndpoint(body.endpoints?.lead, DEFAULT_CRM.endpoints.lead),
      notes: cleanEndpoint(body.endpoints?.notes, DEFAULT_CRM.endpoints.notes),
    },
  };
}

function secretFromBodyOrStore(body: CrmSettingsBody, apiKeyEnv: string): string {
  const rawApiKey = typeof body.apiKey === 'string' ? body.apiKey : '';
  if (/[\r\n\0]/.test(rawApiKey)) {
    throw new Error('API key cannot contain line breaks or null bytes');
  }
  const apiKey = rawApiKey.trim();
  if (apiKey) return apiKey;
  const secrets = parseEnvFile(getSecretsPath());
  return secrets[apiKeyEnv] || process.env[apiKeyEnv] || '';
}

function buildUrl(baseUrl: string | undefined, endpoint: string | undefined): URL {
  const base = cleanOptionalString(baseUrl);
  if (!base) throw new Error('Base URL is required before testing the CRM connection');
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return new URL((endpoint ?? DEFAULT_CRM.endpoints.leads).replace(/^\//, ''), normalizedBase);
}

function leadArrayFromPayload(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  for (const key of ['leads', 'data', 'items', 'results', 'records']) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return null;
}

async function testCrmConnection(body: CrmSettingsBody) {
  const crm = buildCrmSettings(body);
  const key = secretFromBodyOrStore(body, crm.api_key_env ?? DEFAULT_CRM.apiKeyEnv);
  if (!key) throw new Error(`No API key found for ${crm.api_key_env ?? DEFAULT_CRM.apiKeyEnv}`);

  const url = buildUrl(crm.base_url, crm.endpoints?.leads);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (crm.auth?.type === 'query') {
    url.searchParams.set(crm.auth.query_param ?? DEFAULT_CRM.authQueryParam, key);
  } else {
    headers[crm.auth?.header ?? DEFAULT_CRM.authHeader] = `${crm.auth?.prefix ?? DEFAULT_CRM.authPrefix}${key}`;
  }

  const res = await fetch(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(12_000),
  });
  const raw = await res.text();
  if (!res.ok) {
    return {
      success: false,
      status: res.status,
      message: raw.slice(0, 500) || `CRM returned HTTP ${res.status}`,
    };
  }

  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    return {
      success: false,
      status: res.status,
      message: 'CRM responded successfully, but the leads endpoint did not return JSON.',
    };
  }

  const leads = leadArrayFromPayload(parsed);
  if (!leads) {
    return {
      success: false,
      status: res.status,
      message: 'CRM responded, but the payload did not contain a leads/data/items/results/records array.',
    };
  }

  return {
    success: true,
    status: res.status,
    message: `Connection verified. Leads endpoint returned ${leads.length} record${leads.length === 1 ? '' : 's'}.`,
  };
}

async function requireSession() {
  const session = await auth();
  return Boolean(session);
}

export async function GET() {
  if (!(await requireSession())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const org = getActiveOrgName();
  const paths = orgPaths(org);
  const activeConfigPath = fs.existsSync(paths.statePath)
    ? paths.statePath
    : fs.existsSync(paths.frameworkPath)
    ? paths.frameworkPath
    : fs.existsSync(paths.templatePath)
    ? paths.templatePath
    : null;

  return Response.json({
    org,
    configPath: activeConfigPath,
    writableConfigPath: paths.statePath,
    secretsPath: getSecretsPath(),
    crm: readCrmView(),
  });
}

export async function PUT(request: NextRequest) {
  if (!(await requireSession())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const org = getActiveOrgName();
    const paths = orgPaths(org);
    const body = await request.json() as CrmSettingsBody;
    const config = readWritableConfig(org) as unknown as OrgConfig;
    const crm = buildCrmSettings(body);

    config.name = config.name || org;
    config.integrations = {
      ...(config.integrations ?? {}),
      crm,
    };

    fs.mkdirSync(path.dirname(paths.statePath), { recursive: true });
    fs.writeFileSync(paths.statePath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');

    const rawApiKey = typeof body.apiKey === 'string' ? body.apiKey : '';
    if (/[\r\n\0]/.test(rawApiKey)) {
      return Response.json({ error: 'API key cannot contain line breaks or null bytes' }, { status: 400 });
    }
    const apiKey = rawApiKey.trim();
    if (apiKey) {
      writeSecret(paths.stateSecretsPath, crm.api_key_env ?? DEFAULT_CRM.apiKeyEnv, apiKey);
    }

    clearOrgConfigCache();

    return Response.json({
      success: true,
      org,
      configPath: paths.statePath,
      writableConfigPath: paths.statePath,
      secretsPath: getSecretsPath(),
      crm: readCrmView(),
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to save integration settings' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await requireSession())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as CrmSettingsBody;
    if (body.action !== 'test') {
      return Response.json({ error: 'Unsupported action' }, { status: 400 });
    }
    const result = await testCrmConnection(body);
    return Response.json(result, { status: result.success ? 200 : 422 });
  } catch (err) {
    return Response.json(
      { success: false, error: err instanceof Error ? err.message : 'CRM connection test failed' },
      { status: 400 }
    );
  }
}
