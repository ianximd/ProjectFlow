'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, CheckSquare, Settings, Users, List, GitBranch,
  Workflow, BarChart2, Zap, Tag, Layers, BookOpen, GitPullRequest,
  Braces, ShieldCheck, Menu, X,
} from 'lucide-react';
import { NotificationBell } from './NotificationBell';
import { SearchModal } from './SearchModal';
import styles from './Layout.module.css';

interface Props {
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { href: '/board',                    label: 'Board',               Icon: LayoutDashboard },
  { href: '/backlog',                  label: 'Backlog',             Icon: List },
  { href: '/roadmap',                  label: 'Roadmap',             Icon: GitBranch },
  { href: '/workflows',                label: 'Workflows',           Icon: Workflow },
  { href: '/automations',              label: 'Automations',         Icon: Zap },
  { href: '/versions',                 label: 'Versions',            Icon: BookOpen },
  { href: '/epics',                    label: 'Epics',               Icon: Layers },
  { href: '/project-settings',         label: 'Labels & Components', Icon: Tag },
  { href: '/project-settings?tab=git', label: 'Git Integration',     Icon: GitPullRequest },
  { href: '/graphql-explorer',         label: 'GraphQL API',         Icon: Braces },
  { href: '/admin',                    label: 'Admin',               Icon: ShieldCheck },
  { href: '/dashboard',                label: 'Dashboard',           Icon: BarChart2 },
  { href: '/my-issues',                label: 'My Issues',           Icon: CheckSquare },
  { href: '/team',                     label: 'Team',                Icon: Users },
  { href: '/settings',                 label: 'Settings',            Icon: Settings },
] as const;

export function Layout({ children }: Props) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  function closeSidebar() { setSidebarOpen(false); }

  return (
    <div className={styles.container}>
      {/* Skip navigation — WCAG 2.4.1 Bypass Blocks */}
      <a href="#main-content" className="skip-link">Skip to main content</a>

      {/* Global search modal */}
      <SearchModal />

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className={styles.overlay}
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      <aside
        id="sidebar"
        className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}
        aria-label="Application sidebar"
      >
        {/* Mobile close button */}
        <button
          className={styles.sidebarClose}
          onClick={closeSidebar}
          aria-label="Close sidebar"
        >
          <X size={20} aria-hidden="true" />
        </button>

        <div className={styles.logo}>
          <div className={styles.logoIcon} aria-hidden="true">PF</div>
          <span className={styles.logoText}>ProjectFlow</span>
        </div>

        <nav className={styles.nav} aria-label="Main navigation">
          {NAV_ITEMS.map(({ href, label, Icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className={`${styles.navItem} ${isActive ? styles.active : ''}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={closeSidebar}
              >
                <Icon size={18} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <main id="main-content" className={styles.main} tabIndex={-1}>
        <header className={styles.header}>
          {/* Mobile hamburger button */}
          <button
            className={styles.hamburger}
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={sidebarOpen}
            aria-controls="sidebar"
          >
            <Menu size={22} aria-hidden="true" />
          </button>

          <div className={styles.headerRow}>
            <p className={styles.pageTitle}>ProjectFlow</p>
            <div className={styles.headerActions}>
              <button
                className={styles.searchBtn}
                onClick={() => window.dispatchEvent(
                  new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })
                )}
                aria-label="Search issues (Ctrl+K)"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <span>Search</span>
                <span className={styles.kbdHint} aria-hidden="true">Ctrl+K</span>
              </button>
              <NotificationBell />
            </div>
          </div>
        </header>
        <div className={styles.content}>
          {children}
        </div>
      </main>
    </div>
  );
}
