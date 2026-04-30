import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { getOrgConfig } from './org-config';
import { hasRemoteRuntime, remoteDirExists, runRemoteText, shellQuote } from './remote';

export type SkillInventoryResult =
  | { kind: 'ok'; skills: string[]; source: 'local' | 'remote'; toolsRoot: string }
  | { kind: 'no-data' }
  | { kind: 'error'; message: string };

export function getCustomerSkillInventory(): SkillInventoryResult {
  const cfg = getOrgConfig();
  const toolsRoot = cfg?.remote_runtime?.tools_root;
  if (!cfg || !toolsRoot) return { kind: 'no-data' };

  const skillsDir = path.join(toolsRoot, '.claude', 'skills');
  try {
    if (existsSync(skillsDir)) {
      const skills = readdirSync(skillsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      return { kind: 'ok', skills, source: 'local', toolsRoot };
    }

    if (hasRemoteRuntime(cfg) && remoteDirExists(cfg, skillsDir)) {
      const output = runRemoteText(
        cfg,
        `find ${shellQuote(skillsDir)} -mindepth 1 -maxdepth 1 -type d -exec basename {} \\; | sort`
      );
      const skills = output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      return { kind: 'ok', skills, source: 'remote', toolsRoot };
    }

    return { kind: 'no-data' };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'skill scan failed' };
  }
}
