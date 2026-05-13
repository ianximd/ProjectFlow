/**
 * Priority order for getUserStatus:
 *   1. Suspended (deletedAt set)        — wins over everything
 *   2. Locked    (lockedUntil > now)    — wins over Pending/Active
 *   3. Pending Verification             — wins over Active
 *   4. Active                           — fallback
 *
 * MFA is intentionally NOT a status — verified separately in the admin
 * page via its own badge.
 */

import { describe, expect, it } from 'vitest';
import { getUserStatus } from '../userStatus';

const FIXED_NOW = new Date('2026-05-13T12:00:00Z');

describe('getUserStatus', () => {
  it('returns Active for a happy-path verified user with no locks', () => {
    expect(getUserStatus({
      deletedAt:       null,
      lockedUntil:     null,
      isEmailVerified: true,
    }, FIXED_NOW)).toEqual({ label: 'Active', tone: 'green' });
  });

  it('returns Pending Verification when isEmailVerified is false', () => {
    expect(getUserStatus({
      deletedAt:       null,
      lockedUntil:     null,
      isEmailVerified: false,
    }, FIXED_NOW)).toEqual({ label: 'Pending Verification', tone: 'yellow' });
  });

  it('returns Locked when lockedUntil is in the future', () => {
    expect(getUserStatus({
      deletedAt:       null,
      lockedUntil:     '2026-05-13T12:10:00Z', // 10 min ahead of FIXED_NOW
      isEmailVerified: true,
    }, FIXED_NOW)).toEqual({ label: 'Locked', tone: 'orange' });
  });

  it('does NOT return Locked when lockedUntil is in the past (the window expired)', () => {
    expect(getUserStatus({
      deletedAt:       null,
      lockedUntil:     '2026-05-13T11:50:00Z', // 10 min before FIXED_NOW
      isEmailVerified: true,
    }, FIXED_NOW)).toEqual({ label: 'Active', tone: 'green' });
  });

  it('returns Suspended when deletedAt is set, regardless of other fields', () => {
    expect(getUserStatus({
      deletedAt:       '2026-05-01T00:00:00Z',
      lockedUntil:     '2026-05-13T12:10:00Z', // would otherwise be Locked
      isEmailVerified: false,                  // would otherwise be Pending
    }, FIXED_NOW)).toEqual({ label: 'Suspended', tone: 'red' });
  });

  it('treats Locked as higher priority than Pending Verification', () => {
    expect(getUserStatus({
      deletedAt:       null,
      lockedUntil:     '2026-05-13T12:10:00Z',
      isEmailVerified: false,
    }, FIXED_NOW)).toEqual({ label: 'Locked', tone: 'orange' });
  });

  it('accepts a missing lockedUntil field (optional)', () => {
    expect(getUserStatus({
      deletedAt:       null,
      isEmailVerified: true,
    }, FIXED_NOW)).toEqual({ label: 'Active', tone: 'green' });
  });

  it('defaults `now` to the current wall clock when omitted', () => {
    // Just sanity — we don't pin time, but a default call must not throw
    // and must return a known shape.
    const out = getUserStatus({ deletedAt: null, isEmailVerified: true });
    expect(['Active', 'Locked', 'Pending Verification', 'Suspended']).toContain(out.label);
  });
});
