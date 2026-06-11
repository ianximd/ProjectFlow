import 'server-only';
import type { PublicFormView, SubmitFormResult } from '@projectflow/types';

const API_BASE =
  process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/** Public, sessionless render of a form by slug. Returns null when not found. */
export async function fetchPublicForm(slug: string): Promise<PublicFormView | null> {
  const res = await fetch(`${API_BASE}/api/v1/forms/public/${encodeURIComponent(slug)}`, { cache: 'no-store' });
  if (!res.ok) return null;
  const body = await res.json().catch(() => ({}));
  return (body?.data as PublicFormView) ?? null;
}

/** Public, sessionless submit. Returns the result or throws a plain Error with the API message. */
export async function submitPublicForm(
  slug: string,
  answers: Record<string, unknown>,
  readToken: string,
): Promise<SubmitFormResult> {
  const res = await fetch(`${API_BASE}/api/v1/forms/public/${encodeURIComponent(slug)}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers, readToken }),
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? `Submit failed (${res.status})`);
  return body.data as SubmitFormResult;
}
