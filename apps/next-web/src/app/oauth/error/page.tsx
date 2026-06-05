'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

type ReasonKeys = {
  titleKey: string;
  bodyKey: string;
};

const REASON_KEYS: Record<string, ReasonKeys> = {
  INVALID_STATE: {
    titleKey: 'oauthErrorInvalidStateTitle',
    bodyKey:  'oauthErrorInvalidStateBody',
  },
  PROVIDER_ERROR: {
    titleKey: 'oauthErrorProviderErrorTitle',
    bodyKey:  'oauthErrorProviderErrorBody',
  },
  NO_EMAIL: {
    titleKey: 'oauthErrorNoEmailTitle',
    bodyKey:  'oauthErrorNoEmailBody',
  },
  ACCOUNT_EXISTS: {
    titleKey: 'oauthErrorAccountExistsTitle',
    bodyKey:  'oauthErrorAccountExistsBody',
  },
};

function ErrorInner() {
  const t      = useTranslations('Auth');
  const params = useSearchParams();
  const reason = params.get('reason') ?? 'INVALID_STATE';
  const keys   = REASON_KEYS[reason] ?? REASON_KEYS['INVALID_STATE']!;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white p-8 rounded-xl shadow-sm border border-gray-100 text-center space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">{t(keys.titleKey)}</h1>
        <p className="text-sm text-gray-600">{t(keys.bodyKey)}</p>
        <Link
          href="/login"
          className="inline-flex items-center justify-center w-full h-10 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          {t('backToSignIn')}
        </Link>
      </div>
    </div>
  );
}

export default function OAuthErrorPage() {
  return (
    <Suspense fallback={null}>
      <ErrorInner />
    </Suspense>
  );
}
