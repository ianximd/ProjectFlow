/**
 * Unit coverage for the OAuth orchestration service. Mocks the registry,
 * repository, and AuthService so we can drive every branch of the
 * callback flow without standing up Redis, SQL, or a real provider.
 *
 * Branch matrix:
 *   - existing identity → tokens issued for the linked user
 *   - new identity, new email → user created + tokens issued
 *   - new identity, email collides with an existing local user → ACCOUNT_EXISTS
 *   - provider has no email → NO_EMAIL
 *   - provider exchange throws → PROVIDER_ERROR
 *   - state token is missing/expired → INVALID_STATE
 *   - state.provider doesn't match the route's provider → INVALID_STATE
 *   - unknown provider → INVALID_STATE
 *   - existing identity but linked user is gone → INVALID_STATE
 *   - returnTo is preserved through to the result
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../registry.js', () => ({
  getProvider:    vi.fn(),
  callbackUrl:    vi.fn(() => 'http://localhost:3001/api/v1/auth/oauth/fake/callback'),
}));

vi.mock('../state.js', () => ({
  writeState:     vi.fn(async () => 'state-token'),
  consumeState:   vi.fn(),
  makeRandomToken: vi.fn(() => 'rand'),
}));

const { OAuthService } = await import('../service.js');
const registry         = await import('../registry.js');
const stateMod         = await import('../state.js');

function fakeProvider(overrides: Record<string, any> = {}) {
  return {
    name: 'fake' as const,
    getAuthorizationUrl: vi.fn(() => 'http://provider/authz?state=state-token'),
    exchangeCode:        vi.fn(async () => ({ accessToken: 'at', refreshToken: null, idToken: null, expiresAt: null })),
    fetchUserInfo:       vi.fn(async () => ({ subject: 'sub-1', email: 'new@x.com', emailVerified: true, name: 'Newby', avatarUrl: null })),
    ...overrides,
  };
}

function makeRepo(overrides: Record<string, any> = {}) {
  return {
    findByProviderSubject:   vi.fn(),
    createUserWithIdentity:  vi.fn(),
    linkExisting:            vi.fn(),
    listForUser:             vi.fn(),
    unlink:                  vi.fn(),
    ...overrides,
  } as any;
}

function makeAuthRepo(overrides: Record<string, any> = {}) {
  return {
    getUserById:    vi.fn(),
    getUserByEmail: vi.fn(),
    ...overrides,
  } as any;
}

function makeAuthService(overrides: Record<string, any> = {}) {
  return {
    issueSessionTokens: vi.fn(async (user: any) => ({
      kind:         'tokens',
      user:         { Id: user.Id, Email: user.Email },
      accessToken:  'access-jwt',
      refreshToken: 'refresh-raw',
    })),
    ...overrides,
  } as any;
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

// ─── start() ────────────────────────────────────────────────────────────────

describe('OAuthService.start', () => {
  it('returns the provider authorization URL after persisting state', async () => {
    vi.mocked(registry.getProvider).mockReturnValue(fakeProvider());
    const svc = new OAuthService({
      repo:        makeRepo(),
      authRepo:    makeAuthRepo(),
      authService: makeAuthService(),
    });

    const result = await svc.start({ provider: 'fake', returnTo: '/board' });

    expect('url' in result).toBe(true);
    expect(stateMod.writeState).toHaveBeenCalledOnce();
    const writePayload = vi.mocked(stateMod.writeState).mock.calls[0]![0];
    expect(writePayload.provider).toBe('fake');
    expect(writePayload.returnTo).toBe('/board');
    expect(writePayload.pkceVerifier).toBeTypeOf('string');
    expect(writePayload.nonce).toBeTypeOf('string');
  });

  it('coerces an open-redirect-style returnTo to /board', async () => {
    vi.mocked(registry.getProvider).mockReturnValue(fakeProvider());
    const svc = new OAuthService({ repo: makeRepo(), authRepo: makeAuthRepo(), authService: makeAuthService() });

    await svc.start({ provider: 'fake', returnTo: 'https://evil.example.com' });

    const writePayload = vi.mocked(stateMod.writeState).mock.calls[0]![0];
    expect(writePayload.returnTo).toBe('/board');
  });

  it('returns UNKNOWN_PROVIDER when the provider is not registered', async () => {
    vi.mocked(registry.getProvider).mockReturnValue(null);
    const svc = new OAuthService({ repo: makeRepo(), authRepo: makeAuthRepo(), authService: makeAuthService() });

    const result = await svc.start({ provider: 'mystery', returnTo: '/board' });
    expect(result).toEqual({ error: 'UNKNOWN_PROVIDER' });
    expect(stateMod.writeState).not.toHaveBeenCalled();
  });
});

// ─── callback() ─────────────────────────────────────────────────────────────

describe('OAuthService.callback', () => {
  const validPayload = {
    provider:     'fake' as const,
    nonce:        'n',
    pkceVerifier: 'v',
    returnTo:     '/dashboard',
  };

  it('issues tokens when an existing identity is matched', async () => {
    vi.mocked(registry.getProvider).mockReturnValue(fakeProvider());
    vi.mocked(stateMod.consumeState).mockResolvedValue(validPayload);
    const repo     = makeRepo({
      findByProviderSubject: vi.fn().mockResolvedValue({ Id: 'id-1', UserId: 'user-1', Provider: 'fake', Subject: 'sub-1' }),
    });
    const authRepo = makeAuthRepo({
      getUserById: vi.fn().mockResolvedValue({ Id: 'user-1', Email: 'existing@x.com' }),
    });
    const authService = makeAuthService();

    const result = await new OAuthService({ repo, authRepo, authService }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('tokens');
    expect((result as any).accessToken).toBe('access-jwt');
    expect((result as any).returnTo).toBe('/dashboard');
    expect(authService.issueSessionTokens).toHaveBeenCalledOnce();
    expect(repo.createUserWithIdentity).not.toHaveBeenCalled();
  });

  it('creates a new user + identity when subject is unseen and email is fresh', async () => {
    vi.mocked(registry.getProvider).mockReturnValue(fakeProvider());
    vi.mocked(stateMod.consumeState).mockResolvedValue(validPayload);
    const repo = makeRepo({
      findByProviderSubject:  vi.fn().mockResolvedValue(null),
      createUserWithIdentity: vi.fn().mockResolvedValue({ Id: 'user-new', Email: 'new@x.com' }),
    });
    const authRepo = makeAuthRepo({
      getUserByEmail: vi.fn().mockResolvedValue(null),
    });
    const authService = makeAuthService();

    const result = await new OAuthService({ repo, authRepo, authService }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('tokens');
    expect(repo.createUserWithIdentity).toHaveBeenCalledOnce();
    const createArg = repo.createUserWithIdentity.mock.calls[0]![0];
    expect(createArg).toMatchObject({
      email:         'new@x.com',
      provider:      'fake',
      subject:       'sub-1',
      emailVerified: true,
    });
  });

  it('rejects with ACCOUNT_EXISTS when the email collides with a local account', async () => {
    vi.mocked(registry.getProvider).mockReturnValue(fakeProvider());
    vi.mocked(stateMod.consumeState).mockResolvedValue(validPayload);
    const repo = makeRepo({ findByProviderSubject: vi.fn().mockResolvedValue(null) });
    const authRepo = makeAuthRepo({
      getUserByEmail: vi.fn().mockResolvedValue({ Id: 'preexisting' }),
    });

    const result = await new OAuthService({ repo, authRepo, authService: makeAuthService() }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('error');
    expect((result as any).reason).toBe('ACCOUNT_EXISTS');
    expect(repo.createUserWithIdentity).not.toHaveBeenCalled();
  });

  it('rejects with NO_EMAIL when the provider returned no email', async () => {
    vi.mocked(registry.getProvider).mockReturnValue(fakeProvider({
      fetchUserInfo: vi.fn(async () => ({ subject: 'sub-1', email: null, emailVerified: false, name: null, avatarUrl: null })),
    }));
    vi.mocked(stateMod.consumeState).mockResolvedValue(validPayload);

    const result = await new OAuthService({ repo: makeRepo(), authRepo: makeAuthRepo(), authService: makeAuthService() }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('error');
    expect((result as any).reason).toBe('NO_EMAIL');
  });

  it('returns PROVIDER_ERROR when exchangeCode throws', async () => {
    vi.mocked(registry.getProvider).mockReturnValue(fakeProvider({
      exchangeCode: vi.fn(async () => { throw new Error('upstream 502'); }),
    }));
    vi.mocked(stateMod.consumeState).mockResolvedValue(validPayload);

    const result = await new OAuthService({ repo: makeRepo(), authRepo: makeAuthRepo(), authService: makeAuthService() }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('error');
    expect((result as any).reason).toBe('PROVIDER_ERROR');
    expect((result as any).message).toContain('upstream 502');
  });

  it('returns INVALID_STATE when the state token is missing or expired', async () => {
    vi.mocked(registry.getProvider).mockReturnValue(fakeProvider());
    vi.mocked(stateMod.consumeState).mockResolvedValue(null);

    const result = await new OAuthService({ repo: makeRepo(), authRepo: makeAuthRepo(), authService: makeAuthService() }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('error');
    expect((result as any).reason).toBe('INVALID_STATE');
  });

  it('returns INVALID_STATE when state.provider doesn\'t match the route\'s provider', async () => {
    vi.mocked(registry.getProvider).mockReturnValue(fakeProvider());
    vi.mocked(stateMod.consumeState).mockResolvedValue({ ...validPayload, provider: 'google' as any });

    const result = await new OAuthService({ repo: makeRepo(), authRepo: makeAuthRepo(), authService: makeAuthService() }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('error');
    expect((result as any).reason).toBe('INVALID_STATE');
  });

  it('returns INVALID_STATE when the route\'s provider isn\'t registered', async () => {
    vi.mocked(registry.getProvider).mockReturnValue(null);

    const result = await new OAuthService({ repo: makeRepo(), authRepo: makeAuthRepo(), authService: makeAuthService() }).callback({
      provider: 'unknown', code: 'c', state: 's',
    });

    expect(result.kind).toBe('error');
    expect((result as any).reason).toBe('INVALID_STATE');
  });

  it('returns INVALID_STATE when the linked user has been deleted underneath us', async () => {
    vi.mocked(registry.getProvider).mockReturnValue(fakeProvider());
    vi.mocked(stateMod.consumeState).mockResolvedValue(validPayload);
    const repo     = makeRepo({
      findByProviderSubject: vi.fn().mockResolvedValue({ Id: 'id-1', UserId: 'gone', Provider: 'fake', Subject: 'sub-1' }),
    });
    const authRepo = makeAuthRepo({
      getUserById: vi.fn().mockResolvedValue(null),
    });

    const result = await new OAuthService({ repo, authRepo, authService: makeAuthService() }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('error');
    expect((result as any).reason).toBe('INVALID_STATE');
  });
});
