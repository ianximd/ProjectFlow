/**
 * Trusted server-to-server (BFF) caller check. The Next.js server sends the
 * shared secret in the X-BFF-Secret header so we can safely return the rotating
 * refresh token in the response body. Browsers never set this header and never
 * receive the token. Disabled (always false) unless BFF_SECRET is configured.
 */
export function isTrustedBff(headerValue: string | undefined | null): boolean {
  const expected = process.env.BFF_SECRET;
  if (!expected || !headerValue) return false;
  return headerValue === expected;
}
