import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { sendElevateChat } from '@/lib/elevate-gateway-client';

export const dynamic = 'force-dynamic';

function cleanOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json() as Record<string, unknown>;
    const message = cleanOptionalString(body.message);
    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }
    if (message.length > 20_000) {
      return NextResponse.json({ error: 'message is too large' }, { status: 413 });
    }

    const result = await sendElevateChat({
      message,
      sessionId: cleanOptionalString(body.sessionId),
      systemPrompt: cleanOptionalString(body.systemPrompt),
      model: cleanOptionalString(body.model),
      temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Elevate gateway request failed',
    }, { status: 502 });
  }
}
