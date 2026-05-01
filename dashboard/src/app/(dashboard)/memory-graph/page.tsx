import { getOrgs } from '@/lib/config';
import { getActiveOrgName } from '@/lib/realestate/org-config';
import { MemoryGraphClient } from '@/components/memory-graph/memory-graph-client';

export const dynamic = 'force-dynamic';

export default function MemoryGraphPage() {
  const orgs = getOrgs();
  const org = orgs[0] ?? getActiveOrgName();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Memory Graph</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Explore local facts, entities, sessions, embeddings, and knowledge collections as a connected graph.
        </p>
      </div>

      <MemoryGraphClient initialOrg={org} />
    </div>
  );
}
