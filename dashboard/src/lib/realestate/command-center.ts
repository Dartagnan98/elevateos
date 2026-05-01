import { getPendingApprovals } from '@/lib/data/approvals';
import { getTasks } from '@/lib/data/tasks';
import type { Approval, Task } from '@/lib/types';
import { getLatestListingSkillRun, type ListingSkillListing } from './listing-skill-runs';
import { getLeadsWithLastMessage, type LeadRow } from './messages-db';
import { getSkillOperations, type SkillOperation } from './skill-artifacts';

export type DealRisk = 'green' | 'yellow' | 'red';

export type RealtorDealStage =
  | 'New Lead'
  | 'Qualified'
  | 'Showing'
  | 'Offer Prep'
  | 'Offer Submitted'
  | 'Accepted / In Contract'
  | 'Subject Removal'
  | 'Deposit Due'
  | 'Closing Prep'
  | 'Possession'
  | 'Closed'
  | 'Nurture';

export interface RealtorDeal {
  id: string;
  client: string;
  handle: string;
  stage: RealtorDealStage;
  sourceStage: string | null;
  owner: 'Avery' | 'Pierce' | 'Reese' | 'Marlowe';
  risk: DealRisk;
  nextAction: string;
  lastTouchAt: number | null;
  lastTouchLabel: string;
  lastMessage: string | null;
  lastInbound: boolean;
  messageCount: number;
  tags: string[];
  blocker: string | null;
}

export interface RealtorAction {
  id: string;
  label: string;
  count: number;
  href: string;
  tone: DealRisk;
  detail: string;
}

export interface RealtorQueueItem {
  id: string;
  title: string;
  owner: string;
  status: string;
  href: string;
  kind: 'approval' | 'task' | 'deadline' | 'document' | 'feedback';
  detail: string;
}

export interface RealtorCommandCenter {
  connected: boolean;
  deals: RealtorDeal[];
  stageCounts: Array<{ stage: RealtorDealStage; count: number }>;
  todayDesk: RealtorAction[];
  deadlineRadar: RealtorQueueItem[];
  listingFeedback: RealtorQueueItem[];
  skillOperations: SkillOperation[];
  adminQueue: RealtorQueueItem[];
  repliesNeeded: number;
  dealsAtRisk: number;
  pendingDeals: number;
  feedbackDue: number;
  missingDocs: number;
}

export type RealtorCommandCenterResult =
  | { kind: 'ok'; data: RealtorCommandCenter }
  | { kind: 'no-db'; data: RealtorCommandCenter }
  | { kind: 'error'; message: string; data: RealtorCommandCenter };

const STAGES: RealtorDealStage[] = [
  'New Lead',
  'Qualified',
  'Showing',
  'Offer Prep',
  'Offer Submitted',
  'Accepted / In Contract',
  'Subject Removal',
  'Deposit Due',
  'Closing Prep',
  'Possession',
  'Closed',
  'Nurture',
];

const DAY_SECONDS = 24 * 60 * 60;

function tokenize(value: string | null | undefined): string {
  return (value ?? '').toLowerCase();
}

