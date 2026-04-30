import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import { getOrgConfig } from './org-config';

export interface BrewEntry {
  date: string;
  json?: unknown;
  markdown?: string;
}

export type BrewResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'no-data' }
  | { kind: 'error'; message: string };

function brewDir(): string | null {
  const cfg = getOrgConfig();
  const dir = cfg?.data_roots?.brew_dir;
  if (!dir || !existsSync(dir)) return null;
  return dir;
}

function readBrewFiles(date: string, dir: string): BrewEntry {
  const entry: BrewEntry = { date };
  const jsonPath = path.join(dir, `${date}-morning.json`);
  const mdPath = path.join(dir, `${date}-morning.md`);
  if (existsSync(jsonPath)) {
    try {
      entry.json = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    } catch {
      // leave json undefined
    }
  }
  if (existsSync(mdPath)) {
    entry.markdown = readFileSync(mdPath, 'utf-8');
  }
  return entry;
}

/**
 * Most recent brew, scanning brew_dir for files matching `<date>-morning.*`.
 * Returns no-data if the directory is missing or empty.
 */
export function getLatestBrew(): BrewResult<BrewEntry> {
  const dir = brewDir();
  if (!dir) return { kind: 'no-data' };
  try {
    const files = readdirSync(dir);
    const dates = new Set<string>();
    for (const f of files) {
      const match = /^(\d{4}-\d{2}-\d{2})-morning\.(json|md)$/.exec(f);
      if (match) dates.add(match[1]);
    }
    if (dates.size === 0) return { kind: 'no-data' };
    const latest = Array.from(dates).sort().reverse()[0];
    return { kind: 'ok', data: readBrewFiles(latest, dir) };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'read failed' };
  }
}

export function getBrewByDate(date: string): BrewResult<BrewEntry> {
  const dir = brewDir();
  if (!dir) return { kind: 'no-data' };
  const entry = readBrewFiles(date, dir);
  if (!entry.json && !entry.markdown) return { kind: 'no-data' };
  return { kind: 'ok', data: entry };
}

export function getBrewHistory(limit = 14): BrewResult<BrewEntry[]> {
  const dir = brewDir();
  if (!dir) return { kind: 'no-data' };
  try {
    const files = readdirSync(dir);
    const dates = new Set<string>();
    for (const f of files) {
      const match = /^(\d{4}-\d{2}-\d{2})-morning\.(json|md)$/.exec(f);
      if (match) dates.add(match[1]);
    }
    if (dates.size === 0) return { kind: 'no-data' };
    const sorted = Array.from(dates).sort().reverse().slice(0, limit);
    return { kind: 'ok', data: sorted.map((d) => readBrewFiles(d, dir)) };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'read failed' };
  }
}
