import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

export type Id = string | number;

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
  tasks: Task[];
  addTask: (columnId: Id, content: string) => void;
  deleteTask: (id: Id) => void;
  updateTask: (id: Id, content: string) => void;
  moveTask: (taskId: Id, targetColumnId: Id) => void;
  reorderTasks: (newTasks: Task[]) => void;
}

const defaultCols: Column[] = [
  { id: 'todo', title: 'To Do' },
  { id: 'in-progress', title: 'In Progress' },
  { id: 'done', title: 'Done' },
];

const defaultTasks: Task[] = [
  { id: '1', columnId: 'todo', content: 'Set up project structure', priority: 'High' },
  { id: '2', columnId: 'todo', content: 'Design Kanban UI', priority: 'Medium' },
  { id: '3', columnId: 'in-progress', content: 'Implement drag and drop', priority: 'High' },
  { id: '4', columnId: 'done', content: 'Initialize repository', priority: 'Low' },
];

export const useStore = create<BoardState>((set) => ({
  columns: defaultCols,
  tasks: defaultTasks,

  addTask: (columnId, content) => {
    set((state) => ({
      tasks: [
        ...state.tasks,
        {
          id: uuidv4(),
          columnId,
          content,
          priority: 'Medium',
        },
      ],
    }));
  },

  deleteTask: (id) => {
    set((state) => ({
      tasks: state.tasks.filter((task) => task.id !== id),
    }));
  },

  updateTask: (id, content) => {
    set((state) => ({
      tasks: state.tasks.map((task) => (task.id === id ? { ...task, content } : task)),
    }));
  },

  moveTask: (taskId, targetColumnId) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, columnId: targetColumnId } : t
      ),
    }));
  },

  reorderTasks: (newTasks) => {
    set({ tasks: newTasks });
  },
}));
