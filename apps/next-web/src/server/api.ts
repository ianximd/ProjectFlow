// apps/next-web/src/server/api.ts
import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE } from './cookies';

const API_BASE =
  process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Envelope<T> { data?: T; meta?: Record<string, unknown>; error?: { message?: string }; }

async function call<T>(path: string, init: RequestInit): Promise<{ envelope: Envelope<T>; status: number }> {
  if (!path.startsWith('/')) throw new Error(`serverFetch: path must start with "/" (got "${path}")`);
  const token = (await cookies()).get(COOKIE.access)?.value;
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    ...init,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }), // let fetch set multipart boundary
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (res.status === 401) redirect('/login');
  if (res.status === 204) return { envelope: {}, status: 204 };
  const envelope = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (!res.ok) throw new Error(envelope?.error?.message ?? `Request failed (${res.status})`);
  return { envelope, status: res.status };
}

/** Returns the unwrapped `data` field. `path` is the part AFTER `/api/v1`. */
export async function serverFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const { envelope } = await call<T>(path, init);
  return envelope.data as T;
}

/** Returns the full `{ data, meta }` for endpoints that carry data in `meta`. */
export async function serverFetchEnvelope<T = unknown, M = Record<string, unknown>>(
  path: string, init: RequestInit = {},
): Promise<{ data: T; meta: M }> {
  const { envelope } = await call<T>(path, init);
  return { data: envelope.data as T, meta: (envelope.meta ?? {}) as M };
}
