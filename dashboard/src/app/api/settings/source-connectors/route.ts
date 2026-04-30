import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getActiveOrgName } from '@/lib/realestate/org-config';
import { readRemoteFile, runRemoteText, shellQuote } from '@/lib/realestate/remote';
import { getSourceRootInfo, type SourceRootInfo } from '@/lib/realestate/source-records';
import { SOURCE_CONNECTION_BLUEPRINTS } from '@/lib/realestate/source-setup-prompts';

export const dynamic = 'force-dynamic';

type JsonRecord = Record<string, unknown>;
type ConnectorState = 'not_configured' | 'connected' | 'import_only' | 'needs_operator' | 'blocked' | 'error';

const JSONL_FILES = [
  'contacts.jsonl',
  'conversations.jsonl',
  'messages.jsonl',
  'lead-events.jsonl',
  'tasks.jsonl',
] as const;

const OWNER_BY_SOURCE: Record<string, string> = {
  'apple-messages': 'Reese',
  'sms-provider': 'Reese',
  'android-device': 'Reese',
  rcs: 'Reese',
  crm: 'Reese',
  social: 'Reese',
  email: 'Reese',
  skills: 'Marlowe',
  'market-stats': 'Marlowe',
  'admin-requirements': 'Avery',
  'document-storage': 'Avery',
  'forms-signing': 'Avery',
};

const UI_BY_SOURCE: Record<string, string[]> = {
  'apple-messages': ['Outreach', 'Leads', 'Overview', 'Approvals'],
  'sms-provider': ['Outreach', 'Leads', 'Overview', 'Settings'],
  'android-device': ['Outreach', 'Leads', 'Overview', 'Approvals'],
  rcs: ['Outreach', 'Leads', 'Overview', 'Settings'],
  crm: ['Leads', 'Deals', 'Outreach', 'Overview'],
  social: ['Leads', 'Outreach', 'Overview', 'Approvals'],
  email: ['Leads', 'Outreach', 'Overview', 'Documents'],
  skills: ['Deals', 'Overview', 'Documents', 'Settings'],
  'market-stats': ['Deals', 'Overview', 'Documents', 'Settings'],
  'admin-requirements': ['Deals', 'Overview', 'Tasks', 'Approvals'],
  'document-storage': ['Deals', 'Overview', 'Documents', 'Tasks'],
  'forms-signing': ['Deals', 'Overview', 'Approvals', 'Documents'],
};

function remoteDirname(filePath: string): string {
  return filePath.replace(/\/[^/]*$/, '') || '/';
}

