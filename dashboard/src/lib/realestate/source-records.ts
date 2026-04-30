import fs from 'fs';
import path from 'path';
import { CTX_ROOT } from '@/lib/config';
import { getActiveOrgName, getOrgConfig, type OrgConfig } from './org-config';
import { hasRemoteRuntime, readRemoteFile, runRemoteText, shellQuote } from './remote';

export type SourceIo = 'local' | 'remote';
export type SourceRootSource = 'config' | 'local-test-root';

export type SourceRootInfo = {
  org: string;
  toolsRoot: string;
  sourceRoot: string;
  source: SourceRootSource;
  io: SourceIo;
  cfg: OrgConfig | null;
};

export type NormalizedLeadRow = {
  handle: string;
  display_name: string | null;
  stage: string | null;
  tags: string | null;
  is_client: number;
  last_message: string | null;
  last_message_at: number | null;
  last_message_from_me: number | null;
  message_count: number | null;
};

export type NormalizedThreadMessageRow = {
  rowid: number;
  text: string | null;
  is_from_me: number;
  date_unix: number;
};

export type SourceOutreachSnapshot = {
  tableCounts: Array<{ table_name: string; rows: number }>;
  dateRange: { first_day: string | null; last_day: string | null; messages: number } | null;
  recentDays: Array<{
    day: string;
    messages: number;
    from_account: number;
    inbound: number;
    drafted: number;
  }>;
  services: Array<{ service: string | null; messages: number }>;
  drafted: Array<{ drafted: number; messages: number }>;
  approvalStatus: Array<{ status: string; queued: number }>;
  approvalByAgent: Array<{ agent: string; status: string; queued: number }>;
  contactStats: {
    enriched_contacts: number;
    with_crm_id: number;
    with_crm_stage: number;
    clients: number;
  } | null;
  source: 'local' | 'remote';
};

export type SourceOutreachApprovalRow = {
  id: number;
  created_at: number;
  agent: string;
  channel: string;
  recipient: string;
  recipient_name: string | null;
  inbound_text: string | null;
  content: string;
  status: string;
  source_message_id: number | null;
};

type JsonRecord = Record<string, unknown>;

type LeadAccumulator = {
  handle: string;
  displayName: string | null;
  stage: string | null;
  tags: Set<string>;
  isClient: boolean;
  lastMessage: string | null;
  lastMessageAt: number | null;
  lastMessageFromMe: number | null;
  messageCount: number;
};

const JSONL_FILES = [
  'contacts.jsonl',
  'conversations.jsonl',
  'messages.jsonl',
  'lead-events.jsonl',
  'tasks.jsonl',
] as const;

function remoteJoin(root: string, ...segments: string[]): string {
  const cleanRoot = root.replace(/\/+$/, '');
  return [cleanRoot, ...segments.map((segment) => segment.replace(/^\/+|\/+$/g, ''))]
    .filter(Boolean)
    .join('/');
}

function sourcePath(info: SourceRootInfo, ...segments: string[]): string {
  if (info.io === 'remote') return remoteJoin(info.sourceRoot, ...segments);
  return path.join(info.sourceRoot, ...segments);
}

export function getSourceRootInfo(org = getActiveOrgName()): SourceRootInfo {
  const cfg = getOrgConfig();
  const configured = cfg?.remote_runtime?.tools_root?.trim();

  if (configured) {
    const sourceRoot = remoteJoin(configured, 'data', 'sources');
    return {
      org,
      toolsRoot: configured,
      sourceRoot,
      source: 'config',
      io: cfg && hasRemoteRuntime(cfg) && !fs.existsSync(configured) ? 'remote' : 'local',
      cfg,
    };
  }

  const toolsRoot = path.join(CTX_ROOT, 'orgs', org, 'tools');
  return {
    org,
    toolsRoot,
    sourceRoot: path.join(toolsRoot, 'data', 'sources'),
    source: 'local-test-root',
    io: 'local',
    cfg,
  };
}

