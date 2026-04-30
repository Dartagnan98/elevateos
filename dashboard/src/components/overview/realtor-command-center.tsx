import Link from 'next/link';
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBriefcase,
  IconChecklist,
  IconClock,
  IconMessageCircle,
  IconShieldCheck,
  IconSparkles,
} from '@tabler/icons-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  DealRisk,
  RealtorCommandCenter,
  RealtorDeal,
  RealtorQueueItem,
} from '@/lib/realestate/command-center';
import type { SkillOperation } from '@/lib/realestate/skill-artifacts';

function riskClasses(risk: DealRisk): string {
  if (risk === 'red') return 'border-destructive/35 bg-destructive/5 text-destructive';
  if (risk === 'yellow') return 'border-warning/35 bg-warning/10 text-foreground';
  return 'border-success/25 bg-success/5 text-foreground';
}

function riskLabel(risk: DealRisk): string {
  if (risk === 'red') return 'At risk';
  if (risk === 'yellow') return 'Watch';
  return 'Clear';
}

function DeskMetric({
  label,
  count,
  detail,
  href,
  tone,
}: {
  label: string;
  count: number;
  detail: string;
  href: string;
  tone: DealRisk;
}) {
  return (
    <Link
      href={href}
      className={`rounded-md border px-3 py-3 transition-colors hover:bg-muted/40 ${riskClasses(tone)}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide opacity-80">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{count}</p>
        </div>
        <IconArrowRight size={16} className="mt-0.5 shrink-0 opacity-70" />
      </div>
      <p className="mt-2 line-clamp-2 text-xs opacity-75">{detail}</p>
    </Link>
  );
}

function DealRow({ deal }: { deal: RealtorDeal }) {
  return (
    <Link
      href="/deals"
      className="grid gap-2 rounded-md border bg-background px-3 py-3 transition-colors hover:bg-muted/35"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-medium">{deal.client}</h3>
            <Badge variant="outline">{deal.stage}</Badge>
          </div>
          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{deal.nextAction}</p>
        </div>
        <Badge className={riskClasses(deal.risk)} variant="outline">
          {riskLabel(deal.risk)}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{deal.owner}</span>
        <span>·</span>
        <span>{deal.lastTouchLabel}</span>
        {deal.lastInbound && (
          <>
            <span>·</span>
            <span>Inbound waiting</span>
          </>
        )}
      </div>
    </Link>
  );
}

function QueueItem({ item }: { item: RealtorQueueItem }) {
  const icon = item.kind === 'approval'
    ? <IconShieldCheck size={16} />
    : item.kind === 'deadline'
    ? <IconClock size={16} />
    : item.kind === 'feedback'
    ? <IconMessageCircle size={16} />
    : <IconChecklist size={16} />;

  return (
    <Link
      href={item.href}
      className="flex items-start justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/45"
    >
      <div className="flex min-w-0 gap-3">
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.title}</p>
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.detail}</p>
        </div>
      </div>
      <Badge variant="secondary" className="shrink-0">{item.owner}</Badge>
    </Link>
  );
}

function SkillOperationRow({ operation }: { operation: SkillOperation }) {
  const badge = operation.status === 'artifact'
    ? 'Artifact'
    : operation.status === 'ready'
    ? 'Ready'
    : 'Setup';

  return (
    <Link
      href={operation.href}
      className="flex items-start justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/45"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{operation.label}</p>
          <span className="text-xs text-muted-foreground">{operation.owner}</span>
        </div>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{operation.detail}</p>
      </div>
      <Badge
        variant={operation.status === 'missing' ? 'secondary' : 'outline'}
        className="shrink-0"
      >
        {badge}
      </Badge>
    </Link>
  );
}

export function RealtorCommandCenter({ data }: { data: RealtorCommandCenter }) {
  const activeDeals = data.deals.filter((deal) => deal.stage !== 'Closed').slice(0, 5);
  const topStages = data.stageCounts.filter((stage) => stage.count > 0).slice(0, 6);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Today&apos;s Desk</h2>
          <p className="text-sm text-muted-foreground">
            Client replies, deal risk, deadlines, and admin work that can block the day.
          </p>
        </div>
        <Link href="/deals" className="inline-flex items-center gap-1 text-sm font-medium text-primary">
          Open deals <IconArrowRight size={15} />
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.todayDesk.map((item) => (
          <DeskMetric
            key={item.id}
            label={item.label}
            count={item.count}
            detail={item.detail}
            href={item.href}
            tone={item.tone}
          />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-md">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconBriefcase size={18} />
              Pending Deals
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-md bg-muted/40 px-3 py-2">
                <p className="text-xs text-muted-foreground">Open</p>
                <p className="text-xl font-semibold tabular-nums">{data.pendingDeals}</p>
              </div>
              <div className="rounded-md bg-muted/40 px-3 py-2">
                <p className="text-xs text-muted-foreground">At risk</p>
                <p className="text-xl font-semibold tabular-nums">{data.dealsAtRisk}</p>
              </div>
              <div className="rounded-md bg-muted/40 px-3 py-2">
                <p className="text-xs text-muted-foreground">Replies</p>
                <p className="text-xl font-semibold tabular-nums">{data.repliesNeeded}</p>
              </div>
            </div>

            {activeDeals.length === 0 ? (
              <div className="rounded-md border bg-background p-4 text-sm text-muted-foreground">
                No active deals found from the configured messages source yet.
              </div>
            ) : (
              <div className="grid gap-2">
                {activeDeals.map((deal) => <DealRow key={deal.id} deal={deal} />)}
              </div>
            )}

            {topStages.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {topStages.map((stage) => (
                  <Badge key={stage.stage} variant="outline">
                    {stage.stage}: {stage.count}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card className="rounded-md">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <IconAlertTriangle size={18} />
                Deadline Radar
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.deadlineRadar.length === 0 ? (
                <p className="text-sm text-muted-foreground">No deadline tasks are currently surfaced.</p>
              ) : (
                <div className="grid gap-1">
                  {data.deadlineRadar.map((item) => <QueueItem key={item.id} item={item} />)}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-md">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <IconMessageCircle size={18} />
                Listing Feedback
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.listingFeedback.length === 0 ? (
                <p className="text-sm text-muted-foreground">No showing feedback follow-ups are currently surfaced.</p>
              ) : (
                <div className="grid gap-1">
                  {data.listingFeedback.slice(0, 4).map((item) => (
                    <QueueItem key={`${item.kind}-${item.id}`} item={item} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-md">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <IconSparkles size={18} />
                Skill Operations
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.skillOperations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No customer skill root is configured yet.</p>
              ) : (
                <div className="grid gap-1">
                  {data.skillOperations.map((operation) => (
                    <SkillOperationRow key={operation.id} operation={operation} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-md">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <IconMessageCircle size={18} />
                Admin Queue
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.adminQueue.length === 0 ? (
                <p className="text-sm text-muted-foreground">Approvals, docs, and human tasks are clear.</p>
              ) : (
                <div className="grid gap-1">
                  {data.adminQueue.map((item) => <QueueItem key={`${item.kind}-${item.id}`} item={item} />)}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
