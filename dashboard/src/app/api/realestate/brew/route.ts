import { NextRequest, NextResponse } from 'next/server';
import { getLatestBrew, getBrewByDate, getBrewHistory } from '@/lib/realestate/brew-reader';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date');
  const history = req.nextUrl.searchParams.get('history');

  if (history) {
    const limit = Math.max(1, Math.min(60, parseInt(history, 10) || 14));
    const result = getBrewHistory(limit);
    if (result.kind === 'no-data') {
      return NextResponse.json({ ok: false, reason: 'no-data' }, { status: 200 });
    }
    if (result.kind === 'error') {
      return NextResponse.json({ ok: false, reason: 'error', message: result.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, brews: result.data });
  }

  const result = date ? getBrewByDate(date) : getLatestBrew();
  if (result.kind === 'no-data') {
    return NextResponse.json({ ok: false, reason: 'no-data' }, { status: 200 });
  }
  if (result.kind === 'error') {
    return NextResponse.json({ ok: false, reason: 'error', message: result.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, brew: result.data });
}
