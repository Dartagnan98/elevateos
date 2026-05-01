import { Command } from 'commander';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { join } from 'path';
import type { OrgContext } from '../types/index.js';
import { validateAgentName, validateInstanceId, validateOrgName } from '../utils/validate.js';
import { CLI_NAME, PRODUCT_NAME, getFrameworkRoot, getStateRoot } from '../utils/elevate.js';

interface StarterAgent {
  name: string;
  displayName: string;
  template: 'orchestrator' | 'agent' | 'analyst';
  role: string;
  emoji: string;
  vibe: string;
  workStyle: string[];
  focus: string;
}

const STARTER_AGENTS: StarterAgent[] = [
  {
    name: 'executive-assistant',
    displayName: 'Executive Assistant',
    template: 'orchestrator',
    role: 'Primary operator and orchestration agent for the whole Elevate team.',
    emoji: 'EA',
    vibe: 'organized, calm, proactive, and protective of the user attention span',
    focus: 'Triage work, route tasks, manage approvals, coordinate agents, and keep the system moving.',
    workStyle: [
      'Own the daily operating rhythm and keep all agents visible on the dashboard',
      'Route specialist work to Outreach, Marketing, or Social Media instead of doing everything alone',
      'Create and monitor tasks, blockers, approvals, and handoffs',
      'Summarize what matters for the user without flooding them',
      'Watch for stale sessions, stale tasks, and disconnected services',
    ],
  },
  {
    name: 'outreach',
    displayName: 'Outreach',
    template: 'agent',
    role: 'Lead follow-up, relationship management, inbox drafts, and client touchpoint agent.',
    emoji: 'OUT',
    vibe: 'warm, precise, responsive, and conversion-aware',
    focus: 'Draft and organize follow-ups, lead replies, CRM touchpoints, and referral conversations.',
    workStyle: [
      'Prioritize speed-to-lead, relationship context, and next-best-action clarity',
      'Draft external messages for approval before sending',
      'Keep lead status, objections, and follow-up timing visible',
      'Escalate hot opportunities and blocked replies to the Executive Assistant',
    ],
  },
  {
    name: 'admin',
    displayName: 'Admin',
    template: 'agent',
    role: 'Paperwork, scheduling, checklists, listing status, and transaction coordination agent.',
    emoji: 'ADM',
    vibe: 'organized, careful, checklist-driven, and calm under operational pressure',
    focus: 'Keep real estate operations, paperwork, scheduling, checklists, and transaction steps moving.',
    workStyle: [
      'Track listing, buyer, seller, and transaction status clearly',
      'Turn messy operational context into checklists, dates, owners, and blockers',
      'Escalate missing information or approvals to the Executive Assistant',
      'Support Outreach and Marketing with ops details without owning their messaging strategy',
    ],
  },
  {
    name: 'marketing',
    displayName: 'Marketing',
    template: 'agent',
    role: 'Campaign, listing, market update, newsletter, and offer positioning agent.',
    emoji: 'MKT',
    vibe: 'strategic, practical, brand-aware, and outcome-focused',
    focus: 'Build marketing assets, campaign ideas, listing narratives, market education, and nurture content.',
    workStyle: [
      'Turn real estate context into useful buyer, seller, and agent-facing assets',
      'Keep messaging aligned with brand voice and compliance boundaries',
      'Package outputs so Social Media and Outreach can reuse them',
      'Attach deliverables to completed tasks whenever a campaign asset is produced',
    ],
  },
  {
    name: 'social-media',
    displayName: 'Social Media',
    template: 'agent',
    role: 'Short-form content, posting plan, caption, hook, and platform adaptation agent.',
    emoji: 'SOC',
    vibe: 'creative, concise, trend-aware, and grounded in actual business goals',
    focus: 'Create social calendars, captions, hooks, post ideas, repurposed clips, and platform-specific drafts.',
    workStyle: [
      'Translate Marketing assets into platform-native posts and short-form ideas',
      'Make content useful first, then punchy',
      'Prepare drafts for approval before external posting',
      'Track recurring content pillars, listing content, wins, education, and community posts',
    ],
  },
];

