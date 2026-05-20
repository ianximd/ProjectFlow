'use client';

import { useState, useTransition } from 'react';
import { notifyActionError } from '@/lib/apiErrorToast';
import { disconnectIdentity } from '@/server/actions/oauth';
import type { OAuthProvider, OAuthIdentity } from '@/server/queries/oauth';

// ── helpers ───────────────────────────────────────────────────────────────────

const PROVIDER_LABEL: Record<string, string> = {
  google:    'Google',
  github:    'GitHub',
  microsoft: 'Microsoft',
};

// ── ConnectedAccountsView ─────────────────────────────────────────────────────

interface Props {
  providers:  OAuthProvider[];
  identities: OAuthIdentity[];
}

export function ConnectedAccountsView({ providers, identities: initialIdentities }: Props) {
  // Optimistic local identity list so the UI updates immediately after disconnect.
  const [identities, setIdentities] = useState(initialIdentities);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const linkedSlugs    = new Set(identities.map((i) => i.provider));
  const unlinkedNow    = providers.filter((p) => !linkedSlugs.has(p.name) && p.name !== 'fake');
  const onlyCredential = identities.length === 1;

  function handleDisconnect(provider: string) {
    setBusyProvider(provider);
    startTransition(async () => {
      const res = await disconnectIdentity(provider);
      if (!res.ok) {
        notifyActionError(res);
      } else {
        // Optimistically remove the identity; revalidatePath will reconcile on
        // the next navigation / RSC refetch.
        setIdentities((prev) => prev.filter((i) => i.provider !== provider));
      }
      setBusyProvider(null);
    });
  }

  return (
    <div className="max-w-2xl p-6 space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-foreground">Connected accounts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sign in faster by connecting your social accounts.
        </p>
      </header>

      {/* ── Linked providers ─────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">Linked</h2>
        {identities.length === 0 && (
          <p className="text-sm text-muted-foreground">You haven&apos;t connected any providers yet.</p>
        )}
        {identities.map((i) => (
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
              onClick={() => handleDisconnect(i.provider)}
              disabled={busyProvider === i.provider}
              className="text-sm text-destructive hover:underline disabled:opacity-60"
              title={
                onlyCredential
                  ? 'This is your only credential. Set a password before disconnecting to avoid being locked out.'
                  : undefined
              }
            >
              {busyProvider === i.provider ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        ))}
      </section>

      {/* ── Available (unlinked) providers ───────────────────────────────── */}
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