function parseTags(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[,\n|]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function inferStage(row: LeadRow): RealtorDealStage {
  const haystack = [row.stage, row.tags, row.last_message].map(tokenize).join(' ');

  if (haystack.includes('closed') || haystack.includes('sold')) return 'Closed';
  if (haystack.includes('possession') || haystack.includes('key handoff')) return 'Possession';
  if (haystack.includes('closing') || haystack.includes('completion')) return 'Closing Prep';
  if (haystack.includes('deposit')) return 'Deposit Due';
  if (haystack.includes('subject')) return 'Subject Removal';
  if (haystack.includes('contract') || haystack.includes('accepted')) return 'Accepted / In Contract';
  if (haystack.includes('offer submitted') || haystack.includes('submitted')) return 'Offer Submitted';
  if (haystack.includes('offer') || haystack.includes('cma') || haystack.includes('pricing')) return 'Offer Prep';
  if (haystack.includes('showing') || haystack.includes('tour') || haystack.includes('viewing')) return 'Showing';
  if (haystack.includes('qualif') || haystack.includes('appointment')) return 'Qualified';
  if (haystack.includes('nurture') || haystack.includes('cold') || haystack.includes('follow')) return 'Nurture';
  if (row.is_client) return 'Qualified';
  return 'New Lead';
}

function inferOwner(stage: RealtorDealStage, row: LeadRow): RealtorDeal['owner'] {
  const haystack = [row.tags, row.stage].map(tokenize).join(' ');
  if (haystack.includes('listing') || haystack.includes('marketing')) return 'Marlowe';
  if (['Offer Prep', 'Offer Submitted', 'Accepted / In Contract', 'Subject Removal', 'Deposit Due'].includes(stage)) return 'Pierce';
  if (['Closing Prep', 'Possession', 'Closed'].includes(stage)) return 'Avery';
  return 'Reese';
}

function daysSince(unixSeconds: number | null): number | null {
  if (!unixSeconds) return null;
  return Math.max(0, Math.floor((Date.now() / 1000 - unixSeconds) / DAY_SECONDS));
}

function formatLastTouch(unixSeconds: number | null): string {
  const days = daysSince(unixSeconds);
  if (days === null) return 'No touch logged';
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function inferRisk(stage: RealtorDealStage, row: LeadRow, lastInbound: boolean): DealRisk {
  if (stage === 'Closed') return 'green';
  const days = daysSince(row.last_message_at);
  if (lastInbound) return 'red';
  if (days === null) return 'yellow';
  if (['Accepted / In Contract', 'Subject Removal', 'Deposit Due'].includes(stage) && days >= 2) return 'red';
  if (days >= 14) return 'red';
  if (days >= 5) return 'yellow';
  return 'green';
}

function nextAction(stage: RealtorDealStage, lastInbound: boolean): string {
  if (lastInbound) return 'Reply to latest inbound';
  switch (stage) {
    case 'New Lead':
      return 'Qualify motivation and timeline';
    case 'Qualified':
      return 'Book the next appointment';
    case 'Showing':
      return 'Confirm showing feedback';
    case 'Offer Prep':
      return 'Pull comps and prep offer';
    case 'Offer Submitted':
      return 'Follow offer status';
    case 'Accepted / In Contract':
      return 'Confirm subjects and compliance';
    case 'Subject Removal':
      return 'Confirm subject-removal path';
    case 'Deposit Due':
      return 'Verify deposit deadline';
    case 'Closing Prep':
      return 'Check closing checklist';
    case 'Possession':
      return 'Confirm key handoff';
    case 'Closed':
      return 'Move to referral/nurture';
    case 'Nurture':
      return 'Send value check-in';
  }
}

function blockerFor(stage: RealtorDealStage, row: LeadRow, lastInbound: boolean): string | null {
  if (lastInbound) return 'Client is waiting on a reply';
  const days = daysSince(row.last_message_at);
  if (days === null) return 'No recent touch logged';
  if (['Accepted / In Contract', 'Subject Removal', 'Deposit Due'].includes(stage) && days >= 2) {
    return 'Contract-stage touch is stale';
  }
  if (days >= 14) return 'Follow-up is stale';
  return null;
}

function leadToDeal(row: LeadRow): RealtorDeal {
  const stage = inferStage(row);
  const lastInbound = row.last_message_from_me === 0;
  const owner = inferOwner(stage, row);
  const risk = inferRisk(stage, row, lastInbound);

  return {
    id: row.handle,
    client: row.display_name ?? row.handle,
    handle: row.handle,
    stage,
    sourceStage: row.stage,
    owner,
    risk,
    nextAction: nextAction(stage, lastInbound),
    lastTouchAt: row.last_message_at,
    lastTouchLabel: formatLastTouch(row.last_message_at),
    lastMessage: row.last_message,
    lastInbound,
    messageCount: row.message_count ?? 0,
    tags: parseTags(row.tags),
    blocker: blockerFor(stage, row, lastInbound),
  };
}

function matchesTask(task: Task, patterns: RegExp[]): boolean {
  const haystack = `${task.title} ${task.description ?? ''} ${task.notes ?? ''}`.toLowerCase();
  return patterns.some((pattern) => pattern.test(haystack));
}

function taskDetail(task: Task): string {
  const owner = task.assignee ? `${task.assignee} owns this` : 'No owner assigned';
  return `${task.priority} priority - ${owner}`;
}

function approvalToQueueItem(approval: Approval): RealtorQueueItem {
  return {
    id: approval.id,
    title: approval.title,
    owner: approval.agent,
    status: approval.status,
    href: '/approvals',
    kind: 'approval',
    detail: approval.description ?? 'Waiting for a decision',
  };
}

function taskToQueueItem(task: Task, kind: RealtorQueueItem['kind'] = 'task'): RealtorQueueItem {
  return {
    id: task.id,
    title: task.title,
    owner: task.assignee ?? 'Unassigned',
    status: task.status,
    href: `/tasks?status=${encodeURIComponent(task.status)}`,
    kind,
    detail: taskDetail(task),
  };
}

function dealToFeedbackItem(deal: RealtorDeal): RealtorQueueItem {
  return {
    id: deal.id,
    title: `${deal.client} showing feedback`,
    owner: 'Reese',
    status: deal.risk === 'red' ? 'blocked' : 'open',
    href: '/deals',
    kind: 'feedback',
    detail: deal.lastInbound
      ? 'Inbound is waiting before feedback follow-up'
      : `${deal.lastTouchLabel} - collect buyer-agent feedback and update seller`,
  };
}

function listingName(listing: ListingSkillListing): string {
  return listing.address || listing.listingId || 'Listing';
}

function listingSkillItems(listings: ListingSkillListing[]): RealtorQueueItem[] {
  const items: RealtorQueueItem[] = [];

  for (const listing of listings) {
    const name = listingName(listing);
    const pendingDrafts = listing.agentDrafts.filter((draft) => (
      draft.feedbackStatus.toLowerCase() === 'pending' ||
      draft.draft.toLowerCase().includes('feedback')
    ));

    if (listing.feedbackPending > 0 || pendingDrafts.length > 0) {
      items.push({
        id: `listing-feedback-${listing.listingId || name}`,
        title: `${name} feedback follow-up`,
        owner: 'Reese',
        status: 'open',
        href: '/deals',
        kind: 'feedback',
        detail: `${Math.max(listing.feedbackPending, pendingDrafts.length)} pending from ${listing.totalShowings || listing.showings.length} showings`,
      });
    }

    if (listing.sellerDraft && listing.feedbackReceived > 0) {
      items.push({
        id: `seller-update-${listing.listingId || name}`,
        title: `${name} seller update ready`,
        owner: 'Avery',
        status: 'draft',
        href: '/deals',
        kind: 'feedback',
        detail: `${listing.feedbackReceived} feedback received${listing.avgRating ? ` - avg rating ${listing.avgRating}/5` : ''}`,
      });
    }
  }

  return items;
}

function stageCounts(deals: RealtorDeal[]) {
  return STAGES.map((stage) => ({
    stage,
    count: deals.filter((deal) => deal.stage === stage).length,
  }));
}

function riskRank(risk: DealRisk): number {
  if (risk === 'red') return 0;
  if (risk === 'yellow') return 1;
  return 2;
}

function buildDesk(args: {
  pendingApprovals: number;
  humanTasks: number;
  blockedTasks: number;
  repliesNeeded: number;
  dealsAtRisk: number;
  deadlineCount: number;
  missingDocs: number;
}): RealtorAction[] {
  const {
    pendingApprovals,
    humanTasks,
    blockedTasks,
    repliesNeeded,
    dealsAtRisk,
    deadlineCount,
    missingDocs,
  } = args;

  return [
    {
      id: 'replies',
      label: 'Replies needed',
      count: repliesNeeded,
      href: '/leads',
      tone: repliesNeeded > 0 ? 'red' : 'green',
      detail: 'Latest message came from the client',
    },
    {
      id: 'at-risk',
      label: 'Deals at risk',
      count: dealsAtRisk,
      href: '/deals',
      tone: dealsAtRisk > 0 ? 'red' : 'green',
      detail: 'Stale touch or contract-stage risk',
    },
    {
      id: 'deadlines',
      label: 'Deadline radar',
      count: deadlineCount,
      href: '/deals',
      tone: deadlineCount > 0 ? 'yellow' : 'green',
      detail: 'Subject, deposit, possession, closing',
    },
    {
      id: 'admin',
      label: 'Admin queue',
      count: pendingApprovals + humanTasks + blockedTasks + missingDocs,
      href: '/tasks',
      tone: pendingApprovals + humanTasks + blockedTasks + missingDocs > 0 ? 'yellow' : 'green',
      detail: 'Approvals, human tasks, docs, blockers',
    },
  ];
}

export async function getRealtorCommandCenter(org?: string): Promise<RealtorCommandCenterResult> {
  const [leadResult, tasks, approvals, listingSkillRun, skillOperations] = await Promise.all([
    getLeadsWithLastMessage(),
    Promise.resolve(getTasks({ org })),
    Promise.resolve(getPendingApprovals(org)),
    Promise.resolve(getLatestListingSkillRun()),
    Promise.resolve(getSkillOperations()),
  ]);

  const openTasks = tasks.filter((task) => task.status !== 'completed' && task.status !== 'cancelled');
  const humanTasks = openTasks.filter((task) => (
    task.assignee === 'human' ||
    task.assignee === 'user' ||
    task.title.startsWith('[HUMAN]') ||
    task.project === 'human-tasks'
  ));
  const blockedTasks = openTasks.filter((task) => task.status === 'blocked');
  const deadlineTasks = openTasks.filter((task) => matchesTask(task, [
    /subject/,
    /deposit/,
    /possession/,
    /closing/,
    /completion/,
    /deadline/,
    /contract/,
  ]));
  const feedbackTasks = openTasks.filter((task) => matchesTask(task, [
    /listing feedback/,
    /showing feedback/,
    /feedback request/,
    /buyer agent/,
    /buyers agent/,
    /open house/,
    /showing/,
    /tour/,
    /viewing/,
    /seller update/,
  ]));
  const documentTasks = openTasks.filter((task) => matchesTask(task, [
    /doc/,
    /signature/,
    /sign/,
    /fintrac/,
    /iir/,
    /disclosure/,
    /agreement/,
  ]));

  let deals: RealtorDeal[] = [];
  let resultKind: RealtorCommandCenterResult['kind'] = 'ok';
  let errorMessage = '';

  if (leadResult.kind === 'ok') {
    deals = leadResult.rows
      .map(leadToDeal)
      .sort((a, b) => {
        const riskDelta = riskRank(a.risk) - riskRank(b.risk);
        if (riskDelta !== 0) return riskDelta;
        return (b.lastTouchAt ?? 0) - (a.lastTouchAt ?? 0);
      });
  } else if (leadResult.kind === 'no-db') {
    resultKind = 'no-db';
  } else {
    resultKind = 'error';
    errorMessage = leadResult.message;
  }

  const repliesNeeded = deals.filter((deal) => deal.lastInbound && deal.stage !== 'Closed').length;
  const dealsAtRisk = deals.filter((deal) => deal.risk === 'red' && deal.stage !== 'Closed').length;
  const pendingDeals = deals.filter((deal) => deal.stage !== 'Closed').length;
  const feedbackDealItems = deals
    .filter((deal) => deal.stage === 'Showing')
    .slice(0, 4)
    .map(dealToFeedbackItem);
  const listingFeedback = [
    ...(listingSkillRun.kind === 'ok' ? listingSkillItems(listingSkillRun.data.listings) : []),
    ...feedbackTasks.slice(0, 6).map((task) => taskToQueueItem(task, 'feedback')),
    ...feedbackDealItems,
  ].slice(0, 8);
  const missingDocs = documentTasks.length;

  const data: RealtorCommandCenter = {
    connected: leadResult.kind === 'ok',
    deals,
    stageCounts: stageCounts(deals),
    todayDesk: buildDesk({
      pendingApprovals: approvals.length,
      humanTasks: humanTasks.length,
      blockedTasks: blockedTasks.length,
      repliesNeeded,
      dealsAtRisk,
      deadlineCount: deadlineTasks.length,
      missingDocs,
    }),
    deadlineRadar: deadlineTasks.slice(0, 6).map((task) => taskToQueueItem(task, 'deadline')),
    listingFeedback,
    skillOperations,
    adminQueue: [
      ...approvals.slice(0, 4).map(approvalToQueueItem),
      ...humanTasks.slice(0, 4).map((task) => taskToQueueItem(task, 'task')),
      ...documentTasks.slice(0, 4).map((task) => taskToQueueItem(task, 'document')),
      ...blockedTasks.slice(0, 4).map((task) => taskToQueueItem(task, 'task')),
    ].slice(0, 8),
    repliesNeeded,
    dealsAtRisk,
    pendingDeals,
    feedbackDue: listingFeedback.length,
    missingDocs,
  };

  if (resultKind === 'error') return { kind: 'error', message: errorMessage, data };
  return { kind: resultKind, data };
}

export { STAGES as REALTOR_DEAL_STAGES };
