'use client';

import {
  IconBolt,
  IconCode,
  IconPlugConnected,
  IconRoute,
  IconTerminal2,
} from '@tabler/icons-react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { AgentToolSettings } from '@/lib/types';
import type { RuntimeToolsSnapshot } from '@/lib/types';

interface ToolsTabProps {
  toolsRaw: string;
  toolSettings: AgentToolSettings;
  runtimeTools?: RuntimeToolsSnapshot | null;
}

interface ToolRow {
  name: string;
  description: string;
}

interface ToolSection {
  title: string;
  rows: ToolRow[];
}

function cleanCell(cell: string): string {
  return cell
    .trim()
    .replace(/^`|`$/g, '')
    .replace(/\\\|/g, '|');
}

function isDividerRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parseToolSections(markdown: string): ToolSection[] {
  const sections = new Map<string, ToolRow[]>();
  let currentTitle = 'Tools';
  let pendingHeader: string[] | null = null;

  for (const line of markdown.split('\n')) {
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    if (heading) {
      currentTitle = heading[2].replace(/\s+—.*$/, '').trim();
      pendingHeader = null;
      continue;
    }

    if (!line.trim().startsWith('|')) {
      pendingHeader = null;
      continue;
    }

    const cells = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(cleanCell);

    if (cells.length < 2) continue;
    if (isDividerRow(cells)) continue;

    const first = cells[0].toLowerCase();
    const second = cells[1].toLowerCase();
    if (
      first === 'command' ||
      first === 'variable' ||
      first === 'tool' ||
      second === 'what it does' ||
      second === 'source'
    ) {
      pendingHeader = cells;
      continue;
    }

    const title = pendingHeader?.[0]?.toLowerCase() === 'variable'
      ? 'Environment Variables'
      : currentTitle;

    const rows = sections.get(title) ?? [];
    rows.push({
      name: cells[0],
      description: cells.slice(1).filter(Boolean).join(' - '),
    });
    sections.set(title, rows);
  }

  return Array.from(sections.entries()).map(([title, rows]) => ({ title, rows }));
}

function toolCategory(tool: string): 'shell' | 'file' | 'web' | 'other' {
  if (tool === 'Bash') return 'shell';
  if (['Read', 'Edit', 'Write'].includes(tool)) return 'file';
  if (tool.startsWith('Web')) return 'web';
  return 'other';
}

function runtimeToolVariant(tool: string): 'default' | 'secondary' | 'outline' {
  if (tool === 'terminal' || tool === 'code_execution') return 'default';
  if (tool === 'file' || tool === 'delegation' || tool === 'github') return 'secondary';
  return 'outline';
}

function platformTitle(platform: string): string {
  if (platform === 'api_server') return 'API Server';
  if (platform === 'telegram') return 'Telegram';
  return platform.replace(/_/g, ' ');
}

function probeTitle(probe: string): string {
  if (probe === 'code_patch') return 'Code Patch';
  if (probe === 'skill_run') return 'Skill Run';
  if (probe === 'scheduled_task') return 'Scheduled Task';
  return probe.replace(/_/g, ' ');
}

