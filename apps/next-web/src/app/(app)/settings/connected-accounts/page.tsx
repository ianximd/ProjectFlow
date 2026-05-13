'use client';

/**
 * Connected accounts — drives the OAuth link / unlink flow from inside
 * the app shell. Lists providers the user has linked plus any other
 * configured-but-unlinked providers (so they can connect them too).
 *
 * Phase 1.C scope. The "last credential" warning is shown inline on the
 * Disconnect button so a password-less OAuth-only user can't accidentally
 * lock themselves out — the API still enforces it (returns 409
 * LAST_CREDENTIAL) so this is just UX polish.
 */

import { useEffect, useState } from 'react';
import { useStore } from '@/store/useStore';

interface Identity {
  id:        string;
  provider:  string;
  email:     string | null;
  createdAt: string;
}

const PROVIDER_LABEL: Record<string, string> = {
  google:    'Google',
  github:    'GitHub',
  microsoft: 'Microsoft',
};

async function fetchJSON<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization:  `Bearer ${token ?? ''}`,
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error?.message ?? `${res.status}`);
  return json as T;
}

export default function ConnectedAccountsPage() {
  const accessToken = useStore((s) => s.accessToken);

  const [available, setAvailable] = useState<{ name: string }[]>([]);
  const [linked,    setLinked]    = useState<Identity[] | null>(null);
  const [busy,      setBusy]      = useState<string | null>(null);
  const [error,     setError]     = useState<string | null>(null);
  const [success,   setSuccess]   = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const [providers, identities] = await Promise.all([
        fetchJSON<{ data: { name: string }[] }>('/auth/oauth/providers', accessToken),
        fetchJSON<{ data: Identity[] }>('/auth/oauth/identities', accessToken),
      ]);
      setAvailable(providers.data);
      setLinked(identities.data);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [accessToken]);

  async function disconnect(provider: string) {
    setBusy(provider);
    setError(null);
    setSuccess(null);
    try {
      await fetchJSON(`/auth/oauth/identities/${provider}`, accessToken, { method: 'DELETE' });
      setSuccess(`${PROVIDER_LABEL[provider] ?? provider} disconnected.`);
      await refresh();
    } catch (err) {
      // The API surfaces 409 LAST_CREDENTIAL with a copy-ready message.
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!linked) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  const linkedSlugs    = new Set(linked.map((i) => i.provider));
  const unlinkedNow    = available.filter((p) => !linkedSlugs.has(p.name) && p.name !== 'fake');
  const onlyCredential = linked.length === 1; // see warning below

  return (
    <div className="max-w-2xl p-6 space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-foreground">Connected accounts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sign in faster by connecting your social accounts.
        </p>
      </header>

      {error && (
        <div className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border-l-2 border-emerald-500 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          {success}
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">Linked</h2>
        {linked.length === 0 && (
          <p className="text-sm text-muted-foreground">You haven&apos;t connected any providers yet.</p>
        )}
        {linked.map((i) => (
          <div
            key={i.id}
            className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">
                {PROVIDER_LABEL[i.provider] ?? i.provider}
              </div>
              {i.email && (
                <div className="text-xs text-muted-foreground truncate">{i.email}</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => disconnect(i.provider)}
              disabled={busy === i.provider}
              className="text-sm text-destructive hover:underline disabled:opacity-60"
              title={onlyCredential
                ? 'This is your only credential. Set a password before disconnecting to avoid being locked out.'
                : undefined}
            >
              {busy === i.provider ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        ))}
      </section>

      {unlinkedNow.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">Available</h2>
          {unlinkedNow.map((p) => (
            <a
              key={p.name}
              href={`/api/v1/auth/oauth/${p.name}/link?returnTo=${encodeURIComponent('/settings/connected-accounts')}`}
              className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 hover:bg-muted/30"
            >
              <span className="text-sm font-medium text-foreground">
                {PROVIDER_LABEL[p.name] ?? p.name}
              </span>
              <span className="text-xs text-muted-foreground">Connect</span>
            </a>
          ))}
        </section>
      )}
    </div>
  );
}
