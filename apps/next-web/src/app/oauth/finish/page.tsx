'use client';

/**
 * Landing page for the OAuth callback's final hop. The API has already
 * set the httpOnly refresh cookie; we trade it for an in-memory access
 * token via /auth/refresh and then route to the original `returnTo`.
 *
 * Mirrors the silent-refresh path AuthBootstrap takes on every cold
 * load, but runs OUTSIDE the (app) layout so the user sees a brief
 * "Signing you in…" screen rather than the AuthBootstrap loader.
 */

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function FinishInner() {
  const router       = useRouter();
  const params       = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const returnTo = params.get('returnTo') || '/board';

    // Establish the BFF cookie session from the refresh cookie via the Next
    // route handler (it sets pf_at/pf_rt) — the same path AuthBootstrap used.
    // No in-memory token anymore; once cookies are set we just navigate.
    fetch('/api/auth/refresh', { method: 'POST' })
      .then((res) => {
        if (!res.ok) throw new Error(`refresh failed (${res.status})`);
        router.replace(returnTo);
      })
      .catch((err) => {
        // Cookie was set by the callback but our refresh somehow failed.
        // Send the user to /login with a banner so they can retry.
        setError(err.message ?? 'Sign-in failed');
        setTimeout(() => router.replace('/login'), 2000);
      });
  }, [params, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="text-center space-y-3">
        <div className="text-lg font-medium text-gray-900">
          {error ? 'Sign-in failed' : 'Signing you in…'}
        </div>
        {error && (
          <div className="text-sm text-red-600">{error}</div>
        )}
      </div>
    </div>
  );
}

export default function OAuthFinishPage() {
  // useSearchParams must be inside a Suspense boundary in the app router.
  return (
    <Suspense fallback={null}>
      <FinishInner />
    </Suspense>
  );
}
