'use client';

import type { ReactNode } from 'react';
import { Layout1 } from '@/components/layouts/layout-1';
import { AuthBootstrap } from './auth-bootstrap';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthBootstrap>
      <Layout1>{children}</Layout1>
    </AuthBootstrap>
  );
}
