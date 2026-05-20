export interface JwtClaims {
  userId: string;
  email?: string;
  exp?: number; // seconds since epoch
  iat?: number;
}

/** Decode (NOT verify) a JWT payload. Signature is enforced by the API on every
 *  request; here we only need the claims for an optimistic expiry check.
 *  Returns null unless the payload is an object carrying a string `userId`, so a
 *  non-null result is always a usable session claim set. */
export function decodeJwt(token: string | undefined | null): JwtClaims | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const raw = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown;
    if (typeof raw !== 'object' || raw === null) return null;
    if (typeof (raw as Record<string, unknown>).userId !== 'string') return null;
    return raw as JwtClaims;
  } catch {
    return null;
  }
}

/** True if the token is missing `exp`, or expires within `skewSeconds`. */
export function isJwtExpired(claims: JwtClaims | null, skewSeconds = 30): boolean {
  if (!claims?.exp) return true;
  return claims.exp * 1000 <= Date.now() + skewSeconds * 1000;
}
