import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll  (async () => { await closePool();   });

describe('POST /auth/register', () => {
  it('creates a user and returns the safe-shaped record', async () => {
    const res  = await request('/auth/register', {
      method: 'POST',
      json:   { email: 'reg@projectflow.test', name: 'Reg User', password: 'ValidPass1!' },
    });
    const body = await json<{ data: any }>(res, 201);

    expect(body.data.Email).toBe('reg@projectflow.test');
    expect(body.data.Id).toMatch(/^[0-9A-F-]{36}$/i);
    expect(body.data.PasswordHash).toBeUndefined();
    expect(body.data.MfaSecret).toBeUndefined();
  });

  it('rejects a duplicate email with 409', async () => {
    await createTestUser({ email: 'dup@projectflow.test' });
    const res = await request('/auth/register', {
      method: 'POST',
      json:   { email: 'dup@projectflow.test', name: 'Dup', password: 'ValidPass1!' },
    });

    expect(res.status).toBe(409);
  });
});

describe('POST /auth/login', () => {
  it('issues a JWT + refresh cookie for valid credentials', async () => {
    await createTestUser({ email: 'login@projectflow.test', password: 'TestPass123!' });
    const res = await request('/auth/login', {
      method: 'POST',
      json:   { email: 'login@projectflow.test', password: 'TestPass123!' },
    });

    const body = await json<{ data: { token: string; user: { Email: string } } }>(res, 200);
    expect(body.data.token).toBeTypeOf('string');
    expect(body.data.user.Email).toBe('login@projectflow.test');
    expect(res.headers.get('set-cookie')).toMatch(/refresh_token=/);
  });

  it('returns 401 on a wrong password', async () => {
    await createTestUser({ email: 'badpwd@projectflow.test', password: 'TestPass123!' });
    const res = await request('/auth/login', {
      method: 'POST',
      json:   { email: 'badpwd@projectflow.test', password: 'WRONG' },
    });

    expect(res.status).toBe(401);
  });

  it('returns 401 on an unknown email — no enumeration', async () => {
    const res = await request('/auth/login', {
      method: 'POST',
      json:   { email: 'ghost@projectflow.test', password: 'whatever' },
    });

    expect(res.status).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh cookie and issues a new access token', async () => {
    const u = await createTestUser({ email: 'refresh@projectflow.test' });
    expect(u.refreshToken).not.toBeNull();

    const res = await request('/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refresh_token=${u.refreshToken}` },
    });

    const body = await json<{ data: { token: string } }>(res, 200);
    expect(body.data.token).toBeTypeOf('string');
    // The new access token must differ from the original — proves it's freshly minted.
    expect(body.data.token).not.toBe(u.accessToken);
    // The refresh cookie itself is rotated too.
    const newCookie = res.headers.get('set-cookie');
    expect(newCookie).toMatch(/refresh_token=/);
    expect(newCookie).not.toContain(`refresh_token=${u.refreshToken}`);
  });

  it('returns 401 when no refresh cookie is present', async () => {
    const res = await request('/auth/refresh', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('returns 401 + clears cookie when the refresh token has been revoked (replay)', async () => {
    const u = await createTestUser({ email: 'replay@projectflow.test' });

    // First call rotates and revokes the original token.
    await request('/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refresh_token=${u.refreshToken}` },
    });

    // Replay the now-revoked token.
    const replay = await request('/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refresh_token=${u.refreshToken}` },
    });
    expect(replay.status).toBe(401);
    // Server must clear the bad cookie so the client stops re-sending it.
    expect(replay.headers.get('set-cookie') ?? '').toMatch(/refresh_token=;/);
  });
});

describe('POST /auth/logout', () => {
  it('clears the refresh cookie regardless of token presence', async () => {
    const res = await request('/auth/logout', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie') ?? '').toMatch(/refresh_token=;/);
  });
});

describe('GET /auth/me', () => {
  it('returns the authenticated user', async () => {
    const u = await createTestUser({ email: 'me@projectflow.test', name: 'Me User' });

    const res  = await request('/auth/me', { token: u.accessToken });
    const body = await json<{ data: { Email: string; Name: string; PasswordHash?: string } }>(res, 200);

    expect(body.data.Email).toBe('me@projectflow.test');
    expect(body.data.Name).toBe('Me User');
    expect(body.data.PasswordHash).toBeUndefined();
  });

  it('returns 401 without a token', async () => {
    const res = await request('/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 on a bogus token', async () => {
    const res = await request('/auth/me', { token: 'not.a.real.jwt' });
    expect(res.status).toBe(401);
  });
});
