import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useIsMobile } from '@/hooks/use-mobile';
import { MENU_SIDEBAR } from '@/config/layout-1.config';
import { useLayout } from './context';
import { Footer } from './footer';
import { Header } from './header';
import { Sidebar } from './sidebar';

function derivePageTitle(pathname: string): string {
  const item = MENU_SIDEBAR.find(
    (i) => i.path && pathname.startsWith(i.path.split('?')[0]),
  );
  if (item?.title) return item.title;
  const seg = pathname.split('/').filter(Boolean)[0];
  if (!seg) return 'Home';
  return seg
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

export function Main({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const { sidebarCollapse } = useLayout();
  const pageTitle = derivePageTitle(pathname);

  useEffect(() => {
    const bodyClass = document.body.classList;
    if (sidebarCollapse) {
      bodyClass.add('sidebar-collapse');
    } else {
      bodyClass.remove('sidebar-collapse');
    }
  }, [sidebarCollapse]);

  useEffect(() => {
    const bodyClass = document.body.classList;
    bodyClass.add('demo1');
    bodyClass.add('sidebar-fixed');
    bodyClass.add('header-fixed');
    const timer = setTimeout(() => {
      bodyClass.add('layout-initialized');
    }, 1000);
    return () => {
      bodyClass.remove('demo1');
      bodyClass.remove('sidebar-fixed');
      bodyClass.remove('sidebar-collapse');
      bodyClass.remove('header-fixed');
      bodyClass.remove('layout-initialized');
      clearTimeout(timer);
    };
  }, []);

  return (
    <>
      {!isMobile && <Sidebar />}

      <div className="wrapper flex grow flex-col">
        <Header />

        <main id="main-content" tabIndex={-1} className="grow px-5 lg:px-6 py-5">
          <div className="mb-5">
            <h1 className="text-xl lg:text-2xl font-semibold tracking-tight text-foreground">
              {pageTitle}
            </h1>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-xs p-5 lg:p-6 min-h-[calc(100vh-var(--header-height)-7rem)]">
            {children}
          </div>
        </main>

        <Footer />
      </div>
    </>
  );
}
