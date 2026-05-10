'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useStore } from '@/store/useStore';

// Attempts a silent token refresh using the httpOnly refresh-token cookie.
// Runs once on mount so the access token is restored after a page reload.
function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const setAuth = useStore((s) => s.setAuth);

  useEffect(() => {
    fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' })
      .then(async (res) => {
        if (res.ok) {
          const json = await res.json();
          setAuth(json.data.token, json.data.user ?? {});
        }
      })
      .catch(() => {
        // No valid cookie — user needs to log in; that's expected
      })
      .finally(() => setReady(true));
  }, [setAuth]);

  if (!ready) return null;

  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <AuthBootstrap>{children}</AuthBootstrap>
    </QueryClientProvider>
  );
}
