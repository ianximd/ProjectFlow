import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE, COOKIE_BASE, ACCESS_MAX_AGE, REFRESH_MAX_AGE } from '@/server/cookies';
import { decodeJwt, isJwtExpired } from '@/server/jwt';

const API_BASE =
  process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const BFF_SECRET = process.env.BFF_SECRET ?? '';

export async function POST() {
  const jar = await cookies();
  const access = jar.get(COOKIE.access)?.value;
  const refresh = jar.get(COOKIE.refresh)?.value;

  // Still-valid access token: hand it back, no rotation.
  const claims = decodeJwt(access);
  if (claims && !isJwtExpired(claims)) {
    return NextResponse.json({ data: { token: access, user: { id: claims.userId, email: claims.email } } });
  }

  if (!refresh) {
    return NextResponse.json({ error: { message: 'No session' } }, { status: 401 });
  }

  const r = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'X-BFF-Secret': BFF_SECRET, Cookie: `refresh_token=${refresh}` },
  });
  if (!r.ok) {
    const res = NextResponse.json({ error: { message: 'Refresh failed' } }, { status: 401 });
    res.cookies.delete(COOKIE.access);
    res.cookies.delete(COOKIE.refresh);
    return res;
  }
  const j = await r.json();
  const newClaims = decodeJwt(j.data.token);
  const res = NextResponse.json({
    data: { token: j.data.token, user: { id: newClaims?.userId, email: newClaims?.email } },
  });
  res.cookies.set(COOKIE.access, j.data.token, { ...COOKIE_BASE, maxAge: ACCESS_MAX_AGE });
  res.cookies.set(COOKIE.refresh, j.data.refreshToken, { ...COOKIE_BASE, maxAge: REFRESH_MAX_AGE });
  return res;
}
