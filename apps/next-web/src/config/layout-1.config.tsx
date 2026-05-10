import {
  BarChart2,
  BookOpen,
  Braces,
  GitBranch,
  GitPullRequest,
  Layers,
  LayoutDashboard,
  List,
  ShieldCheck,
  Tag,
  Workflow,
  Zap,
} from 'lucide-react';
import { MenuConfig } from '@/config/types';

export const MENU_SIDEBAR: MenuConfig = [
  { heading: 'Workspace' },
  { title: 'Board',     icon: LayoutDashboard, path: '/board' },
  { title: 'Backlog',   icon: List,            path: '/backlog' },
  { title: 'Roadmap',   icon: GitBranch,       path: '/roadmap' },
  { title: 'Dashboard', icon: BarChart2,       path: '/dashboard' },

  { heading: 'Plan' },
  { title: 'Epics',     icon: Layers,          path: '/epics' },
  { title: 'Versions',  icon: BookOpen,        path: '/versions' },

  { heading: 'Configure' },
  { title: 'Workflows',     icon: Workflow,       path: '/workflows' },
  { title: 'Automations',   icon: Zap,            path: '/automations' },
  { title: 'Labels',        icon: Tag,            path: '/project-settings' },
  { title: 'Git',           icon: GitPullRequest, path: '/project-settings?tab=git' },

  { heading: 'System' },
  { title: 'Admin',         icon: ShieldCheck,    path: '/admin' },
  { title: 'GraphQL',       icon: Braces,         path: '/graphql-explorer' },
];
