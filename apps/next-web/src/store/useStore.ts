import { create } from 'zustand';

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

const defaultCols: Column[] = [
  { id: 'To Do', title: 'To Do' },
  { id: 'In Progress', title: 'In Progress' },
  { id: 'Done', title: 'Done' },
];

export const useStore = create<BoardState & AuthState>((set) => ({
  // Board state
  columns: defaultCols,
  // Auth state — access token lives in memory only (never localStorage)
  accessToken: null,
  user: null,
  setAuth: (token, user) => set({ accessToken: token, user }),
  clearAuth: () => set({ accessToken: null, user: null }),
}));
