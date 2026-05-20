import { timingSafeEqual } from 'node:crypto';

/**
 * Dev-only fallback so a fresh checkout can sign in without hand-wiring the
 * shared secret into both apps. Mirrors the value shipped in next-web's
 * .env.example / .env.local. Same convention as the JWT_SECRET dev default
 * (see shared/lib/jwtSecret.ts): convenient locally, never used in production.
 */
const DEV_BFF_SECRET = 'devsecret';

/**
 * The secret the X-BFF-Secret header must match. Falls back to the well-known
 * dev secret outside production; in production a missing BFF_SECRET keeps BFF
 * trust disabled (fail-safe — refresh token stays out of the response body).
 */
function expectedBffSecret(): string | undefined {
  const configured = process.env.BFF_SECRET;
  if (configured) return configured;
  return process.env.NODE_ENV === 'production' ? undefined : DEV_BFF_SECRET;
}

/**
 * Trusted server-to-server (BFF) caller check. The Next.js server sends the
 * shared secret in the X-BFF-Secret header so we can safely return the rotating
 * refresh token in the response body. Browsers never set this header and never
 * receive the token.
 *
 * `null` is accepted in the signature for testing convenience; at real call
 * sites Hono's c.req.header() returns string | undefined.
 */
export function isTrustedBff(headerValue: string | undefined | null): boolean {
  const expected = expectedBffSecret();
  if (!expected || !headerValue) return false;
  // A length mismatch can't be equal. Leaking length is acceptable for a long
  // random secret and is required because timingSafeEqual throws on
  // unequal-length buffers.
  if (headerValue.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(headerValue), Buffer.from(expected));
}
