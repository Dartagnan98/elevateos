import { execFileSync } from 'child_process';
import type { OrgConfig } from './org-config';

export type RemoteRuntime = {
  mode?: 'ssh';
  host?: string;
  ssh_user?: string;
  tools_root?: string;
};

export function hasRemoteRuntime(cfg: OrgConfig | null): cfg is OrgConfig & { remote_runtime: RemoteRuntime } {
  return Boolean(
    cfg?.remote_runtime?.host?.trim() &&
    cfg.remote_runtime.ssh_user?.trim()
  );
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function runRemoteText(
  cfg: OrgConfig,
  command: string,
  opts: { timeoutMs?: number; maxBuffer?: number } = {}
): string {
  if (!hasRemoteRuntime(cfg)) throw new Error('remote runtime is not configured');
  const remote = cfg.remote_runtime;
  const target = `${remote.ssh_user}@${remote.host}`;
  return execFileSync(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=6',
      '-o',
      'StrictHostKeyChecking=accept-new',
      target,
      command,
    ],
    {
      encoding: 'utf-8',
      timeout: opts.timeoutMs ?? 12_000,
      maxBuffer: opts.maxBuffer ?? 8 * 1024 * 1024,
    }
  );
}

export function remoteFileExists(cfg: OrgConfig, filePath: string): boolean {
  try {
    runRemoteText(cfg, `test -f ${shellQuote(filePath)}`);
    return true;
  } catch {
    return false;
  }
}

export function remoteDirExists(cfg: OrgConfig, dirPath: string): boolean {
  try {
    runRemoteText(cfg, `test -d ${shellQuote(dirPath)}`);
    return true;
  } catch {
    return false;
  }
}

export function readRemoteFile(cfg: OrgConfig, filePath: string): string {
  return runRemoteText(cfg, `cat ${shellQuote(filePath)}`, {
    timeoutMs: 12_000,
    maxBuffer: 12 * 1024 * 1024,
  });
}

export function remoteSqliteJson<T>(cfg: OrgConfig, dbPath: string, sql: string): T[] {
  const output = runRemoteText(
    cfg,
    `sqlite3 -json ${shellQuote(dbPath)} ${shellQuote(sql)}`,
    {
      timeoutMs: 18_000,
      maxBuffer: 20 * 1024 * 1024,
    }
  ).trim();
  if (!output) return [];
  return JSON.parse(output) as T[];
}
