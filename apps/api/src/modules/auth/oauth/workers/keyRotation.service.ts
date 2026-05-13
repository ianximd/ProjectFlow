/**
 * Key-rotation sweep (Phase 1.E).
 *
 * One pass: find identity rows whose stored ciphertext was encrypted
 * under a key OTHER than the current PRIMARY, decrypt with the
 * (still-loaded) old key, re-seal under PRIMARY, write back. Walks the
 * table in fixed-size batches (default 100 rows / run) so a long
 * rotation drains the backlog over many ticks rather than freezing
 * the table.
 *
 * The runbook (docs/runbooks/oauth-key-rotation.md) used to call out
 * this work as "do this manually with SQL". Phase 1.E automates it.
 */

import { OAuthRepository, type TokenStoreRow } from '../repository.js';
import {
  isConfigured as cryptoConfigured,
  describeKeyset,
  open,
  seal,
} from '../../../../shared/lib/tokenCrypto.js';
import { subLogger } from '../../../../shared/lib/logger.js';

const log = subLogger('oauth-rotate');

export interface RotationSweepResult {
  primary:    string | null;
  scanned:    number;
  rotated:    number;
  failed:     number;
  remaining:  'unknown' | 'maybe-more' | 'caught-up'; // hints next-tick scheduling
}

export interface RotationSweepOptions {
  limit?: number; // default 100
}

export async function runRotationSweep(
  opts: RotationSweepOptions = {},
  deps: { repo?: OAuthRepository } = {},
): Promise<RotationSweepResult> {
  const ks = describeKeyset();
  const result: RotationSweepResult = {
    primary:   ks.primary,
    scanned:   0,
    rotated:   0,
    failed:    0,
    remaining: 'unknown',
  };

  if (!cryptoConfigured() || !ks.primary) {
    // No primary configured → nothing to rotate to.
    result.remaining = 'caught-up';
    return result;
  }

  const repo  = deps.repo ?? new OAuthRepository();
  const limit = opts.limit ?? 100;
  const rows  = await repo.listByKeyVersion(ks.primary, limit);
  result.scanned = rows.length;

  for (const row of rows) {
    try {
      await rotateOne(row, ks.primary, repo);
      result.rotated += 1;
    } catch (err: any) {
      result.failed += 1;
      log.error(
        {
          provider: row.Provider, subject: row.Subject,
          oldKey:   row.TokenKeyVersion,
          reason:   err?.message ?? String(err),
        },
        'row failed',
      );
    }
  }

  // If we filled the batch, there are probably more rows waiting; if we
  // got fewer rows than the limit, this run drained the backlog.
  result.remaining = rows.length === limit ? 'maybe-more' : 'caught-up';
  return result;
}

async function rotateOne(row: TokenStoreRow, primary: string, repo: OAuthRepository): Promise<void> {
  if (!row.TokenKeyVersion) {
    throw new Error('row has NULL TokenKeyVersion but SP filter let it through');
  }
  if (row.TokenKeyVersion === primary) {
    // Race: someone re-encrypted between our SELECT and the worker
    // picking the row up. Nothing to do — count as success.
    return;
  }

  // Both columns may legitimately be NULL on a given row. Re-seal what's
  // present; preserve NULLs.
  const access  = row.AccessTokenEnc  ? seal(open(row.AccessTokenEnc))  : null;
  const refresh = row.RefreshTokenEnc ? seal(open(row.RefreshTokenEnc)) : null;

  await repo.upsertTokens({
    provider:        row.Provider,
    subject:         row.Subject,
    accessTokenEnc:  access?.sealed  ?? null,
    refreshTokenEnc: refresh?.sealed ?? null,
    tokenExpiresAt:  row.TokenExpiresAt,
    // seal() always returns the PRIMARY key id, so picking either is
    // fine — they're the same. We write it explicitly for clarity.
    tokenKeyVersion: primary,
  });
}
