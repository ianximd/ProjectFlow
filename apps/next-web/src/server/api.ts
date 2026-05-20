import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE } from './cookies';

const API_BASE =
  process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * Server-to-server fetch to the API, carrying the access token from the session
 * cookie. `path` is the part AFTER `/api/v1` (e.g. `/projects?workspaceId=x`).
 * Returns the unwrapped `data` field. Throws on non-OK; redirects to /login on 401.
 */
export async function serverFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  // Guard against a missing leading slash silently producing `/api/v1projects`.
  if (!path.startsWith('/')) throw new Error(`serverFetch: path must start with "/" (got "${path}")`);
  const token = (await cookies()).get(COOKIE.access)?.value;
  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (res.status === 401) redirect('/login');
  if (res.status === 204) return undefined as T;

  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { message?: string } };
  if (!res.ok) throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
  return json.data as T;
}
