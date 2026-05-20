import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE, COOKIE_BASE, ACCESS_MAX_AGE, REFRESH_MAX_AGE } from '@/server/cookies';
import { decodeJwt, isJwtExpired } from '@/server/jwt';
import { decideAuth } from '@/server/auth-decision';

const API_BASE =
  process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const BFF_SECRET = process.env.BFF_SECRET ?? '';

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  let access = req.cookies.get(COOKIE.access)?.value;
  const refresh = req.cookies.get(COOKIE.refresh)?.value;

  let refreshed: { token: string; refreshToken: string } | null = null;
  let cleared = false;

  // Single per-request refresh chokepoint.
  if ((!access || isJwtExpired(decodeJwt(access))) && refresh) {
    try {
      const r = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'X-BFF-Secret': BFF_SECRET, Cookie: `refresh_token=${refresh}` },
      });
      if (r.ok) {
        const j = await r.json().catch(() => null);
        if (j?.data?.token && j?.data?.refreshToken) {
          access = j.data.token;
          refreshed = { token: j.data.token, refreshToken: j.data.refreshToken };
        } else {
          // 200 but malformed body — refresh genuinely failed.
          access = undefined;
          cleared = true;
        }
      } else {
        access = undefined;
        cleared = true;
      }
    } catch {
      // API unreachable — treat as unauthenticated for THIS request only. We do
      // NOT clear cookies here: a transient outage must not delete a still-valid
      // refresh token and force re-login. The next request retries the refresh.
      access = undefined;
    }
  }

  const applyCookies = (res: NextResponse) => {
    if (refreshed) {
      res.cookies.set(COOKIE.access, refreshed.token, { ...COOKIE_BASE, maxAge: ACCESS_MAX_AGE });
      res.cookies.set(COOKIE.refresh, refreshed.refreshToken, { ...COOKIE_BASE, maxAge: REFRESH_MAX_AGE });
    }
    if (cleared) {
      res.cookies.delete(COOKIE.access);
      res.cookies.delete(COOKIE.refresh);
    }
    return res;
  };

  const isAuthed = !!access && !isJwtExpired(decodeJwt(access));
  const decision = decideAuth(pathname, isAuthed);

  if (decision === 'redirect-login') {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return applyCookies(NextResponse.redirect(url));
  }
  if (decision === 'redirect-app') {
    const url = req.nextUrl.clone();
    url.pathname = '/board';
    return applyCookies(NextResponse.redirect(url));
  }
  return applyCookies(NextResponse.next());
}

export const config = {
  // Run on pages only: skip Next internals, API routes (/api/* incl. the /api/v1
  // rewrite and /api/auth handlers), static media, and any file with an extension.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|media|.*\\.).*)'],
};
