import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getLatestBrew } from '@/lib/realestate/brew-reader';
import {
  getOutreachApprovals,
  getOutreachDbSnapshot,
  type OutreachApprovalRow,
} from '@/lib/realestate/messages-db';
import { getOrgConfig } from '@/lib/realestate/org-config';
import { getCustomerSkillInventory } from '@/lib/realestate/customer-tools';

export const dynamic = 'force-dynamic';

type BrewDraft = {
  id: number | string | null;
  category: string;
  name: string;
  stage?: string;
  score?: number;
  context?: string;
  situation?: string;
  draft: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeDrafts(items: unknown, category: string): BrewDraft[] {
  return asArray(items).map((item, index) => {
    const contextBits = [
      asString(item.inquiry),
      asString(item.viewed),
      asString(item.context),
      asNumber(item.days_quiet) ? `${asNumber(item.days_quiet)} days quiet` : undefined,
      asString(item.last_they_said) ? `Last: ${asString(item.last_they_said)}` : undefined,
    ].filter(Boolean);

    return {
      id: asNumber(item.id) ?? asString(item.id) ?? index + 1,
      category: asString(item.category) ?? category,
      name: asString(item.name) ?? 'Unnamed lead',
      stage: asString(item.stage),
      score: asNumber(item.score),
      context: contextBits.join(' · '),
      situation: asString(item.situation),
      draft: asString(item.draft) ?? asString(item.body) ?? '',
    };
  });
}

function formatMetric(value: number | undefined | null): string {
  if (typeof value !== 'number') return '0';
  return value.toLocaleString();
}

function formatTime(value: number | null | undefined): string {
  if (!value) return '—';
  const millis = value > 1_000_000_000_000 ? value : value * 1000;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(millis));
}

function countFor(rows: Array<{ table_name: string; rows: number }> | undefined, tableName: string): number {
  return rows?.find((row) => row.table_name === tableName)?.rows ?? 0;
}

function statusCount(rows: Array<{ status: string; queued: number }> | undefined, status: string): number {
  return rows?.find((row) => row.status === status)?.queued ?? 0;
}

function sourceLabel(source: 'local' | 'remote' | undefined, configuredLabel: string | undefined): string {
  if (configuredLabel) return configuredLabel;
  if (source === 'remote') return 'Remote runtime';
  if (source === 'local') return 'Local runtime';
  return 'Not connected';
}

function DraftCard({ draft }: { draft: BrewDraft }) {
  return (
    <div className="rounded-md border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-medium">{draft.name}</h3>
            <Badge variant="secondary">{draft.category}</Badge>
            {draft.score !== undefined && <Badge variant="outline">score {draft.score}</Badge>}
          </div>
          {draft.context && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{draft.context}</p>
          )}
        </div>
        <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs tabular-nums text-muted-foreground">
          #{draft.id}
        </span>
      </div>
      {draft.situation && (
        <p className="mt-3 text-xs font-medium text-muted-foreground">{draft.situation}</p>
      )}
      {draft.draft && (
        <p className="mt-3 whitespace-pre-line rounded-md bg-muted/50 p-3 text-sm leading-relaxed">
          {draft.draft}
        </p>
      )}
    </div>
  );
}

function ApprovalCard({ approval }: { approval: OutreachApprovalRow }) {
  return (
    <div className="rounded-md border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-medium">
              {approval.recipient_name ?? approval.recipient}
            </h3>
            <Badge variant={approval.status === 'pending' ? 'default' : 'outline'}>
              {approval.status}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {approval.agent} · {approval.channel} · {formatTime(approval.created_at)}
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs tabular-nums text-muted-foreground">
          #{approval.id}
        </span>
      </div>
      {approval.inbound_text && (
        <p className="mt-3 line-clamp-2 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
          {approval.inbound_text}
        </p>
      )}
      <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">{approval.content}</p>
    </div>
  );
}

