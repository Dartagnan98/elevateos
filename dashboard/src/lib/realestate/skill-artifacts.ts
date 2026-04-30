import { existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { getCustomerSkillInventory } from './customer-tools';
import { getOrgConfig, type OrgConfig } from './org-config';
import { hasRemoteRuntime, remoteDirExists, runRemoteText, shellQuote } from './remote';

export interface SkillOperation {
  id: string;
  label: string;
  status: 'ready' | 'artifact' | 'missing';
  detail: string;
  owner: 'Avery' | 'Pierce' | 'Reese' | 'Marlowe';
  href: string;
}

interface Artifact {
  filePath: string;
  modifiedAt: number;
}

interface OperationDefinition {
  id: string;
  label: string;
  owner: SkillOperation['owner'];
  skillSlugs: string[];
  artifactGlobs: string[];
  fallbackDetail: string;
}

const DEFINITIONS: OperationDefinition[] = [
  {
    id: 'outreach',
    label: 'Lead Outreach',
    owner: 'Reese',
    skillSlugs: ['outreach'],
    artifactGlobs: ['scripts/output/*outreach*', 'output/*outreach*'],
    fallbackDetail: 'Uses the configured CRM/messages source and approval queue',
  },
  {
    id: 'docs',
    label: 'Document Routing',
    owner: 'Avery',
    skillSlugs: ['gmail-doc-router'],
    artifactGlobs: ['output/doc-router*.log', 'output/*doc-router*', 'knowledge/listings/*'],
    fallbackDetail: 'Routes incoming files by listing folder and surfaces human tasks when blocked',
  },
  {
    id: 'market',
    label: 'Market Stats',
    owner: 'Marlowe',
    skillSlugs: ['market-stats-watcher'],
    artifactGlobs: ['market-stats/*/*.md', 'market-stats/*/pdfs/*.pdf', 'scripts/output/*market*'],
    fallbackDetail: 'Feeds market context into listing and pricing work',
  },
  {
    id: 'cma',
    label: 'CMA / Comps',
    owner: 'Pierce',
    skillSlugs: ['cma'],
    artifactGlobs: ['output/*cma*', 'scripts/output/*cma*', 'scripts/output/*comparison*', 'scripts/output/*evaluation*'],
    fallbackDetail: 'Produces comp analysis, pricing notes, and CMA report artifacts',
  },
  {
    id: 'property',
    label: 'Property Lookup',
    owner: 'Pierce',
    skillSlugs: ['property-lookup'],
    artifactGlobs: ['output/*property*', 'scripts/output/*property*', 'output/*assessment*', 'output/*map*'],
    fallbackDetail: 'Pulls assessment, zoning, map, and property-report artifacts',
  },
  {
    id: 'signing',
    label: 'Forms & Signing',
    owner: 'Avery',
    skillSlugs: ['digisign'],
    artifactGlobs: ['output/*cps*', 'output/*listing-package*', 'output/*filled*', 'mcp-digisign/*.json'],
    fallbackDetail: 'Prepares signing packets; sending still needs an explicit approval step',
  },
];

function formatArtifact(artifact: Artifact): string {
  const ageMs = Date.now() - artifact.modifiedAt;
  const ageDays = Math.max(0, Math.floor(ageMs / (24 * 60 * 60 * 1000)));
  const age = ageDays === 0 ? 'today' : ageDays === 1 ? 'yesterday' : `${ageDays}d ago`;
  return `${path.basename(artifact.filePath)} updated ${age}`;
}

function walkLocal(root: string, maxDepth = 5): Artifact[] {
  const out: Artifact[] = [];
  function visit(dir: string, depth: number) {
    if (depth > maxDepth) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', '.next'].includes(entry.name)) visit(full, depth + 1);
      } else if (entry.isFile()) {
        const stat = statSync(full);
        out.push({ filePath: full, modifiedAt: stat.mtimeMs });
      }
    }
  }
  visit(root, 0);
  return out;
}

function wildcardToRegExp(glob: string): RegExp {
  const escaped = glob
    .split('*')
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'))
    .join('.*');
  return new RegExp(`(^|/)${escaped}$`);
}

function findLocalArtifacts(root: string, globs: string[]): Artifact[] {
  if (!existsSync(root)) return [];
  const patterns = globs.map(wildcardToRegExp);
  return walkLocal(root)
    .filter((artifact) => {
      const rel = path.relative(root, artifact.filePath);
      return patterns.some((pattern) => pattern.test(rel));
    })
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

function findRemoteArtifacts(cfg: OrgConfig, root: string, globs: string[]): Artifact[] {
  if (!hasRemoteRuntime(cfg) || !remoteDirExists(cfg, root)) return [];
  const nameTerms = Array.from(new Set(
    globs
      .map((glob) => glob.split('/').pop() ?? '')
      .map((name) => name.replace(/\*/g, '').replace(/\.[A-Za-z0-9]+$/, ''))
      .filter(Boolean)
  ));
  const nameClause = nameTerms.length > 0
    ? `\\( ${nameTerms.map((term) => `-iname '*${term}*'`).join(' -o ')} \\)`
    : `-type f`;
  const output = runRemoteText(
    cfg,
    `find ${shellQuote(root)} -maxdepth 5 -type f ${nameClause} -printf '%T@\\t%p\\n' | sort -nr | head -80`,
    { timeoutMs: 14_000, maxBuffer: 4 * 1024 * 1024 }
  );
  return output
    .split('\n')
    .map((line) => {
      const [timestamp, filePath] = line.split('\t');
      if (!timestamp || !filePath) return null;
      return { filePath, modifiedAt: Number(timestamp) * 1000 };
    })
    .filter((artifact): artifact is Artifact => Boolean(artifact && Number.isFinite(artifact.modifiedAt)));
}

function installedSkills(): Set<string> {
  const inventory = getCustomerSkillInventory();
  return new Set(inventory.kind === 'ok' ? inventory.skills : []);
}

function toolsRoot(): { root: string; cfg: OrgConfig | null } | null {
  const cfg = getOrgConfig();
  const root = cfg?.remote_runtime?.tools_root;
  return root ? { root, cfg } : null;
}

export function getSkillOperations(): SkillOperation[] {
  const source = toolsRoot();
  const skills = installedSkills();
  if (!source) {
    return DEFINITIONS.map((definition) => ({
      id: definition.id,
      label: definition.label,
      owner: definition.owner,
      href: definition.id === 'outreach' ? '/outreach' : definition.id === 'cma' || definition.id === 'property' ? '/deals' : '/tasks',
      status: 'missing',
      detail: 'Configure the customer tools root to read this skill lane',
    }));
  }

  return DEFINITIONS.map((definition) => {
    const hasSkill = definition.skillSlugs.some((slug) => skills.has(slug));
    const artifacts = existsSync(source.root)
      ? findLocalArtifacts(source.root, definition.artifactGlobs)
      : source.cfg
      ? findRemoteArtifacts(source.cfg, source.root, definition.artifactGlobs)
      : [];
    const latest = artifacts[0];

    return {
      id: definition.id,
      label: definition.label,
      owner: definition.owner,
      href: definition.id === 'outreach' ? '/outreach' : definition.id === 'cma' || definition.id === 'property' ? '/deals' : '/tasks',
      status: latest ? 'artifact' : hasSkill ? 'ready' : 'missing',
      detail: latest
        ? formatArtifact(latest)
        : hasSkill
        ? definition.fallbackDetail
        : 'Skill not installed in the configured tools root',
    };
  });
}
