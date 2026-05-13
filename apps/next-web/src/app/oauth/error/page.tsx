'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

const REASON_COPY: Record<string, { title: string; body: string }> = {
  INVALID_STATE: {
    title: 'Sign-in could not be completed',
    body:  "The sign-in attempt expired or doesn't match. Please try again from the login page.",
  },
  PROVIDER_ERROR: {
    title: 'Provider error',
    body:  "We couldn't reach the sign-in provider. Try again in a moment.",
  },
  NO_EMAIL: {
    title: 'No email available',
    body:  'Your account did not return an email address. Make a verified email visible on the provider and try again.',
  },
  ACCOUNT_EXISTS: {
    title: 'Account already exists',
    body:  'An account with this email already exists. Sign in with your password — once linking ships, you can connect this provider from settings.',
  },
};

function ErrorInner() {
  const params = useSearchParams();
  const reason = params.get('reason') ?? 'INVALID_STATE';
  const copy   = REASON_COPY[reason] ?? REASON_COPY['INVALID_STATE']!;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white p-8 rounded-xl shadow-sm border border-gray-100 text-center space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">{copy.title}</h1>
        <p className="text-sm text-gray-600">{copy.body}</p>
        <Link
          href="/login"
          className="inline-flex items-center justify-center w-full h-10 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Back to sign in
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
