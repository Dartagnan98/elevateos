import { NextRequest } from 'next/server';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { getTasks } from '@/lib/data/tasks';
import { getFrameworkRoot, getCTXRoot, getOrgs } from '@/lib/config';
import { syncAll } from '@/lib/sync';

export const dynamic = 'force-dynamic';

// Security (H4): frameworkRoot must match a safe path pattern — no shell metacharacters.
const SAFE_PATH_REGEX = /^[/\w.-]+$/;

// ---------------------------------------------------------------------------
// Validation constants
// ---------------------------------------------------------------------------

const VALID_PRIORITIES = ['urgent', 'high', 'normal', 'low'];

const VALID_AGENT_NAME = /^[a-z0-9_-]+$/;
const VALID_ORG_NAME = /^[a-zA-Z0-9_-]+$/;

function isValidAgentName(name: string): boolean {
  return VALID_AGENT_NAME.test(name) && name.length <= 64;
}

function isValidOrgName(name: string): boolean {
  return VALID_ORG_NAME.test(name) && name.length <= 128;
}

function normalizeOptionalIso(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const epoch = Date.parse(trimmed);
  if (Number.isNaN(epoch)) return '';
  return new Date(epoch).toISOString();
}

// ---------------------------------------------------------------------------
// GET /api/tasks - List tasks with optional filters
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  try { syncAll(); } catch { /* best-effort */ }

  const filters = {
    org: searchParams.get('org') || undefined,
    agent: searchParams.get('agent') || undefined,
    priority: searchParams.get('priority') || undefined,
    status: searchParams.get('status') || undefined,
    project: searchParams.get('project') || undefined,
    search: searchParams.get('search') || undefined,
  };

  try {
    const tasks = getTasks(filters);
    return Response.json(tasks);
  } catch (err) {
    console.error('[api/tasks] GET error:', err);
    return Response.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/tasks - Create a new task via bus/create-task.sh
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { title, description, assignee, priority, project, needsApproval, dueDate, scheduledFor } =
    body as {
      title?: string;
      description?: string;
      assignee?: string;
      priority?: string;
      project?: string;
      needsApproval?: boolean;
      dueDate?: string;
      scheduledFor?: string;
    };

  // Validate required fields
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return Response.json({ error: 'Title is required' }, { status: 400 });
  }
  if (title.length > 500) {
    return Response.json(
      { error: 'Title must be 500 characters or fewer' },
      { status: 400 },
    );
  }
  if (priority && !VALID_PRIORITIES.includes(priority)) {
    return Response.json(
      { error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}` },
      { status: 400 },
    );
  }
  const cleanAssignee = typeof assignee === 'string' ? assignee.trim() : '';
  if (cleanAssignee && !isValidAgentName(cleanAssignee)) {
    return Response.json(
      { error: 'Invalid assignee. Use lowercase letters, numbers, underscores, or hyphens.' },
      { status: 400 },
    );
  }
  const cleanDueDate = normalizeOptionalIso(dueDate);
  if (cleanDueDate === '') {
    return Response.json({ error: 'Due date must be a valid date/time' }, { status: 400 });
  }
  const cleanScheduledFor = normalizeOptionalIso(scheduledFor);
  if (cleanScheduledFor === '') {
    return Response.json({ error: 'Run at must be a valid date/time' }, { status: 400 });
  }
  if (cleanScheduledFor && !cleanAssignee) {
    return Response.json(
      { error: 'Timed tasks need an assignee so the daemon knows which agent to wake.' },
      { status: 400 },
    );
  }

  const requestedOrg = typeof body.org === 'string' ? body.org.trim() : '';
  if (requestedOrg && !isValidOrgName(requestedOrg)) {
    return Response.json(
      { error: 'Invalid org. Use letters, numbers, underscores, or hyphens.' },
      { status: 400 },
    );
  }

  const availableOrgs = getOrgs();
  if (requestedOrg && availableOrgs.length > 0 && !availableOrgs.includes(requestedOrg)) {
    return Response.json(
      { error: `Unknown org "${requestedOrg}"` },
      { status: 400 },
    );
  }

  // Use selected org from the dashboard, or fall back to the first configured org.
  const org = requestedOrg || availableOrgs[0] || '';

  const frameworkRoot = getFrameworkRoot();

  // Security (H4): Validate frameworkRoot before using in execFileSync path.
  if (!frameworkRoot || !SAFE_PATH_REGEX.test(frameworkRoot)) {
    console.error('[api/tasks] Invalid CTX_FRAMEWORK_ROOT:', frameworkRoot);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }

  const instanceId = process.env.ELEVATE_INSTANCE_ID ?? process.env.CTX_INSTANCE_ID ?? 'default';
  const env = {
    ...process.env,
    ELEVATE_FRAMEWORK_ROOT: frameworkRoot,
    ELEVATE_ROOT: getCTXRoot(),
    ELEVATE_INSTANCE_ID: instanceId,
    ELEVATE_ORG: org,
    CTX_FRAMEWORK_ROOT: frameworkRoot,
    CTX_ROOT: getCTXRoot(),
    CTX_INSTANCE_ID: instanceId,
    CTX_AGENT_NAME: 'dashboard',
    CTX_ORG: org,
  };

  // Call the Node CLI directly instead of going through bash wrapper.
  // create-task.sh just runs: node dist/cli.js bus create-task <title> [options]
  const cliPath = join(frameworkRoot, 'dist', 'cli.js');
  const args: string[] = ['bus', 'create-task', title.trim()];
  if (description) { args.push('--desc', String(description).slice(0, 2000)); }
  if (cleanAssignee) { args.push('--assignee', cleanAssignee); }
  if (priority) { args.push('--priority', priority); }
  if (project) { args.push('--project', String(project)); }
  if (needsApproval) { args.push('--needs-approval'); }
  if (cleanDueDate) { args.push('--due-date', cleanDueDate); }
  if (cleanScheduledFor) { args.push('--run-at', cleanScheduledFor); }

  try {
    const result = execFileSync(process.execPath, [cliPath, ...args], {
      encoding: 'utf-8',
      timeout: 10000,
      env,
    });

    // Trigger sync so subsequent reads reflect the new task
    try {
      syncAll();
    } catch {
      // Sync is best-effort
    }

    return Response.json(
      { success: true, taskId: result.trim() },
      { status: 201 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/tasks] POST error:', message);
    return Response.json({ error: 'Failed to create task', detail: message }, { status: 500 });
  }
}
