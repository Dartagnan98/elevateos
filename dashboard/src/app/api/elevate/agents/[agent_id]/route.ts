import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { updateElevateAgent } from '@/lib/elevate-gateway-client';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ agent_id: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { agent_id: rawAgentId } = await params;
  const agentId = decodeURIComponent(rawAgentId);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const agent = await updateElevateAgent(agentId, body);
    return NextResponse.json({ ok: true, agent });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Elevate agent update failed',
    }, { status: 502 });
  }
}
