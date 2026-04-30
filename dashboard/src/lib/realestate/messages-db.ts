import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { getOrgConfig } from './org-config';

export type LeadRow = {
  handle: string;
  display_name: string | null;
  stage: string | null;
  last_message: string | null;
  last_message_at: number | null;
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

/**
 * Open the iMessage sqlite db readonly. Lazy — only opens on call so a missing
 * db at build time doesn't crash next build (better-sqlite3 throws on import
 * if the file is missing, see dashboard/node_modules/better-sqlite3/lib/database.js:63-65).
 */
function openDb(): { kind: 'ok'; db: Database.Database } | { kind: 'no-db' } | { kind: 'error'; message: string } {
  const cfg = getOrgConfig();
  const dbPath = cfg?.data_roots?.messages_db;
  if (!dbPath || !existsSync(dbPath)) return { kind: 'no-db' };
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    return { kind: 'ok', db };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'unknown sqlite error' };
  }
}

/**
 * Pull leads from the messages db with the most recent message text and
 * timestamp. The query joins on a contacts table that the user's setup
 * maintains separately from the raw iMessage chat.db. If the schema is
 * different on her actual machine, this returns an error result and the UI
 * shows the diagnostic — adjust the query against the real schema in Tier 2.
 */
export async function getLeadsWithLastMessage(): Promise<Result<LeadRow[]>> {
  const opened = openDb();
  if (opened.kind !== 'ok') return opened;
  const { db } = opened;
  try {
    const rows = db
      .prepare(
        `SELECT
           c.handle              AS handle,
           c.display_name        AS display_name,
           c.stage               AS stage,
           m.text                AS last_message,
           m.date_unix           AS last_message_at,
           c.message_count       AS message_count
         FROM contacts c
         LEFT JOIN (
           SELECT handle, text, date_unix,
                  ROW_NUMBER() OVER (PARTITION BY handle ORDER BY date_unix DESC) AS rn
           FROM messages
         ) m ON m.handle = c.handle AND m.rn = 1
         ORDER BY COALESCE(m.date_unix, 0) DESC
         LIMIT 500`
      )
      .all() as LeadRow[];
    db.close();
    return { kind: 'ok', rows };
  } catch (e) {
    try {
      db.close();
    } catch {
      // ignore
    }
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
  const opened = openDb();
  if (opened.kind !== 'ok') return opened;
  const { db } = opened;
  try {
    const rows = db
      .prepare(
        `SELECT rowid, text, is_from_me, date_unix
         FROM messages
         WHERE handle = ?
         ORDER BY date_unix DESC
         LIMIT ?`
      )
      .all(handle, limit) as ThreadMessageRow[];
    db.close();
    return { kind: 'ok', rows: rows.reverse() };
  } catch (e) {
    try {
      db.close();
    } catch {
      // ignore
    }
    return { kind: 'error', message: e instanceof Error ? e.message : 'query failed' };
  }
}
