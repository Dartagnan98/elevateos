import { getCTXRoot, getFrameworkRoot, getOrgs } from '@/lib/config';
import { KnowledgeBaseClient } from '@/components/knowledge-base/kb-client';
import { getActiveOrgName } from '@/lib/realestate/org-config';
import fs from 'fs';
import path from 'path';

function getKnowledgePath(org: string): string {
  const statePath = path.join(getCTXRoot(), 'orgs', org, 'knowledge.md');
  const frameworkPath = path.join(getFrameworkRoot(), 'orgs', org, 'knowledge.md');
  if (fs.existsSync(statePath)) return statePath;
  if (fs.existsSync(frameworkPath)) return frameworkPath;
  return statePath;
}

function getKnowledgeContent(filePath: string): string {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
  } catch {
    // graceful fallback
  }
  return '';
}

export const dynamic = 'force-dynamic';

export default function KnowledgeBasePage() {
  const orgs = getOrgs();
  const org = orgs[0] ?? getActiveOrgName();
  const kbPath = getKnowledgePath(org);
  const content = getKnowledgeContent(kbPath);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Knowledge Base</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Search, browse, and manage your organization&apos;s shared knowledge. Powered by multimodal RAG.
        </p>
      </div>

      <KnowledgeBaseClient
        org={org}
        markdownContent={content}
        filePath={kbPath}
      />
    </div>
  );
}
