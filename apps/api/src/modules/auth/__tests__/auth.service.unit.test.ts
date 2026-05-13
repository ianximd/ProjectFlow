import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../../../shared/lib/jwtSecret.js';

// bcrypt is mocked so cost-12 hashes don't slow the suite. Behavioural
// guarantee preserved: compare(plain, 'hash:plain') === true, anything
// else === false. The "is bcrypt cost 12?" assertion belongs in a
// security-config test, not here.
vi.mock('bcryptjs', () => ({
  default: {
    hash:    vi.fn(async (plain: string) => `hash:${plain}`),
    compare: vi.fn(async (plain: string, hash: string) => hash === `hash:${plain}`),
  },
}));

// mfaService is a module singleton; replace it wholesale so we can drive
// the TOTP / recovery-code branches deterministically.
vi.mock('../mfa.service.js', () => ({
  mfaService: {
    verifyTotp:           vi.fn(),
    findRecoveryCodeId:   vi.fn(),
    generateSecret:       vi.fn(() => 'fixed-secret'),
    otpauthUri:           vi.fn(() => 'otpauth://fixed'),
    generateRecoveryCodes: vi.fn(async () => ({ plaintext: ['code-1'], hashes: ['hash-1'] })),
  },
}));

// Imported AFTER vi.mock so the spies are in place when AuthService binds
// its references.
const { AuthService } = await import('../auth.service.js');
const { mfaService }  = await import('../mfa.service.js');

// ─── Repo mock factory ───────────────────────────────────────────────────────
// AuthService takes its repo through the constructor, which makes injection
// trivial — no module mocking required. Each test starts from a fresh mock.
function makeRepo(overrides: Partial<Record<string, any>> = {}) {
  return {
    createUser:                  vi.fn(),
    getUserById:                 vi.fn(),
    getUserByEmail:              vi.fn(),
    createRefreshToken:          vi.fn(),
    getRefreshToken:             vi.fn(),
    revokeRefreshToken:          vi.fn(),
    createPasswordResetToken:    vi.fn(),
    consumePasswordResetToken:   vi.fn(),
    recordFailedLogin:           vi.fn(),
    clearLoginAttempts:          vi.fn(),
    getMfaState:                 vi.fn(),
    setMfaPending:               vi.fn(),
    enableMfa:                   vi.fn(),
    disableMfa:                  vi.fn(),
    createRecoveryCodes:         vi.fn(),
    listRecoveryHashes:          vi.fn(),
    consumeRecoveryCode:         vi.fn(),
    ...overrides,
  } as any;
}

