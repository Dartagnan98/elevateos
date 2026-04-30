import path from 'path';
import fs from 'fs';
import { CTX_FRAMEWORK_ROOT, CTX_ROOT } from '@/lib/config';

// Default to the bundled customer template, but let setup/runtime choose the
// active org so this dashboard can ship to more than one brokerage.
const ELEVATION_ORG = process.env.ELEVATE_ORG ?? process.env.CTX_ORG ?? 'elevation';

export interface OrgConfig {
  name: string;
  display_name?: string;
  remote_runtime?: {
    mode?: 'ssh';
    host?: string;
    ssh_user?: string;
    tools_root?: string;
  };
  integrations?: {
    messages?: {
      label?: string;
      source_label?: string;
      owner_agent?: string;
      drafts_label?: string;
    };
    crm?: {
      provider?: string;
      label?: string;
      api_key_env?: string;
      base_url?: string;
      auth?: {
        type?: 'header' | 'query';
        header?: string;
        prefix?: string;
        query_param?: string;
      };
      db_columns?: {
        lead_id?: string;
        stage?: string;
        tags?: string;
      };
      endpoints?: {
        leads?: string;
        lead?: string;
        notes?: string;
      };
    };
  };
  data_roots?: {
    messages_db?: string;
    brew_dir?: string;
    marketing_dir?: string;
    listings_state?: string;
    knowledge_seed?: string;
  };
  brokerage?: string;
  voice_profile?: string;
  agents?: string[];
}

let cached: OrgConfig | null | undefined;

export function getActiveOrgName(): string {
  return ELEVATION_ORG;
}

export function clearOrgConfigCache(): void {
  cached = undefined;
}

function expandTilde(p: string): string {
  const withEnv = p.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => process.env[name] ?? '');
  p = withEnv;
  if (p.startsWith('~/') || p === '~') {
    return path.join(process.env.HOME ?? '', p.slice(1));
  }
  return p;
}

function expandOptional(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return expandTilde(value);
}

/**
 * Read orgs/elevation/config.json — the place data_roots live for adapters.
 * Runtime state overrides the bundled template so setup can safely customize a
 * customer install without editing checked-in files.
 * Result cached per-process; adapters call this on every request but the
 * cache means we read disk once per server lifetime.
 */
export function getOrgConfig(): OrgConfig | null {
  if (cached !== undefined) return cached;
  const frameworkPath = path.join(CTX_FRAMEWORK_ROOT, 'orgs', ELEVATION_ORG, 'config.json');
  const statePath = path.join(CTX_ROOT, 'orgs', ELEVATION_ORG, 'config.json');
  const templatePath = path.join(CTX_FRAMEWORK_ROOT, 'customer-templates', ELEVATION_ORG, 'config.json');
  const target = fs.existsSync(statePath)
    ? statePath
    : fs.existsSync(frameworkPath)
    ? frameworkPath
    : fs.existsSync(templatePath)
    ? templatePath
    : null;
  if (!target) {
    cached = null;
    return null;
  }
  try {
    const raw = fs.readFileSync(target, 'utf-8');
    const cfg = JSON.parse(raw) as OrgConfig;
    if (cfg.data_roots) {
      const roots = cfg.data_roots;
      if (roots.messages_db) roots.messages_db = expandTilde(roots.messages_db);
      if (roots.brew_dir) roots.brew_dir = expandTilde(roots.brew_dir);
      if (roots.marketing_dir) roots.marketing_dir = expandTilde(roots.marketing_dir);
      if (roots.listings_state) roots.listings_state = expandTilde(roots.listings_state);
      if (roots.knowledge_seed) roots.knowledge_seed = expandTilde(roots.knowledge_seed);
    }
    if (cfg.remote_runtime) {
      cfg.remote_runtime.host = expandOptional(cfg.remote_runtime.host);
      cfg.remote_runtime.ssh_user = expandOptional(cfg.remote_runtime.ssh_user);
      cfg.remote_runtime.tools_root = expandOptional(cfg.remote_runtime.tools_root);
    }
    if (cfg.integrations?.crm) {
      cfg.integrations.crm.base_url = expandOptional(cfg.integrations.crm.base_url);
    }
    cfg.voice_profile = expandOptional(cfg.voice_profile);
    cached = cfg;
    return cfg;
  } catch {
    cached = null;
    return null;
  }
}

/**
 * Path to orgs/elevation/secrets.env — the place adapter API keys live.
 * The dashboard server doesn't get this in process.env (the elevate CLI
 * only puts auth/root/instance/port in dashboard/.env.local), so adapters
 * that need API keys must read this file directly.
 */
export function getSecretsPath(): string {
  const frameworkPath = path.join(CTX_FRAMEWORK_ROOT, 'orgs', ELEVATION_ORG, 'secrets.env');
  const statePath = path.join(CTX_ROOT, 'orgs', ELEVATION_ORG, 'secrets.env');
  if (fs.existsSync(statePath)) return statePath;
  if (fs.existsSync(frameworkPath)) return frameworkPath;
  return statePath;
}

/**
 * Inline dotenv parser. Lifted from src/cli/dashboard.ts:9-25 so we don't add
 * a dotenv dep just for the dashboard. Handles `KEY=value`, `KEY="value"`,
 * `KEY='value'`, ignores comments and blank lines.
 */
export function parseEnvFile(path: string): Record<string, string> {
  if (!fs.existsSync(path)) return {};
  const result: Record<string, string> = {};
  const content = fs.readFileSync(path, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value
        .slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  return result;
}
