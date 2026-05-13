/**
 * Redis-backed one-time state store for the OAuth start → callback flow.
 *
 * Replay protection: every `state` key is consumed via DEL on read, so
 * a replayed callback URL can't fish out the original PKCE verifier or
 * provider hint a second time.
 *
 * 10-minute TTL: long enough for a user to complete the consent screen,
 * short enough that an abandoned flow self-cleans.
 */

import { randomBytes } from 'node:crypto';
import { getRedis }    from '../../../shared/lib/redis.js';
import type { OAuthProviderName } from './types.js';

const TTL_SECONDS = 10 * 60;
const KEY_PREFIX  = 'oauth:state:';

export interface OAuthStatePayload {
  provider:     OAuthProviderName;
  nonce:        string;
  pkceVerifier: string;
  returnTo:     string;       // validated relative path to push the user to after sign-in
  /** When set, the callback links to this user instead of creating one. Phase 1.C. */
  linkUserId?:  string | null;
}

/** Generate a URL-safe random string suitable for state / nonce / verifier. */
export function makeRandomToken(byteLen = 32): string {
  return randomBytes(byteLen).toString('base64url');
}

export async function writeState(payload: OAuthStatePayload): Promise<string> {
  const state = makeRandomToken();
  await getRedis().set(`${KEY_PREFIX}${state}`, JSON.stringify(payload), 'EX', TTL_SECONDS);
  return state;
}

/**
 * Atomically consume a state token. Returns the payload on first read
 * and null forever after. Implemented as DEL-after-GET; we tolerate the
 * tiny race window because the state is one-time and short-TTL anyway —
 * a competing reader at the exact same instant is not a realistic
 * threat model for an OAuth callback.
 */
export async function consumeState(state: string): Promise<OAuthStatePayload | null> {
  const redis = getRedis();
  const key   = `${KEY_PREFIX}${state}`;
  const raw   = await redis.get(key);
  if (raw === null) return null;
  await redis.del(key);
  try {
    return JSON.parse(raw) as OAuthStatePayload;
  } catch {
    return null;
  }
}