// Canonical "good" user record. Tests can shallow-clone and tweak.
const baseUser = {
  Id:           'user-1',
  Email:        'alice@example.com',
  Name:         'Alice',
  PasswordHash: 'hash:correct-pass',
  MfaEnabled:   false,
  LockedUntil:  null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── login() ────────────────────────────────────────────────────────────────

describe('AuthService.login', () => {
  it('issues tokens on a correct password (no MFA)', async () => {
    const repo = makeRepo({ getUserByEmail: vi.fn().mockResolvedValue(baseUser) });
    const svc  = new AuthService(repo);

    const result = await svc.login('alice@example.com', 'correct-pass');

    expect(result).toMatchObject({ kind: 'tokens', user: { Id: 'user-1' } });
    expect((result as any).accessToken).toBeTypeOf('string');
    expect((result as any).refreshToken).toBeTypeOf('string');
    // The refresh token must be persisted; PasswordHash and MfaSecret must
    // never appear on the returned user.
    expect(repo.createRefreshToken).toHaveBeenCalledOnce();
    expect((result as any).user.PasswordHash).toBeUndefined();
    expect(repo.clearLoginAttempts).toHaveBeenCalledWith('user-1');
  });

  it('returns null on a wrong password and records the failure', async () => {
    const repo = makeRepo({ getUserByEmail: vi.fn().mockResolvedValue(baseUser) });
    const svc  = new AuthService(repo);

    const result = await svc.login('alice@example.com', 'WRONG');

    expect(result).toBeNull();
    expect(repo.recordFailedLogin).toHaveBeenCalledWith('user-1');
    expect(repo.createRefreshToken).not.toHaveBeenCalled();
    expect(repo.clearLoginAttempts).not.toHaveBeenCalled();
  });

  it('returns null when the email is unknown — no enumeration', async () => {
    const repo = makeRepo({ getUserByEmail: vi.fn().mockResolvedValue(null) });
    const svc  = new AuthService(repo);

    expect(await svc.login('ghost@example.com', 'whatever')).toBeNull();
    expect(repo.recordFailedLogin).not.toHaveBeenCalled();
  });

  it('returns "locked" when the user is currently locked out', async () => {
    const futureLock = new Date(Date.now() + 10 * 60 * 1000);
    const repo = makeRepo({
      getUserByEmail: vi.fn().mockResolvedValue({ ...baseUser, LockedUntil: futureLock }),
    });
    const svc = new AuthService(repo);

    const result = await svc.login('alice@example.com', 'correct-pass');

    expect(result).toBe('locked');
    // Critical: bcrypt must not run — that's the whole point of the early gate.
    // We assert by ensuring no failure was recorded and no tokens issued.
    expect(repo.recordFailedLogin).not.toHaveBeenCalled();
    expect(repo.createRefreshToken).not.toHaveBeenCalled();
  });

  it('treats an expired LockedUntil as not-locked', async () => {
    const pastLock = new Date(Date.now() - 60 * 1000);
    const repo = makeRepo({
      getUserByEmail: vi.fn().mockResolvedValue({ ...baseUser, LockedUntil: pastLock }),
    });
    const svc = new AuthService(repo);

    const result = await svc.login('alice@example.com', 'correct-pass');

    expect(result).toMatchObject({ kind: 'tokens' });
  });

  it('returns mfa-required when the user has MFA enabled — does NOT clear lockout', async () => {
    const repo = makeRepo({
      getUserByEmail: vi.fn().mockResolvedValue({ ...baseUser, MfaEnabled: true }),
    });
    const svc = new AuthService(repo);

    const result = await svc.login('alice@example.com', 'correct-pass');

    expect(result).toMatchObject({ kind: 'mfa-required' });
    // The mfaToken must be a JWT scoped to mfa-challenge purpose.
    const decoded = jwt.verify((result as any).mfaToken, JWT_SECRET) as any;
    expect(decoded.purpose).toBe('mfa-challenge');
    expect(decoded.userId).toBe('user-1');
    // No session tokens, no lockout reset until MFA is verified.
    expect(repo.createRefreshToken).not.toHaveBeenCalled();
    expect(repo.clearLoginAttempts).not.toHaveBeenCalled();
  });

  it('returns null when the stored user has no password hash (OAuth-only)', async () => {
    const repo = makeRepo({
      getUserByEmail: vi.fn().mockResolvedValue({ ...baseUser, PasswordHash: null }),
    });
    const svc = new AuthService(repo);

    expect(await svc.login('alice@example.com', 'whatever')).toBeNull();
    expect(repo.recordFailedLogin).not.toHaveBeenCalled();
  });
});

// ─── mfaChallenge() ─────────────────────────────────────────────────────────

describe('AuthService.mfaChallenge', () => {
  function makeMfaToken(payload: Record<string, unknown>, expiresIn = '5m'): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: expiresIn as any });
  }

  it('issues tokens on a correct TOTP code', async () => {
    vi.mocked(mfaService.verifyTotp).mockReturnValue(true);
    const repo = makeRepo({
      getMfaState: vi.fn().mockResolvedValue({ enabled: true, secret: 'sekret' }),
      getUserById: vi.fn().mockResolvedValue(baseUser),
    });
    const svc = new AuthService(repo);
    const mfaToken = makeMfaToken({ purpose: 'mfa-challenge', userId: 'user-1', email: baseUser.Email });

    const result = await svc.mfaChallenge(mfaToken, { code: '123456' });

    expect((result as any).accessToken).toBeTypeOf('string');
    expect((result as any).refreshToken).toBeTypeOf('string');
    expect(mfaService.verifyTotp).toHaveBeenCalledWith('123456', 'sekret');
    expect(repo.clearLoginAttempts).toHaveBeenCalledWith('user-1');
  });

  it('issues tokens on a valid recovery code (consumes it)', async () => {
    vi.mocked(mfaService.findRecoveryCodeId).mockResolvedValue('recovery-id-1');
    const repo = makeRepo({
      getMfaState:         vi.fn().mockResolvedValue({ enabled: true, secret: 'sekret' }),
      listRecoveryHashes:  vi.fn().mockResolvedValue([{ id: 'recovery-id-1', hash: 'h' }]),
      consumeRecoveryCode: vi.fn().mockResolvedValue(true),
      getUserById:         vi.fn().mockResolvedValue(baseUser),
    });
    const svc = new AuthService(repo);
    const mfaToken = makeMfaToken({ purpose: 'mfa-challenge', userId: 'user-1', email: baseUser.Email });

    const result = await svc.mfaChallenge(mfaToken, { recoveryCode: 'ABCD-EFGH-IJ' });

    expect((result as any).accessToken).toBeTypeOf('string');
    expect(repo.consumeRecoveryCode).toHaveBeenCalledWith('recovery-id-1');
  });

  it('returns "invalid-code" on a recovery code that bcrypt-matches but is already consumed', async () => {
    vi.mocked(mfaService.findRecoveryCodeId).mockResolvedValue('recovery-id-1');
    const repo = makeRepo({
      getMfaState:         vi.fn().mockResolvedValue({ enabled: true, secret: 'sekret' }),
      listRecoveryHashes:  vi.fn().mockResolvedValue([{ id: 'recovery-id-1', hash: 'h' }]),
      // SP returns false when ROWCOUNT is 0 → already consumed.
      consumeRecoveryCode: vi.fn().mockResolvedValue(false),
    });
    const svc = new AuthService(repo);
    const mfaToken = makeMfaToken({ purpose: 'mfa-challenge', userId: 'user-1', email: baseUser.Email });

    const result = await svc.mfaChallenge(mfaToken, { recoveryCode: 'ABCD-EFGH-IJ' });

    expect(result).toBe('invalid-code');
  });

  it('returns "invalid-token" on a forged or wrong-purpose JWT', async () => {
    const wrongPurpose = makeMfaToken({ purpose: 'access', userId: 'user-1' });
    const svc = new AuthService(makeRepo());
    expect(await svc.mfaChallenge(wrongPurpose, { code: '123456' })).toBe('invalid-token');
    expect(await svc.mfaChallenge('not.a.jwt', { code: '123456' })).toBe('invalid-token');
  });

  it('returns "invalid-token" when MFA is no longer enabled for the user', async () => {
    const repo = makeRepo({
      getMfaState: vi.fn().mockResolvedValue({ enabled: false, secret: null }),
    });
    const svc = new AuthService(repo);
    const mfaToken = makeMfaToken({ purpose: 'mfa-challenge', userId: 'user-1', email: baseUser.Email });

    expect(await svc.mfaChallenge(mfaToken, { code: '123456' })).toBe('invalid-token');
  });

  it('returns "invalid-code" on a wrong TOTP', async () => {
    vi.mocked(mfaService.verifyTotp).mockReturnValue(false);
    const repo = makeRepo({
      getMfaState: vi.fn().mockResolvedValue({ enabled: true, secret: 'sekret' }),
    });
    const svc = new AuthService(repo);
    const mfaToken = makeMfaToken({ purpose: 'mfa-challenge', userId: 'user-1', email: baseUser.Email });

    expect(await svc.mfaChallenge(mfaToken, { code: '000000' })).toBe('invalid-code');
  });
});

