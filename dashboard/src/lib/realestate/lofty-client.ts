import { getSecretsPath, parseEnvFile } from './org-config';

export type LoftyResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'no-key' }
  | { kind: 'error'; message: string; status?: number };

export interface LoftyLead {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  source?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

const LOFTY_BASE_URL = 'https://api.lofty.com';

function getLoftyKey(): string | null {
  const env = parseEnvFile(getSecretsPath());
  const key = env.LOFTY_API_KEY;
  if (!key) return null;
  return key;
}

async function loftyFetch<T>(endpoint: string, params?: URLSearchParams): Promise<LoftyResult<T>> {
  const key = getLoftyKey();
  if (!key) return { kind: 'no-key' };
  const url = `${LOFTY_BASE_URL}${endpoint}${params ? `?${params.toString()}` : ''}`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      return { kind: 'error', message: await res.text(), status: res.status };
    }
    return { kind: 'ok', data: (await res.json()) as T };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'fetch failed' };
  }
}

/**
 * Pull a page of leads from Lofty. `scrollId` paginates — pass the value
 * returned in the previous response. Schema and endpoint shape are best-effort
 * and may need adjusting once we have a real Lofty account to validate.
 */
export async function pullLeads(scrollId?: string): Promise<LoftyResult<{ leads: LoftyLead[]; scrollId?: string }>> {
  const params = new URLSearchParams();
  if (scrollId) params.set('scrollId', scrollId);
  return loftyFetch<{ leads: LoftyLead[]; scrollId?: string }>('/v1/leads', params);
}

export async function getLeadById(id: string): Promise<LoftyResult<LoftyLead>> {
  return loftyFetch<LoftyLead>(`/v1/leads/${encodeURIComponent(id)}`);
}

export async function logNote(leadId: string, text: string): Promise<LoftyResult<{ id: string }>> {
  const key = getLoftyKey();
  if (!key) return { kind: 'no-key' };
  try {
    const res = await fetch(`${LOFTY_BASE_URL}/v1/leads/${encodeURIComponent(leadId)}/notes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      return { kind: 'error', message: await res.text(), status: res.status };
    }
    return { kind: 'ok', data: (await res.json()) as { id: string } };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'fetch failed' };
  }
}