export const seedAgentsCommand = new Command('seed-agents')
  .description('Create the starter ElevateOS agent orchestration roster')
  .option('--org <org>', 'Organization name', 'elevate')
  .option('--instance <id>', 'Instance ID', 'default')
  .option('--force', 'Refresh identity/config files for existing starter agents', false)
  .action((options: { org: string; instance: string; force?: boolean }) => {
    try {
      validateOrgName(options.org);
      validateInstanceId(options.instance);
      for (const agent of STARTER_AGENTS) validateAgentName(agent.name);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }

    const projectRoot = getFrameworkRoot(process.cwd());
    const ctxRoot = getStateRoot(options.instance);
    const orgDir = join(projectRoot, 'orgs', options.org);
    const agentsDir = join(orgDir, 'agents');

    mkdirSync(agentsDir, { recursive: true });
    createOrgDefaults(orgDir, options.org);

    let created = 0;
    let refreshed = 0;
    let skipped = 0;

    for (const agent of STARTER_AGENTS) {
      const agentDir = join(agentsDir, agent.name);
      const existed = existsSync(agentDir);
      if (existed && !options.force) {
        skipped += 1;
      } else {
        mkdirSync(agentDir, { recursive: true });
        mkdirSync(join(agentDir, 'memory'), { recursive: true });
        mkdirSync(join(agentDir, '.claude', 'skills'), { recursive: true });

        if (!existed) {
          const templateDir = findTemplateDir(projectRoot, agent.template);
          if (templateDir) copyTemplateFiles(templateDir, agentDir, agent.name, options.org);
          created += 1;
        } else {
          refreshed += 1;
        }

        writeStarterIdentity(agentDir, agent);
        writeStarterGoals(agentDir, agent);
        writeStarterConfig(agentDir, agent, options.org);
        ensureAgentEnv(agentDir, agent.name);
      }

      ensureStateDirs(ctxRoot, agent.name);
    }

    updateOrgContext(orgDir, options.org);
    registerEnabledAgents(ctxRoot, options.org);

    console.log(`\n${PRODUCT_NAME} starter agents ready`);
    console.log(`  Org: ${options.org}`);
    console.log(`  Project: ${projectRoot}`);
    console.log(`  State: ${ctxRoot}`);
    console.log(`  Created: ${created}`);
    console.log(`  Refreshed: ${refreshed}`);
    console.log(`  Already existed: ${skipped}`);
    console.log('\n  Roster:');
    for (const agent of STARTER_AGENTS) {
      console.log(`    - ${agent.displayName} (${agent.name})`);
    }
    console.log(`\n  Next: ${CLI_NAME} start executive-assistant --instance ${options.instance}`);
  });

function createOrgDefaults(orgDir: string, org: string): void {
  const contextPath = join(orgDir, 'context.json');
  if (!existsSync(contextPath)) {
    writeFileSync(contextPath, JSON.stringify({
      name: org,
      description: 'ElevateOS starter real estate operating system.',
      industry: 'real-estate',
      icp: '',
      value_prop: '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      orchestrator: 'executive-assistant',
      day_mode_start: '08:00',
      day_mode_end: '00:00',
      default_approval_categories: ['external-comms', 'financial', 'deployment', 'data-deletion'],
      communication_style: 'direct and casual',
    }, null, 2) + '\n', 'utf-8');
  }

  const goalsPath = join(orgDir, 'goals.json');
  if (!existsSync(goalsPath)) {
    writeFileSync(goalsPath, JSON.stringify({
      north_star: '',
      daily_focus: '',
      daily_focus_set_at: '',
      goals: [],
      bottleneck: '',
      updated_at: '',
    }, null, 2) + '\n', 'utf-8');
  }

  const knowledgePath = join(orgDir, 'knowledge.md');
  if (!existsSync(knowledgePath)) {
    writeFileSync(knowledgePath, `# ${org} - Shared Knowledge\n\nShared facts, metrics, and corrections for all agents.\n`, 'utf-8');
  }

  const secretsPath = join(orgDir, 'secrets.env');
  if (!existsSync(secretsPath)) {
    writeFileSync(secretsPath, [
      `# ${PRODUCT_NAME} secrets for ${org}`,
      '# Optional Telegram settings. The dashboard can talk to agents without Telegram.',
      'BOT_TOKEN=',
      'CHAT_ID=',
      'ACTIVITY_CHAT_ID=',
      '',
    ].join('\n'), 'utf-8');
    try { chmodSync(secretsPath, 0o600); } catch { /* ignore on Windows */ }
  }
}

function updateOrgContext(orgDir: string, org: string): void {
  const contextPath = join(orgDir, 'context.json');
  let context: OrgContext = {};
  try {
    context = JSON.parse(readFileSync(contextPath, 'utf-8')) as OrgContext;
  } catch {
    context = {};
  }

  context.name = context.name || org;
  context.industry = context.industry || 'real-estate';
  context.orchestrator = 'executive-assistant';
  context.timezone = context.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  context.day_mode_start = context.day_mode_start || '08:00';
  context.day_mode_end = context.day_mode_end || '00:00';
  context.communication_style = context.communication_style || 'direct and casual';
  context.default_approval_categories = context.default_approval_categories || ['external-comms', 'financial', 'deployment', 'data-deletion'];

  writeFileSync(contextPath, JSON.stringify(context, null, 2) + '\n', 'utf-8');
}

