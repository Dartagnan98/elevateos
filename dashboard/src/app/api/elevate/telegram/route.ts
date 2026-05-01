import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const PAIRING_CODE_RE = /^[A-Z2-9]{4,24}$/i;

interface PairingEntry {
  user_id?: string | number;
  user_name?: string;
  created_at?: number;
  approved_at?: number;
  [key: string]: unknown;
}

interface TelegramApiPayload {
  ok?: boolean;
  result?: {
    id?: number | string;
    username?: string;
    type?: string;
  };
  description?: string;
}

function getElevateHome(): string {
  return process.env.ELEVATE_HOME || path.join(os.homedir(), '.elevate');
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
    // Some filesystems ignore chmod.
  }
}

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 10) return '****';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function maskId(value: string | number | undefined): string {
  const id = String(value ?? '');
  if (!id) return '';
  if (id.length <= 4) return '****';
  return `${'*'.repeat(id.length - 4)}${id.slice(-4)}`;
}

function pairingPaths(): { pending: string; approved: string } {
  const base = path.join(getElevateHome(), 'platforms', 'pairing');
  return {
    pending: path.join(base, 'telegram-pending.json'),
    approved: path.join(base, 'telegram-approved.json'),
  };
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
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Non-fatal.
  }
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

async function validateTelegram(botToken: string, chatId?: string): Promise<{
  ok: boolean;
  error?: string;
  botUsername?: string;
  chatType?: string;
  selfChat?: boolean;
}> {
  if (!botToken) return { ok: false, error: 'TELEGRAM_BOT_TOKEN is missing' };
  try {
    const me = await fetchTelegramJson(`https://api.telegram.org/bot${botToken}/getMe`);
    if (!me.ok || !me.payload?.ok || !me.payload?.result?.id) {
      return { ok: false, error: me.payload?.description || 'Telegram rejected the bot token' };
    }

    if (!chatId) {
      return {
        ok: true,
        botUsername: me.payload.result.username ? `@${me.payload.result.username}` : undefined,
      };
    }

    const chat = await fetchTelegramJson(
      `https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(chatId)}`,
    );
    if (!chat.ok || !chat.payload?.ok) {
      return { ok: false, error: chat.payload?.description || 'Telegram could not reach that home channel' };
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

function restartGateway(): { ok: boolean; stdout: string; stderr: string; error: string | null } {
  const configuredCommand = process.env.ELEVATE_AGENT_COMMAND || process.env.ELEVATE_COMMAND;
  const command = configuredCommand || resolveElevateCommand() || 'elevate';
  const result = spawnSync(command, ['gateway', 'restart'], {
    encoding: 'utf-8',
    timeout: 30000,
    stdio: 'pipe',
    env: process.env,
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    error: result.error ? result.error.message : result.status === 0 ? null : `exit ${result.status ?? 'unknown'}`,
  };
}

function resolveElevateCommand(): string | null {
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'elevate'),
    '/opt/homebrew/bin/elevate',
    '/usr/local/bin/elevate',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const result = spawnSync('sh', ['-lc', 'command -v elevate'], {
    encoding: 'utf-8',
    timeout: 3000,
    stdio: 'pipe',
  });
  const resolved = (result.stdout || '').trim().split(/\r?\n/)[0];
  return resolved || null;
}

function buildResponse(validation?: Awaited<ReturnType<typeof validateTelegram>>, restart?: ReturnType<typeof restartGateway>) {
  const elevateHome = getElevateHome();
  const envPath = path.join(elevateHome, '.env');
  const env = parseEnvFile(envPath);
  const { pending, approved } = pairingPaths();
  const pendingPairings = readJsonObject(pending);
  const approvedPairings = readJsonObject(approved);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const botToken = env.TELEGRAM_BOT_TOKEN || '';
  const homeChannel = env.TELEGRAM_HOME_CHANNEL || '';

  return {
    elevateHome,
    envPath,
    botTokenConfigured: Boolean(botToken),
    botTokenMasked: botToken ? maskSecret(botToken) : '',
    homeChannel,
    homeChannelConfigured: Boolean(homeChannel),
    approvedUserCount: Object.keys(approvedPairings).length,
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
    restart,
  };
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(buildResponse());
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const envPath = path.join(getElevateHome(), '.env');
  const currentEnv = parseEnvFile(envPath);
  const updates: Record<string, string> = {};
  const botToken = typeof body.botToken === 'string' ? body.botToken.trim() : '';
  const homeChannel = typeof body.homeChannel === 'string' ? body.homeChannel.trim() : '';
  const pairingCode = typeof body.pairingCode === 'string' ? body.pairingCode.trim().toUpperCase() : '';

  if (botToken) updates.TELEGRAM_BOT_TOKEN = botToken;
  if (homeChannel) updates.TELEGRAM_HOME_CHANNEL = homeChannel;

  if (pairingCode) {
    if (!PAIRING_CODE_RE.test(pairingCode)) {
      return NextResponse.json({ error: 'Invalid pairing code' }, { status: 400 });
    }
    const paths = pairingPaths();
    const pending = readJsonObject(paths.pending);
    const approved = readJsonObject(paths.approved);
    const pairing = pending[pairingCode];
    const userId = String(pairing?.user_id ?? '').trim();

    if (!pairing || !/^\d+$/.test(userId)) {
      return NextResponse.json({ error: 'Pairing code was not found or has expired' }, { status: 404 });
    }

    delete pending[pairingCode];
    approved[userId] = {
      ...pairing,
      approved_at: Math.floor(Date.now() / 1000),
      approved_by: 'elevateos-dashboard',
    };
    writeJsonObject(paths.pending, pending);
    writeJsonObject(paths.approved, approved);

    if (!homeChannel && !currentEnv.TELEGRAM_HOME_CHANNEL) {
      updates.TELEGRAM_HOME_CHANNEL = userId;
    }
  }

  if (Object.keys(updates).length === 0 && body.validate !== true && body.restartGateway !== true) {
    return NextResponse.json({ error: 'No Telegram gateway settings were provided' }, { status: 400 });
  }

  if (Object.keys(updates).length > 0) {
    writeEnvUpdates(envPath, updates);
  }

  const envAfter = parseEnvFile(envPath);
  let validation: Awaited<ReturnType<typeof validateTelegram>> | undefined;
  if (body.validate === true) {
    validation = await validateTelegram(
      envAfter.TELEGRAM_BOT_TOKEN || '',
      envAfter.TELEGRAM_HOME_CHANNEL || undefined,
    );
  }

  let restart: ReturnType<typeof restartGateway> | undefined;
  if (body.restartGateway === true) {
    restart = restartGateway();
  }

  return NextResponse.json({ success: true, ...buildResponse(validation, restart) });
}