export function ToolsTab({ toolsRaw, toolSettings, runtimeTools }: ToolsTabProps) {
  const sections = parseToolSections(toolsRaw);
  const runtimePlatforms = ['api_server', 'telegram']
    .map((name) => ({ name, tools: runtimeTools?.platforms?.[name] }))
    .filter((item) => item.tools);
  const codingProfile = runtimeTools?.focused_auto?.profiles?.['coding-edit'];
  const runtimeDecision = runtimeTools?.focused_auto?.decision
    ?? runtimeTools?.focused_auto?.latest_decision;
  const runtimeDecisionLabel = runtimeTools?.focused_auto?.decision ? 'Current Probe' : 'Latest Turn';
  const routerProbes = Object.entries(runtimeTools?.focused_auto?.router_probes ?? {});

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <IconTerminal2 size={16} />
              Gateway Runtime Tools
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {runtimePlatforms.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                Runtime tool snapshot unavailable.
              </div>
            ) : (
              <div className="space-y-3">
                {runtimePlatforms.map(({ name, tools }) => (
                  <div key={name} className="rounded-md border p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        {platformTitle(name)}
                      </div>
                      <Badge variant="outline">
                        {tools?.resolved_toolsets.length ?? 0}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(tools?.resolved_toolsets ?? []).map((tool) => (
                        <Badge key={`${name}-${tool}`} variant={runtimeToolVariant(tool)}>
                          {tool}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
                {codingProfile && (
                  <div className="rounded-md border p-3">
                    <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                      Code Task Profile
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {codingProfile.effective_toolsets.map((tool) => (
                        <Badge key={`coding-${tool}`} variant={runtimeToolVariant(tool)}>
                          {tool}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <IconRoute size={16} />
              Runtime Brain
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {runtimeDecision ? (
              <div className="rounded-md border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs font-medium uppercase text-muted-foreground">
                    {runtimeDecisionLabel}
                  </div>
                  <Badge variant="default">{runtimeDecision.selected_profile}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {runtimeDecision.reason}
                </div>
                {runtimeDecision.matched_keywords.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {runtimeDecision.matched_keywords.map((keyword) => (
                      <Badge key={keyword} variant="outline">
                        {keyword}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                No live message probe selected.
              </div>
            )}

            {routerProbes.length > 0 ? (
              <div className="space-y-2">
                {routerProbes.map(([probe, decision]) => (
                  <div key={probe} className="rounded-md border p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        {probeTitle(probe)}
                      </div>
                      <Badge variant={decision.selected_profile === 'coding-edit' ? 'default' : 'secondary'}>
                        {decision.selected_profile}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {decision.selected_toolsets.map((tool) => (
                        <Badge key={`${probe}-${tool}`} variant={runtimeToolVariant(tool)}>
                          {tool}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <IconPlugConnected size={16} />
              Agent Tool Access
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {toolSettings.allow.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                No allowed tools found in this agent's tool settings.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {toolSettings.allow.map((tool) => (
                  <Badge
                    key={tool}
                    variant={toolCategory(tool) === 'shell' ? 'default' : 'secondary'}
                  >
                    {tool}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <IconBolt size={16} />
              Runtime Hooks
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {toolSettings.statusLine?.command && (
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="text-xs font-medium uppercase text-muted-foreground">
                  Status Line
                </div>
                <code className="mt-1 block break-words text-xs">
                  {toolSettings.statusLine.command}
                </code>
              </div>
            )}

            {toolSettings.hooks.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                No hooks configured.
              </div>
            ) : (
              <div className="space-y-2">
                {toolSettings.hooks.map((hook, index) => (
                  <div key={`${hook.event}-${index}`} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{hook.event}</Badge>
                      {hook.matcher && (
                        <span className="text-xs text-muted-foreground">
                          {hook.matcher}
                        </span>
                      )}
                      {hook.timeout !== undefined && (
                        <span className="text-xs text-muted-foreground">
                          {hook.timeout}s
                        </span>
                      )}
                    </div>
                    <code className="mt-2 block break-words text-xs">
                      {hook.command}
                    </code>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <IconTerminal2 size={16} />
            Agent Command Reference
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sections.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              No TOOLS.md reference found for this agent.
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {sections.map((section) => (
                <section key={section.title} className="rounded-md border">
                  <div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-2">
                    <IconCode size={14} className="text-muted-foreground" />
                    <h3 className="text-sm font-medium">{section.title}</h3>
                    <Badge variant="secondary" className="ml-auto">
                      {section.rows.length}
                    </Badge>
                  </div>
                  <div className="divide-y">
                    {section.rows.map((row, index) => (
                      <div key={`${row.name}-${index}`} className="grid gap-1 px-3 py-2">
                        <code className="break-words text-xs">{row.name}</code>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {row.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
