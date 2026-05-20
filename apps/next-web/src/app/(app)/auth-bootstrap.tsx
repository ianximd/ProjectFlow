'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@/store/useStore';
import { ScreenLoader } from '@/components/screen-loader';

// Silent token refresh on mount; restores the in-memory access token from the
// httpOnly refresh cookie so a page reload doesn't kick the user out.
export function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const setAuth = useStore((s) => s.setAuth);

  useEffect(() => {
    fetch('/api/auth/refresh', { method: 'POST' })
      .then(async (res) => {
        if (res.ok) {
          const json = await res.json();
          setAuth(json.data.token, json.data.user ?? {});
        }
      })
      .catch(() => {
        // No valid cookie — user needs to log in
      })
      .finally(() => setReady(true));
  }, [setAuth]);

  if (!ready) return <ScreenLoader />;

  return <>{children}</>;
}
