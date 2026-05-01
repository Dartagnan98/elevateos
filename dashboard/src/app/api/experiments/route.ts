import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Experiment {
  id: string;
  agent: string;
  metric: string;
  hypothesis: string;
  surface: string;
  direction: string;
  window: string;
  measurement: string;
  status: string;
  baseline_value: number;
  result_value: number | null;
  decision: string | null;
  changes_description?: string | null;
  learning: string | null;
  experiment_commit: string | null;
  tracking_commit: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface Cycle {
  name: string;
  agent: string;
  surface: string;
  metric: string;
  metric_type: string;
  direction: string;
  window: string;
  measurement: string;
  loop_interval: string;
  enabled: boolean;
  created_by: string;
  created_at: string;
}

interface AgentExperiments {
  agent: string;
  org: string;
  approval_required: boolean;
  config_path: string;
  cycles: Cycle[];
  experiments: Experiment[];
  learnings: string;
  stats: {
    total: number;
    running: number;
    proposed: number;
    completed: number;
    kept: number;
    discarded: number;
    keepRate: number;
  };
}

interface ExperimentConfig {
  approval_required?: boolean;
  cycles?: Cycle[];
  theta_wave?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFrameworkRoot(): string {
  return (
    process.env.CTX_FRAMEWORK_ROOT ??
    path.resolve(process.cwd(), '..')
  );
}

function isSafeSegment(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

function agentDir(org: string, agent: string): string {
  if (!isSafeSegment(org) || !isSafeSegment(agent)) {
    throw new Error('Invalid org or agent');
  }
  const dir = path.join(getFrameworkRoot(), 'orgs', org, 'agents', agent);
  if (!fs.existsSync(dir)) {
    throw new Error(`Agent ${agent} was not found in org ${org}`);
  }
  return dir;
}

function experimentDir(org: string, agent: string): string {
  return path.join(agentDir(org, agent), 'experiments');
}

function readConfig(configPath: string): ExperimentConfig {
  if (!fs.existsSync(configPath)) return {};
  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, filePath);
}

function normalizeCycle(input: Record<string, unknown>, existing?: Cycle): Cycle {
  const name = String(input.name ?? input.cycle ?? existing?.name ?? '').trim();
  const agent = String(input.agent ?? existing?.agent ?? '').trim();
  const metric = String(input.metric ?? existing?.metric ?? '').trim();
  const metricType = String(input.metric_type ?? input.metricType ?? existing?.metric_type ?? 'qualitative');
  const direction = String(input.direction ?? existing?.direction ?? 'higher');

  if (!isSafeSegment(name)) throw new Error('Cycle name must use letters, numbers, underscores, or hyphens');
  if (!isSafeSegment(agent)) throw new Error('Cycle agent is invalid');
  if (!metric || metric.length > 120) throw new Error('Metric is required and must be 120 characters or fewer');
  if (!['quantitative', 'qualitative'].includes(metricType)) throw new Error('Metric type must be quantitative or qualitative');
  if (!['higher', 'lower'].includes(direction)) throw new Error('Direction must be higher or lower');

  return {
    name,
    agent,
    metric,
    metric_type: metricType,
    surface: String(input.surface ?? existing?.surface ?? '').slice(0, 500),
    direction,
    window: String(input.window ?? existing?.window ?? '24h').slice(0, 40),
    measurement: String(input.measurement ?? existing?.measurement ?? '').slice(0, 1000),
    loop_interval: String(input.loop_interval ?? input.loopInterval ?? existing?.loop_interval ?? input.window ?? '24h').slice(0, 40),
    enabled: typeof input.enabled === 'boolean' ? input.enabled : existing?.enabled ?? true,
    created_by: existing?.created_by ?? agent,
    created_at: existing?.created_at ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}

function randomId(prefix: string): string {
  return `${prefix}_${Math.floor(Date.now() / 1000)}_${Math.random().toString(36).slice(2, 7)}`;
}

function scanExperiments(): AgentExperiments[] {
  const frameworkRoot = getFrameworkRoot();
  const orgsDir = path.join(frameworkRoot, 'orgs');
  if (!fs.existsSync(orgsDir)) return [];

  const results: AgentExperiments[] = [];

  for (const org of fs.readdirSync(orgsDir, { withFileTypes: true })) {
    if (!org.isDirectory()) continue;
    const agentsDir = path.join(orgsDir, org.name, 'agents');
    if (!fs.existsSync(agentsDir)) continue;

    for (const agent of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!agent.isDirectory()) continue;
      const expDir = path.join(agentsDir, agent.name, 'experiments');
      if (!fs.existsSync(expDir)) continue;

      // Read config
      let cycles: Cycle[] = [];
      let approvalRequired = false;
      const configPath = path.join(expDir, 'config.json');
      if (fs.existsSync(configPath)) {
        try {
          const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          cycles = cfg.cycles ?? [];
          approvalRequired = Boolean(cfg.approval_required);
        } catch { /* ignore parse errors */ }
      }

      // Read experiments from history/
      const experiments: Experiment[] = [];
      const histDir = path.join(expDir, 'history');
      if (fs.existsSync(histDir)) {
        for (const f of fs.readdirSync(histDir)) {
          if (!f.endsWith('.json')) continue;
          try {
            const exp = JSON.parse(
              fs.readFileSync(path.join(histDir, f), 'utf-8'),
            );
            experiments.push(exp);
          } catch { /* skip bad files */ }
        }
      }

      // Sort by created_at descending
      experiments.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

      // Read learnings
      let learnings = '';
      const learningsPath = path.join(expDir, 'learnings.md');
      if (fs.existsSync(learningsPath)) {
        learnings = fs.readFileSync(learningsPath, 'utf-8');
      }

      // Calculate stats
      const total = experiments.length;
      const running = experiments.filter((e) => e.status === 'running').length;
      const proposed = experiments.filter(
        (e) => e.status === 'proposed',
      ).length;
      const completed = experiments.filter(
        (e) => e.status === 'completed',
      ).length;
      const kept = experiments.filter((e) => e.decision === 'keep').length;
      const discarded = experiments.filter(
        (e) => e.decision === 'discard',
      ).length;
      const decided = kept + discarded;
      const keepRate = decided > 0 ? Math.round((kept / decided) * 100) : 0;

      // Include config-only agents too so the dashboard can manage setup before
      // the first cycle is created.
      if (cycles.length > 0 || experiments.length > 0 || fs.existsSync(configPath)) {
        results.push({
          agent: agent.name,
          org: org.name,
          approval_required: approvalRequired,
          config_path: configPath,
          cycles,
          experiments,
          learnings,
          stats: { total, running, proposed, completed, kept, discarded, keepRate },
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// GET /api/experiments
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const filterAgent = searchParams.get('agent');
  const filterOrg = searchParams.get('org');

  try {
    let data = scanExperiments();

    if (filterOrg) {
      data = data.filter((d) => d.org === filterOrg);
    }
    if (filterAgent) {
      data = data.filter((d) => d.agent === filterAgent);
    }

    // Aggregate stats across all agents
    const allExperiments = data.flatMap((d) => d.experiments);
    const allCycles = data.flatMap((d) => d.cycles);
    const totalKept = allExperiments.filter(
      (e) => e.decision === 'keep',
    ).length;
    const totalDiscarded = allExperiments.filter(
      (e) => e.decision === 'discard',
    ).length;
    const totalDecided = totalKept + totalDiscarded;

    return Response.json({
      agents: data,
      summary: {
        totalExperiments: allExperiments.length,
        totalCycles: allCycles.length,
        running: allExperiments.filter((e) => e.status === 'running').length,
        proposed: allExperiments.filter((e) => e.status === 'proposed').length,
        completed: allExperiments.filter((e) => e.status === 'completed')
          .length,
        kept: totalKept,
        discarded: totalDiscarded,
        keepRate:
          totalDecided > 0 ? Math.round((totalKept / totalDecided) * 100) : 0,
      },
    });
  } catch (err) {
    console.error('[api/experiments] GET error:', err);
    return Response.json(
      { error: 'Failed to fetch experiments' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/experiments
// Dashboard-first setup for experiment settings and cycles.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = String(body.action ?? '').trim();
  const org = String(body.org ?? '').trim();
  const agent = String(body.agent ?? '').trim();

  if (!action) return Response.json({ error: 'Action is required' }, { status: 400 });
  if (!isSafeSegment(org) || !isSafeSegment(agent)) {
    return Response.json({ error: 'Valid org and agent are required' }, { status: 400 });
  }

  try {
    const expDir = experimentDir(org, agent);
    const configPath = path.join(expDir, 'config.json');
    const config = readConfig(configPath);
    const cycles = Array.isArray(config.cycles) ? config.cycles : [];

    if (action === 'update-settings') {
      if (typeof body.approval_required === 'boolean') {
        config.approval_required = body.approval_required;
      }
      if (body.theta_wave && typeof body.theta_wave === 'object' && !Array.isArray(body.theta_wave)) {
        config.theta_wave = body.theta_wave as Record<string, unknown>;
      }
      config.cycles = cycles;
      writeJsonAtomic(configPath, config);
      return Response.json({ success: true, agents: scanExperiments() });
    }

    if (action === 'create-cycle') {
      const next = normalizeCycle({ ...body, agent });
      if (cycles.some((cycle) => cycle.name === next.name)) {
        return Response.json({ error: `Cycle "${next.name}" already exists` }, { status: 409 });
      }
      config.cycles = [...cycles, next];
      writeJsonAtomic(configPath, config);
      return Response.json({ success: true, cycle: next, agents: scanExperiments() }, { status: 201 });
    }

    if (action === 'update-cycle') {
      const cycleName = String(body.cycle ?? body.name ?? '').trim();
      const idx = cycles.findIndex((cycle) => cycle.name === cycleName);
      if (idx < 0) return Response.json({ error: `Cycle "${cycleName}" not found` }, { status: 404 });
      const nextCycles = [...cycles];
      nextCycles[idx] = normalizeCycle({ ...body, agent, name: cycleName }, cycles[idx]);
      config.cycles = nextCycles;
      writeJsonAtomic(configPath, config);
      return Response.json({ success: true, cycle: nextCycles[idx], agents: scanExperiments() });
    }

    if (action === 'remove-cycle') {
      const cycleName = String(body.cycle ?? body.name ?? '').trim();
      const nextCycles = cycles.filter((cycle) => cycle.name !== cycleName);
      if (nextCycles.length === cycles.length) {
        return Response.json({ error: `Cycle "${cycleName}" not found` }, { status: 404 });
      }
      config.cycles = nextCycles;
      writeJsonAtomic(configPath, config);
      return Response.json({ success: true, agents: scanExperiments() });
    }

    if (action === 'create-experiment') {
      const metric = String(body.metric ?? '').trim();
      const hypothesis = String(body.hypothesis ?? '').trim();
      if (!metric || !hypothesis) {
        return Response.json({ error: 'Metric and hypothesis are required' }, { status: 400 });
      }
      const id = randomId('exp');
      const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const experiment: Experiment = {
        id,
        agent,
        metric: metric.slice(0, 120),
        hypothesis: hypothesis.slice(0, 1000),
        surface: String(body.surface ?? '').slice(0, 500),
        direction: String(body.direction ?? 'higher') === 'lower' ? 'lower' : 'higher',
        window: String(body.window ?? '24h').slice(0, 40),
        measurement: String(body.measurement ?? '').slice(0, 1000),
        status: 'proposed',
        baseline_value: 0,
        result_value: null,
        decision: null,
        changes_description: null,
        learning: null,
        experiment_commit: null,
        tracking_commit: null,
        created_at: now,
        started_at: null,
        completed_at: null,
      };
      writeJsonAtomic(path.join(expDir, 'history', `${id}.json`), experiment);
      return Response.json({ success: true, experiment, agents: scanExperiments() }, { status: 201 });
    }

    return Response.json({ error: `Unsupported experiment action "${action}"` }, { status: 400 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to update experiment settings' },
      { status: 500 },
    );
  }
}
