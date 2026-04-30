import { LeadTable } from '@/components/elevateos/lead-table';
import { getLeadsWithLastMessage } from '@/lib/realestate/messages-db';

// Force runtime rendering — adapter opens sqlite at request time and the
// db doesn't exist on the build machine.
export const dynamic = 'force-dynamic';

export default async function LeadsPage() {
  const result = await getLeadsWithLastMessage();

  if (result.kind === 'no-db') {
    return (
      <div className="p-6 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Lofty data isn&apos;t connected yet. Set <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">data_roots.messages_db</code> in
          {' '}<code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">orgs/elevation/config.json</code> and reload.
        </p>
      </div>
    );
  }

  if (result.kind === 'error') {
    return (
      <div className="p-6 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
        <p className="mt-3 text-sm text-destructive">
          Couldn&apos;t read messages.db: {result.message}
        </p>
      </div>
    );
  }

  return <LeadTable rows={result.rows} />;
}
