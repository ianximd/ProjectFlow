import { timingSafeEqual } from 'node:crypto';

/**
 * Trusted server-to-server (BFF) caller check. The Next.js server sends the
 * shared secret in the X-BFF-Secret header so we can safely return the rotating
 * refresh token in the response body. Browsers never set this header and never
 * receive the token. Disabled (always false) unless BFF_SECRET is configured.
 *
 * `null` is accepted in the signature for testing convenience; at real call
 * sites Hono's c.req.header() returns string | undefined.
 */
export function isTrustedBff(headerValue: string | undefined | null): boolean {
  const expected = process.env.BFF_SECRET;
  if (!expected || !headerValue) return false;
  // A length mismatch can't be equal. Leaking length is acceptable for a long
  // random secret and is required because timingSafeEqual throws on
  // unequal-length buffers.
  if (headerValue.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(headerValue), Buffer.from(expected));
}
