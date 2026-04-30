import path from 'path';
import fs from 'fs';
import { CTX_FRAMEWORK_ROOT, CTX_ROOT } from '@/lib/config';

// Tier 1 hardcodes the org as "elevation" (single-tenant fork). Multi-tenant
// support lifts via getOrgs() in Tier 2 — see docs/SOURCE_FIXES.md #11.
const ELEVATION_ORG = 'elevation';

export interface OrgConfig {
  name: string;
  display_name?: string;
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

function expandTilde(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(process.env.HOME ?? '', p.slice(1));
  }
  return p;
}

/**
 * Read orgs/elevation/config.json — the place data_roots live for adapters.
 * Checks framework root first, then state dir. Returns null if neither exists.
 * Result cached per-process; adapters call this on every request but the
 * cache means we read disk once per server lifetime.
 */
export function getOrgConfig(): OrgConfig | null {
  if (cached !== undefined) return cached;
  const frameworkPath = path.join(CTX_FRAMEWORK_ROOT, 'orgs', ELEVATION_ORG, 'config.json');
  const statePath = path.join(CTX_ROOT, 'orgs', ELEVATION_ORG, 'config.json');
  const target = fs.existsSync(frameworkPath)
    ? frameworkPath
    : fs.existsSync(statePath)
    ? statePath
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
 * that need API keys (Lofty, etc.) must read this file directly.
 */
export function getSecretsPath(): string {
  const frameworkPath = path.join(CTX_FRAMEWORK_ROOT, 'orgs', ELEVATION_ORG, 'secrets.env');
  const statePath = path.join(CTX_ROOT, 'orgs', ELEVATION_ORG, 'secrets.env');
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  return result;
}
