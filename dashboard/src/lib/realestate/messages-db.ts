import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { getOrgConfig } from './org-config';
import { hasRemoteRuntime, remoteFileExists, remoteSqliteJson } from './remote';
import {
  getSourceLeadRows,
  getSourceMessagesForHandle,
  getSourceOutreachApprovals,
  getSourceOutreachSnapshot,
} from './source-records';

export type LeadRow = {
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

export type ThreadMessageRow = {
  rowid: number;
  text: string | null;
  is_from_me: number;
  date_unix: number;
};

export type Result<T> =
  | { kind: 'ok'; rows: T }
  | { kind: 'no-db' }
  | { kind: 'error'; message: string };

export type OutreachApprovalRow = {
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

export type OutreachDbSnapshot = {
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

type OpenedDb =
  | { kind: 'local'; db: Database.Database }
  | { kind: 'remote'; dbPath: string; cfg: NonNullable<ReturnType<typeof getOrgConfig>> };

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteIdentifier(value: string | undefined): string | null {
  if (!value || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) return null;
  return `"${value}"`;
}

function columnRef(alias: string, columnName: string | undefined): string {
  const quoted = quoteIdentifier(columnName);
  return quoted ? `${alias}.${quoted}` : 'NULL';
}

function getCrmDbColumns(): { leadId: string; stage: string; tags: string } {
  const cfg = getOrgConfig();
  const columns = cfg?.integrations?.crm?.db_columns;
  return {
    leadId: columns?.lead_id ?? 'crm_lead_id',
    stage: columns?.stage ?? 'crm_stage',
    tags: columns?.tags ?? 'crm_tags',
  };
}

/**
 * Open the iMessage sqlite db readonly. Lazy — only opens on call so a missing
 * db at build time doesn't crash next build (better-sqlite3 throws on import
 * if the file is missing, see dashboard/node_modules/better-sqlite3/lib/database.js:63-65).
 */
function openDb(): { kind: 'ok'; opened: OpenedDb } | { kind: 'no-db' } | { kind: 'error'; message: string } {
  const cfg = getOrgConfig();
  const dbPath = cfg?.data_roots?.messages_db;
  if (!dbPath) return { kind: 'no-db' };
  if (!existsSync(dbPath)) {
    if (cfg && hasRemoteRuntime(cfg) && remoteFileExists(cfg, dbPath)) {
      return { kind: 'ok', opened: { kind: 'remote', dbPath, cfg } };
    }
    return { kind: 'no-db' };
  }
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    return { kind: 'ok', opened: { kind: 'local', db } };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'unknown sqlite error' };
  }
}

function allRows<T>(opened: OpenedDb, sql: string, params: unknown[] = []): T[] {
  if (opened.kind === 'local') {
    return opened.db.prepare(sql).all(...params) as T[];
  }
  let remoteSql = sql;
  for (const param of params) {
    const value = typeof param === 'number' ? String(param) : sqlString(String(param));
    remoteSql = remoteSql.replace('?', value);
  }
  return remoteSqliteJson<T>(opened.cfg, opened.dbPath, remoteSql);
}

function closeDb(opened: OpenedDb): void {
  if (opened.kind === 'local') opened.db.close();
}

/**
 * Pull leads from the messages db with the most recent message text and
 * timestamp. The query joins on a contacts table that the user's setup
 * maintains separately from the raw iMessage chat.db. If the schema is
 * different on a customer machine, this returns an error result and the UI
 * shows the diagnostic. CRM-specific contact columns are configured through
 * integrations.crm.db_columns during setup.
 */
export async function getLeadsWithLastMessage(): Promise<Result<LeadRow[]>> {
  const opened = openDb();
  if (opened.kind !== 'ok') {
    const sourceRows = getSourceLeadRows();
    return sourceRows.length > 0 ? { kind: 'ok', rows: sourceRows } : opened;
  }
  try {
    const crmColumns = getCrmDbColumns();
    const rows = allRows<LeadRow>(
      opened.opened,
      `WITH ranked_messages AS (
           SELECT
             handle,
             text,
             from_me,
             ts,
             ROW_NUMBER() OVER (PARTITION BY handle ORDER BY ts DESC, id DESC) AS rn
           FROM messages
       ),
       message_counts AS (
         SELECT handle, COUNT(*) AS message_count
         FROM messages
         GROUP BY handle
       )
       SELECT
         c.handle AS handle,
         c.display_name AS display_name,
         ${columnRef('c', crmColumns.stage)} AS stage,
         ${columnRef('c', crmColumns.tags)} AS tags,
         c.is_client AS is_client,
         r.text AS last_message,
         r.ts AS last_message_at,
         r.from_me AS last_message_from_me,
         COALESCE(mc.message_count, 0) AS message_count
       FROM contacts c
       LEFT JOIN ranked_messages r ON r.handle = c.handle AND r.rn = 1
       LEFT JOIN message_counts mc ON mc.handle = c.handle
       ORDER BY COALESCE(r.ts, 0) DESC
       LIMIT 500`
    );
    closeDb(opened.opened);
    const sourceRows = getSourceLeadRows();
    const byHandle = new Map<string, LeadRow>();
    for (const row of [...rows, ...sourceRows]) byHandle.set(row.handle, row);
    return {
      kind: 'ok',
      rows: Array.from(byHandle.values())
        .sort((a, b) => (b.last_message_at ?? 0) - (a.last_message_at ?? 0))
        .slice(0, 500),
    };
  } catch (e) {
    try { closeDb(opened.opened); } catch { /* ignore */ }
    return { kind: 'error', message: e instanceof Error ? e.message : 'query failed' };
  }
}

/**
 * Read the most recent N messages for a single handle, oldest-first so the
 * caller can render top-to-bottom. Cap is small (default 200) — full thread
 * view is Tier 2.
 */
export async function getMessagesForHandle(
  handle: string,
  limit = 200
): Promise<Result<ThreadMessageRow[]>> {
  if (handle.startsWith('source:')) {
    const sourceRows = getSourceMessagesForHandle(handle, limit);
    return sourceRows.length > 0 ? { kind: 'ok', rows: sourceRows } : { kind: 'no-db' };
  }

  const opened = openDb();
  if (opened.kind !== 'ok') return opened;
  try {
    const rows = allRows<ThreadMessageRow>(
      opened.opened,
      `SELECT id AS rowid, text, from_me AS is_from_me, ts AS date_unix
       FROM messages
       WHERE handle = ?
       ORDER BY ts DESC, id DESC
       LIMIT ?`,
      [handle, limit]
    );
    closeDb(opened.opened);
    return { kind: 'ok', rows: rows.reverse() };
  } catch (e) {
    try { closeDb(opened.opened); } catch { /* ignore */ }
    return { kind: 'error', message: e instanceof Error ? e.message : 'query failed' };
  }
}

export async function getOutreachApprovals(limit = 25): Promise<Result<OutreachApprovalRow[]>> {
  const opened = openDb();
  if (opened.kind !== 'ok') {
    const sourceRows = getSourceOutreachApprovals(limit);
    return sourceRows.length > 0 ? { kind: 'ok', rows: sourceRows } : opened;
  }
  try {
    const rows = allRows<OutreachApprovalRow>(
      opened.opened,
      `SELECT
         id,
         created_at,
         agent,
         channel,
         recipient,
         recipient_name,
         inbound_text,
         content,
         status,
         source_message_id
       FROM approval_queue
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [Math.max(1, Math.min(limit, 100))]
    );
    closeDb(opened.opened);
    const merged = [...rows, ...getSourceOutreachApprovals(limit)]
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, Math.max(1, Math.min(limit, 100)));
    return { kind: 'ok', rows: merged };
  } catch (e) {
    try { closeDb(opened.opened); } catch { /* ignore */ }
    return { kind: 'error', message: e instanceof Error ? e.message : 'query failed' };
  }
}

export async function getOutreachDbSnapshot(): Promise<Result<OutreachDbSnapshot>> {
  const opened = openDb();
  if (opened.kind !== 'ok') {
    const sourceSnapshot = getSourceOutreachSnapshot();
    return sourceSnapshot ? { kind: 'ok', rows: sourceSnapshot } : opened;
  }
  try {
    const crmColumns = getCrmDbColumns();
    const tableCounts = allRows<{ table_name: string; rows: number }>(
      opened.opened,
      `SELECT 'contacts' AS table_name, COUNT(*) AS rows FROM contacts
       UNION ALL SELECT 'messages', COUNT(*) FROM messages
       UNION ALL SELECT 'approval_queue', COUNT(*) FROM approval_queue
       UNION ALL SELECT 'meta', COUNT(*) FROM meta`
    );
    const dateRange =
      allRows<{ first_day: string | null; last_day: string | null; messages: number }>(
        opened.opened,
        `SELECT MIN(day) AS first_day, MAX(day) AS last_day, COUNT(*) AS messages FROM messages`
      )[0] ?? null;
    const recentDays = allRows<OutreachDbSnapshot['recentDays'][number]>(
      opened.opened,
      `SELECT
         day,
         COUNT(*) AS messages,
         SUM(CASE WHEN from_me=1 THEN 1 ELSE 0 END) AS from_account,
         SUM(CASE WHEN from_me=0 THEN 1 ELSE 0 END) AS inbound,
         SUM(drafted) AS drafted
       FROM messages
       GROUP BY day
       ORDER BY day DESC
       LIMIT 10`
    );
    const services = allRows<{ service: string | null; messages: number }>(
      opened.opened,
      `SELECT service, COUNT(*) AS messages
       FROM messages
       GROUP BY service
       ORDER BY messages DESC`
    );
    const drafted = allRows<{ drafted: number; messages: number }>(
      opened.opened,
      `SELECT drafted, COUNT(*) AS messages
       FROM messages
       GROUP BY drafted`
    );
    const approvalStatus = allRows<{ status: string; queued: number }>(
      opened.opened,
      `SELECT status, COUNT(*) AS queued
       FROM approval_queue
       GROUP BY status
       ORDER BY queued DESC`
    );
    const approvalByAgent = allRows<{ agent: string; status: string; queued: number }>(
      opened.opened,
      `SELECT agent, status, COUNT(*) AS queued
       FROM approval_queue
       GROUP BY agent, status
       ORDER BY queued DESC
       LIMIT 20`
    );
    const contactStats =
      allRows<NonNullable<OutreachDbSnapshot['contactStats']>>(
        opened.opened,
        `SELECT
           COUNT(*) AS enriched_contacts,
           SUM(CASE WHEN ${columnRef('contacts', crmColumns.leadId)} IS NOT NULL THEN 1 ELSE 0 END) AS with_crm_id,
           SUM(CASE WHEN ${columnRef('contacts', crmColumns.stage)} IS NOT NULL AND ${columnRef('contacts', crmColumns.stage)} != '' THEN 1 ELSE 0 END) AS with_crm_stage,
           SUM(CASE WHEN is_client=1 THEN 1 ELSE 0 END) AS clients
         FROM contacts`
      )[0] ?? null;
    const source = opened.opened.kind === 'remote' ? 'remote' : 'local';
    closeDb(opened.opened);
    return {
      kind: 'ok',
      rows: {
        tableCounts,
        dateRange,
        recentDays,
        services,
        drafted,
        approvalStatus,
        approvalByAgent,
        contactStats,
        source,
      },
    };
  } catch (e) {
    try { closeDb(opened.opened); } catch { /* ignore */ }
    return { kind: 'error', message: e instanceof Error ? e.message : 'query failed' };
  }
}
