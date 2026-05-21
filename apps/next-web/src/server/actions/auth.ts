'use server';
import { redirect } from 'next/navigation';
import { getSession, requireSession } from '../session';
import { setSessionCookies, clearSessionCookies } from '../cookies';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';

const API_BASE =
  process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const BFF_SECRET = process.env.BFF_SECRET ?? '';

function bffHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-BFF-Secret': BFF_SECRET };
}

// Auth is cookie-only (Phase 3): the action sets httpOnly pf_at/pf_rt via
// setSessionCookies; the client never sees the token, it just navigates on ok.
export type LoginResult =
  | { ok: true }
  | { ok: false; mfaRequired: true; mfaToken: string }
  | { ok: false; error: string };

export async function login(email: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: 'POST', headers: bffHeaders(), body: JSON.stringify({ email, password }), cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: json?.error?.message ?? 'Login failed' };
  const data = json.data;
  if (data?.mfaRequired) return { ok: false, mfaRequired: true, mfaToken: data.mfaToken };
  if (!data?.token || !data?.refreshToken) return { ok: false, error: 'Login failed: malformed server response' };
  await setSessionCookies(data.token, data.refreshToken);
  return { ok: true };
}

export async function mfaChallenge(
  mfaToken: string, code?: string, recoveryCode?: string,
): Promise<LoginResult> {
  const res = await fetch(`${API_BASE}/api/v1/auth/mfa/challenge`, {
    method: 'POST', headers: bffHeaders(),
    body: JSON.stringify({ mfaToken, code, recoveryCode }), cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: json?.error?.message ?? 'Verification failed' };
  if (!json.data?.token || !json.data?.refreshToken) return { ok: false, error: 'Verification failed: malformed server response' };
  await setSessionCookies(json.data.token, json.data.refreshToken);
  return { ok: true };
}

export async function register(
  email: string, name: string, password: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/auth/register`, {
    method: 'POST', headers: bffHeaders(),
    body: JSON.stringify({ email, name, password }), cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: json?.error?.message ?? 'Registration failed' };
  return { ok: true };
}

export async function logout(): Promise<void> {
  await clearSessionCookies();
  redirect('/login');
}

/** Current viewer's user id (from the access-token cookie), or null. Lets a
 *  client component derive identity without the in-memory auth store. */
export async function getCurrentUserId(): Promise<string | null> {
  const session = await getSession();
  return session?.userId ?? null;
}

/** POST /auth/change-password — profile "Change password" card. */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/auth/change-password', {
      method: 'POST',
      body:   JSON.stringify({ currentPassword, newPassword }),
    });
  } catch (e) {
    return toActionError(e);
  }
  return { ok: true };
}
