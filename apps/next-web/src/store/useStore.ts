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

// Auth lives entirely in httpOnly cookies (pf_at/pf_rt) + the server session
// now — there is no in-memory access token or user in this store (removed in
// the CSR→SSR migration, Phase 3). This store only holds client-only UI state:
// board columns, the workspace/project selection, and the roadmap viewport.
export const useStore = create<BoardState & SelectionState & RoadmapState>()(
  persist(
    (set) => ({
      // Board state
      columns: defaultCols,
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
      // Only persist the user-visible selection + roadmap viewport.
      partialize: (s) => ({
        currentWorkspaceId: s.currentWorkspaceId,
        currentProjectId:   s.currentProjectId,
        roadmapZoom:        s.roadmapZoom,
        roadmapScrollLeft:  s.roadmapScrollLeft,
      }),
    },
  ),
);
