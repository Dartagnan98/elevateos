import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getMessagesForHandle } from '@/lib/realestate/messages-db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const handle = req.nextUrl.searchParams.get('handle');
  if (!handle) {
    return NextResponse.json({ ok: false, reason: 'handle param required' }, { status: 400 });
  }
  const limitParam = req.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Math.max(1, Math.min(500, parseInt(limitParam, 10) || 200)) : 200;

  const result = await getMessagesForHandle(handle, limit);
  if (result.kind === 'no-db') {
    return NextResponse.json({ ok: false, reason: 'no-db' }, { status: 200 });
  }
  if (result.kind === 'error') {
    return NextResponse.json({ ok: false, reason: 'error', message: result.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, rows: result.rows });
}