function findTemplateDir(projectRoot: string, template: string): string | null {
  const candidates = [
    join(projectRoot, 'templates', template),
    join(__dirname, '..', '..', 'templates', template),
    join(projectRoot, 'node_modules', 'elevateos', 'templates', template),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function copyTemplateFiles(templateDir: string, agentDir: string, name: string, org: string): void {
  for (const file of readdirSync(templateDir)) {
    if (file === 'CLAUDE.md' || file === 'claude.md') continue;
    const srcPath = join(templateDir, file);
    const destPath = join(agentDir, file);
    try {
      const stat = require('fs').statSync(srcPath);
      if (stat.isDirectory()) {
        if (file === 'node_modules') continue;
        mkdirSync(destPath, { recursive: true });
        copyTemplateFiles(srcPath, destPath, name, org);
      } else if (stat.isFile()) {
        let content = readFileSync(srcPath, 'utf-8');
        content = content.replace(/\{\{agent_name\}\}/g, name);
        content = content.replace(/\{\{org\}\}/g, org);
        content = content.replace(/\{\{current_timestamp\}\}/g, new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
        writeFileSync(destPath, content, 'utf-8');
      }
    } catch {
      // Skip unreadable template files.
    }
  }
}

function writeStarterIdentity(agentDir: string, agent: StarterAgent): void {
  writeFileSync(join(agentDir, 'IDENTITY.md'), [
    '# Agent Identity',
    '',
    '## Name',
    agent.displayName,
    '',
    '## Role',
    agent.role,
    '',
    '## Emoji',
    agent.emoji,
    '',
    '## Vibe',
    agent.vibe,
    '',
    '## Focus',
    agent.focus,
    '',
    '## Work Style',
    ...agent.workStyle.map((item) => `- ${item}`),
    '',
  ].join('\n'), 'utf-8');
}

function writeStarterGoals(agentDir: string, agent: StarterAgent): void {
  writeFileSync(join(agentDir, 'goals.json'), JSON.stringify({
    focus: agent.focus,
    goals: [],
    bottleneck: '',
    updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    updated_by: 'seed-agents',
  }, null, 2) + '\n', 'utf-8');
}

function writeStarterConfig(agentDir: string, agent: StarterAgent, org: string): void {
  const configPath = join(agentDir, 'config.json');
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      config = {};
    }
  }

  const isOrchestrator = agent.template === 'orchestrator';
  config.agent_name = agent.name;
  config.display_name = agent.displayName;
  config.role = agent.role;
  config.org = org;
  config.enabled = true;
  config.startup_delay = typeof config.startup_delay === 'number' ? config.startup_delay : 0;
  config.max_session_seconds = typeof config.max_session_seconds === 'number' ? config.max_session_seconds : 255600;
  config.max_crashes_per_day = typeof config.max_crashes_per_day === 'number' ? config.max_crashes_per_day : 10;
  config.orchestration = {
    tier: isOrchestrator ? 'primary' : 'specialist',
    reports_to: isOrchestrator ? null : 'executive-assistant',
    lane: agent.displayName,
  };

  if (!Array.isArray(config.crons)) {
    config.crons = [{
      name: 'heartbeat',
      type: 'recurring',
      interval: isOrchestrator ? '2h' : '4h',
      prompt: isOrchestrator
        ? 'Read HEARTBEAT.md, check inbox, review task/approval health, and coordinate the specialist agents.'
        : 'Read HEARTBEAT.md, check inbox, update heartbeat, and work on the highest priority assigned task.',
    }];
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

function ensureAgentEnv(agentDir: string, name: string): void {
  const envPath = join(agentDir, '.env');
  if (existsSync(envPath)) return;
  writeFileSync(envPath, [
    `# Agent environment for ${name}`,
    '# Telegram is optional. Dashboard Comms can talk to this agent locally.',
    'BOT_TOKEN=',
    'CHAT_ID=',
    '',
    'CLAUDE_CODE_DISABLE_1M_CONTEXT=true',
    '',
  ].join('\n'), 'utf-8');
  try { chmodSync(envPath, 0o600); } catch { /* ignore on Windows */ }
}

function ensureStateDirs(ctxRoot: string, agentName: string): void {
  for (const dir of ['inbox', 'outbox', 'processed', 'inflight', 'logs', 'state']) {
    mkdirSync(join(ctxRoot, dir, agentName), { recursive: true });
  }
}

function registerEnabledAgents(ctxRoot: string, org: string): void {
  const configDir = join(ctxRoot, 'config');
  mkdirSync(configDir, { recursive: true });
  const enabledPath = join(configDir, 'enabled-agents.json');

  let enabledAgents: Record<string, Record<string, unknown>> = {};
  if (existsSync(enabledPath)) {
    try {
      enabledAgents = JSON.parse(readFileSync(enabledPath, 'utf-8')) as Record<string, Record<string, unknown>>;
    } catch {
      enabledAgents = {};
    }
  }

  for (const agent of STARTER_AGENTS) {
    enabledAgents[agent.name] = {
      ...(enabledAgents[agent.name] || {}),
      enabled: true,
      status: 'configured',
      org,
      template: agent.template,
      display_name: agent.displayName,
      role: agent.role,
      orchestration: agent.template === 'orchestrator' ? 'primary' : 'specialist',
      reports_to: agent.template === 'orchestrator' ? null : 'executive-assistant',
      seeded_at: enabledAgents[agent.name]?.seeded_at || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
  }

  writeFileSync(enabledPath, JSON.stringify(enabledAgents, null, 2) + '\n', 'utf-8');
}
