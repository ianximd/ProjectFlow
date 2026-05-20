import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE } from './cookies';
import { decodeJwt, isJwtExpired, type JwtClaims } from './jwt';

/** Current session from the access-token cookie, or null. Deduped per render. */
export const getSession = cache(async (): Promise<JwtClaims | null> => {
  const token = (await cookies()).get(COOKIE.access)?.value;
  const claims = decodeJwt(token);
  // skew 0: the proxy already refreshed; treat a still-expired token as no session.
  if (!claims || isJwtExpired(claims, 0)) return null;
  return claims;
});

export async function requireSession(): Promise<JwtClaims> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}
