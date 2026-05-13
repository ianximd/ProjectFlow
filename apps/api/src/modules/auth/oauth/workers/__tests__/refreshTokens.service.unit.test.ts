/**
 * Unit coverage for the silent-refresh sweep. Mocks the registry, repo,
 * and crypto module so we can drive every branch without Redis or SQL.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../registry.js', () => ({
  getProvider: vi.fn(),
}));
vi.mock('../../../../../shared/lib/tokenCrypto.js', () => ({
  isConfigured: vi.fn(() => true),
  seal:         vi.fn((pt: string) => ({ sealed: `sealed:${pt}`, keyId: 'v1' })),
  open:         vi.fn((sealed: string) => sealed.replace(/^sealed:/, '')),
  describeKeyset: vi.fn(() => ({ primary: 'v1', available: ['v1'] })),
  _resetForTest:  vi.fn(),
}));

const { runRefreshSweep } = await import('../refreshTokens.service.js');
const registry            = await import('../../registry.js');
const cryptoMod           = await import('../../../../../shared/lib/tokenCrypto.js');

function row(overrides: Record<string, any> = {}) {
  return {
    Id:               'id-1',
    UserId:           'user-1',
    Provider:         'fake',
    Subject:          'sub-1',
    AccessTokenEnc:   'sealed:old-access',
    RefreshTokenEnc:  'sealed:rt',
    TokenExpiresAt:   new Date(Date.now() - 1000),
    TokenKeyVersion:  'v1',
    ...overrides,
  };
}

function makeRepo(overrides: Record<string, any> = {}) {
  return {
    listExpiringTokens: vi.fn().mockResolvedValue([]),
    upsertTokens:       vi.fn().mockResolvedValue(true),
    ...overrides,
  } as any;
}

function fakeProviderWithRefresh(refreshImpl?: (rt: string) => Promise<any>) {
  return {
    name: 'fake' as const,
    getAuthorizationUrl: vi.fn(),
    exchangeCode:        vi.fn(),
    fetchUserInfo:       vi.fn(),
    refreshTokens: refreshImpl ?? vi.fn(async (rt: string) => ({
      accessToken:  `new-${rt}`,
      refreshToken: `${rt}-rotated`,
      idToken:      null,
      expiresAt:    new Date(Date.now() + 3_600_000),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (cryptoMod.isConfigured as any).mockReturnValue(true);
});
afterEach(() => { vi.useRealTimers(); });

describe('runRefreshSweep', () => {
  it('returns zeros and skips work when crypto is unconfigured', async () => {
    (cryptoMod.isConfigured as any).mockReturnValue(false);
    const repo = makeRepo();
    const result = await runRefreshSweep({}, { repo });
    expect(result).toEqual({ scanned: 0, refreshed: 0, skippedNoRefresh: 0, failed: 0 });
    expect(repo.listExpiringTokens).not.toHaveBeenCalled();
  });

  it('returns zeros when the SP returns no rows', async () => {
    const repo = makeRepo();
    const result = await runRefreshSweep({}, { repo });
    expect(result).toEqual({ scanned: 0, refreshed: 0, skippedNoRefresh: 0, failed: 0 });
  });

  it('refreshes one row end-to-end and persists the new access + refresh ciphertext', async () => {
    (registry.getProvider as any).mockReturnValue(fakeProviderWithRefresh());
    const repo = makeRepo({ listExpiringTokens: vi.fn().mockResolvedValue([row()]) });

    const result = await runRefreshSweep({}, { repo });

    expect(result).toEqual({ scanned: 1, refreshed: 1, skippedNoRefresh: 0, failed: 0 });
    expect(cryptoMod.open).toHaveBeenCalledWith('sealed:rt');
    expect(repo.upsertTokens).toHaveBeenCalledWith(expect.objectContaining({
      provider:        'fake',
      subject:         'sub-1',
      accessTokenEnc:  'sealed:new-rt',
      refreshTokenEnc: 'sealed:rt-rotated',
      tokenKeyVersion: 'v1',
    }));
  });

  it('preserves the existing refresh column when the provider omits a new one', async () => {
    (registry.getProvider as any).mockReturnValue(fakeProviderWithRefresh(async () => ({
      accessToken:  'newAT',
      refreshToken: null,
      idToken:      null,
      expiresAt:    new Date(Date.now() + 3_600_000),
    })));
    const repo = makeRepo({ listExpiringTokens: vi.fn().mockResolvedValue([row()]) });

    await runRefreshSweep({}, { repo });

    expect(repo.upsertTokens).toHaveBeenCalledWith(expect.objectContaining({
      refreshTokenEnc: null,
    }));
  });

  it('counts a provider that does not implement refreshTokens as skippedNoRefresh', async () => {
    (registry.getProvider as any).mockReturnValue({
      name: 'github', getAuthorizationUrl: vi.fn(), exchangeCode: vi.fn(), fetchUserInfo: vi.fn(),
      // no refreshTokens method
    });
    const repo = makeRepo({ listExpiringTokens: vi.fn().mockResolvedValue([row({ Provider: 'github' })]) });

    const result = await runRefreshSweep({}, { repo });

    expect(result.refreshed).toBe(0);
    expect(result.skippedNoRefresh).toBe(1);
    expect(repo.upsertTokens).not.toHaveBeenCalled();
  });

  it('counts a provider error as failed without aborting the sweep', async () => {
    (registry.getProvider as any).mockReturnValue(fakeProviderWithRefresh(async () => {
      throw new Error('provider 401: refresh_token_expired');
    }));
    const repo = makeRepo({
      listExpiringTokens: vi.fn().mockResolvedValue([row(), row({ Subject: 'sub-2' })]),
    });

    const result = await runRefreshSweep({}, { repo });
    expect(result.scanned).toBe(2);
    expect(result.refreshed).toBe(0);
    expect(result.failed).toBe(2);
  });

  it('passes withinSeconds + limit through to the SP', async () => {
    const repo = makeRepo();
    await runRefreshSweep({ withinSeconds: 1800, limit: 25 }, { repo });
    expect(repo.listExpiringTokens).toHaveBeenCalledWith(1800, 25);
  });
});
