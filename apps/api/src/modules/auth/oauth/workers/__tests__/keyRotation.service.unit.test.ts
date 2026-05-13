/**
 * Unit coverage for the key-rotation sweep. Mocks the repo + crypto so we
 * can drive batches without standing up SQL.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../shared/lib/tokenCrypto.js', () => ({
  isConfigured:   vi.fn(() => true),
  seal:           vi.fn((pt: string) => ({ sealed: `sealed-v2:${pt}`, keyId: 'v2' })),
  open:           vi.fn((sealed: string) => sealed.replace(/^sealed-v\d:/, '')),
  describeKeyset: vi.fn(() => ({ primary: 'v2', available: ['v1', 'v2'] })),
  _resetForTest:  vi.fn(),
}));

const { runRotationSweep } = await import('../keyRotation.service.js');
const cryptoMod            = await import('../../../../../shared/lib/tokenCrypto.js');

function row(overrides: Record<string, any> = {}) {
  return {
    Id:               'id-1',
    UserId:           'user-1',
    Provider:         'fake',
    Subject:          'sub-1',
    AccessTokenEnc:   'sealed-v1:old-access',
    RefreshTokenEnc:  'sealed-v1:old-refresh',
    TokenExpiresAt:   new Date('2026-06-01T00:00:00Z'),
    TokenKeyVersion:  'v1',
    ...overrides,
  };
}

function makeRepo(overrides: Record<string, any> = {}) {
  return {
    listByKeyVersion: vi.fn().mockResolvedValue([]),
    upsertTokens:     vi.fn().mockResolvedValue(true),
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  (cryptoMod.isConfigured as any).mockReturnValue(true);
  (cryptoMod.describeKeyset as any).mockReturnValue({ primary: 'v2', available: ['v1', 'v2'] });
});
afterEach(() => { vi.useRealTimers(); });

describe('runRotationSweep', () => {
  it('returns caught-up when crypto is unconfigured', async () => {
    (cryptoMod.isConfigured as any).mockReturnValue(false);
    const repo = makeRepo();
    const result = await runRotationSweep({}, { repo });
    expect(result.remaining).toBe('caught-up');
    expect(result.scanned).toBe(0);
    expect(repo.listByKeyVersion).not.toHaveBeenCalled();
  });

  it('returns caught-up when no PRIMARY is set', async () => {
    (cryptoMod.describeKeyset as any).mockReturnValue({ primary: null, available: ['v1'] });
    const repo = makeRepo();
    const result = await runRotationSweep({}, { repo });
    expect(result.remaining).toBe('caught-up');
    expect(repo.listByKeyVersion).not.toHaveBeenCalled();
  });

  it('re-encrypts every row and writes back under PRIMARY', async () => {
    const repo = makeRepo({
      listByKeyVersion: vi.fn().mockResolvedValue([row(), row({ Subject: 'sub-2' })]),
    });
    const result = await runRotationSweep({ limit: 100 }, { repo });

    expect(result.scanned).toBe(2);
    expect(result.rotated).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe('caught-up'); // batch < limit
    expect(repo.upsertTokens).toHaveBeenCalledTimes(2);
    expect(repo.upsertTokens).toHaveBeenCalledWith(expect.objectContaining({
      accessTokenEnc:  'sealed-v2:old-access',
      refreshTokenEnc: 'sealed-v2:old-refresh',
      tokenKeyVersion: 'v2',
    }));
  });

  it('preserves NULL access/refresh columns when re-encrypting', async () => {
    const repo = makeRepo({
      listByKeyVersion: vi.fn().mockResolvedValue([row({
        AccessTokenEnc: null, RefreshTokenEnc: null,
      })]),
    });
    await runRotationSweep({}, { repo });
    expect(repo.upsertTokens).toHaveBeenCalledWith(expect.objectContaining({
      accessTokenEnc:  null,
      refreshTokenEnc: null,
      tokenKeyVersion: 'v2',
    }));
  });

  it('signals maybe-more when the batch fills the limit', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ Subject: `sub-${i}` }));
    const repo = makeRepo({ listByKeyVersion: vi.fn().mockResolvedValue(rows) });
    const result = await runRotationSweep({ limit: 5 }, { repo });
    expect(result.remaining).toBe('maybe-more');
    expect(result.scanned).toBe(5);
  });

  it('counts a row that already matches PRIMARY as rotated (no-op) without an upsert', async () => {
    // Race case: row was re-encrypted between SP SELECT and worker pickup.
    const repo = makeRepo({
      listByKeyVersion: vi.fn().mockResolvedValue([row({ TokenKeyVersion: 'v2' })]),
    });
    const result = await runRotationSweep({}, { repo });
    expect(result.rotated).toBe(1);
    expect(result.failed).toBe(0);
    expect(repo.upsertTokens).not.toHaveBeenCalled();
  });

  it('counts a decrypt failure as failed without aborting the sweep', async () => {
    (cryptoMod.open as any).mockImplementationOnce(() => {
      throw new Error('key "v0" not present in keyset');
    });
    const repo = makeRepo({
      listByKeyVersion: vi.fn().mockResolvedValue([
        row({ TokenKeyVersion: 'v0' }), // decrypt will throw
        row({ Subject: 'sub-2' }),       // this one succeeds
      ]),
    });

    const result = await runRotationSweep({}, { repo });
    expect(result.scanned).toBe(2);
    expect(result.rotated).toBe(1);
    expect(result.failed).toBe(1);
  });
});
