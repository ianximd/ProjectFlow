/**
 * Silent-refresh sweep (Phase 1.E).
 *
 * One pass: find identity rows whose access token is about to expire and
 * have a stored refresh token, ask the provider for a fresh pair, write
 * the result back encrypted. Never throws — per-row failures are logged
 * and counted but the sweep keeps going so one bad row doesn't poison
 * the whole batch.
 *
 * The work is split from the worker wiring so tests can drive it with a
 * fake clock + mocked provider, and so the same function can be invoked
 * ad-hoc from an admin endpoint in the future.
 */

import { OAuthRepository, type TokenStoreRow } from '../repository.js';
import { getProvider } from '../registry.js';
import { isConfigured as cryptoConfigured, seal, open } from '../../../../shared/lib/tokenCrypto.js';
import { subLogger } from '../../../../shared/lib/logger.js';

const log = subLogger('oauth-refresh');

export interface RefreshSweepResult {
  scanned:         number; // rows pulled from the SP
  refreshed:       number; // rows where the provider returned new tokens AND we persisted them
  skippedNoRefresh: number; // provider doesn't support refresh OR row's RefreshTokenEnc is unreadable
  failed:          number; // provider call or persistence error
}

export interface RefreshSweepOptions {
  withinSeconds?: number; // default 600 (10 min) — see SP
  limit?:         number; // default 100 — protects against runaway batches
}

export async function runRefreshSweep(
  opts: RefreshSweepOptions = {},
  deps: { repo?: OAuthRepository } = {},
): Promise<RefreshSweepResult> {
  const result: RefreshSweepResult = { scanned: 0, refreshed: 0, skippedNoRefresh: 0, failed: 0 };

  if (!cryptoConfigured()) {
    // Without an encryption key we have nothing to decrypt and nothing
    // to persist back. Boot-time gate would also catch this, but a
    // defence-in-depth check here keeps the function correct in tests.
    return result;
  }

  const repo = deps.repo ?? new OAuthRepository();
  const rows = await repo.listExpiringTokens(opts.withinSeconds ?? 600, opts.limit ?? 100);
  result.scanned = rows.length;

  for (const row of rows) {
    try {
      await refreshOne(row, repo);
      result.refreshed += 1;
    } catch (err: any) {
      // Provider revocation, network blip, schema row that can't be
      // decrypted — none of these should break the rest of the sweep.
      const reason = err?.message ?? String(err);
      if (reason.includes('does not support refresh')) {
        result.skippedNoRefresh += 1;
      } else {
        result.failed += 1;
        log.error({ provider: row.Provider, subject: row.Subject, reason }, 'row failed');
      }
    }
  }

  return result;
}

async function refreshOne(row: TokenStoreRow, repo: OAuthRepository): Promise<void> {
  const provider = getProvider(row.Provider);
  if (!provider) {
    throw new Error(`unknown provider "${row.Provider}" — was it disabled?`);
  }
  if (!provider.refreshTokens) {
    throw new Error(`provider "${row.Provider}" does not support refresh`);
  }
  if (!row.RefreshTokenEnc) {
    throw new Error(`row missing RefreshTokenEnc — SP filter let it through unexpectedly`);
  }

  const refreshPlaintext = open(row.RefreshTokenEnc);
  const fresh            = await provider.refreshTokens(refreshPlaintext);

  const access  = seal(fresh.accessToken);
  const refresh = fresh.refreshToken ? seal(fresh.refreshToken) : null;

  await repo.upsertTokens({
    provider:        row.Provider,
    subject:         row.Subject,
    accessTokenEnc:  access.sealed,
    refreshTokenEnc: refresh?.sealed ?? null, // SP preserves prior on NULL
    tokenExpiresAt:  fresh.expiresAt ?? null,
    tokenKeyVersion: access.keyId,
  });
}
