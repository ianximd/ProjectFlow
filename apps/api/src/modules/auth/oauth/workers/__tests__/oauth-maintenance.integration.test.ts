/**
 * Integration coverage for the OAuth maintenance workers (Phase 1.E).
 *
 * Drives the sweep functions directly (no Redis / no Worker) against the
 * real ProjectFlow_Test DB. The integration setup wires
 * OAUTH_TOKEN_ENC_KEY_PRIMARY=test, so tokens written here actually get
 * sealed end-to-end.
 *
 * What this proves that the unit tests can't:
 *   - usp_UserOAuthIdentity_ListExpiringTokens filters on TokenExpiresAt
 *     + RefreshTokenEnc correctly
 *   - usp_UserOAuthIdentity_ListByKeyVersion returns rows whose
 *     TokenKeyVersion <> @PrimaryKeyVersion
 *   - upsertTokens writes back values readable by a fresh decrypt
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { closePool, getPool } from '../../../../../shared/lib/db.js';
import { truncateAll }  from '../../../../../__tests__/fixtures/truncate.js';
import { OAuthRepository } from '../../repository.js';
import {
  registerFakeIdentity,
  clearFakeIdentities,
} from '../../providers/fake.js';
import { resetRegistry } from '../../registry.js';
import { runRefreshSweep }  from '../refreshTokens.service.js';
import { runRotationSweep } from '../keyRotation.service.js';
import {
  seal,
  describeKeyset,
  _resetForTest as resetCrypto,
} from '../../../../../shared/lib/tokenCrypto.js';

beforeEach(async () => {
  await truncateAll();
  clearFakeIdentities();
  resetRegistry();
  resetCrypto();
});
afterAll(async () => { await closePool(); });

/** Create a Users + UserOAuthIdentities row pair for a test identity. */
async function seedIdentity(opts: {
  email:           string;
  provider:        string;
  subject:         string;
  refreshToken:    string;       // PLAINTEXT — we'll seal it here
  expiresAt:       Date | null;
  keyVersion?:     string;       // overrides PRIMARY for the row's TokenKeyVersion column
}) {
  const pool = await getPool();
  // Create the user via the OAuth-create SP — easier than wiring two
  // separate inserts and gives us a real Users row.
  const userResult = await pool.request()
    .input('Email',         sql.NVarChar(255), opts.email)
    .input('Name',          sql.NVarChar(255), 'Maint Test')
    .input('AvatarUrl',     sql.NVarChar(500), null)
    .input('EmailVerified', sql.Bit,           true)
    .input('Provider',      sql.NVarChar(32),  opts.provider)
    .input('Subject',       sql.NVarChar(255), opts.subject)
    .execute('usp_User_CreateFromOAuth');
  const user = userResult.recordset[0];

  // Seal the refresh token under the current PRIMARY (or the override).
  const access = seal('initial-access');
  const refresh = seal(opts.refreshToken);

  await pool.request()
    .input('Provider',        sql.NVarChar(32),  opts.provider)
    .input('Subject',         sql.NVarChar(255), opts.subject)
    .input('AccessTokenEnc',  sql.NVarChar(sql.MAX), access.sealed)
    .input('RefreshTokenEnc', sql.NVarChar(sql.MAX), refresh.sealed)
    .input('TokenExpiresAt',  sql.DateTime2,        opts.expiresAt)
    .input('TokenKeyVersion', sql.NVarChar(16),     opts.keyVersion ?? access.keyId)
    .execute('usp_UserOAuthIdentity_UpsertTokens');

  return { userId: user.Id as string };
}

