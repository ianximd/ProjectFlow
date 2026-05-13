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

// ─── Phase 1.C: link / identities / unlink ─────────────────────────────────

describe('OAuth link flow (Phase 1.C)', () => {
  it('an authenticated user can link a new identity via /link → callback', async () => {
    // Step 1: register + login a local password user.
    await request('/auth/register', {
      method: 'POST',
      json:   { email: 'linker@projectflow.test', name: 'Linker', password: 'PasswordX1!' },
    });
    const loginRes = await request('/auth/login', {
      method: 'POST',
      json:   { email: 'linker@projectflow.test', password: 'PasswordX1!' },
    });
    const { data: { token } } = await loginRes.json();

    // Step 2: hit /link with the access token. Server stamps user id
    // into state, then redirects to the (fake) provider.
    registerFakeIdentity('code-link-1', {
      subject: 'fake-link-sub-1', email: 'linker@projectflow.test',
      emailVerified: true, name: 'Linker via OAuth', avatarUrl: null,
    });
    const start = await request('/auth/oauth/fake/link', {
      headers: { authorization: `Bearer ${token}` },
      redirect: 'manual',
    });
    expect(start.status).toBe(302);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;

    // Step 3: callback links the identity. Returns 302 to the SPA's
    // returnTo path WITHOUT setting a refresh cookie (user already
    // has one).
    const callback = await request(`/auth/oauth/fake/callback?code=code-link-1&state=${state}`, {
      redirect: 'manual',
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toMatch(/\/settings\/connected-accounts/);
    expect(callback.headers.get('set-cookie') ?? '').not.toMatch(/refresh_token=/);

    // The identity was actually written.
    const idsRes = await request('/auth/oauth/identities', {
      headers: { authorization: `Bearer ${token}` },
    });
    const ids = await idsRes.json() as { data: { provider: string; email: string | null }[] };
    expect(ids.data.map((i) => i.provider)).toContain('fake');
  });

  it('/link without a session returns 401', async () => {
    const res = await request('/auth/oauth/fake/link', { redirect: 'manual' });
    expect(res.status).toBe(401);
  });

  it('callback rejects ALREADY_LINKED when the (provider, subject) is on a different user', async () => {
    // First user: signs up via OAuth (anonymous flow).
    registerFakeIdentity('code-owner', {
      subject: 'shared-sub', email: 'owner@projectflow.test',
      emailVerified: true, name: 'Owner', avatarUrl: null,
    });
    const owner = await request('/auth/oauth/fake/start', { redirect: 'manual' });
    const ownerState = new URL(owner.headers.get('location')!).searchParams.get('state')!;
    await request(`/auth/oauth/fake/callback?code=code-owner&state=${ownerState}`, { redirect: 'manual' });

    // Second user: registered locally, then tries to link the SAME
    // (provider, subject) the first user already has.
    await request('/auth/register', {
      method: 'POST',
      json:   { email: 'second@projectflow.test', name: 'Second', password: 'PasswordX1!' },
    });
    const login = await request('/auth/login', {
      method: 'POST',
      json:   { email: 'second@projectflow.test', password: 'PasswordX1!' },
    });
    const { data: { token } } = await login.json();

    registerFakeIdentity('code-conflict', {
      subject: 'shared-sub', email: 'second@projectflow.test',
      emailVerified: true, name: 'Second', avatarUrl: null,
    });
    const start = await request('/auth/oauth/fake/link', {
      headers: { authorization: `Bearer ${token}` }, redirect: 'manual',
    });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const callback = await request(`/auth/oauth/fake/callback?code=code-conflict&state=${state}`, {
      redirect: 'manual',
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toMatch(/\/oauth\/error\?reason=ALREADY_LINKED/);
  });
});

describe('GET /auth/oauth/identities', () => {
  it('returns 401 without a session', async () => {
    const res = await request('/auth/oauth/identities');
    expect(res.status).toBe(401);
  });

  it('returns an empty array for a fresh user with no linked providers', async () => {
    await request('/auth/register', {
      method: 'POST',
      json:   { email: 'noids@projectflow.test', name: 'No IDs', password: 'PasswordX1!' },
    });
    const login = await request('/auth/login', {
      method: 'POST',
      json:   { email: 'noids@projectflow.test', password: 'PasswordX1!' },
    });
    const { data: { token } } = await login.json();

    const res = await request('/auth/oauth/identities', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});

describe('DELETE /auth/oauth/identities/:provider', () => {
  it('an OAuth-only user with no other credential is blocked from removing their last identity (409 LAST_CREDENTIAL)', async () => {
    // Sign up via OAuth — no password. The user's only credential is
    // the linked identity.
    registerFakeIdentity('code-only', {
      subject: 'only-sub', email: 'only@projectflow.test',
      emailVerified: true, name: 'Only Cred', avatarUrl: null,
    });
    const start = await request('/auth/oauth/fake/start', { redirect: 'manual' });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const cb    = await request(`/auth/oauth/fake/callback?code=code-only&state=${state}`, {
      redirect: 'manual',
    });
    // Pull the access token from the refresh cookie path.
    const cookie = cb.headers.get('set-cookie');
    expect(cookie).toMatch(/refresh_token=/);
    const refresh = /refresh_token=([^;]+)/.exec(cookie!)![1]!;
    const refreshRes = await request('/auth/refresh', {
      method:  'POST',
      headers: { cookie: `refresh_token=${refresh}` },
    });
    const { data: { token } } = await refreshRes.json();

    const del = await request('/auth/oauth/identities/fake', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.status).toBe(409);
    const body = await del.json();
    expect((body as any).error?.code).toBe('LAST_CREDENTIAL');
  });

  it('a user with a password can remove their linked identity (204)', async () => {
    // Local password user, then link a provider via auto-link path.
    await request('/auth/register', {
      method: 'POST',
      json:   { email: 'has-pwd@projectflow.test', name: 'Has Pwd', password: 'PasswordX1!' },
    });
    // The Users.IsEmailVerified is 0 by default after register, so the
    // anonymous-callback collision path would 409 ACCOUNT_EXISTS. We
    // instead use the explicit /link flow which bypasses that check.
    const login = await request('/auth/login', {
      method: 'POST',
      json:   { email: 'has-pwd@projectflow.test', password: 'PasswordX1!' },
    });
    const { data: { token } } = await login.json();

    registerFakeIdentity('code-link-pwd', {
      subject: 'pwd-link-sub', email: 'has-pwd@projectflow.test',
      emailVerified: true, name: 'Has Pwd', avatarUrl: null,
    });
    const start = await request('/auth/oauth/fake/link', {
      headers: { authorization: `Bearer ${token}` }, redirect: 'manual',
    });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    await request(`/auth/oauth/fake/callback?code=code-link-pwd&state=${state}`, { redirect: 'manual' });

    // Now disconnect — the password is the safety net.
    const del = await request('/auth/oauth/identities/fake', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.status).toBe(204);

    // /identities now empty.
    const after = await request('/auth/oauth/identities', {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await after.json() as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});

// ─── Phase 1.D — encrypted token persistence + audit log ───────────────────

describe('OAuth callback — encrypted token persistence (Phase 1.D)', () => {
  it('stores AccessTokenEnc + TokenKeyVersion on the identity row after sign-in', async () => {
    await driveOAuthFlow({
      identityCode: 'code-tok',
      identity: {
        subject: 'tok-sub', email: 'tok@projectflow.test',
        emailVerified: true, name: 'Tok', avatarUrl: null,
      },
      returnTo: '/board',
    });
    const pool = await getPool();
    const r = await pool.request()
      .input('Subject', 'tok-sub')
      .query(`
        SELECT AccessTokenEnc, RefreshTokenEnc, TokenKeyVersion
        FROM dbo.UserOAuthIdentities
        WHERE Provider = 'fake' AND Subject = @Subject
      `);
    const row = r.recordset[0];
    expect(row).toBeDefined();
    // Sealed string format: v1.<keyId>.<iv>.<tag>.<ct>
    expect(row.AccessTokenEnc).toMatch(/^v1\.test\./);
    expect(row.TokenKeyVersion).toBe('test');
    // The fake provider returns no refresh token, so this stays NULL.
    expect(row.RefreshTokenEnc).toBeNull();
  });
});

/** Poll AuditLog for up to ~2s — adminService.log() is fire-and-forget. */
async function waitForAuditEntry(criteria: {
  action: string;
  resource: string;
  resourceId: string;
}): Promise<any | null> {
  const pool = await getPool();
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const r = await pool.request()
      .input('Action',     criteria.action)
      .input('Resource',   criteria.resource)
      .input('ResourceId', criteria.resourceId)
      .query(`
        SELECT TOP 1 UserId, UserEmail, Action, Resource, ResourceId, NewValues
        FROM   dbo.AuditLog
        WHERE  Action     = @Action
           AND Resource   = @Resource
           AND ResourceId = @ResourceId
        ORDER BY CreatedAt DESC
      `);
    if (r.recordset[0]) return r.recordset[0];
    await new Promise((res) => setTimeout(res, 50));
  }
  return null;
}

describe('OAuth audit log (Phase 1.D)', () => {
  it('writes oauth.login on a successful sign-in', async () => {
    await driveOAuthFlow({
      identityCode: 'code-audit-login',
      identity: {
        subject: 'audit-login-sub', email: 'audit-login@projectflow.test',
        emailVerified: true, name: 'Audit Login', avatarUrl: null,
      },
    });
    const row = await waitForAuditEntry({
      action: 'oauth.login', resource: 'OAuth', resourceId: 'fake',
    });
    expect(row).not.toBeNull();
    expect(row.UserEmail).toBe('audit-login@projectflow.test');
  });

  it('writes oauth.link when an authenticated user links a provider', async () => {
    await request('/auth/register', {
      method: 'POST',
      json:   { email: 'audit-link@projectflow.test', name: 'Audit Link', password: 'PasswordX1!' },
    });
    const login = await request('/auth/login', {
      method: 'POST',
      json:   { email: 'audit-link@projectflow.test', password: 'PasswordX1!' },
    });
    const { data: { token } } = await login.json();

    registerFakeIdentity('code-audit-link', {
      subject: 'audit-link-sub', email: 'audit-link@projectflow.test',
      emailVerified: true, name: 'Audit Link', avatarUrl: null,
    });
    const start = await request('/auth/oauth/fake/link', {
      headers: { authorization: `Bearer ${token}` }, redirect: 'manual',
    });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    await request(`/auth/oauth/fake/callback?code=code-audit-link&state=${state}`, { redirect: 'manual' });

    const row = await waitForAuditEntry({
      action: 'oauth.link', resource: 'OAuth', resourceId: 'fake',
    });
    expect(row).not.toBeNull();
  });

  it('writes oauth.unlink when a user disconnects a provider', async () => {
    // Use the same password-user-then-link-then-unlink pattern as the
    // 204 test above so the unlink can succeed (a password is the
    // remaining credential).
    await request('/auth/register', {
      method: 'POST',
      json:   { email: 'audit-unlink@projectflow.test', name: 'Audit Unlink', password: 'PasswordX1!' },
    });
    const login = await request('/auth/login', {
      method: 'POST',
      json:   { email: 'audit-unlink@projectflow.test', password: 'PasswordX1!' },
    });
    const { data: { token } } = await login.json();

    registerFakeIdentity('code-audit-unlink', {
      subject: 'audit-unlink-sub', email: 'audit-unlink@projectflow.test',
      emailVerified: true, name: 'Audit Unlink', avatarUrl: null,
    });
    const start = await request('/auth/oauth/fake/link', {
      headers: { authorization: `Bearer ${token}` }, redirect: 'manual',
    });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    await request(`/auth/oauth/fake/callback?code=code-audit-unlink&state=${state}`, { redirect: 'manual' });

    const del = await request('/auth/oauth/identities/fake', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.status).toBe(204);

    const row = await waitForAuditEntry({
      action: 'oauth.unlink', resource: 'OAuth', resourceId: 'fake',
    });
    expect(row).not.toBeNull();
    expect(row.UserEmail).toBe('audit-unlink@projectflow.test');
  });
});

describe('OAuth callback — auto-link branch (Phase 1.C)', () => {
  it('auto-links when the local account is verified and the provider asserts verified', async () => {
    // Pre-create a verified local user. We have to flip the flag in
    // SQL directly — register sets IsEmailVerified=0 and there's no
    // public endpoint to verify in tests.
    await request('/auth/register', {
      method: 'POST',
      json:   { email: 'autolink@projectflow.test', name: 'Auto', password: 'PasswordX1!' },
    });
    const pool = await getPool();
    await pool.request()
      .input('Email', 'autolink@projectflow.test')
      .query('UPDATE dbo.Users SET IsEmailVerified = 1 WHERE Email = @Email');

    // Anonymous OAuth sign-in with the matching email.
    registerFakeIdentity('code-autolink', {
      subject: 'autolink-sub', email: 'autolink@projectflow.test',
      emailVerified: true, name: 'Auto', avatarUrl: null,
    });
    const start = await request('/auth/oauth/fake/start', { redirect: 'manual' });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const cb = await request(`/auth/oauth/fake/callback?code=code-autolink&state=${state}`, {
      redirect: 'manual',
    });

    // Should LOG IN (302 to /oauth/finish + cookie), not 302 to /oauth/error.
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toMatch(/\/oauth\/finish/);
    expect(cb.headers.get('set-cookie')).toMatch(/refresh_token=/);

    // Identity was attached to the existing user, not a new one.
    const r = await pool.request()
      .input('Email', 'autolink@projectflow.test')
      .query('SELECT COUNT(*) AS c FROM dbo.Users WHERE Email = @Email');
    expect(r.recordset[0]!.c).toBe(1);
  });
});

// ─── Phase 1.F — MFA gate ───────────────────────────────────────────────────

describe('OAuth callback — MFA gate (Phase 1.F)', () => {
  /**
   * Helper: turn MFA on for a user via direct SQL. The /mfa/setup +
   * /mfa/verify-setup flow needs a real TOTP code which requires the
   * shared secret — easier in tests to flip the column directly.
   */
  async function enableMfaFor(email: string) {
    const pool = await getPool();
    await pool.request()
      .input('Email', email)
      .query(`
        UPDATE dbo.Users
        SET MfaEnabled = 1,
            MfaSecret  = 'JBSWY3DPEHPK3PXP', -- arbitrary base32; never used in this test
            MfaEnabledAt = SYSUTCDATETIME()
        WHERE Email = @Email
      `);
  }

  it('redirects to /oauth/mfa with a token (no refresh cookie) when the linked user has MFA on', async () => {
    // Sign in once to create the identity + user.
    await driveOAuthFlow({
      identityCode: 'code-mfa-1',
      identity: {
        subject: 'mfa-sub-1', email: 'mfa-user@projectflow.test',
        emailVerified: true, name: 'Mfa User', avatarUrl: null,
      },
    });

    // Flip MFA on, then sign in again — the gate must fire.
    await enableMfaFor('mfa-user@projectflow.test');
    const { callback } = await driveOAuthFlow({
      identityCode: 'code-mfa-1',
      identity: {
        subject: 'mfa-sub-1', email: 'mfa-user@projectflow.test',
        emailVerified: true, name: 'Mfa User', avatarUrl: null,
      },
    });

    expect(callback.status).toBe(302);
    const loc = callback.headers.get('location')!;
    expect(loc).toMatch(/\/oauth\/mfa\?/);
    // The challenge JWT is in the URL.
    const url = new URL(loc);
    expect(url.searchParams.get('token')).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/); // 3-part JWT
    expect(url.searchParams.get('returnTo')).toBe('/board');
    // Critically: NO refresh cookie. The session has not been issued.
    expect(callback.headers.get('set-cookie')).toBeNull();

    const row = await waitForAuditEntry({
      action: 'oauth.mfa-required', resource: 'OAuth', resourceId: 'fake',
    });
    expect(row).not.toBeNull();
    expect(row.UserEmail).toBe('mfa-user@projectflow.test');
  });

  it('does NOT log a SECOND oauth.login when the gate fires — only oauth.mfa-required', async () => {
    // First sign-in (no MFA yet) — produces one oauth.login row.
    await driveOAuthFlow({
      identityCode: 'code-mfa-2',
      identity: {
        subject: 'mfa-sub-2', email: 'mfa-only@projectflow.test',
        emailVerified: true, name: 'Mfa Only', avatarUrl: null,
      },
    });
    await waitForAuditEntry({ action: 'oauth.login', resource: 'OAuth', resourceId: 'fake' });

    await enableMfaFor('mfa-only@projectflow.test');

    // Second sign-in (MFA on) — gate fires, no new oauth.login row.
    await driveOAuthFlow({
      identityCode: 'code-mfa-2',
      identity: {
        subject: 'mfa-sub-2', email: 'mfa-only@projectflow.test',
        emailVerified: true, name: 'Mfa Only', avatarUrl: null,
      },
    });
    await waitForAuditEntry({ action: 'oauth.mfa-required', resource: 'OAuth', resourceId: 'fake' });

    const pool = await getPool();
    const r = await pool.request()
      .input('Action', 'oauth.login')
      .input('Email', 'mfa-only@projectflow.test')
      .query(`
        SELECT COUNT(*) AS c FROM dbo.AuditLog
        WHERE Action = @Action AND UserEmail = @Email
      `);
    // One row from the first flow, none added by the second.
    expect(r.recordset[0]!.c).toBe(1);
  });
});
