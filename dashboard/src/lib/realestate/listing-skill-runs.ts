import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { getOrgConfig, type OrgConfig } from './org-config';
import { hasRemoteRuntime, readRemoteFile, remoteDirExists, remoteFileExists, runRemoteText, shellQuote } from './remote';

export interface ListingSkillShowing {
  address: string;
  listingId: string;
  showingDate: string;
  showingTime: string;
  agentName: string;
  feedbackStatus: string;
  interested: string;
  comments: string;
}

export interface ListingSkillDraft {
  agentName: string;
  showingDate: string;
  feedbackStatus: string;
  draft: string;
}

export interface ListingSkillListing {
  listingId: string;
  address: string;
  city: string;
  price: string;
  totalShowings: number;
  feedbackReceived: number;
  feedbackPending: number;
  avgRating: number | null;
  sellerDraft: string;
  showings: ListingSkillShowing[];
  agentDrafts: ListingSkillDraft[];
}

export interface ListingSkillRun {
  generatedAt: string | null;
  sourcePath: string;
  sourceLabel: string;
  totalListings: number;
  totalShowings: number;
  listings: ListingSkillListing[];
}

export type ListingSkillRunResult =
  | { kind: 'ok'; data: ListingSkillRun }
  | { kind: 'no-data' }
  | { kind: 'error'; message: string };

type ListingSource =
  | { kind: 'local-file'; filePath: string }
  | { kind: 'local-dir'; dir: string }
  | { kind: 'remote-file'; filePath: string; cfg: OrgConfig }
  | { kind: 'remote-dir'; dir: string; cfg: OrgConfig };

