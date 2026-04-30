import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import { getOrgConfig } from './org-config';
import { hasRemoteRuntime, readRemoteFile, remoteDirExists, remoteFileExists, runRemoteText, shellQuote } from './remote';

export interface BrewEntry {
  date: string;
  json?: unknown;
  markdown?: string;
}

export type BrewResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'no-data' }
  | { kind: 'error'; message: string };

type BrewSource =
  | { kind: 'local'; dir: string }
  | { kind: 'remote'; dir: string; cfg: NonNullable<ReturnType<typeof getOrgConfig>> };

function brewSource(): BrewSource | null {
  const cfg = getOrgConfig();
  const dir = cfg?.data_roots?.brew_dir;
  if (!dir) return null;
  if (existsSync(dir)) return { kind: 'local', dir };
  if (cfg && hasRemoteRuntime(cfg) && remoteDirExists(cfg, dir)) {
    return { kind: 'remote', dir, cfg };
  }
  return null;
}

function fileExists(source: BrewSource, filePath: string): boolean {
  return source.kind === 'local' ? existsSync(filePath) : remoteFileExists(source.cfg, filePath);
}

function readJsonFile(source: BrewSource, filePath: string): unknown {
  const raw =
    source.kind === 'local'
      ? readFileSync(filePath, 'utf-8')
      : readRemoteFile(source.cfg, filePath);
  return JSON.parse(raw);
}

function readTextFile(source: BrewSource, filePath: string): string {
  return source.kind === 'local'
    ? readFileSync(filePath, 'utf-8')
    : readRemoteFile(source.cfg, filePath);
}

function listBrewFiles(source: BrewSource): string[] {
  if (source.kind === 'local') return readdirSync(source.dir);
  const output = runRemoteText(
    source.cfg,
    `find ${shellQuote(source.dir)} -maxdepth 1 -type f \\( -name '*-morning.json' -o -name '*-morning.md' -o -name 'latest.json' -o -name 'latest.md' \\) -exec basename {} \\;`
  );
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function readBrewFiles(date: string, source: BrewSource): BrewEntry {
  const entry: BrewEntry = { date };
  const jsonPath = path.join(source.dir, `${date}-morning.json`);
  const mdPath = path.join(source.dir, `${date}-morning.md`);
  if (fileExists(source, jsonPath)) {
    try {
      entry.json = readJsonFile(source, jsonPath);
    } catch {
      // leave json undefined
    }
  }
  if (fileExists(source, mdPath)) {
    entry.markdown = readTextFile(source, mdPath);
  }
  return entry;
}

/**
 * Most recent brew. Prefer latest.json/latest.md when present, then fall back
 * to scanning `<date>-morning.*` files.
 */
export function getLatestBrew(): BrewResult<BrewEntry> {
  const source = brewSource();
  if (!source) return { kind: 'no-data' };
  try {
    const latestJson = path.join(source.dir, 'latest.json');
    const latestMd = path.join(source.dir, 'latest.md');
    if (fileExists(source, latestJson) || fileExists(source, latestMd)) {
      const entry: BrewEntry = { date: 'latest' };
      if (fileExists(source, latestJson)) {
        try {
          const json = readJsonFile(source, latestJson);
          entry.json = json;
          if (
            json &&
            typeof json === 'object' &&
            'date' in json &&
            typeof (json as { date?: unknown }).date === 'string'
          ) {
            entry.date = (json as { date: string }).date;
          }
        } catch {
          // leave json undefined
        }
      }
      if (fileExists(source, latestMd)) entry.markdown = readTextFile(source, latestMd);
      if (entry.json || entry.markdown) return { kind: 'ok', data: entry };
    }

    const files = listBrewFiles(source);
    const dates = new Set<string>();
    for (const f of files) {
      const match = /^(\d{4}-\d{2}-\d{2})-morning\.(json|md)$/.exec(f);
      if (match) dates.add(match[1]);
    }
    if (dates.size === 0) return { kind: 'no-data' };
    const latest = Array.from(dates).sort().reverse()[0];
    return { kind: 'ok', data: readBrewFiles(latest, source) };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'read failed' };
  }
}

export function getBrewByDate(date: string): BrewResult<BrewEntry> {
  const source = brewSource();
  if (!source) return { kind: 'no-data' };
  const entry = readBrewFiles(date, source);
  if (!entry.json && !entry.markdown) return { kind: 'no-data' };
  return { kind: 'ok', data: entry };
}

export function getBrewHistory(limit = 14): BrewResult<BrewEntry[]> {
  const source = brewSource();
  if (!source) return { kind: 'no-data' };
  try {
    const files = listBrewFiles(source);
    const dates = new Set<string>();
    for (const f of files) {
      const match = /^(\d{4}-\d{2}-\d{2})-morning\.(json|md)$/.exec(f);
      if (match) dates.add(match[1]);
    }
    if (dates.size === 0) return { kind: 'no-data' };
    const sorted = Array.from(dates).sort().reverse().slice(0, limit);
    return { kind: 'ok', data: sorted.map((d) => readBrewFiles(d, source)) };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'read failed' };
  }
}
