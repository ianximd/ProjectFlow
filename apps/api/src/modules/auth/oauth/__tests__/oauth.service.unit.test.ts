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

// Phase 1.D — mock the crypto module so tests can flip configured/not
// without juggling env vars + cache resets. Default to configured so the
// existing repo mock (which now includes `upsertTokens`) gets exercised.
vi.mock('../../../../shared/lib/tokenCrypto.js', () => ({
  isConfigured: vi.fn(() => true),
  seal:         vi.fn((plaintext: string) => ({ sealed: `sealed:${plaintext}`, keyId: 'v1' })),
  open:         vi.fn(),
  describeKeyset: vi.fn(() => ({ primary: 'v1', available: ['v1'] })),
  _resetForTest:  vi.fn(),
}));

const { OAuthService } = await import('../service.js');
const registry         = await import('../registry.js');
const stateMod         = await import('../state.js');
const cryptoMod        = await import('../../../../shared/lib/tokenCrypto.js');

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
    upsertTokens:            vi.fn(async () => true),
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
    // Phase 1.F — service mints MFA challenge JWTs via this helper.
    mintMfaChallengeToken: vi.fn((userId: string, _email: string) => `mfa-jwt-for-${userId}`),
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

  it('rejects with ACCOUNT_EXISTS when local account exists but is unverified', async () => {
    vi.mocked(registry.getProvider).mockReturnValue(fakeProvider());
    vi.mocked(stateMod.consumeState).mockResolvedValue(validPayload);
    const repo = makeRepo({ findByProviderSubject: vi.fn().mockResolvedValue(null) });
    const authRepo = makeAuthRepo({
      // IsEmailVerified=false — auto-link is unsafe; refuse.
      getUserByEmail: vi.fn().mockResolvedValue({ Id: 'preexisting', IsEmailVerified: false }),
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

// ─── Phase 1.C: email-collision auto-link ──────────────────────────────────

describe('OAuthService.callback — email-collision auto-link (Phase 1.C)', () => {
  const validPayload = { provider: 'fake' as const, nonce: 'n', pkceVerifier: 'v', returnTo: '/board' };

  it('auto-links when both sides assert email verification', async () => {
    vi.mocked(registry.getProvider).mockReturnValue(fakeProvider({
      // Provider says verified.
      fetchUserInfo: vi.fn(async () => ({
        subject: 'sub-link', email: 'both-verified@x.com',
        emailVerified: true, name: 'V', avatarUrl: null,
      })),
    }));
    vi.mocked(stateMod.consumeState).mockResolvedValue(validPayload);

    const repo = makeRepo({
      findByProviderSubject: vi.fn().mockResolvedValue(null),
      linkExisting:          vi.fn().mockResolvedValue({ Id: 'identity-id' }),
    });
    const authRepo = makeAuthRepo({
      // Local says verified too.
      getUserByEmail: vi.fn().mockResolvedValue({ Id: 'local-user', Email: 'both-verified@x.com', IsEmailVerified: true }),
    });
    const authService = makeAuthService();

    const result = await new OAuthService({ repo, authRepo, authService }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('tokens');
    expect(repo.linkExisting).toHaveBeenCalledOnce();
    expect(repo.linkExisting.mock.calls[0]![0]).toMatchObject({
      userId:   'local-user',
      provider: 'fake',
      subject:  'sub-link',
    });
    expect(repo.createUserWithIdentity).not.toHaveBeenCalled();
    // Critical: tokens are issued for the LOCAL user, not a freshly
    // created one — proves the auto-link branch funnels through the
    // same session-token path as password login.
    expect(authService.issueSessionTokens).toHaveBeenCalledWith(
      expect.objectContaining({ Id: 'local-user' }),
    );
  });

  it('refuses with ACCOUNT_EXISTS when provider says unverified (even if local is verified)', async () => {
    vi.mocked(registry.getProvider).mockReturnValue(fakeProvider({
      fetchUserInfo: vi.fn(async () => ({
        subject: 's', email: 'mixed@x.com', emailVerified: false, name: null, avatarUrl: null,
      })),
    }));
    vi.mocked(stateMod.consumeState).mockResolvedValue(validPayload);
    const repo = makeRepo({ findByProviderSubject: vi.fn().mockResolvedValue(null) });
    const authRepo = makeAuthRepo({
      getUserByEmail: vi.fn().mockResolvedValue({ Id: 'local', IsEmailVerified: true }),
    });

    const result = await new OAuthService({ repo, authRepo, authService: makeAuthService() }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('error');
    expect((result as any).reason).toBe('ACCOUNT_EXISTS');
    expect(repo.linkExisting).not.toHaveBeenCalled();
  });

  it('returns ALREADY_LINKED when SP throws 51030 during the auto-link race', async () => {
    vi.mocked(registry.getProvider).mockReturnValue(fakeProvider({
      fetchUserInfo: vi.fn(async () => ({
        subject: 's', email: 'race@x.com', emailVerified: true, name: null, avatarUrl: null,
      })),
    }));
    vi.mocked(stateMod.consumeState).mockResolvedValue(validPayload);

    const linkErr: any = new Error('already linked');
    linkErr.number = 51030;

    const repo = makeRepo({
      findByProviderSubject: vi.fn().mockResolvedValue(null),
      linkExisting:          vi.fn().mockRejectedValue(linkErr),
    });
    const authRepo = makeAuthRepo({
      getUserByEmail: vi.fn().mockResolvedValue({ Id: 'local', IsEmailVerified: true }),
    });

    const result = await new OAuthService({ repo, authRepo, authService: makeAuthService() }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('error');
    expect((result as any).reason).toBe('ALREADY_LINKED');
  });
});

// ─── Phase 1.C: link flow (authenticated user adding a provider) ───────────

describe('OAuthService.callback — link flow (Phase 1.C)', () => {
  const linkPayload = {
    provider:     'fake' as const,
    nonce:        'n',
    pkceVerifier: 'v',
    returnTo:     '/settings/connected-accounts',
    linkUserId:   'logged-in-user-1',
  };

  it('attaches the identity to linkUserId and returns kind: linked (no session tokens)', async () => {
    vi.mocked(registry.getProvider).mockReturnValue(fakeProvider());
    vi.mocked(stateMod.consumeState).mockResolvedValue(linkPayload);
    const repo = makeRepo({
      linkExisting: vi.fn().mockResolvedValue({ Id: 'new-identity' }),
    });
    const authService = makeAuthService();

    const result = await new OAuthService({ repo, authRepo: makeAuthRepo(), authService }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('linked');
    expect((result as any).userId).toBe('logged-in-user-1');
    expect((result as any).returnTo).toBe('/settings/connected-accounts');
    expect(repo.linkExisting).toHaveBeenCalledWith(expect.objectContaining({
      userId:   'logged-in-user-1',
      provider: 'fake',
    }));
    // No session tokens issued — the user already has one.
    expect(authService.issueSessionTokens).not.toHaveBeenCalled();
    // The link path runs BEFORE findByProviderSubject — we don't need to
    // pre-check; the SP throws 51030 if there's a conflict.
    expect(repo.findByProviderSubject).not.toHaveBeenCalled();
  });

  it('returns ALREADY_LINKED when the (provider, subject) is already on a different user', async () => {
    vi.mocked(registry.getProvider).mockReturnValue(fakeProvider());
    vi.mocked(stateMod.consumeState).mockResolvedValue(linkPayload);

    const linkErr: any = new Error('already linked');
    linkErr.number = 51030;

    const repo = makeRepo({
      linkExisting: vi.fn().mockRejectedValue(linkErr),
    });

    const result = await new OAuthService({ repo, authRepo: makeAuthRepo(), authService: makeAuthService() }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('error');
    expect((result as any).reason).toBe('ALREADY_LINKED');
  });

  it('idempotent re-link of the same provider+subject for the same user returns linked', async () => {
    vi.mocked(registry.getProvider).mockReturnValue(fakeProvider());
    vi.mocked(stateMod.consumeState).mockResolvedValue(linkPayload);
    // The SP swallows duplicates for the same user (returns the existing row).
    const repo = makeRepo({
      linkExisting: vi.fn().mockResolvedValue({ Id: 'existing-identity' }),
    });

    const result = await new OAuthService({ repo, authRepo: makeAuthRepo(), authService: makeAuthService() }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('linked');
  });
});

// ─── Phase 1.C: unlink ──────────────────────────────────────────────────────

describe('OAuthService.unlink', () => {
  it('returns ok on success', async () => {
    const repo = makeRepo({ unlink: vi.fn().mockResolvedValue(undefined) });
    const result = await new OAuthService({ repo, authRepo: makeAuthRepo(), authService: makeAuthService() })
      .unlink('user-1', 'fake');
    expect(result).toEqual({ ok: true });
  });

  it('maps SP error 51031 (last credential) to a typed result', async () => {
    const err: any = new Error('last credential');
    err.number = 51031;
    const repo = makeRepo({ unlink: vi.fn().mockRejectedValue(err) });

    const result = await new OAuthService({ repo, authRepo: makeAuthRepo(), authService: makeAuthService() })
      .unlink('user-1', 'fake');

    expect(result).toEqual({ ok: false, reason: 'LAST_CREDENTIAL' });
  });

  it('rethrows unexpected errors so the route handler 500s rather than masking', async () => {
    const repo = makeRepo({ unlink: vi.fn().mockRejectedValue(new Error('connection lost')) });
    await expect(
      new OAuthService({ repo, authRepo: makeAuthRepo(), authService: makeAuthService() }).unlink('user-1', 'fake'),
    ).rejects.toThrow(/connection lost/);
  });
});

// ─── Phase 1.F: MFA gate ────────────────────────────────────────────────────

describe('OAuthService.callback — MFA gate (Phase 1.F)', () => {
  beforeEach(() => {
    (registry.getProvider as any).mockReturnValue(fakeProvider());
    (stateMod.consumeState as any).mockResolvedValue({
      provider: 'fake', nonce: 'n', pkceVerifier: 'p', returnTo: '/board', linkUserId: null,
    });
  });

  it('returns mfa-required for an existing identity whose user has MfaEnabled', async () => {
    const repo = makeRepo({
      findByProviderSubject: vi.fn().mockResolvedValue({ UserId: 'user-mfa' }),
    });
    const authRepo = makeAuthRepo({
      getUserById: vi.fn().mockResolvedValue({ Id: 'user-mfa', Email: 'mfa@x.com', MfaEnabled: true }),
    });
    const authService = makeAuthService();

    const result = await new OAuthService({ repo, authRepo, authService }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('mfa-required');
    expect(result).toMatchObject({
      kind:      'mfa-required',
      userId:    'user-mfa',
      userEmail: 'mfa@x.com',
      mfaToken:  'mfa-jwt-for-user-mfa',
      returnTo:  '/board',
    });
    // The gate must short-circuit BEFORE issueSessionTokens — that's
    // the whole point of the fix.
    expect(authService.issueSessionTokens).not.toHaveBeenCalled();
    expect(authService.mintMfaChallengeToken).toHaveBeenCalledWith('user-mfa', 'mfa@x.com');
  });

  it('returns mfa-required from the auto-link branch when local user has MfaEnabled', async () => {
    const repo = makeRepo({
      findByProviderSubject: vi.fn().mockResolvedValue(null),
      linkExisting:          vi.fn().mockResolvedValue({ Id: 'oauth-row-1' }),
    });
    const authRepo = makeAuthRepo({
      getUserByEmail: vi.fn().mockResolvedValue({
        Id: 'user-collide', Email: 'collide@x.com',
        IsEmailVerified: true, MfaEnabled: true,
      }),
    });
    const authService = makeAuthService();

    const result = await new OAuthService({ repo, authRepo, authService }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('mfa-required');
    expect(repo.linkExisting).toHaveBeenCalled(); // identity DOES get linked
    expect(authService.issueSessionTokens).not.toHaveBeenCalled();
  });

  it('does NOT trigger the MFA gate for a brand-new user (just-created accounts cannot have MFA)', async () => {
    const repo = makeRepo({
      findByProviderSubject:  vi.fn().mockResolvedValue(null),
      // The brand-new user CAN'T have MfaEnabled — but even if some
      // pathological path returned MfaEnabled=true here, the new-user
      // branch deliberately skips the gate to avoid the JWT mint cost.
      createUserWithIdentity: vi.fn().mockResolvedValue({ Id: 'user-new', Email: 'new@x.com' }),
    });
    const authRepo = makeAuthRepo({ getUserByEmail: vi.fn().mockResolvedValue(null) });
    const authService = makeAuthService();

    const result = await new OAuthService({ repo, authRepo, authService }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('tokens');
    expect(authService.mintMfaChallengeToken).not.toHaveBeenCalled();
  });

  it('still issues tokens directly when MfaEnabled is false on the existing user', async () => {
    const repo = makeRepo({
      findByProviderSubject: vi.fn().mockResolvedValue({ UserId: 'user-no-mfa' }),
    });
    const authRepo = makeAuthRepo({
      getUserById: vi.fn().mockResolvedValue({ Id: 'user-no-mfa', Email: 'plain@x.com', MfaEnabled: false }),
    });
    const authService = makeAuthService();

    const result = await new OAuthService({ repo, authRepo, authService }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('tokens');
    expect(authService.mintMfaChallengeToken).not.toHaveBeenCalled();
    expect(authService.issueSessionTokens).toHaveBeenCalled();
  });

  it('persists provider tokens at the gate boundary (so the post-MFA session benefits)', async () => {
    // The deferred-persistence trade-off documented in the service:
    // we DO write the encrypted tokens before the user passes MFA.
    // Worst case for an attacker: a few KB of unusable ciphertext sit
    // in the DB. The legitimate user benefits because the rotation +
    // refresh workers can already see the row.
    const repo = makeRepo({
      findByProviderSubject: vi.fn().mockResolvedValue({ UserId: 'user-mfa-persist' }),
    });
    const authRepo = makeAuthRepo({
      getUserById: vi.fn().mockResolvedValue({ Id: 'user-mfa-persist', Email: 'mfa2@x.com', MfaEnabled: true }),
    });

    const result = await new OAuthService({ repo, authRepo, authService: makeAuthService() }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('mfa-required');
    expect(repo.upsertTokens).toHaveBeenCalled();
  });

  it('treats MfaEnabled=1 (SQL Bit) the same as MfaEnabled=true', async () => {
    const repo = makeRepo({
      findByProviderSubject: vi.fn().mockResolvedValue({ UserId: 'user-bit' }),
    });
    const authRepo = makeAuthRepo({
      getUserById: vi.fn().mockResolvedValue({ Id: 'user-bit', Email: 'bit@x.com', MfaEnabled: 1 }),
    });

    const result = await new OAuthService({ repo, authRepo, authService: makeAuthService() }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('mfa-required');
  });
});

// ─── Phase 1.D: encrypted token persistence ─────────────────────────────────

describe('OAuthService.callback — token persistence (Phase 1.D)', () => {
  beforeEach(() => {
    // Default mock posture: configured. Individual tests override.
    (cryptoMod.isConfigured as any).mockReturnValue(true);
    (cryptoMod.seal as any).mockImplementation((pt: string) => ({ sealed: `sealed:${pt}`, keyId: 'v1' }));
  });

  it('persists encrypted access + refresh tokens after a new-user sign-in', async () => {
    (registry.getProvider as any).mockReturnValue(fakeProvider({
      exchangeCode: vi.fn(async () => ({
        accessToken: 'AT', refreshToken: 'RT', idToken: null,
        expiresAt: new Date('2026-06-01T00:00:00Z'),
      })),
    }));
    (stateMod.consumeState as any).mockResolvedValue({
      provider: 'fake', nonce: 'n', pkceVerifier: 'p', returnTo: '/board', linkUserId: null,
    });
    const repo = makeRepo({
      findByProviderSubject:  vi.fn().mockResolvedValue(null),
      createUserWithIdentity: vi.fn().mockResolvedValue({ Id: 'user-new', Email: 'new@x.com' }),
    });
    const authRepo = makeAuthRepo({ getUserByEmail: vi.fn().mockResolvedValue(null) });
    await new OAuthService({ repo, authRepo, authService: makeAuthService() }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(cryptoMod.seal).toHaveBeenCalledWith('AT');
    expect(cryptoMod.seal).toHaveBeenCalledWith('RT');
    expect(repo.upsertTokens).toHaveBeenCalledWith({
      provider:        'fake',
      subject:         'sub-1',
      accessTokenEnc:  'sealed:AT',
      refreshTokenEnc: 'sealed:RT',
      tokenExpiresAt:  new Date('2026-06-01T00:00:00Z'),
      tokenKeyVersion: 'v1',
    });
  });

  it('persists access only when the provider does not return a refresh token', async () => {
    (registry.getProvider as any).mockReturnValue(fakeProvider({
      exchangeCode: vi.fn(async () => ({ accessToken: 'AT', refreshToken: null, idToken: null, expiresAt: null })),
    }));
    (stateMod.consumeState as any).mockResolvedValue({
      provider: 'fake', nonce: 'n', pkceVerifier: 'p', returnTo: '/board', linkUserId: null,
    });
    const repo = makeRepo({
      findByProviderSubject: vi.fn().mockResolvedValue({ UserId: 'user-1' }),
    });
    const authRepo = makeAuthRepo({ getUserById: vi.fn().mockResolvedValue({ Id: 'user-1', Email: 'u@x.com' }) });

    await new OAuthService({ repo, authRepo, authService: makeAuthService() }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(repo.upsertTokens).toHaveBeenCalledTimes(1);
    expect(repo.upsertTokens).toHaveBeenCalledWith(expect.objectContaining({
      accessTokenEnc:  'sealed:AT',
      refreshTokenEnc: null,
    }));
  });

  it('persists tokens after the link flow attaches an identity', async () => {
    (registry.getProvider as any).mockReturnValue(fakeProvider({
      exchangeCode: vi.fn(async () => ({ accessToken: 'AT', refreshToken: 'RT', idToken: null, expiresAt: null })),
    }));
    (stateMod.consumeState as any).mockResolvedValue({
      provider: 'fake', nonce: 'n', pkceVerifier: 'p', returnTo: '/settings', linkUserId: 'user-A',
    });
    const repo = makeRepo({ linkExisting: vi.fn().mockResolvedValue({ Id: 'oauth-1' }) });

    await new OAuthService({ repo, authRepo: makeAuthRepo(), authService: makeAuthService() }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(repo.linkExisting).toHaveBeenCalled();
    expect(repo.upsertTokens).toHaveBeenCalledTimes(1);
  });

  it('skips persistence entirely when no encryption key is configured', async () => {
    (cryptoMod.isConfigured as any).mockReturnValue(false);

    (registry.getProvider as any).mockReturnValue(fakeProvider());
    (stateMod.consumeState as any).mockResolvedValue({
      provider: 'fake', nonce: 'n', pkceVerifier: 'p', returnTo: '/board', linkUserId: null,
    });
    const repo = makeRepo({
      findByProviderSubject:  vi.fn().mockResolvedValue(null),
      createUserWithIdentity: vi.fn().mockResolvedValue({ Id: 'user-new', Email: 'new@x.com' }),
    });
    const authRepo = makeAuthRepo({ getUserByEmail: vi.fn().mockResolvedValue(null) });

    const result = await new OAuthService({ repo, authRepo, authService: makeAuthService() }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('tokens');
    expect(cryptoMod.seal).not.toHaveBeenCalled();
    expect(repo.upsertTokens).not.toHaveBeenCalled();
  });

  it('does not block sign-in when token persistence throws', async () => {
    // Storage failure is logged but the user still gets their session.
    (registry.getProvider as any).mockReturnValue(fakeProvider());
    (stateMod.consumeState as any).mockResolvedValue({
      provider: 'fake', nonce: 'n', pkceVerifier: 'p', returnTo: '/board', linkUserId: null,
    });
    const repo = makeRepo({
      findByProviderSubject:  vi.fn().mockResolvedValue(null),
      createUserWithIdentity: vi.fn().mockResolvedValue({ Id: 'user-new', Email: 'new@x.com' }),
      upsertTokens:           vi.fn().mockRejectedValue(new Error('SQL connection lost')),
    });
    const authRepo = makeAuthRepo({ getUserByEmail: vi.fn().mockResolvedValue(null) });

    const result = await new OAuthService({ repo, authRepo, authService: makeAuthService() }).callback({
      provider: 'fake', code: 'c', state: 's',
    });

    expect(result.kind).toBe('tokens');
  });
});
