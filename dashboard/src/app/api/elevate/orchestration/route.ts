import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getElevateOrchestration } from '@/lib/elevate-gateway-client';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const orchestration = await getElevateOrchestration();
    return NextResponse.json({ ok: true, orchestration });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Elevate orchestration request failed',
    }, { status: 502 });
  }
}
