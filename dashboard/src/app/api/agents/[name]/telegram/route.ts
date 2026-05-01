import { NextRequest } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getAllAgents, getAgentDir } from '@/lib/config';

export const dynamic = 'force-dynamic';

const SAFE_NAME_RE = /^[a-z0-9_-]+$/i;
const PAIRING_CODE_RE = /^[a-z0-9]{4,24}$/i;

interface PairingEntry {
  user_id?: string | number;
  user_name?: string;
  created_at?: number;
  approved_at?: number;
  [key: string]: unknown;
}

interface TelegramValidation {
  ok: boolean;
  error?: string;
  botUsername?: string;
  chatType?: string;
  selfChat?: boolean;
}

interface TelegramApiPayload {
  ok?: boolean;
  result?: {
    id?: number | string;
    username?: string;
    type?: string;
  };
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const values: Record<string, string> = {};

  for (const line of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    values[match[1]] = stripQuotes(match[2]);
  }

  return values;
}

function writeEnvUpdates(envPath: string, updates: Record<string, string>): void {
  fs.mkdirSync(path.dirname(envPath), { recursive: true });

  const original = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf-8').replace(/\r\n/g, '\n')
    : '';
  const lines = original ? original.split('\n') : [];
  const next: string[] = [];
  const written = new Set<string>();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === '' && i === lines.length - 1) continue;

    const match = line.match(/^(\s*)(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)(\s*)=(.*)$/);
    if (match && Object.prototype.hasOwnProperty.call(updates, match[2])) {
      next.push(`${match[1]}${match[2]}=${updates[match[2]]}`);
      written.add(match[2]);
      continue;
    }

    next.push(line);
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!written.has(key)) next.push(`${key}=${value}`);
  }

  fs.writeFileSync(envPath, next.join('\n') + '\n', { encoding: 'utf-8', mode: 0o600 });
  try {
    fs.chmodSync(envPath, 0o600);
  } catch {
    // Non-fatal on filesystems that do not support chmod.
  }
}

function maskToken(token: string): string {
  if (!token) return '';
  if (token.length <= 10) return '****';
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function maskId(value: string | number | undefined): string {
  const id = String(value ?? '');
  if (!id) return '';
  if (id.length <= 4) return '****';
  return `${'*'.repeat(id.length - 4)}${id.slice(-4)}`;
}

function getElevateHome(): string {
  return process.env.ELEVATE_HOME || path.join(os.homedir(), '.elevate');
}

function getGatewayBotToken(): string {
  const envPath = path.join(getElevateHome(), '.env');
  const env = parseEnvFile(envPath);
  return env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN || '';
}

function readJsonObject(filePath: string): Record<string, PairingEntry> {
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, PairingEntry>;
  } catch {
    return {};
  }
}

function writeJsonObject(filePath: string, value: Record<string, PairingEntry>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf-8');
}

function pairingPaths(): { pending: string; approved: string } {
  const base = path.join(getElevateHome(), 'platforms', 'pairing');
  return {
    pending: path.join(base, 'telegram-pending.json'),
    approved: path.join(base, 'telegram-approved.json'),
  };
}

function resolveAgent(name: string, requestedOrg?: string): { name: string; org: string; error?: string; status?: number } {
  if (!SAFE_NAME_RE.test(name)) {
    return { name, org: '', error: 'Invalid agent name', status: 400 };
  }
  if (requestedOrg && !SAFE_NAME_RE.test(requestedOrg)) {
    return { name, org: '', error: 'Invalid org name', status: 400 };
  }

  const matches = getAllAgents().filter((agent) => {
    if (agent.name.toLowerCase() !== name.toLowerCase()) return false;
    return requestedOrg ? agent.org === requestedOrg : true;
  });

  if (matches.length === 0) {
    return { name, org: requestedOrg ?? '', error: 'Agent not found', status: 404 };
  }

  if (matches.length > 1) {
    return { name, org: '', error: 'Agent name is ambiguous; pass org', status: 409 };
  }

  return matches[0];
}

