/**
 * End-to-end OAuth callback flow against the in-process Hono app, the
 * real Redis state store, and the real SQL Server.
 *
 * The fake provider stands in for Google / GitHub / Microsoft — it lets
 * us register a deterministic identity per test and drive the full
 * /start → /callback dance without leaving the process.
 *
 * Branches covered here that the unit tests can't fully prove:
 *   - state actually round-trips through Redis (one-time consumption)
 *   - the callback sets the refresh_token cookie and 302s to /oauth/finish
 *   - replay of the same `state` returns the INVALID_STATE redirect
 *   - a previously-unseen subject creates a real Users + UserOAuthIdentities pair
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request }   from '../../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../../__tests__/fixtures/truncate.js';
import { closePool, getPool } from '../../../../shared/lib/db.js';
import {
  registerFakeIdentity,
  clearFakeIdentities,
} from '../providers/fake.js';
import { resetRegistry } from '../registry.js';

beforeEach(async () => {
  await truncateAll();
  clearFakeIdentities();
  // Force the registry to re-read env vars in case an earlier test
  // mutated them.
  resetRegistry();
});
afterAll(async () => { await closePool(); });

/**
 * Drive /start, capture the state token from the redirect URL the fake
 * provider returns, then drive /callback with a registered identity.
 * Returns the callback Response so the test can assert on cookies +
 * status + Location header.
 */
async function driveOAuthFlow(opts: {
  identityCode:  string;
  identity:      { subject: string; email: string | null; emailVerified: boolean; name: string | null; avatarUrl: string | null };
  returnTo?:     string;
}): Promise<{ start: Response; state: string; callback: Response }> {
  registerFakeIdentity(opts.identityCode, opts.identity);

  const startQ = opts.returnTo ? `?returnTo=${encodeURIComponent(opts.returnTo)}` : '';
  const start  = await request(`/auth/oauth/fake/start${startQ}`, { redirect: 'manual' });
  expect(start.status).toBe(302);

  // The fake provider's authz URL is the callback URL with state + code.
  const authzUrl = new URL(start.headers.get('location')!);
  const state    = authzUrl.searchParams.get('state')!;
  expect(state).toBeTruthy();

  const callback = await request(
    `/auth/oauth/fake/callback?code=${opts.identityCode}&state=${state}`,
    { redirect: 'manual' },
  );

  return { start, state, callback };
}

describe('OAuth callback — happy path', () => {
  it('creates a new user + identity for an unseen subject and sets the refresh cookie', async () => {
    const { callback } = await driveOAuthFlow({
      identityCode: 'code-new',
      identity: {
        subject: 'fake-sub-100', email: 'newcomer@projectflow.test',
        emailVerified: true, name: 'Newcomer', avatarUrl: null,
      },
      returnTo: '/board',
    });

    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toMatch(/\/oauth\/finish\?returnTo=/);
    expect(callback.headers.get('set-cookie')).toMatch(/refresh_token=/);

    // Confirm the user + identity actually landed in the DB.
    const pool = await getPool();
    const u = await pool.request()
      .input('Email', 'newcomer@projectflow.test')
      .query('SELECT Id, Email, IsEmailVerified, PasswordHash FROM dbo.Users WHERE Email = @Email');
    expect(u.recordset[0]).toBeDefined();
    expect(u.recordset[0]!.IsEmailVerified).toBe(true);
    expect(u.recordset[0]!.PasswordHash).toBeNull();

    const i = await pool.request()
      .input('UserId', u.recordset[0]!.Id)
      .query('SELECT Provider, Subject FROM dbo.UserOAuthIdentities WHERE UserId = @UserId');
    expect(i.recordset[0]).toMatchObject({ Provider: 'fake', Subject: 'fake-sub-100' });
  });

  it('reuses the existing user when the same subject signs in twice', async () => {
    const identity = {
      subject: 'fake-sub-200', email: 'returning@projectflow.test',
      emailVerified: true, name: 'Returner', avatarUrl: null,
    };

    await driveOAuthFlow({ identityCode: 'code-first',  identity });
    const second = await driveOAuthFlow({ identityCode: 'code-second', identity });

    expect(second.callback.status).toBe(302);
    expect(second.callback.headers.get('set-cookie')).toMatch(/refresh_token=/);

    // Only one Users row was created.
    const pool = await getPool();
    const r = await pool.request()
      .input('Email', 'returning@projectflow.test')
      .query('SELECT COUNT(*) AS c FROM dbo.Users WHERE Email = @Email');
    expect(r.recordset[0]!.c).toBe(1);
  });
});

describe('OAuth callback — error branches', () => {
  it('redirects to /oauth/error?reason=ACCOUNT_EXISTS when email collides with a local account', async () => {
    // Pre-create a local password user with the colliding email.
    await request('/auth/register', {
      method: 'POST',
      json:   { email: 'collide@projectflow.test', name: 'Local', password: 'PasswordX1!' },
    });

    const { callback } = await driveOAuthFlow({
      identityCode: 'code-collide',
      identity: {
        subject: 'fake-sub-collide', email: 'collide@projectflow.test',
        emailVerified: true, name: 'Provider', avatarUrl: null,
      },
    });

    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toMatch(/\/oauth\/error\?reason=ACCOUNT_EXISTS/);
    expect(callback.headers.get('set-cookie') ?? '').not.toMatch(/refresh_token=/);
  });

  it('redirects to /oauth/error?reason=NO_EMAIL when the provider returns no email', async () => {
    const { callback } = await driveOAuthFlow({
      identityCode: 'code-noemail',
      identity: {
        subject: 'fake-sub-noemail', email: null,
        emailVerified: false, name: null, avatarUrl: null,
      },
    });

    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toMatch(/\/oauth\/error\?reason=NO_EMAIL/);
  });

  it('rejects a replayed state token with INVALID_STATE', async () => {
    const { state, callback: first } = await driveOAuthFlow({
      identityCode: 'code-replay',
      identity: {
        subject: 'fake-sub-replay', email: 'replay@projectflow.test',
        emailVerified: true, name: 'Replay', avatarUrl: null,
      },
    });
    expect(first.status).toBe(302); // first use succeeded

    // Replay the same state.
    const replay = await request(`/auth/oauth/fake/callback?code=code-replay&state=${state}`, {
      redirect: 'manual',
    });
    expect(replay.status).toBe(302);
    expect(replay.headers.get('location')).toMatch(/\/oauth\/error\?reason=INVALID_STATE/);
  });

  it('rejects a callback missing code or state', async () => {
    const noCode = await request('/auth/oauth/fake/callback?state=anything', { redirect: 'manual' });
    expect(noCode.status).toBe(302);
    expect(noCode.headers.get('location')).toMatch(/\/oauth\/error\?reason=INVALID_STATE/);
  });

  it('returns 404 from /start when the provider is not configured', async () => {
    const res = await request('/auth/oauth/google/start', { redirect: 'manual' });
    expect(res.status).toBe(404);
  });
});

describe('GET /auth/oauth/providers', () => {
  it('lists the test-enabled fake provider when OAUTH_TEST_PROVIDER is set', async () => {
    const res = await request('/auth/oauth/providers');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { name: string }[] };
    expect(body.data.map((p) => p.name)).toContain('fake');
  });
});