function parentDir(info: SourceRootInfo, filePath: string): string {
  return info.io === 'remote' ? remoteDirname(filePath) : path.dirname(filePath);
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

function writeText(info: SourceRootInfo, filePath: string, content: string): void {
  if (info.io === 'remote') {
    if (!info.cfg) throw new Error('Remote source root is not configured');
    runRemoteText(
      info.cfg,
      `mkdir -p ${shellQuote(parentDir(info, filePath))} && printf %s ${shellQuote(content)} > ${shellQuote(filePath)}`,
      { timeoutMs: 12_000, maxBuffer: 1024 * 1024 }
    );
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function readJson(info: SourceRootInfo, filePath: string): JsonRecord | null {
  try {
    const raw = readText(info, filePath);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonRecord : null;
  } catch {
    return null;
  }
}

function writeJson(info: SourceRootInfo, filePath: string, value: JsonRecord): void {
  writeText(info, filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function countJsonl(info: SourceRootInfo, filePath: string): number {
  try {
    if (info.io === 'remote') {
      if (!info.cfg) return 0;
      const output = runRemoteText(
        info.cfg,
        `test -f ${shellQuote(filePath)} && sed '/^[[:space:]]*$/d' ${shellQuote(filePath)} | wc -l || printf 0`,
        { timeoutMs: 8_000, maxBuffer: 1024 * 1024 }
      );
      return Number.parseInt(output.trim(), 10) || 0;
    }
    if (!fs.existsSync(filePath)) return 0;
    return fs.readFileSync(filePath, 'utf-8')
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .length;
  } catch {
    return 0;
  }
}

function joinSourcePath(info: SourceRootInfo, ...segments: string[]): string {
  if (info.io === 'remote') {
    const cleanRoot = info.sourceRoot.replace(/\/+$/, '');
    return [cleanRoot, ...segments.map((segment) => segment.replace(/^\/+|\/+$/g, ''))]
      .filter(Boolean)
      .join('/');
  }
  return path.join(info.sourceRoot, ...segments);
}

function sourcePaths(info: SourceRootInfo, sourceId: string) {
  const sourceDir = joinSourcePath(info, sourceId);
  return {
    sourceDir,
    sourcePath: joinSourcePath(info, sourceId, 'source.json'),
    statusPath: joinSourcePath(info, sourceId, 'status.json'),
    artifactsDir: joinSourcePath(info, sourceId, 'artifacts'),
  };
}

function stateFromStatus(sourceExists: boolean, status: JsonRecord | null): ConnectorState {
  if (!sourceExists && !status) return 'not_configured';
  if (!status) return 'needs_operator';
  if (status.blocked === true) return 'blocked';
  if (status.connected === true) return 'connected';
  if (status.import_only === true) return 'import_only';
  if (typeof status.last_error === 'string' && status.last_error.trim()) return 'error';
  return 'needs_operator';
}

function connectorView(info: SourceRootInfo, sourceId: string) {
  const blueprint = SOURCE_CONNECTION_BLUEPRINTS.find((item) => item.id === sourceId);
  if (!blueprint) return null;

  const paths = sourcePaths(info, sourceId);
  const source = readJson(info, paths.sourcePath);
  const status = readJson(info, paths.statusPath);
  const sourceExists = Boolean(source);
  const state = stateFromStatus(sourceExists, status);
  const recordCounts = Object.fromEntries(
    JSONL_FILES.map((file) => [file.replace('.jsonl', ''), countJsonl(info, joinSourcePath(info, sourceId, file))])
  );

  return {
    id: sourceId,
    label: blueprint.source,
    state,
    sourceExists,
    sourceDir: paths.sourceDir,
    sourcePath: paths.sourcePath,
    statusPath: paths.statusPath,
    artifactsDir: paths.artifactsDir,
    connectionType: typeof source?.connection_type === 'string' ? source.connection_type : null,
    syncMode: typeof source?.sync_mode === 'string' ? source.sync_mode : null,
    authStatus: typeof source?.auth_status === 'string' ? source.auth_status : null,
    ownerAgent: typeof source?.owner_agent === 'string' ? source.owner_agent : OWNER_BY_SOURCE[sourceId] ?? 'Reese',
    enabledUiSurfaces: Array.isArray(source?.enabled_ui_surfaces)
      ? source.enabled_ui_surfaces.filter((item): item is string => typeof item === 'string')
      : UI_BY_SOURCE[sourceId] ?? [],
    connected: status?.connected === true,
    importOnly: status?.import_only === true,
    blocked: status?.blocked === true,
    lastError: typeof status?.last_error === 'string' && status.last_error.trim() ? status.last_error : null,
    nextOperatorStep: typeof status?.next_operator_step === 'string' && status.next_operator_step.trim()
      ? status.next_operator_step
      : state === 'not_configured'
        ? 'Initialize this source to create the connector files.'
        : null,
    lastCheckedAt: typeof status?.last_checked_at === 'string' ? status.last_checked_at : null,
    recordCounts,
  };
}

function buildResponse() {
  const org = getActiveOrgName();
  const info = getSourceRootInfo(org);
  const connectors = SOURCE_CONNECTION_BLUEPRINTS
    .map((item) => connectorView(info, item.id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return {
    org,
    toolsRoot: info.toolsRoot,
    toolsRootSource: info.source,
    toolsRootIo: info.io,
    sourceRoot: info.sourceRoot,
    connectors,
  };
}

function writeJsonlIfEmpty(info: SourceRootInfo, filePath: string, record: JsonRecord): void {
  if (countJsonl(info, filePath) > 0) return;
  writeText(info, filePath, `${JSON.stringify(record)}\n`);
}

function scaffoldSource(info: SourceRootInfo, sourceId: string) {
  const blueprint = SOURCE_CONNECTION_BLUEPRINTS.find((item) => item.id === sourceId);
  if (!blueprint) throw new Error('Unknown source connector');

  const now = new Date().toISOString();
  const paths = sourcePaths(info, sourceId);
  const surfaces = UI_BY_SOURCE[sourceId] ?? ['Settings'];
  const ownerAgent = OWNER_BY_SOURCE[sourceId] ?? 'Reese';
  if (info.io === 'remote') {
    if (!info.cfg) throw new Error('Remote source root is not configured');
    runRemoteText(info.cfg, `mkdir -p ${shellQuote(paths.artifactsDir)}`, { timeoutMs: 12_000 });
  } else {
    fs.mkdirSync(paths.artifactsDir, { recursive: true });
  }

  writeJson(info, paths.sourcePath, {
    source_id: sourceId,
    provider: blueprint.source,
    account_label: `${blueprint.source} local test`,
    connection_type: 'manual_import',
    auth_status: 'not_required_for_local_test',
    sync_mode: 'manual',
    owner_agent: ownerAgent,
    enabled_ui_surfaces: surfaces,
    setup_status: 'import_only',
    last_sync_at: now,
    setup_notes: 'Local connector scaffold generated from ElevateOS Settings for testing.',
  });

  writeJson(info, paths.statusPath, {
    connected: false,
    import_only: true,
    blocked: false,
    last_error: null,
    next_operator_step: 'Replace this local scaffold with a real webhook, polling command, import command, or local bridge.',
    last_checked_at: now,
  });

  writeJsonlIfEmpty(info, joinSourcePath(info, sourceId, 'contacts.jsonl'), {
    source_id: sourceId,
    source_record_id: `${sourceId}-demo-contact`,
    source_url: null,
    display_name: `${blueprint.source} Demo Lead`,
    channel: sourceId,
    confidence: 0.72,
    tags: ['demo', 'connector-test'],
    target_ui_surfaces: surfaces,
  });
  writeJsonlIfEmpty(info, joinSourcePath(info, sourceId, 'conversations.jsonl'), {
    source_id: sourceId,
    source_record_id: `${sourceId}-demo-thread`,
    display_name: `${blueprint.source} Demo Conversation`,
    channel: sourceId,
    timestamp: now,
    summary: 'Demo connector conversation created from Settings.',
    confidence: 0.72,
    tags: ['demo', 'connector-test'],
    target_ui_surfaces: surfaces,
  });
  writeJsonlIfEmpty(info, joinSourcePath(info, sourceId, 'messages.jsonl'), {
    source_id: sourceId,
    source_record_id: `${sourceId}-demo-message`,
    display_name: `${blueprint.source} Demo Lead`,
    channel: sourceId,
    direction: 'inbound',
    timestamp: now,
    text: 'Demo inbound message for connector testing.',
    confidence: 0.72,
    tags: ['demo', 'connector-test'],
    target_ui_surfaces: surfaces,
  });
  writeJsonlIfEmpty(info, joinSourcePath(info, sourceId, 'lead-events.jsonl'), {
    source_id: sourceId,
    source_record_id: `${sourceId}-demo-lead-event`,
    display_name: `${blueprint.source} Demo Lead`,
    channel: sourceId,
    direction: 'inbound',
    timestamp: now,
    type: 'new_lead',
    summary: 'Demo lead event from local connector scaffold.',
    confidence: 0.72,
    tags: ['demo', 'connector-test'],
    target_ui_surfaces: surfaces,
  });
  writeJsonlIfEmpty(info, joinSourcePath(info, sourceId, 'tasks.jsonl'), {
    source_id: sourceId,
    source_record_id: `${sourceId}-demo-task`,
    display_name: `${blueprint.source} Demo Lead`,
    timestamp: now,
    title: `Review ${blueprint.source} connector scaffold`,
    status: 'open',
    approval_required: false,
    owner_agent: ownerAgent,
    confidence: 0.72,
    tags: ['demo', 'connector-test'],
    target_ui_surfaces: ['Overview', 'Settings'],
  });

  return connectorView(info, sourceId);
}

async function requireSession() {
  const session = await auth();
  return Boolean(session);
}

export async function GET() {
  if (!(await requireSession())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return Response.json(buildResponse());
}

export async function POST(request: NextRequest) {
  if (!(await requireSession())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as { action?: string; sourceId?: string };
    if (body.action !== 'scaffold') {
      return Response.json({ error: 'Unsupported action' }, { status: 400 });
    }
    const sourceId = typeof body.sourceId === 'string' ? body.sourceId : '';
    const org = getActiveOrgName();
    const info = getSourceRootInfo(org);
    scaffoldSource(info, sourceId);
    return Response.json({ success: true, ...buildResponse() });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to update source connector' },
      { status: 500 }
    );
  }
}