async function fetchTelegramJson(url: string): Promise<{ ok: boolean; payload: TelegramApiPayload | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);

  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
    const payload = await res.json().catch(() => null);
    return { ok: res.ok, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function validateTelegram(botToken: string, chatId: string): Promise<TelegramValidation> {
  if (!botToken) return { ok: false, error: 'BOT_TOKEN is missing' };
  if (!chatId) return { ok: false, error: 'CHAT_ID is missing' };

  try {
    const me = await fetchTelegramJson(`https://api.telegram.org/bot${botToken}/getMe`);
    if (!me.ok || !me.payload?.ok || !me.payload?.result?.id) {
      return { ok: false, error: 'Telegram rejected the bot token' };
    }

    const chat = await fetchTelegramJson(
      `https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(chatId)}`,
    );
    if (!chat.ok || !chat.payload?.ok) {
      return { ok: false, error: 'Telegram could not reach that chat ID' };
    }

    return {
      ok: true,
      botUsername: me.payload.result.username ? `@${me.payload.result.username}` : undefined,
      chatType: chat.payload.result?.type,
      selfChat: String(me.payload.result.id) === String(chatId),
    };
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError'
      ? 'Telegram validation timed out'
      : 'Telegram validation failed';
    return { ok: false, error: message };
  }
}

function buildResponse(agent: { name: string; org: string }, validation?: TelegramValidation) {
  const agentDir = getAgentDir(agent.name, agent.org || undefined);
  const envPath = path.join(agentDir, '.env');
  const env = parseEnvFile(envPath);
  const { pending, approved } = pairingPaths();
  const pendingPairings = readJsonObject(pending);
  const approvedPairings = readJsonObject(approved);
  const botToken = env.BOT_TOKEN || '';
  const chatId = env.CHAT_ID || '';
  const allowedUser = env.ALLOWED_USER || '';
  const nowSeconds = Math.floor(Date.now() / 1000);

  return {
    agent,
    envPath,
    botTokenConfigured: Boolean(botToken),
    botTokenMasked: botToken ? maskToken(botToken) : '',
    chatId,
    allowedUser,
    allowedUserConfigured: Boolean(allowedUser),
    configured: Boolean(botToken && chatId && allowedUser),
    gatewayBotTokenConfigured: Boolean(getGatewayBotToken()),
    pendingPairings: Object.entries(pendingPairings).map(([code, entry]) => ({
      code,
      userId: String(entry.user_id || ''),
      userName: entry.user_name || '',
      userIdMasked: maskId(entry.user_id),
      ageMinutes: entry.created_at ? Math.max(0, Math.round((nowSeconds - Number(entry.created_at)) / 60)) : null,
    })),
    approvedPairings: Object.entries(approvedPairings).map(([userId, entry]) => ({
      userId,
      userName: entry.user_name || '',
      userIdMasked: maskId(userId),
      approvedAt: entry.approved_at || null,
    })),
    validation,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const requestedOrg = request.nextUrl.searchParams.get('org') || undefined;
  const agent = resolveAgent(decodeURIComponent(name), requestedOrg);

  if (agent.error) {
    return Response.json({ error: agent.error }, { status: agent.status ?? 400 });
  }

  return Response.json(buildResponse(agent));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const requestedOrg = request.nextUrl.searchParams.get('org') || undefined;
  const agent = resolveAgent(decodeURIComponent(name), requestedOrg);

  if (agent.error) {
    return Response.json({ error: agent.error }, { status: agent.status ?? 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const agentDir = getAgentDir(agent.name, agent.org || undefined);
  if (!fs.existsSync(agentDir)) {
    return Response.json({ error: 'Agent directory not found' }, { status: 404 });
  }

  const updates: Record<string, string> = {};
  let pendingAfter: Record<string, PairingEntry> | null = null;
  let approvedAfter: Record<string, PairingEntry> | null = null;

  const botToken = typeof body.botToken === 'string' ? body.botToken.trim() : '';
  const chatId = typeof body.chatId === 'string' ? body.chatId.trim() : '';
  const allowedUser = typeof body.allowedUser === 'string' ? body.allowedUser.trim() : '';
  const pairingCode = typeof body.pairingCode === 'string' ? body.pairingCode.trim().toUpperCase() : '';

  if (body.useGatewayBotToken === true) {
    const gatewayBotToken = getGatewayBotToken();
    if (!gatewayBotToken) {
      return Response.json({ error: 'Gateway Telegram bot token is not configured' }, { status: 400 });
    }
    updates.BOT_TOKEN = gatewayBotToken;
  } else if (botToken) {
    updates.BOT_TOKEN = botToken;
  }

  if (pairingCode) {
    if (!PAIRING_CODE_RE.test(pairingCode)) {
      return Response.json({ error: 'Invalid pairing code' }, { status: 400 });
    }

    const paths = pairingPaths();
    const pending = readJsonObject(paths.pending);
    const approved = readJsonObject(paths.approved);
    const pairing = pending[pairingCode];
    const userId = String(pairing?.user_id ?? '').trim();

    if (!pairing || !/^\d+$/.test(userId)) {
      return Response.json({ error: 'Pairing code was not found or has expired' }, { status: 404 });
    }

    updates.CHAT_ID = userId;
    updates.ALLOWED_USER = userId;
    delete pending[pairingCode];
    approved[userId] = {
      ...pairing,
      approved_at: Math.floor(Date.now() / 1000),
      approved_for_agent: agent.name,
      approved_for_org: agent.org,
      approved_by: 'dashboard',
    };
    pendingAfter = pending;
    approvedAfter = approved;
  } else {
    if (chatId) updates.CHAT_ID = chatId;
    if (allowedUser) updates.ALLOWED_USER = allowedUser;
  }

  if (Object.keys(updates).length === 0 && body.validate !== true) {
    return Response.json({ error: 'No Telegram settings were provided' }, { status: 400 });
  }

  const envPath = path.join(agentDir, '.env');
  if (Object.keys(updates).length > 0) {
    writeEnvUpdates(envPath, updates);
  }

  if (pendingAfter && approvedAfter) {
    const paths = pairingPaths();
    writeJsonObject(paths.pending, pendingAfter);
    writeJsonObject(paths.approved, approvedAfter);
  }

  let validation: TelegramValidation | undefined;
  if (body.validate === true) {
    const env = parseEnvFile(envPath);
    validation = await validateTelegram(env.BOT_TOKEN || '', env.CHAT_ID || '');
  }

  return Response.json({ success: true, ...buildResponse(agent, validation) });
}