describe('runRefreshSweep — integration', () => {
  it('refreshes a row whose access token is past expiry', async () => {
    // Register a fake identity so the (provider, subject) lookup at
    // /me time doesn't matter; the worker only calls refreshTokens().
    registerFakeIdentity('seed-code', {
      subject: 'maint-sub-1', email: 'maint1@projectflow.test',
      emailVerified: true, name: 'Maint 1', avatarUrl: null,
    });
    await seedIdentity({
      email:        'maint1@projectflow.test',
      provider:     'fake',
      subject:      'maint-sub-1',
      refreshToken: 'rt-original',
      expiresAt:    new Date(Date.now() - 60_000), // expired one minute ago
    });

    const result = await runRefreshSweep({ withinSeconds: 600, limit: 10 });

    expect(result.scanned).toBeGreaterThanOrEqual(1);
    expect(result.refreshed).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);

    // Verify the persisted row was actually mutated by the worker. The
    // fake provider returns accessToken=`refreshed-${rt}` and rotates
    // the refresh to `${rt}-rotated`.
    const pool = await getPool();
    const r = await pool.request()
      .input('Subject', sql.NVarChar(255), 'maint-sub-1')
      .query(`
        SELECT AccessTokenEnc, RefreshTokenEnc, TokenExpiresAt, TokenKeyVersion
        FROM dbo.UserOAuthIdentities
        WHERE Provider = 'fake' AND Subject = @Subject
      `);
    const row = r.recordset[0];
    expect(row.TokenKeyVersion).toBe('test');
    // Decrypt with the live keyset and confirm the new plaintext.
    const { open } = await import('../../../../../shared/lib/tokenCrypto.js');
    expect(open(row.AccessTokenEnc)).toBe('refreshed-rt-original');
    expect(open(row.RefreshTokenEnc)).toBe('rt-original-rotated');
    expect(row.TokenExpiresAt).toBeInstanceOf(Date);
    // expiresAt should now be in the future (fake provider sets +1h).
    expect(new Date(row.TokenExpiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('does not pick up a row that is comfortably in the future', async () => {
    registerFakeIdentity('seed-future', {
      subject: 'maint-future', email: 'future@projectflow.test',
      emailVerified: true, name: 'Future', avatarUrl: null,
    });
    await seedIdentity({
      email:        'future@projectflow.test',
      provider:     'fake',
      subject:      'maint-future',
      refreshToken: 'rt-future',
      expiresAt:    new Date(Date.now() + 24 * 3600 * 1000), // 24h out
    });

    const result = await runRefreshSweep({ withinSeconds: 600, limit: 10 });
    expect(result.refreshed).toBe(0);
  });
});

describe('runRotationSweep — integration', () => {
  it('re-encrypts rows whose TokenKeyVersion <> PRIMARY and updates the column', async () => {
    // Stamp the row with a legacy key id ('legacy') that the keyset does
    // not contain. We don't actually need to decrypt it for this test —
    // the test confirms the SP filter selects it AND that rows the SP
    // ignores stay untouched.
    //
    // We can prove the rotation path by adding a SECOND key the keyset
    // CAN decrypt: register a known key under id 'older', seal under it,
    // stamp the row with TokenKeyVersion='older', then sweep.
    process.env.OAUTH_TOKEN_ENC_KEY_older = Buffer.alloc(32, 7).toString('base64');
    resetCrypto();

    // Seal the tokens under 'older' by temporarily flipping PRIMARY.
    const savedPrimary = process.env.OAUTH_TOKEN_ENC_KEY_PRIMARY!;
    process.env.OAUTH_TOKEN_ENC_KEY_PRIMARY = 'older';
    resetCrypto();

    const sealedAccess  = seal('legacy-access');
    const sealedRefresh = seal('legacy-refresh');
    expect(sealedAccess.keyId).toBe('older');

    // Restore PRIMARY=test for the actual sweep.
    process.env.OAUTH_TOKEN_ENC_KEY_PRIMARY = savedPrimary;
    resetCrypto();
    expect(describeKeyset().primary).toBe('test');

    // Bypass the test's seedIdentity helper so we can stamp the legacy
    // ciphertext + TokenKeyVersion explicitly.
    const pool = await getPool();
    await pool.request()
      .input('Email',         sql.NVarChar(255), 'rotate@projectflow.test')
      .input('Name',          sql.NVarChar(255), 'Rotate Me')
      .input('AvatarUrl',     sql.NVarChar(500), null)
      .input('EmailVerified', sql.Bit,           true)
      .input('Provider',      sql.NVarChar(32),  'fake')
      .input('Subject',       sql.NVarChar(255), 'rotate-sub')
      .execute('usp_User_CreateFromOAuth');
    await pool.request()
      .input('Provider',        sql.NVarChar(32),  'fake')
      .input('Subject',         sql.NVarChar(255), 'rotate-sub')
      .input('AccessTokenEnc',  sql.NVarChar(sql.MAX), sealedAccess.sealed)
      .input('RefreshTokenEnc', sql.NVarChar(sql.MAX), sealedRefresh.sealed)
      .input('TokenExpiresAt',  sql.DateTime2,        new Date(Date.now() + 3600_000))
      .input('TokenKeyVersion', sql.NVarChar(16),     'older')
      .execute('usp_UserOAuthIdentity_UpsertTokens');

    const result = await runRotationSweep({ limit: 10 });
    expect(result.primary).toBe('test');
    expect(result.scanned).toBeGreaterThanOrEqual(1);
    expect(result.rotated).toBeGreaterThanOrEqual(1);

    const r = await pool.request()
      .input('Subject', sql.NVarChar(255), 'rotate-sub')
      .query(`
        SELECT AccessTokenEnc, RefreshTokenEnc, TokenKeyVersion
        FROM dbo.UserOAuthIdentities
        WHERE Provider = 'fake' AND Subject = @Subject
      `);
    const row = r.recordset[0];
    expect(row.TokenKeyVersion).toBe('test');
    expect(row.AccessTokenEnc.startsWith('v1.test.')).toBe(true);
    expect(row.RefreshTokenEnc.startsWith('v1.test.')).toBe(true);

    // Cleanup — leave the env in a clean state for unrelated tests.
    delete process.env.OAUTH_TOKEN_ENC_KEY_older;
    resetCrypto();
  });

  it('returns scanned=0 when every row is already on PRIMARY', async () => {
    // No rows at all is the simplest "already on primary" case.
    const result = await runRotationSweep({ limit: 10 });
    expect(result.primary).toBe('test');
    expect(result.scanned).toBe(0);
    expect(result.remaining).toBe('caught-up');
  });
});

// Touch repo so the import isn't tree-shaken away on the unused warning.
void OAuthRepository;