export default async function OutreachPage() {
  const cfg = getOrgConfig();
  const messagesConfig = cfg?.integrations?.messages;
  const ownerLabel = messagesConfig?.owner_agent ?? 'Outreach';
  const draftsLabel = messagesConfig?.drafts_label ?? 'Daily review';
  const [snapshotResult, approvalsResult, brewResult, skillsResult] = await Promise.all([
    getOutreachDbSnapshot(),
    getOutreachApprovals(20),
    Promise.resolve(getLatestBrew()),
    Promise.resolve(getCustomerSkillInventory()),
  ]);

  const snapshot = snapshotResult.kind === 'ok' ? snapshotResult.rows : null;
  const approvals = approvalsResult.kind === 'ok' ? approvalsResult.rows : [];
  const brew = brewResult.kind === 'ok' && isRecord(brewResult.data.json) ? brewResult.data.json : {};
  const hotLeads = normalizeDrafts(brew.hot_leads, 'Hot lead');
  const followups = normalizeDrafts(brew.followups, 'Follow-up');
  const drafts = [...hotLeads, ...followups];
  const today = snapshot?.recentDays[0];
  const pendingApprovals = statusCount(snapshot?.approvalStatus, 'pending');
  const sentApprovals = statusCount(snapshot?.approvalStatus, 'sent');
  const runtimeLabel = sourceLabel(snapshot?.source, messagesConfig?.source_label);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Outreach</h1>
          <p className="text-sm text-muted-foreground">
            {ownerLabel} · {runtimeLabel} · {brewResult.kind === 'ok' ? brewResult.data.date : 'no review'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {skillsResult.kind === 'ok' && <Badge variant="outline">{skillsResult.skills.length} tools</Badge>}
          {snapshot?.dateRange?.last_day && <Badge variant="secondary">current {snapshot.dateRange.last_day}</Badge>}
        </div>
      </div>

      {(snapshotResult.kind === 'error' || approvalsResult.kind === 'error' || brewResult.kind === 'error') && (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          {snapshotResult.kind === 'error' && <p>messages.db: {snapshotResult.message}</p>}
          {approvalsResult.kind === 'error' && <p>approvals: {approvalsResult.message}</p>}
          {brewResult.kind === 'error' && <p>daily review: {brewResult.message}</p>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card size="sm" className="rounded-md">
          <CardHeader>
            <CardDescription>Pending</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{formatMetric(pendingApprovals)}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm" className="rounded-md">
          <CardHeader>
            <CardDescription>Drafted Today</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{formatMetric(today?.drafted)}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm" className="rounded-md">
          <CardHeader>
            <CardDescription>Hot Leads</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{formatMetric(hotLeads.length)}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm" className="rounded-md">
          <CardHeader>
            <CardDescription>Follow-ups</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{formatMetric(followups.length)}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm" className="rounded-md">
          <CardHeader>
            <CardDescription>Messages</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {formatMetric(countFor(snapshot?.tableCounts, 'messages'))}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Today&apos;s Drafts</h2>
            <p className="text-sm text-muted-foreground">
              {drafts.length} from {draftsLabel.toLowerCase()} · {sentApprovals} sent in queue history
            </p>
          </div>
          <div className="grid gap-3">
            {drafts.length === 0 ? (
              <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">No review drafts found.</div>
            ) : (
              drafts.map((draft, index) => <DraftCard key={`${draft.category}-${draft.id}-${index}`} draft={draft} />)
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Approval Queue</h2>
            <p className="text-sm text-muted-foreground">{approvals.length} latest items</p>
          </div>
          <div className="grid gap-3">
            {approvals.length === 0 ? (
              <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">No approvals found.</div>
            ) : (
              approvals.map((approval) => <ApprovalCard key={approval.id} approval={approval} />)
            )}
          </div>

          <Card className="rounded-md">
            <CardHeader>
              <CardTitle>Tools</CardTitle>
              <CardDescription>
                {skillsResult.kind === 'ok' ? skillsResult.toolsRoot : 'No skill inventory'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {skillsResult.kind === 'ok' ? (
                <div className="flex flex-wrap gap-2">
                  {skillsResult.skills.map((skill) => (
                    <Badge
                      key={skill}
                      variant={skill.startsWith('outreach') ? 'default' : 'outline'}
                    >
                      {skill}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {skillsResult.kind === 'error' ? skillsResult.message : 'No skills found.'}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
