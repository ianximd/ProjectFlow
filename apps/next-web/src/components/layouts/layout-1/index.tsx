'use client';

import { Metadata } from 'next';
import { LayoutProvider, type LayoutUser } from './components/context';
import { Main } from './components/main';

// Generate metadata for the layout
export async function generateMetadata(): Promise<Metadata> {
  // You can access route params here if needed
  // const { params } = props;

  return {
    title: 'Dashboard | Metronic',
    description: 'Central Hub for Personal Customization',
  };
}

export function Layout1({
  children,
  isAdmin = false,
  user = null,
}: {
  children: React.ReactNode;
  isAdmin?: boolean;
  user?: LayoutUser | null;
}) {
  return (
    <LayoutProvider isAdmin={isAdmin} user={user}>
      <Main>
        {children}
      </Main>
    </LayoutProvider>
  );
}
