import { randomBytes } from 'node:crypto';

/** A 64-char URL-safe high-entropy token (48 random bytes -> 64 base64url chars,
 *  no padding). NOT a GUID. Stored in ShareLinks.Token (NVARCHAR(64) UNIQUE). */
export function generateShareToken(): string {
  return randomBytes(48).toString('base64url');
}

/** Validity check mirroring usp_ShareLink_Resolve's SQL predicate — a
 *  belt-and-suspenders guard after the SP lookup (the SP already filters dead
 *  links, but we re-assert in code so the contract is pinned by a unit test). */
export function isLinkLive(
  link: { revokedAt: string | null; expiresAt: string | null },
  now: Date = new Date(),
): boolean {
  if (link.revokedAt) return false;
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= now.getTime()) return false;
  return true;
}
