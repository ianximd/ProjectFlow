import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';

// ── Normalised shapes ─────────────────────────────────────────────────────────

export interface OAuthProvider {
  /** Provider slug — e.g. "google", "github", "microsoft" */
  name: string;
}

export interface OAuthIdentity {
  id:        string;
  provider:  string;
  email:     string | null;
  createdAt: string;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * GET /auth/oauth/providers
 * Returns the list of OAuth providers that are configured + enabled on the
 * server. Response shape: `{ data: { name: string }[] }` — standard envelope.
 */
export const getOAuthProviders = cache(async (): Promise<OAuthProvider[]> => {
  const rows = await serverFetch<{ name: string }[]>('/auth/oauth/providers');
  return (rows ?? []).map((r) => ({ name: String(r?.name ?? '') }));
});

/**
 * GET /auth/oauth/identities
 * Returns the OAuth identities the current user has linked.
 * Response shape: `{ data: { id, provider, email, createdAt }[] }` — standard envelope.
 */
export const getOAuthIdentities = cache(async (): Promise<OAuthIdentity[]> => {
  const rows = await serverFetch<{ id: string; provider: string; email: string | null; createdAt: string }[]>(
    '/auth/oauth/identities',
  );
  return (rows ?? []).map((r) => ({
    id:        String(r?.id        ?? ''),
    provider:  String(r?.provider  ?? ''),
    email:     r?.email            ?? null,
    createdAt: String(r?.createdAt ?? ''),
  }));
});
