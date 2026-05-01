import { NextRequest } from 'next/server';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { getFrameworkRoot, getAllAgents, getAgentDir } from '@/lib/config';
import { getElevateAgent, updateElevateAgent } from '@/lib/elevate-gateway-client';
import { spawnSync } from 'child_process';

export const dynamic = 'force-dynamic';

const SAFE_ORG_RE = /^[A-Za-z0-9_-]+$/;
const SYNCED_CONFIG_KEYS = [
  'timezone',
  'day_mode_start',
  'day_mode_end',
  'communication_style',
  'approval_rules',
  'max_session_seconds',
  'max_crashes_per_day',
  'startup_delay',
  'model',
  'dangerously_skip_permissions',
  'ctx_warning_threshold',
  'ctx_handoff_threshold',
] as const;

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function syncedConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SYNCED_CONFIG_KEYS) {
    if (config[key] !== undefined) out[key] = config[key];
  }
  return out;
}

function resolveAgentConfigPath(frameworkRoot: string, name: string, requestedOrg?: string): string | null {
  // First check via getAllAgents (uses enabled-agents.json + filesystem scan)
  const allAgents = getAllAgents();
  const entry = allAgents.find(a => (
    a.name.toLowerCase() === name.toLowerCase() &&
    (!requestedOrg || a.org === requestedOrg)
  ));
  if (entry) {
    const agentDir = getAgentDir(entry.name, entry.org || undefined);
    const p = join(agentDir, 'config.json');
    if (existsSync(p)) return p;
  }

  // Fallback: search all orgs directories
  const orgsDir = join(frameworkRoot, 'orgs');
  if (!existsSync(orgsDir)) return null;
  for (const org of readdirSync(orgsDir)) {
    if (requestedOrg && org !== requestedOrg) continue;
    const p = join(orgsDir, org, 'agents', name, 'config.json');
    if (existsSync(p)) return p;
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!/^[a-z0-9_-]+$/.test(name)) {
    return Response.json({ error: 'Invalid agent name' }, { status: 400 });
  }
  const requestedOrg = request.nextUrl.searchParams.get('org') || undefined;
  if (requestedOrg && !SAFE_ORG_RE.test(requestedOrg)) {
    return Response.json({ error: 'Invalid org name' }, { status: 400 });
  }
  const frameworkRoot = getFrameworkRoot();
  const configPath = resolveAgentConfigPath(frameworkRoot, name, requestedOrg);
  if (!configPath) {
    return Response.json({ error: 'Agent config not found' }, { status: 404 });
  }
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    return Response.json({ config, name });
  } catch {
    return Response.json({ error: 'Failed to read config' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!/^[a-z0-9_-]+$/.test(name)) {
    return Response.json({ error: 'Invalid agent name' }, { status: 400 });
  }
  const requestedOrg = request.nextUrl.searchParams.get('org') || undefined;
  if (requestedOrg && !SAFE_ORG_RE.test(requestedOrg)) {
    return Response.json({ error: 'Invalid org name' }, { status: 400 });
  }
  const frameworkRoot = getFrameworkRoot();
  const configPath = resolveAgentConfigPath(frameworkRoot, name, requestedOrg);
  if (!configPath) {
    return Response.json({ error: 'Agent config not found' }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const allowed = ['timezone', 'day_mode_start', 'day_mode_end', 'communication_style', 'approval_rules', 'max_session_seconds', 'max_crashes_per_day', 'startup_delay', 'model', 'dangerously_skip_permissions', 'ctx_warning_threshold', 'ctx_handoff_threshold'];
  const timeRegex = /^\d{2}:\d{2}$/;
  if (body.day_mode_start && !timeRegex.test(body.day_mode_start as string)) {
    return Response.json({ error: 'day_mode_start must be HH:MM' }, { status: 400 });
  }
  if (body.day_mode_end && !timeRegex.test(body.day_mode_end as string)) {
    return Response.json({ error: 'day_mode_end must be HH:MM' }, { status: 400 });
  }

  // Validate approval_rules shape
  if (body.approval_rules !== undefined) {
    const ar = body.approval_rules as Record<string, unknown>;
    const isStringArray = (v: unknown) => Array.isArray(v) && (v as unknown[]).every(el => typeof el === 'string' && el.length > 0);
    if (
      typeof ar !== 'object' || ar === null || Array.isArray(ar) ||
      !isStringArray(ar.always_ask) || !isStringArray(ar.never_ask)
    ) {
      return Response.json(
        { error: 'approval_rules must have shape { always_ask: string[], never_ask: string[] } with non-empty string elements' },
        { status: 400 },
      );
    }
  }

  // Validate context threshold fields: must be numbers between 50 and 95
  for (const pctField of ['ctx_warning_threshold', 'ctx_handoff_threshold'] as const) {
    if (body[pctField] !== undefined) {
      const val = body[pctField];
      if (typeof val !== 'number' || val < 50 || val > 95) {
        return Response.json({ error: `${pctField} must be a number between 50 and 95` }, { status: 400 });
      }
    }
  }

  if (
    body.dangerously_skip_permissions !== undefined &&
    typeof body.dangerously_skip_permissions !== 'boolean'
  ) {
    return Response.json({ error: 'dangerously_skip_permissions must be a boolean' }, { status: 400 });
  }
  if (body.ctx_warning_threshold !== undefined && body.ctx_handoff_threshold !== undefined) {
    if ((body.ctx_warning_threshold as number) >= (body.ctx_handoff_threshold as number)) {
      return Response.json({ error: 'ctx_warning_threshold must be less than ctx_handoff_threshold' }, { status: 400 });
    }
  }

  // Validate numeric fields: must be non-negative integers
  for (const numField of ['max_session_seconds', 'max_crashes_per_day', 'startup_delay'] as const) {
    if (body[numField] !== undefined) {
      const val = body[numField];
      if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
        return Response.json(
          { error: `${numField} must be a non-negative integer` },
          { status: 400 },
        );
      }
    }
  }

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    for (const key of allowed) {
      if (body[key] !== undefined) config[key] = body[key];
    }
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

    let gatewaySync: { ok: boolean; error: string | null } = { ok: false, error: null };
    try {
      const currentGatewayAgent = await getElevateAgent(name);
      const currentMetadata = objectValue(currentGatewayAgent.metadata);
      const currentConfigMetadata = objectValue(currentMetadata.config);
      await updateElevateAgent(name, {
        org: requestedOrg || (typeof config.org === 'string' ? config.org : undefined),
        metadata: {
          ...currentMetadata,
          config: {
            ...currentConfigMetadata,
            ...syncedConfig(config),
          },
          settings_sync: {
            source: 'elevateos',
            direction: 'dashboard-to-gateway',
            config_path: configPath,
            updated_at: new Date().toISOString(),
          },
        },
      });
      gatewaySync = { ok: true, error: null };
    } catch (syncErr) {
      gatewaySync = {
        ok: false,
        error: syncErr instanceof Error ? syncErr.message : 'Gateway sync failed',
      };
      console.error(`[api/agents/${name}/config] PATCH: gateway sync failed (non-fatal):`, syncErr);
    }

    // Notify agent immediately (non-fatal if offline)
    try {
      const sendMsg = join(frameworkRoot, 'bus', 'send-message.sh');
      if (existsSync(sendMsg)) {
        spawnSync(
          'bash',
          [sendMsg, name, 'normal', 'Settings updated via dashboard. Re-read config.json and apply new operational settings.'],
          {
            env: {
              ...process.env,
              ELEVATE_FRAMEWORK_ROOT: frameworkRoot,
              ELEVATE_AGENT_NAME: name,
              CTX_FRAMEWORK_ROOT: frameworkRoot,
              CTX_AGENT_NAME: name,
            },
            timeout: 5000,
            stdio: 'pipe',
          },
        );
      }
    } catch (notifyErr) {
      console.error(`[api/agents/${name}/config] PATCH: send-message.sh failed (non-fatal):`, notifyErr);
    }

    return Response.json({ success: true, config, name, gateway_sync: gatewaySync });
  } catch {
    return Response.json({ error: 'Failed to write config' }, { status: 500 });
  }
}
