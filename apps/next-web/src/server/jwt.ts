export interface JwtClaims {
  userId: string;
  email?: string;
  exp?: number; // seconds since epoch
  iat?: number;
}

/** Decode (NOT verify) a JWT payload. Signature is enforced by the API on every
 *  request; here we only need the claims for an optimistic expiry check. */
export function decodeJwt(token: string | undefined | null): JwtClaims | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as JwtClaims;
  } catch {
    return null;
  }
}

/** True if the token is missing `exp`, or expires within `skewSeconds`. */
export function isJwtExpired(claims: JwtClaims | null, skewSeconds = 30): boolean {
  if (!claims?.exp) return true;
  return claims.exp * 1000 <= Date.now() + skewSeconds * 1000;
}