// ─── refreshAccessToken() ───────────────────────────────────────────────────

describe('AuthService.refreshAccessToken', () => {
  it('rotates: revokes the old token and issues a new pair', async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const repo = makeRepo({
      getRefreshToken:    vi.fn().mockResolvedValue({ UserId: 'user-1', RevokedAt: null, ExpiresAt: future }),
      revokeRefreshToken: vi.fn(),
      createRefreshToken: vi.fn(),
    });
    const svc = new AuthService(repo);

    const result = await svc.refreshAccessToken('raw-token-from-cookie');

    expect((result as any).accessToken).toBeTypeOf('string');
    expect((result as any).refreshToken).toBeTypeOf('string');
    expect((result as any).refreshToken).not.toBe('raw-token-from-cookie');
    // Rotation guarantee: the consumed token must be revoked exactly once.
    expect(repo.revokeRefreshToken).toHaveBeenCalledOnce();
    expect(repo.createRefreshToken).toHaveBeenCalledOnce();
  });

  it('returns null when the refresh token has been revoked (replay)', async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const repo = makeRepo({
      getRefreshToken: vi.fn().mockResolvedValue({
        UserId: 'user-1', RevokedAt: new Date(), ExpiresAt: future,
      }),
    });
    const svc = new AuthService(repo);

    expect(await svc.refreshAccessToken('replayed-token')).toBeNull();
    expect(repo.revokeRefreshToken).not.toHaveBeenCalled();
  });

  it('returns null when the refresh token is expired', async () => {
    const past = new Date(Date.now() - 60 * 1000);
    const repo = makeRepo({
      getRefreshToken: vi.fn().mockResolvedValue({ UserId: 'user-1', RevokedAt: null, ExpiresAt: past }),
    });
    const svc = new AuthService(repo);

    expect(await svc.refreshAccessToken('expired-token')).toBeNull();
    expect(repo.revokeRefreshToken).not.toHaveBeenCalled();
  });

  it('returns null on an unknown refresh token hash', async () => {
    const repo = makeRepo({ getRefreshToken: vi.fn().mockResolvedValue(null) });
    const svc  = new AuthService(repo);

    expect(await svc.refreshAccessToken('never-seen')).toBeNull();
  });
});

