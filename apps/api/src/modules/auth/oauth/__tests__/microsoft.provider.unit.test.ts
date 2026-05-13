/**
 * Unit coverage for the Microsoft provider — focused on the two
 * easy-to-get-wrong things:
 *
 *   1. `subject` MUST come from Graph /me `id` (the directory `oid`),
 *      NOT from the OIDC `sub` claim. On the `common` tenant `sub` is
 *      tenant-scoped — the same human gets a different `sub` from work
 *      vs personal accounts. Using `id` keeps identity stable.
 *   2. PKCE (`code_challenge`, `code_challenge_method=S256`) is sent on
 *      every authorization URL — Microsoft's v2.0 security guidance
 *      requires it for confidential web clients too.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMicrosoftProvider } from '../providers/microsoft.js';

const baseConfig = {
  clientId:     'msft-id',
  clientSecret: 'msft-secret',
  tenant:       'common',
};

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Microsoft provider — authorization URL', () => {
  it('includes PKCE S256, nonce, scopes, and the configured tenant', () => {
    const provider = createMicrosoftProvider(baseConfig);
    const url = new URL(provider.getAuthorizationUrl({
      state:        'state-abc',
      nonce:        'nonce-xyz',
      pkceVerifier: 'verifier-1234567890',
      redirectUri:  'http://localhost:3001/api/v1/auth/oauth/microsoft/callback',
    }));

    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    expect(url.searchParams.get('client_id')).toBe('msft-id');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state-abc');
    expect(url.searchParams.get('nonce')).toBe('nonce-xyz');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('code_challenge')).not.toBe('verifier-1234567890');
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(url.searchParams.get('scope')).toContain('User.Read');
    // select_account so multi-account users get the picker.
    expect(url.searchParams.get('prompt')).toBe('select_account');
  });

  it('honours a non-default tenant id', () => {
    const provider = createMicrosoftProvider({ ...baseConfig, tenant: 'tenant-guid-here' });
    const url = new URL(provider.getAuthorizationUrl({
      state: 's', nonce: 'n', pkceVerifier: 'v', redirectUri: 'http://x/cb',
    }));
    expect(url.pathname).toBe('/tenant-guid-here/oauth2/v2.0/authorize');
  });
});

describe('Microsoft provider — fetchUserInfo (oid stability)', () => {
  it('uses Graph /me `id` (the oid), NOT the id_token `sub`', async () => {
    // Same human signs in twice — once from a work tenant, once from a
    // personal MSA. The OIDC `sub` claim would differ between the two
    // (tenant-scoped). The Graph `id` (= oid) MUST be the same. We
    // assert by simulating a Graph response that includes both fields
    // with deliberately divergent values, and confirm the provider
    // picks `id`.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      id:                'oid-stable-across-tenants-12345',
      sub:               'sub-tenant-A-abc', // would be different from tenant B
      displayName:       'Real Person',
      mail:              'real.person@contoso.com',
      userPrincipalName: 'real.person@contoso.com',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const provider = createMicrosoftProvider(baseConfig);
    const info = await provider.fetchUserInfo('access-token');

    expect(info.subject).toBe('oid-stable-across-tenants-12345');
    expect(info.subject).not.toBe('sub-tenant-A-abc');
    expect(info.email).toBe('real.person@contoso.com');
    expect(info.name).toBe('Real Person');
  });

  it('falls back to userPrincipalName when `mail` is null (personal MSA accounts)', async () => {
    // Personal Microsoft Accounts (Hotmail / Outlook.com) have no
    // mailbox in the directory sense — Graph returns `mail: null`. The
    // sign-in identifier (`userPrincipalName`) is the email-shaped
    // login the user typed; use that.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      id:                'oid-msa-1',
      mail:              null,
      userPrincipalName: 'someone@outlook.com',
      displayName:       'Personal MSA User',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const provider = createMicrosoftProvider(baseConfig);
    const info = await provider.fetchUserInfo('access-token');

    expect(info.email).toBe('someone@outlook.com');
    expect(info.subject).toBe('oid-msa-1');
  });

  it('returns email=null when both mail and userPrincipalName are missing', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      id: 'oid-no-email', displayName: 'No Email',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const provider = createMicrosoftProvider(baseConfig);
    const info = await provider.fetchUserInfo('access-token');

    expect(info.email).toBeNull();
    expect(info.emailVerified).toBe(false);
  });

  it('throws on a non-200 Graph response so the orchestrator can surface PROVIDER_ERROR', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    const provider = createMicrosoftProvider(baseConfig);
    await expect(provider.fetchUserInfo('bad-token')).rejects.toThrow(/Microsoft.*401/);
  });
});

describe('Microsoft provider — exchangeCode', () => {
  it('POSTs form-encoded to the tenanted token endpoint and parses JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      access_token:  'at',
      refresh_token: 'rt',
      id_token:      'it',
      expires_in:    3600,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const provider = createMicrosoftProvider({ ...baseConfig, tenant: 'tenant-guid' });
    const tokens = await provider.exchangeCode({
      code: 'auth-code', pkceVerifier: 'verifier', redirectUri: 'http://x/cb',
    });

    expect(tokens.accessToken).toBe('at');
    expect(tokens.refreshToken).toBe('rt');
    expect(tokens.idToken).toBe('it');
    expect(tokens.expiresAt).toBeInstanceOf(Date);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://login.microsoftonline.com/tenant-guid/oauth2/v2.0/token');
    expect(init.method).toBe('POST');
    const body = init.body.toString();
    expect(body).toContain('client_id=msft-id');
    expect(body).toContain('code=auth-code');
    expect(body).toContain('code_verifier=verifier');
    expect(body).toContain('grant_type=authorization_code');
  });
});
