import type { ReactNode } from 'react';

// Public share shell (Phase 10c). A SIBLING of the (app) group — the protected
// (app)/layout.tsx (which calls getMe()/auth) never wraps this, so the route
// renders for an unauthenticated visitor. No sidebar, no nav, no auth lookups.
export default function ShareLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" style={{ maxWidth: 880, margin: '0 auto', padding: '32px 20px' }}>
      {children}
    </main>
  );
}
