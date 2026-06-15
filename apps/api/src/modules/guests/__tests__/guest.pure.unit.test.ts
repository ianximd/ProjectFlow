import { describe, it, expect } from 'vitest';
import {
  isOrgEmail, resolveInviteRole, assertGuestObjectAllowed, guestFloor,
  WORKSPACE_GUEST_ROLE, WORKSPACE_LIMITED_MEMBER_ROLE,
} from '../guest.pure.js';

describe('isOrgEmail', () => {
  it('matches the workspace verified domain case-insensitively', () => {
    expect(isOrgEmail('alice@Acme.com', 'acme.com')).toBe(true);
    expect(isOrgEmail('ALICE@ACME.COM', 'acme.com')).toBe(true);
  });
  it('is false for a different domain or no verified domain', () => {
    expect(isOrgEmail('bob@gmail.com', 'acme.com')).toBe(false);
    expect(isOrgEmail('bob@acme.com', null)).toBe(false);
  });
});

describe('resolveInviteRole (org-email promotion)', () => {
  it('promotes an org-email invite to limited member', () => {
    expect(resolveInviteRole('alice@acme.com', 'acme.com')).toBe(WORKSPACE_LIMITED_MEMBER_ROLE);
  });
  it('keeps an external invite as guest', () => {
    expect(resolveInviteRole('ext@vendor.io', 'acme.com')).toBe(WORKSPACE_GUEST_ROLE);
    expect(resolveInviteRole('ext@vendor.io', null)).toBe(WORKSPACE_GUEST_ROLE);
  });
});

describe('assertGuestObjectAllowed (reject-guest-at-Space)', () => {
  it('rejects a guest at SPACE scope', () => {
    expect(() => assertGuestObjectAllowed(WORKSPACE_GUEST_ROLE, 'SPACE')).toThrow(/space/i);
  });
  it('allows a guest at FOLDER/LIST scope', () => {
    expect(() => assertGuestObjectAllowed(WORKSPACE_GUEST_ROLE, 'FOLDER')).not.toThrow();
    expect(() => assertGuestObjectAllowed(WORKSPACE_GUEST_ROLE, 'LIST')).not.toThrow();
  });
  it('allows a LIMITED MEMBER at SPACE scope', () => {
    expect(() => assertGuestObjectAllowed(WORKSPACE_LIMITED_MEMBER_ROLE, 'SPACE')).not.toThrow();
  });
});

describe('guestFloor (no floor for guests)', () => {
  it('is null for both guest roles', () => {
    expect(guestFloor(true)).toBeNull();
    expect(guestFloor(false)).toBeNull();
  });
});
