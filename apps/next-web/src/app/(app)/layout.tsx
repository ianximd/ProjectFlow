import type { ReactNode } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { Layout1 } from '@/components/layouts/layout-1';
import type { LayoutUser } from '@/components/layouts/layout-1/components/context';
import { AuthBootstrap } from './auth-bootstrap';
import { hasAdminAccess } from '@/server/queries/admin';
import { getMe, type MeProfile } from '@/server/queries/profile';

/** Run a layout lookup, tolerating transient API failures (so a flaky /auth/me
 *  doesn't crash the whole app shell) while still letting Next redirect/notFound
 *  control flow (e.g. a 401 → /login from serverFetch) propagate. */
async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    unstable_rethrow(e);
    return fallback;
  }
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const [me, isAdmin] = await Promise.all([
    safe<MeProfile | null>(getMe(), null),
    safe(hasAdminAccess(), false),
  ]);

  const user: LayoutUser | null = me
    ? { name: me.name, email: me.email, avatarUrl: me.avatarUrl }
    : null;

  return (
    <AuthBootstrap>
      <Layout1 isAdmin={isAdmin} user={user}>{children}</Layout1>
    </AuthBootstrap>
  );
}
