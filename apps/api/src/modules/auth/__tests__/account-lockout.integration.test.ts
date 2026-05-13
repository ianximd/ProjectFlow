/**
 * Phase 4 Week 25 added a 5-strikes / 15-minute account lockout
 * (migration 0017 + `usp_User_RecordFailedLogin` + `usp_User_ClearLoginAttempts`).
 *
 * This file regresses the failure-counter and the locked-out check at
 * the route boundary — i.e. verifies that the SP-level lockout actually
 * propagates through AuthService.login and the /auth/login handler.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser } from '../../../__tests__/fixtures/factories.js';
import { closePool, getPool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll  (async () => { await closePool();   });

async function loginAttempt(email: string, password: string): Promise<Response> {
  return request('/auth/login', { method: 'POST', json: { email, password } });
}

describe('account lockout', () => {
  it('locks the account after 5 consecutive failed attempts', async () => {
    const u = await createTestUser({ email: 'lock@projectflow.test', password: 'CorrectPass1!' });

    // Five wrong-password attempts — each returns 401 but does NOT yet lock.
    for (let i = 0; i < 5; i++) {
      const res = await loginAttempt(u.user.Email, 'WRONG');
      expect(res.status).toBe(401);
    }

    // The 6th wrong attempt should hit the lockout — auth.service maps the
    // 'locked' result to a distinct response. Either 401 or 429 is plausible
    // depending on how the route surfaces it, but the body should signal
    // lockout, not generic invalid-credentials.
    const sixth = await loginAttempt(u.user.Email, 'WRONG');
    const body  = await sixth.text();
    expect(body.toLowerCase()).toMatch(/lock/);
    // And critically: even the CORRECT password is now rejected — the lock
    // gate runs before bcrypt verification.
    const withRightPwd = await loginAttempt(u.user.Email, u.password);
    const rightBody    = await withRightPwd.text();
    expect(rightBody.toLowerCase()).toMatch(/lock/);
  });

  it('clears LockedUntil + the failure counter on a successful login', async () => {
    const u = await createTestUser({ email: 'recover@projectflow.test', password: 'CorrectPass1!' });

    // Two wrong attempts — accumulates failure count but doesn't lock.
    await loginAttempt(u.user.Email, 'WRONG');
    await loginAttempt(u.user.Email, 'WRONG');

    // A successful login.
    const ok = await loginAttempt(u.user.Email, u.password);
    expect(ok.status).toBe(200);

    // FailedLoginCount must be back to 0. The DB is the source of truth —
    // querying it is the only way to assert this without a second
    // round-trip API endpoint.
    const pool = await getPool();
    const result = await pool.request()
      .input('Id', u.user.Id)
      .query('SELECT FailedLoginCount, LockedUntil FROM dbo.Users WHERE Id = @Id');
    expect(result.recordset[0]?.FailedLoginCount).toBe(0);
    expect(result.recordset[0]?.LockedUntil).toBeNull();
  });

  it('an expired LockedUntil is treated as not-locked', async () => {
    const u = await createTestUser({ email: 'expired@projectflow.test', password: 'CorrectPass1!' });

    // Manually stamp a LockedUntil in the past — emulates "the 15-minute
    // window has already elapsed". This is the only way to test the
    // expiry branch without sleeping in real time.
    const pool = await getPool();
    await pool.request()
      .input('Id',   u.user.Id)
      .input('Past', new Date(Date.now() - 60_000))
      .query('UPDATE dbo.Users SET LockedUntil = @Past, FailedLoginCount = 5 WHERE Id = @Id');

    const ok = await loginAttempt(u.user.Email, u.password);
    expect(ok.status).toBe(200);
  });
});
