'use client';

import { createContext, ReactNode, useContext, useState } from 'react';
import type { HierarchyTreeData } from '@/components/hierarchy/SidebarTree';

type SidebarTheme = 'dark' | 'light';

/** Minimal viewer identity surfaced in the topbar (name / email / avatar).
 *  Sourced server-side from getMe() in the (app) layout — no in-memory store. */
export interface LayoutUser {
  name:      string;
  email:     string;
  avatarUrl: string | null;
}

// Define the shape of the layout state
interface LayoutState {
  sidebarCollapse: boolean;
  setSidebarCollapse: (open: boolean) => void;
  sidebarTheme: SidebarTheme;
  setSidebarTheme: (theme: SidebarTheme) => void;
  /** Server-derived: does the viewer hold any admin.* permission? */
  isAdmin: boolean;
  /** Server-derived current user for the topbar, or null. */
  user: LayoutUser | null;
  /** Server-derived Space/Folder/List tree for the active workspace (Phase 1). */
  hierarchy: HierarchyTreeData | null;
  /** Server-seeded unread notification count for the topbar bell badge (Phase 3.5b). */
  initialUnread: number;
}

// Create the context
const LayoutContext = createContext<LayoutState | undefined>(undefined);

// Provider component
interface LayoutProviderProps {
  children: ReactNode;
  isAdmin?: boolean;
  user?:    LayoutUser | null;
  hierarchy?: HierarchyTreeData | null;
  initialUnread?: number;
}

export function LayoutProvider({ children, isAdmin = false, user = null, hierarchy = null, initialUnread = 0 }: LayoutProviderProps) {
  const [sidebarCollapse, setSidebarCollapse] = useState(false);
  const [sidebarTheme, setSidebarTheme] = useState<SidebarTheme>('light');

  return (
    <LayoutContext.Provider
      value={{
        sidebarCollapse,
        setSidebarCollapse,
        sidebarTheme,
        setSidebarTheme,
        isAdmin,
        user,
        hierarchy,
        initialUnread,
      }}
    >
      {children}
    </LayoutContext.Provider>
  );
}

// Custom hook for consuming the context
export const useLayout = () => {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayout must be used within a LayoutProvider');
  }
  return context;
};
