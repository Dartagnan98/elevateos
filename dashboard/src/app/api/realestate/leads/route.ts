import { NextResponse } from 'next/server';
import { getLeadsWithLastMessage } from '@/lib/realestate/messages-db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const result = await getLeadsWithLastMessage();
  if (result.kind === 'no-db') {
    return NextResponse.json({ ok: false, reason: 'no-db' }, { status: 200 });
  }
  if (result.kind === 'error') {
    return NextResponse.json({ ok: false, reason: 'error', message: result.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, rows: result.rows });
}
