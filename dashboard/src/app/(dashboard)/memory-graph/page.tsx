import { getOrgs } from '@/lib/config';
import { getActiveOrgName } from '@/lib/realestate/org-config';
import { MemoryGraphClient } from '@/components/memory-graph/memory-graph-client';

export const dynamic = 'force-dynamic';

export default function MemoryGraphPage() {
  const orgs = getOrgs();
  const org = orgs[0] ?? getActiveOrgName();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 border-b pb-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="size-2 rounded-full bg-success" />
          Elevate Agent Memory
        </div>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Memory Graph</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Explore local facts, entities, sessions, embeddings, and knowledge collections as a connected graph.
            </p>
          </div>
          <div className="text-xs text-muted-foreground">Org: {org}</div>
        </div>
      </div>

      <MemoryGraphClient initialOrg={org} />
    </div>
  );
}