const REPORT_PATTERNS = [
  /^latest(?:-listing|-feedback)?\.json$/,
  /^weekly-report-\d{4}-\d{2}-\d{2}\.json$/,
  /^listing-feedback-\d{4}-\d{2}-\d{2}\.json$/,
  /^showing-feedback-\d{4}-\d{2}-\d{2}\.json$/,
  /^showingtime-feedback-\d{4}-\d{2}-\d{2}\.json$/,
];

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = numberValue(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isReportFile(fileName: string): boolean {
  return REPORT_PATTERNS.some((pattern) => pattern.test(fileName));
}

function sourceLabel(filePath: string): string {
  const base = path.basename(filePath);
  if (base.startsWith('weekly-report')) return 'weekly listing skill';
  if (base.includes('feedback')) return 'listing feedback skill';
  return 'listing skill output';
}

function configuredSources(cfg: OrgConfig | null): ListingSource[] {
  if (!cfg) return [];
  const sources: ListingSource[] = [];
  const configuredRoot = cfg.data_roots?.listings_state;
  const toolsOutput = cfg.remote_runtime?.tools_root
    ? path.join(cfg.remote_runtime.tools_root, 'scripts', 'output')
    : null;

  for (const candidate of [configuredRoot, toolsOutput]) {
    if (!candidate) continue;
    if (existsSync(candidate)) {
      const stat = statSync(candidate);
      sources.push(stat.isDirectory()
        ? { kind: 'local-dir', dir: candidate }
        : { kind: 'local-file', filePath: candidate });
      continue;
    }
    if (hasRemoteRuntime(cfg)) {
      if (remoteFileExists(cfg, candidate)) {
        sources.push({ kind: 'remote-file', filePath: candidate, cfg });
      } else if (remoteDirExists(cfg, candidate)) {
        sources.push({ kind: 'remote-dir', dir: candidate, cfg });
      }
    }
  }

  return sources;
}

function listFiles(source: Extract<ListingSource, { kind: 'local-dir' | 'remote-dir' }>): string[] {
  if (source.kind === 'local-dir') return readdirSync(source.dir).filter(isReportFile);
  const output = runRemoteText(
    source.cfg,
    `find ${shellQuote(source.dir)} -maxdepth 1 -type f \\( -name 'latest*.json' -o -name 'weekly-report-*.json' -o -name 'listing-feedback-*.json' -o -name 'showing-feedback-*.json' -o -name 'showingtime-feedback-*.json' \\) -exec basename {} \\;`,
    { timeoutMs: 12_000, maxBuffer: 2 * 1024 * 1024 }
  );
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(isReportFile);
}

function latestFile(source: Extract<ListingSource, { kind: 'local-dir' | 'remote-dir' }>): string | null {
  const files = listFiles(source);
  if (files.length === 0) return null;
  const latest = files.find((file) => file.startsWith('latest'));
  if (latest) return path.join(source.dir, latest);
  return path.join(source.dir, files.sort().reverse()[0]);
}

function readJson(source: ListingSource): { filePath: string; json: unknown } | null {
  if (source.kind === 'local-file') {
    return { filePath: source.filePath, json: JSON.parse(readFileSync(source.filePath, 'utf-8')) };
  }
  if (source.kind === 'remote-file') {
    return { filePath: source.filePath, json: JSON.parse(readRemoteFile(source.cfg, source.filePath)) };
  }

  const filePath = latestFile(source);
  if (!filePath) return null;
  if (source.kind === 'local-dir') {
    return { filePath, json: JSON.parse(readFileSync(filePath, 'utf-8')) };
  }
  return { filePath, json: JSON.parse(readRemoteFile(source.cfg, filePath)) };
}

function normalizeShowing(value: unknown): ListingSkillShowing {
  const row = objectValue(value);
  return {
    address: text(row.address),
    listingId: text(row.listing_id ?? row.listingId),
    showingDate: text(row.showing_date ?? row.showingDate),
    showingTime: text(row.showing_time ?? row.showingTime),
    agentName: text(row.agent_name ?? row.agentName),
    feedbackStatus: text(row.feedback_status ?? row.feedbackStatus),
    interested: text(row.interested),
    comments: text(row.comments),
  };
}

function normalizeDraft(value: unknown): ListingSkillDraft {
  const row = objectValue(value);
  return {
    agentName: text(row.agent_name ?? row.agentName),
    showingDate: text(row.showing_date ?? row.showingDate),
    feedbackStatus: text(row.feedback_status ?? row.feedbackStatus),
    draft: text(row.draft),
  };
}

function normalizeListing(value: unknown): ListingSkillListing {
  const row = objectValue(value);
  return {
    listingId: text(row.listing_id ?? row.listingId),
    address: text(row.address),
    city: text(row.city),
    price: text(row.price),
    totalShowings: numberValue(row.total_showings ?? row.totalShowings),
    feedbackReceived: numberValue(row.feedback_received ?? row.feedbackReceived),
    feedbackPending: numberValue(row.feedback_pending ?? row.feedbackPending),
    avgRating: nullableNumber(row.avg_rating ?? row.avgRating),
    sellerDraft: text(row.seller_update_draft ?? row.seller_draft ?? row.sellerDraft),
    showings: arrayValue(row.showings).map(normalizeShowing),
    agentDrafts: [
      ...arrayValue(row.agent_followup_drafts),
      ...arrayValue(row.agent_drafts),
    ].map(normalizeDraft),
  };
}

function normalizeRun(filePath: string, json: unknown): ListingSkillRun | null {
  const root = objectValue(json);
  const listings = arrayValue(root.listings).map(normalizeListing);
  if (listings.length === 0) return null;
  return {
    generatedAt: text(root.generated_at ?? root.scraped_at) || null,
    sourcePath: filePath,
    sourceLabel: sourceLabel(filePath),
    totalListings: numberValue(root.total_listings ?? root.totalListings) || listings.length,
    totalShowings: numberValue(root.total_showings ?? root.totalShowings),
    listings,
  };
}

export function getLatestListingSkillRun(): ListingSkillRunResult {
  const cfg = getOrgConfig();
  const sources = configuredSources(cfg);
  if (sources.length === 0) return { kind: 'no-data' };

  for (const source of sources) {
    try {
      const result = readJson(source);
      if (!result) continue;
      const run = normalizeRun(result.filePath, result.json);
      if (run) return { kind: 'ok', data: run };
    } catch {
      // Try the next configured source before reporting no usable skill output.
    }
  }

  return { kind: 'no-data' };
}
