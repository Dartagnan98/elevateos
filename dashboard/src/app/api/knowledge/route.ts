import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getCTXRoot } from '@/lib/config';
import { getActiveOrgName } from '@/lib/realestate/org-config';

export const dynamic = 'force-dynamic';

function isValidOrg(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function knowledgePath(org: string): string {
  return path.join(getCTXRoot(), 'orgs', org, 'knowledge.md');
}

export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json() as { org?: unknown; content?: unknown };
    const org = typeof body.org === 'string' && body.org.trim()
      ? body.org.trim()
      : getActiveOrgName();

    if (!isValidOrg(org)) {
      return Response.json({ error: 'Invalid org' }, { status: 400 });
    }
    if (typeof body.content !== 'string') {
      return Response.json({ error: 'content must be a string' }, { status: 400 });
    }
    if (body.content.length > 1_000_000) {
      return Response.json({ error: 'Knowledge file is too large' }, { status: 413 });
    }

    const filePath = knowledgePath(org);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, body.content, 'utf-8');
    fs.renameSync(tmpPath, filePath);

    return Response.json({ success: true, org, path: filePath });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to save knowledge file' },
      { status: 500 }
    );
  }
}

