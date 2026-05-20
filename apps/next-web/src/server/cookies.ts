import 'server-only';
import { cookies } from 'next/headers';

export const COOKIE = {
  access: 'pf_at',
  refresh: 'pf_rt',
  selection: 'pf_sel',
} as const;

const isProd = process.env.NODE_ENV === 'production';

export const COOKIE_BASE = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax',
  path: '/',
} as const;

export const ACCESS_MAX_AGE = 15 * 60;            // ~JWT_EXPIRES_IN default (15m)
export const REFRESH_MAX_AGE = 7 * 24 * 60 * 60;  // 7 days
export const SELECTION_MAX_AGE = 180 * 24 * 60 * 60;

export async function setSessionCookies(accessToken: string, refreshToken: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE.access, accessToken, { ...COOKIE_BASE, maxAge: ACCESS_MAX_AGE });
  jar.set(COOKIE.refresh, refreshToken, { ...COOKIE_BASE, maxAge: REFRESH_MAX_AGE });
}

export async function clearSessionCookies(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE.access);
  jar.delete(COOKIE.refresh);
  jar.delete(COOKIE.selection);
}