function readText(info: SourceRootInfo, filePath: string): string | null {
  try {
    if (info.io === 'remote') {
      if (!info.cfg) return null;
      return readRemoteFile(info.cfg, filePath);
    }
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export function listSourceIds(info = getSourceRootInfo()): string[] {
  try {
    if (info.io === 'remote') {
      if (!info.cfg) return [];
      const output = runRemoteText(
        info.cfg,
        `find ${shellQuote(info.sourceRoot)} -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null || true`,
        { timeoutMs: 8_000, maxBuffer: 1024 * 1024 }
      );
      return output
        .split(/\r?\n/)
        .map((line) => path.posix.basename(line.trim()))
        .filter((name) => /^[A-Za-z0-9_-]+$/.test(name))
        .sort();
    }

    if (!fs.existsSync(info.sourceRoot)) return [];
    return fs.readdirSync(info.sourceRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^[A-Za-z0-9_-]+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function readJsonl(info: SourceRootInfo, sourceId: string, fileName: typeof JSONL_FILES[number]): JsonRecord[] {
  const content = readText(info, sourcePath(info, sourceId, fileName));
  if (!content) return [];

  const rows: JsonRecord[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) rows.push(parsed as JsonRecord);
    } catch {
      // One malformed connector row should not take down the dashboard.
    }
  }
  return rows;
}

function stringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function boolValue(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === '1' || value === 'yes';
}

function tagsFrom(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => stringValue(item))
      .filter((item): item is string => Boolean(item));
  }
  const text = stringValue(value);
  if (!text) return [];
  return text.split(/[,\n|]/).map((tag) => tag.trim()).filter(Boolean);
}

function timestampSeconds(value: unknown): number | null {
  const num = numberValue(value);
  if (num !== null) return num > 1_000_000_000_000 ? Math.floor(num / 1000) : Math.floor(num);

  const text = stringValue(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return null;
  return Math.floor(parsed / 1000);
}

function dayFromTimestamp(value: number | null): string | null {
  if (!value) return null;
  return new Date(value * 1000).toISOString().slice(0, 10);
}

function displayName(record: JsonRecord): string | null {
  return (
    stringValue(record.display_name) ??
    stringValue(record.name) ??
    stringValue(record.recipient_name) ??
    stringValue(record.contact_name) ??
    null
  );
}

function recordKey(sourceId: string, record: JsonRecord): string {
  return [
    displayName(record),
    stringValue(record.phone),
    stringValue(record.email),
    stringValue(record.handle),
    stringValue(record.conversation_id),
    stringValue(record.thread_id),
    stringValue(record.contact_id),
    stringValue(record.source_contact_id),
    stringValue(record.source_record_id),
  ].find(Boolean) ?? sourceId;
}

function handleFor(sourceId: string, key: string): string {
  return `source:${sourceId}:${key}`;
}

function stableId(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sourceIdFor(record: JsonRecord, fallback: string): string {
  return stringValue(record.source_id) ?? fallback;
}

function stageFrom(record: JsonRecord): string | null {
  return (
    stringValue(record.crm_stage) ??
    stringValue(record.lead_stage) ??
    stringValue(record.stage) ??
    stringValue(record.status) ??
    stringValue(record.type)
  );
}

function textFrom(record: JsonRecord): string | null {
  return (
    stringValue(record.text) ??
    stringValue(record.summary) ??
    stringValue(record.body) ??
    stringValue(record.content) ??
    stringValue(record.message)
  );
}

function ensureLead(map: Map<string, LeadAccumulator>, sourceId: string, key: string): LeadAccumulator {
  const handle = handleFor(sourceId, key);
  const existing = map.get(handle);
  if (existing) return existing;
  const next: LeadAccumulator = {
    handle,
    displayName: null,
    stage: null,
    tags: new Set<string>(),
    isClient: false,
    lastMessage: null,
    lastMessageAt: null,
    lastMessageFromMe: null,
    messageCount: 0,
  };
  map.set(handle, next);
  return next;
}

function applyRecordToLead(lead: LeadAccumulator, record: JsonRecord, sourceId: string, countAsMessage: boolean): void {
  lead.displayName = lead.displayName ?? displayName(record) ?? recordKey(sourceId, record);
  lead.stage = lead.stage ?? stageFrom(record);
  for (const tag of tagsFrom(record.tags)) lead.tags.add(tag);
  if (boolValue(record.is_client) || tagsFrom(record.tags).some((tag) => tag.toLowerCase() === 'existing_client')) {
    lead.isClient = true;
  }

  const text = textFrom(record);
  const ts = timestampSeconds(record.timestamp) ?? timestampSeconds(record.created_at) ?? timestampSeconds(record.last_sync_at);
  const direction = stringValue(record.direction)?.toLowerCase();
  if (countAsMessage) lead.messageCount += 1;
  if (text && (lead.lastMessageAt === null || (ts ?? 0) >= lead.lastMessageAt)) {
    lead.lastMessage = text;
    lead.lastMessageAt = ts;
    lead.lastMessageFromMe = direction === 'outbound' || direction === 'from_me' ? 1 : 0;
  }
}

export function getSourceLeadRows(info = getSourceRootInfo()): NormalizedLeadRow[] {
  const leads = new Map<string, LeadAccumulator>();

  for (const sourceId of listSourceIds(info)) {
    for (const contact of readJsonl(info, sourceId, 'contacts.jsonl')) {
      const resolvedSource = sourceIdFor(contact, sourceId);
      const lead = ensureLead(leads, resolvedSource, recordKey(resolvedSource, contact));
      applyRecordToLead(lead, contact, resolvedSource, false);
    }

    for (const message of readJsonl(info, sourceId, 'messages.jsonl')) {
      const resolvedSource = sourceIdFor(message, sourceId);
      const lead = ensureLead(leads, resolvedSource, recordKey(resolvedSource, message));
      applyRecordToLead(lead, message, resolvedSource, true);
    }

    for (const event of readJsonl(info, sourceId, 'lead-events.jsonl')) {
      const resolvedSource = sourceIdFor(event, sourceId);
      const lead = ensureLead(leads, resolvedSource, recordKey(resolvedSource, event));
      applyRecordToLead(lead, event, resolvedSource, false);
    }
  }

  return Array.from(leads.values())
    .map((lead) => ({
      handle: lead.handle,
      display_name: lead.displayName,
      stage: lead.stage,
      tags: Array.from(lead.tags).join(', ') || null,
      is_client: lead.isClient ? 1 : 0,
      last_message: lead.lastMessage,
      last_message_at: lead.lastMessageAt,
      last_message_from_me: lead.lastMessageFromMe,
      message_count: lead.messageCount,
    }))
    .sort((a, b) => (b.last_message_at ?? 0) - (a.last_message_at ?? 0))
    .slice(0, 500);
}

export function getSourceMessagesForHandle(handle: string, limit = 200, info = getSourceRootInfo()): NormalizedThreadMessageRow[] {
  if (!handle.startsWith('source:')) return [];
  const [, sourceId, ...keyParts] = handle.split(':');
  const key = keyParts.join(':');
  if (!sourceId || !key) return [];

  return readJsonl(info, sourceId, 'messages.jsonl')
    .filter((record) => recordKey(sourceId, record) === key)
    .map((record) => {
      const ts = timestampSeconds(record.timestamp) ?? timestampSeconds(record.created_at) ?? Math.floor(Date.now() / 1000);
      const direction = stringValue(record.direction)?.toLowerCase();
      return {
        rowid: stableId(`${sourceId}:${key}:${stringValue(record.source_record_id) ?? textFrom(record) ?? ts}`),
        text: textFrom(record),
        is_from_me: direction === 'outbound' || direction === 'from_me' ? 1 : 0,
        date_unix: ts,
      };
    })
    .sort((a, b) => a.date_unix - b.date_unix)
    .slice(-Math.max(1, Math.min(limit, 500)));
}

export function getSourceOutreachApprovals(limit = 25, info = getSourceRootInfo()): SourceOutreachApprovalRow[] {
  const rows: SourceOutreachApprovalRow[] = [];
  for (const sourceId of listSourceIds(info)) {
    for (const task of readJsonl(info, sourceId, 'tasks.jsonl')) {
      if (!boolValue(task.approval_required)) continue;
      const key = recordKey(sourceId, task);
      const ts = timestampSeconds(task.timestamp) ?? timestampSeconds(task.created_at) ?? Math.floor(Date.now() / 1000);
      rows.push({
        id: stableId(`${sourceId}:${key}:${stringValue(task.source_record_id) ?? rows.length}`),
        created_at: ts,
        agent: stringValue(task.owner_agent) ?? stringValue(task.agent) ?? 'Reese',
        channel: stringValue(task.channel) ?? sourceId,
        recipient: stringValue(task.recipient) ?? stringValue(task.phone) ?? stringValue(task.email) ?? key,
        recipient_name: displayName(task),
        inbound_text: stringValue(task.inbound_text) ?? stringValue(task.source_summary),
        content: textFrom(task) ?? stringValue(task.title) ?? 'Approval required',
        status: stringValue(task.status) ?? 'pending',
        source_message_id: null,
      });
    }
  }

  return rows
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, Math.max(1, Math.min(limit, 100)));
}

export function getSourceOutreachSnapshot(info = getSourceRootInfo()): SourceOutreachSnapshot | null {
  const sourceIds = listSourceIds(info);
  if (sourceIds.length === 0) return null;

  const counts = new Map<string, number>();
  const dayCounts = new Map<string, { messages: number; from_account: number; inbound: number; drafted: number }>();
  const services = new Map<string, number>();
  const approvalStatus = new Map<string, number>();
  const approvalByAgent = new Map<string, number>();
  let contactsWithCrmId = 0;
  let contactsWithStage = 0;
  let clients = 0;

  for (const sourceId of sourceIds) {
    for (const file of JSONL_FILES) {
      const records = readJsonl(info, sourceId, file);
      counts.set(file.replace('.jsonl', ''), (counts.get(file.replace('.jsonl', '')) ?? 0) + records.length);

      if (file === 'contacts.jsonl') {
        for (const record of records) {
          if (stringValue(record.crm_lead_id) || stringValue(record.lead_id)) contactsWithCrmId += 1;
          if (stageFrom(record)) contactsWithStage += 1;
          if (boolValue(record.is_client)) clients += 1;
        }
      }

      if (file === 'messages.jsonl') {
        for (const record of records) {
          const ts = timestampSeconds(record.timestamp) ?? timestampSeconds(record.created_at);
          const day = dayFromTimestamp(ts);
          if (day) {
            const current = dayCounts.get(day) ?? { messages: 0, from_account: 0, inbound: 0, drafted: 0 };
            const direction = stringValue(record.direction)?.toLowerCase();
            current.messages += 1;
            if (direction === 'outbound' || direction === 'from_me') current.from_account += 1;
            else current.inbound += 1;
            dayCounts.set(day, current);
          }
          const channel = stringValue(record.channel) ?? sourceId;
          services.set(channel, (services.get(channel) ?? 0) + 1);
        }
      }

      if (file === 'tasks.jsonl') {
        for (const record of records) {
          if (boolValue(record.approval_required)) {
            const status = stringValue(record.status) ?? 'pending';
            const agent = stringValue(record.owner_agent) ?? stringValue(record.agent) ?? 'Reese';
            approvalStatus.set(status, (approvalStatus.get(status) ?? 0) + 1);
            const key = `${agent}:${status}`;
            approvalByAgent.set(key, (approvalByAgent.get(key) ?? 0) + 1);
          }
        }
      }
    }
  }

  const recentDays = Array.from(dayCounts.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 10)
    .map(([day, value]) => ({ day, ...value }));
  const allDays = Array.from(dayCounts.keys()).sort();
  const messages = counts.get('messages') ?? 0;
  const approvals = getSourceOutreachApprovals(100, info);

  return {
    tableCounts: [
      { table_name: 'contacts', rows: counts.get('contacts') ?? 0 },
      { table_name: 'messages', rows: messages },
      { table_name: 'approval_queue', rows: approvals.length },
      { table_name: 'lead-events', rows: counts.get('lead-events') ?? 0 },
      { table_name: 'tasks', rows: counts.get('tasks') ?? 0 },
    ],
    dateRange: messages > 0
      ? { first_day: allDays[0] ?? null, last_day: allDays[allDays.length - 1] ?? null, messages }
      : null,
    recentDays,
    services: Array.from(services.entries())
      .map(([service, count]) => ({ service, messages: count }))
      .sort((a, b) => b.messages - a.messages),
    drafted: [
      { drafted: 0, messages: messages },
      { drafted: 1, messages: approvals.length },
    ],
    approvalStatus: Array.from(approvalStatus.entries())
      .map(([status, queued]) => ({ status, queued }))
      .sort((a, b) => b.queued - a.queued),
    approvalByAgent: Array.from(approvalByAgent.entries())
      .map(([key, queued]) => {
        const [agent, status] = key.split(':');
        return { agent, status, queued };
      })
      .sort((a, b) => b.queued - a.queued),
    contactStats: {
      enriched_contacts: counts.get('contacts') ?? 0,
      with_crm_id: contactsWithCrmId,
      with_crm_stage: contactsWithStage,
      clients,
    },
    source: info.io,
  };
}

