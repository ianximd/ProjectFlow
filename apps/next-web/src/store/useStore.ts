import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// All ids in the app are UUID strings (tasks/projects/etc.) or string column
// names ('To Do', 'In Progress', …). The original `string | number` union was
// a leftover from pre-API local-only state — narrowing it to `string` removes
// the contravariant callback type errors in Board.tsx.
export type Id = string;

export type Column = {
  id: Id;
  title: string;
};

export type Task = {
  id: Id;
  columnId: Id;
  content: string;
  description?: string;
  assignee?: string;
  priority?: 'Low' | 'Medium' | 'High';
};

interface AuthState {
  accessToken: string | null;
  user: Record<string, unknown> | null;
  setAuth: (token: string, user: Record<string, unknown>) => void;
  clearAuth: () => void;
}

interface BoardState {
  columns: Column[];
}

// Shared workspace/project selection across pages. Each page used to keep its
// own `useState`, so navigating from Board → Epics would silently switch the
// active project to whichever came first in the workspace. Lifting it here
// keeps the dropdowns in sync so users see the same project everywhere.
interface SelectionState {
  currentWorkspaceId: string | null;
  currentProjectId:   string | null;
  setCurrentWorkspace: (id: string | null) => void;
  setCurrentProject:   (id: string | null) => void;
}

// Roadmap viewport — persisted so navigating away and back keeps the user on
// the same zoom level and scroll position. Without this the Gantt remounts
// each time and snaps back to today, losing the user's context.
export type RoadmapZoom = 'day' | 'week' | 'month';
interface RoadmapState {
  roadmapZoom:       RoadmapZoom;
  roadmapScrollLeft: number;
  setRoadmapZoom:       (z: RoadmapZoom) => void;
  setRoadmapScrollLeft: (px: number) => void;
}

const defaultCols: Column[] = [
  { id: 'To Do', title: 'To Do' },
  { id: 'In Progress', title: 'In Progress' },
  { id: 'Done', title: 'Done' },
];

export const useStore = create<BoardState & AuthState & SelectionState & RoadmapState>()(
  persist(
    (set) => ({
      // Board state
      columns: defaultCols,
      // Auth state — access token lives in memory only (never localStorage)
      accessToken: null,
      user: null,
      setAuth: (token, user) => set({ accessToken: token, user }),
      clearAuth: () => set({ accessToken: null, user: null, currentWorkspaceId: null, currentProjectId: null }),
      // Selection state — persisted so it survives reloads.
      currentWorkspaceId: null,
      currentProjectId:   null,
      setCurrentWorkspace: (id) => set({ currentWorkspaceId: id, currentProjectId: null }),
      setCurrentProject:   (id) => set({ currentProjectId: id }),
      // Roadmap state — persisted so the Gantt remembers zoom + scroll.
      roadmapZoom:       'week',
      roadmapScrollLeft: 0,
      setRoadmapZoom:       (z)  => set({ roadmapZoom: z }),
      setRoadmapScrollLeft: (px) => set({ roadmapScrollLeft: px }),
    }),
    {
      name: 'pf-selection',
      storage: createJSONStorage(() => localStorage),
      // Only persist the user-visible selection, never auth state.
      partialize: (s) => ({
        currentWorkspaceId: s.currentWorkspaceId,
        currentProjectId:   s.currentProjectId,
        roadmapZoom:        s.roadmapZoom,
        roadmapScrollLeft:  s.roadmapScrollLeft,
      }),
    },
  ),
);
