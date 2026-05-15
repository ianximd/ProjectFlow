import {
  BarChart2,
  Bell,
  BookOpen,
  Braces,
  Building2,
  Folder,
  GitBranch,
  GitPullRequest,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  List,
  ShieldCheck,
  Tag,
  UserCog,
  Workflow,
  Zap,
} from 'lucide-react';
import { MenuConfig } from '@/config/types';

export const MENU_SIDEBAR: MenuConfig = [
  { heading: 'Workspace' },
  { title: 'Board',         icon: LayoutDashboard, path: '/board' },
  { title: 'Backlog',       icon: List,            path: '/backlog' },
  { title: 'Roadmap',       icon: GitBranch,       path: '/roadmap' },
  { title: 'Dashboard',     icon: BarChart2,       path: '/dashboard' },
  { title: 'Notifications', icon: Bell,            path: '/notifications' },

  { heading: 'Plan' },
  { title: 'Epics',     icon: Layers,          path: '/epics' },
  { title: 'Versions',  icon: BookOpen,        path: '/versions' },

  { heading: 'Configure' },
  { title: 'Workflows',     icon: Workflow,       path: '/workflows' },
  { title: 'Automations',   icon: Zap,            path: '/automations' },
  { title: 'Labels',        icon: Tag,            path: '/project-settings' },
  { title: 'Git',           icon: GitPullRequest, path: '/project-settings?tab=git' },

  { heading: 'System' },
  { title: 'Workspaces',    icon: Building2,      path: '/workspaces' },
  { title: 'Projects',      icon: Folder,         path: '/projects' },
  { title: 'Admin',         icon: ShieldCheck,    path: '/admin' },
  { title: 'GraphQL',       icon: Braces,         path: '/graphql-explorer' },

  { heading: 'Account' },
  { title: 'My Profile',    icon: UserCog,        path: '/settings/profile' },

  { heading: 'Help' },
  { title: 'User Guide',    icon: LifeBuoy,       path: '/user-guide' },
];
