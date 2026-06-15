import { describe, it, expect } from 'vitest';
import { generateShareToken, isLinkLive } from '../share.token.js';

describe('generateShareToken', () => {
  it('returns a 64-char URL-safe token', () => {
    expect(generateShareToken()).toMatch(/^[A-Za-z0-9_-]{64}$/);
  });
  it('is non-repeating across calls (entropy)', () => {
    const set = new Set(Array.from({ length: 1000 }, () => generateShareToken()));
    expect(set.size).toBe(1000);
  });
});

describe('isLinkLive', () => {
  const base = { revokedAt: null as string | null, expiresAt: null as string | null };
  it('valid: not revoked, no expiry', () => {
    expect(isLinkLive(base, new Date('2026-06-07T00:00:00Z'))).toBe(true);
  });
  it('revoked -> dead', () => {
    expect(isLinkLive({ ...base, revokedAt: '2026-06-06T00:00:00Z' }, new Date('2026-06-07T00:00:00Z'))).toBe(false);
  });
  it('expired -> dead', () => {
    expect(isLinkLive({ ...base, expiresAt: '2026-06-06T00:00:00Z' }, new Date('2026-06-07T00:00:00Z'))).toBe(false);
  });
  it('future expiry -> live', () => {
    expect(isLinkLive({ ...base, expiresAt: '2026-06-08T00:00:00Z' }, new Date('2026-06-07T00:00:00Z'))).toBe(true);
  });
});
