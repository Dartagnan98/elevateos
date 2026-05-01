import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { createElevateAgent, getElevateAgents } from '@/lib/elevate-gateway-client';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const agents = await getElevateAgents();
    return NextResponse.json({ ok: true, agents });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Elevate agents request failed',
    }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const agent = await createElevateAgent(body);
    return NextResponse.json({ ok: true, agent }, { status: 201 });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Elevate agent create failed',
    }, { status: 502 });
  }
}
