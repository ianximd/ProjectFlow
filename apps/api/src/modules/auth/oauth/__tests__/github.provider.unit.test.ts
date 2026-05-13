/**
 * Unit coverage for the GitHub provider — focused on the email-fallback
 * path that the plan specifically called out as risk-prone:
 *
 *   1. /user returns email when the user has set their primary as
 *      visible — used directly, marked verified.
 *   2. /user returns email=null when private — fall back to /user/emails
 *      and pick the primary verified address.
 *   3. /user/emails returns no verified address — provider returns null
 *      email so the orchestrator surfaces NO_EMAIL.
 *
 * GitHub OAuth Apps don't support PKCE (the authorization endpoint
 * silently ignores code_challenge), so we confirm we do NOT include it
 * — sending dead params would hide bugs in real-provider testing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitHubProvider } from '../providers/github.js';

const baseConfig = { clientId: 'gh-id', clientSecret: 'gh-secret' };

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('GitHub provider — authorization URL', () => {
  it('omits PKCE — GitHub OAuth Apps don\'t support it', () => {
    const provider = createGitHubProvider(baseConfig);
    const url = new URL(provider.getAuthorizationUrl({
      state:        's', nonce: 'n',
      pkceVerifier: 'verifier-which-must-not-leak-into-the-url',
      redirectUri:  'http://localhost:3001/api/v1/auth/oauth/github/callback',
    }));

    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('code_challenge')).toBeNull();
    expect(url.searchParams.get('code_challenge_method')).toBeNull();
    // The verifier itself definitely shouldn't appear anywhere.
    expect(url.toString()).not.toContain('verifier-which-must-not-leak');
  });

  it('requests user:email so /user/emails is reachable when primary is private', () => {
    const provider = createGitHubProvider(baseConfig);
    const url = new URL(provider.getAuthorizationUrl({
      state: 's', nonce: 'n', pkceVerifier: 'v', redirectUri: 'http://x/cb',
    }));
    const scope = url.searchParams.get('scope') ?? '';
    expect(scope).toContain('user:email');
    expect(scope).toContain('read:user');
  });
});

describe('GitHub provider — fetchUserInfo email fallback', () => {
  it('uses /user.email directly when present (verified by GitHub)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      id: 12345, login: 'octocat', name: 'Mona', email: 'octocat@github.com', avatar_url: 'https://x/a.png',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const provider = createGitHubProvider(baseConfig);
    const info = await provider.fetchUserInfo('access');

    expect(info.subject).toBe('12345'); // numeric id stringified
    expect(info.email).toBe('octocat@github.com');
    expect(info.emailVerified).toBe(true);
    expect(info.name).toBe('Mona');
    expect(info.avatarUrl).toBe('https://x/a.png');
    // Only one fetch call when /user has the email.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to /user/emails and picks primary verified when /user.email is null', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 99, login: 'private-user', name: 'Hidden', email: null, avatar_url: null,
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { email: 'public@example.com',  primary: false, verified: true  },
        { email: 'real@example.com',    primary: true,  verified: true  },
        { email: 'noisy@example.com',   primary: false, verified: false },
      ]), { status: 200, headers: { 'content-type': 'application/json' } }));

    const provider = createGitHubProvider(baseConfig);
    const info = await provider.fetchUserInfo('access');

    expect(info.email).toBe('real@example.com');
    expect(info.emailVerified).toBe(true);
    expect(info.subject).toBe('99');
    // Two fetches: /user then /user/emails.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('picks the first verified email when no primary is verified', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 1, login: 'no-primary', name: null, email: null, avatar_url: null,
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { email: 'unverified-primary@x.com', primary: true,  verified: false },
        { email: 'verified-secondary@x.com', primary: false, verified: true  },
      ]), { status: 200, headers: { 'content-type': 'application/json' } }));

    const provider = createGitHubProvider(baseConfig);
    const info = await provider.fetchUserInfo('access');

    expect(info.email).toBe('verified-secondary@x.com');
    expect(info.emailVerified).toBe(true);
  });

  it('returns null email when /user/emails has nothing verified', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 2, login: 'no-verified', name: null, email: null, avatar_url: null,
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { email: 'unverified@x.com', primary: true, verified: false },
      ]), { status: 200, headers: { 'content-type': 'application/json' } }));

    const provider = createGitHubProvider(baseConfig);
    const info = await provider.fetchUserInfo('access');

    expect(info.email).toBeNull();
    expect(info.emailVerified).toBe(false);
  });

  it('returns null email when the /user/emails call fails (revoked scope etc.)', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 3, login: 'scope-issue', name: null, email: null, avatar_url: null,
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));

    const provider = createGitHubProvider(baseConfig);
    const info = await provider.fetchUserInfo('access');

    expect(info.email).toBeNull();
    expect(info.emailVerified).toBe(false);
  });

  it('falls back to login when name is null', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      id: 4, login: 'just-a-handle', name: null, email: 'h@x.com', avatar_url: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const provider = createGitHubProvider(baseConfig);
    const info = await provider.fetchUserInfo('access');

    expect(info.name).toBe('just-a-handle');
  });
});

describe('GitHub provider — exchangeCode', () => {
  it('asks for JSON via Accept header (default form-encoded would force us to parse)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: 'gh-at', token_type: 'bearer', scope: 'read:user,user:email',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const provider = createGitHubProvider(baseConfig);
    const tokens = await provider.exchangeCode({
      code: 'auth-code', pkceVerifier: 'unused', redirectUri: 'http://x/cb',
    });

    expect(tokens.accessToken).toBe('gh-at');
    expect(tokens.refreshToken).toBeNull();
    expect(tokens.idToken).toBeNull();

    const init = fetchMock.mock.calls[0]![1];
    expect(init.headers.accept).toBe('application/json');
  });

  it('throws when GitHub returns 200 with an error body (bad code path)', async () => {
    // GitHub's quirk: bad codes get 200 with `{ error: 'bad_verification_code' }`.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: 'bad_verification_code', error_description: 'The code is incorrect',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const provider = createGitHubProvider(baseConfig);
    await expect(provider.exchangeCode({
      code: 'bad', pkceVerifier: '', redirectUri: 'http://x/cb',
    })).rejects.toThrow(/no access_token/);
  });
});
