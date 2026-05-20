'use server';
import { cookies } from 'next/headers';
import { requireSession } from '../session';
import { COOKIE } from '../cookies';

const API_BASE =
  process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function runGraphql(
  query: string,
  variables: Record<string, unknown>,
  tokenOverride?: string,
): Promise<{ status: number; ms: number; body: unknown }> {
  await requireSession();
  const token = tokenOverride ?? (await cookies()).get(COOKIE.access)?.value;
  const t0 = Date.now();
  const res = await fetch(`${API_BASE}/api/v1/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });
  return { status: res.status, ms: Date.now() - t0, body: await res.json().catch(() => ({})) };
}