// ─── forgotPassword() ───────────────────────────────────────────────────────

describe('AuthService.forgotPassword', () => {
  it('returns a reset token for a known email and persists its hash', async () => {
    const repo = makeRepo({
      getUserByEmail:           vi.fn().mockResolvedValue(baseUser),
      createPasswordResetToken: vi.fn(),
    });
    const svc = new AuthService(repo);

    const result = await svc.forgotPassword('alice@example.com');

    expect(result?.resetToken).toBeTypeOf('string');
    expect(result?.resetToken.length).toBeGreaterThan(40); // 40-byte hex
    expect(repo.createPasswordResetToken).toHaveBeenCalledOnce();
    // The persisted token must be a HASH, not the raw value — this is the
    // protection that ensures a DB compromise can't impersonate users.
    const [, persistedHash] = repo.createPasswordResetToken.mock.calls[0]!;
    expect(persistedHash).not.toBe(result?.resetToken);
    expect(persistedHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it('returns null on an unknown email — no enumeration, no DB write', async () => {
    const repo = makeRepo({
      getUserByEmail:           vi.fn().mockResolvedValue(null),
      createPasswordResetToken: vi.fn(),
    });
    const svc = new AuthService(repo);

    expect(await svc.forgotPassword('ghost@example.com')).toBeNull();
    expect(repo.createPasswordResetToken).not.toHaveBeenCalled();
  });
});
