/**
 * Compute the headline user-status label and badge tone from the existing
 * fields the API surfaces. Pure function; no I/O, safe to reuse anywhere
 * a list of users is rendered.
 *
 * Priority order (first match wins):
 *   1. Suspended            — `deletedAt` is set; admin has soft-deleted
 *                             this account. Overrides everything because
 *                             the user can't sign in regardless of other
 *                             flags.
 *   2. Locked               — `lockedUntil` is in the future. Triggered
 *                             by repeated failed-login attempts (the
 *                             account-lockout system in migration 0017).
 *                             Clears itself once the timestamp passes;
 *                             admins can also clear it via
 *                             POST /admin/users/:id/unlock.
 *   3. Pending Verification — email never confirmed. The user can sign
 *                             in (we don't gate on this today) but
 *                             admins probably want to know.
 *   4. Active               — the happy path.
 *
 * MFA is intentionally NOT a status — it's an orthogonal property
 * (an active user can have MFA on; a suspended user can also have had
 * MFA). The admin page renders MFA as its own badge.
 */

export type UserStatus = 'Suspended' | 'Locked' | 'Pending Verification' | 'Active';
export type StatusTone = 'red' | 'orange' | 'yellow' | 'green';

export interface UserStatusInput {
  deletedAt:       string | null;
  lockedUntil?:    string | null;
  isEmailVerified: boolean;
}

export interface UserStatusResult {
  label: UserStatus;
  tone:  StatusTone;
}

/**
 * Accepts the subset of AdminUser fields the status calculation needs.
 * `now` is injectable so unit tests can pin time without mocking Date.
 */
export function getUserStatus(u: UserStatusInput, now: Date = new Date()): UserStatusResult {
  if (u.deletedAt) {
    return { label: 'Suspended', tone: 'red' };
  }
  if (u.lockedUntil && new Date(u.lockedUntil) > now) {
    return { label: 'Locked', tone: 'orange' };
  }
  if (!u.isEmailVerified) {
    return { label: 'Pending Verification', tone: 'yellow' };
  }
  return { label: 'Active', tone: 'green' };
}
