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
  { heading: 'Workspace',     headingKey: 'headingWorkspace' },
  { title: 'Board',         labelKey: 'board',         icon: LayoutDashboard, path: '/board' },
  { title: 'Backlog',       labelKey: 'backlog',       icon: List,            path: '/backlog' },
  { title: 'Roadmap',       labelKey: 'roadmap',       icon: GitBranch,       path: '/roadmap' },
  { title: 'Dashboard',     labelKey: 'dashboard',     icon: BarChart2,       path: '/dashboard' },
  { title: 'Notifications', labelKey: 'notifications', icon: Bell,            path: '/notifications' },

  { heading: 'Plan',          headingKey: 'headingPlan' },
  { title: 'Epics',     labelKey: 'epics',     icon: Layers,          path: '/epics' },
  { title: 'Versions',  labelKey: 'versions',  icon: BookOpen,        path: '/versions' },

  { heading: 'Configure',     headingKey: 'headingConfigure' },
  { title: 'Workflows',     labelKey: 'workflows',     icon: Workflow,       path: '/workflows' },
  { title: 'Automations',   labelKey: 'automations',   icon: Zap,            path: '/automations' },
  { title: 'Labels',        labelKey: 'labels',        icon: Tag,            path: '/project-settings' },
  { title: 'Git',           labelKey: 'git',           icon: GitPullRequest, path: '/project-settings?tab=git' },

  { heading: 'System',        headingKey: 'headingSystem' },
  { title: 'Workspaces',    labelKey: 'workspaces',    icon: Building2,      path: '/workspaces' },
  { title: 'Projects',      labelKey: 'projects',      icon: Folder,         path: '/projects' },
  { title: 'Admin',         labelKey: 'admin',         icon: ShieldCheck,    path: '/admin' },
  { title: 'GraphQL',       labelKey: 'graphQL',       icon: Braces,         path: '/graphql-explorer' },

  { heading: 'Account',       headingKey: 'headingAccount' },
  { title: 'My Profile',    labelKey: 'myProfile',     icon: UserCog,        path: '/settings/profile' },

  { heading: 'Help',          headingKey: 'headingHelp' },
  { title: 'User Guide',    labelKey: 'userGuide',     icon: LifeBuoy,       path: '/user-guide' },
];
