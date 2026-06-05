'use client';

/**
 * Phase 1.F — second-factor challenge for an OAuth sign-in.
 *
 * The API's OAuth callback redirected here with `?token=<mfa-challenge JWT>
 * &returnTo=<spa path>` instead of setting the refresh cookie. The user's
 * provider auth was good but they have TOTP enabled, so we still need
 * the second factor before issuing a session.
 *
 * On success the existing /auth/mfa/challenge endpoint sets the
 * refresh cookie itself, so we just need to call /auth/refresh to pick
 * up the access token (same as /oauth/finish does) and route on.
 */

import { Suspense, useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { mfaChallenge } from '@/server/actions/auth';

function MfaInner() {
  const t       = useTranslations('Auth');
  const router  = useRouter();
  const params  = useSearchParams();

  const [isPending, startTransition] = useTransition();

  const [mode,    setMode]    = useState<'totp' | 'recovery'>('totp');
  const [code,    setCode]    = useState('');
  const [error,   setError]   = useState<string | null>(null);

  // Bail to /login if we don't have a token — usually means a stale
  // bookmark or a refresh after the 5-minute challenge expired.
  const mfaToken = params.get('token');
  useEffect(() => {
    if (!mfaToken) router.replace('/login');
  }, [mfaToken, router]);

  const returnTo = params.get('returnTo');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaToken || !code) return;
    setError(null);
    const isTotp = mode === 'totp';
    startTransition(async () => {
      const result = await mfaChallenge(
        mfaToken,
        isTotp ? code : undefined,
        isTotp ? undefined : code,
      );
      if (result.ok) {
        // mfaChallenge set the session cookies server-side; just navigate.
        router.replace(returnTo || '/board');
      } else {
        setError('error' in result ? result.error : t('verificationFailed'));
      }
    });
  }

  if (!mfaToken) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border border-border bg-card p-6 space-y-4"
      >
        <div>
          <h1 className="text-lg font-semibold text-foreground">{t('twoFactorTitle')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === 'totp'
              ? t('totpPrompt')
              : t('recoveryPrompt')}
          </p>
        </div>

        {error && (
          <div className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <input
          type="text"
          inputMode={mode === 'totp' ? 'numeric' : 'text'}
          autoComplete="one-time-code"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.trim())}
          placeholder={mode === 'totp' ? '123456' : 'AAAA-BBBB-CCCC'}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground"
        />

        <button
          type="submit"
          disabled={isPending || !code}
          className="w-full rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium disabled:opacity-60"
        >
          {isPending ? t('verifying') : t('verifyAndContinue')}
        </button>

        <button
          type="button"
          onClick={() => { setMode((m) => m === 'totp' ? 'recovery' : 'totp'); setCode(''); setError(null); }}
          className="w-full text-xs text-muted-foreground hover:text-foreground"
        >
          {mode === 'totp' ? t('useRecoveryCode') : t('useAuthenticatorApp')}
        </button>
      </form>
    </div>
  );
}

export default function OAuthMfaPage() {
  // useSearchParams must be inside a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <MfaInner />
    </Suspense>
  );
}
