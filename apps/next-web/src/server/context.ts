// apps/next-web/src/server/context.ts
import 'server-only';
import { cache } from 'react';
import { getWorkspaces } from './queries/workspaces';
import { getProjects } from './queries/projects';
import { getSelection } from './selection';
import { resolveActiveId } from './queries/select-context';
import type { Workspace, Project } from './queries/normalize';

export interface WorkspaceProjectContext {
  workspaces: Workspace[];
  projects: Project[];
  activeWorkspaceId: string;        // '' only when workspaces is empty (caller -> /setup)
  activeProjectId: string | null;   // null when the workspace has no projects
  cookieWorkspaceId: string | null;
  cookieProjectId: string | null;
}

export const getWorkspaceProjectContext = cache(async (): Promise<WorkspaceProjectContext> => {
  const workspaces = await getWorkspaces();
  const { workspaceId: cookieWorkspaceId, projectId: cookieProjectId } = await getSelection();
  const activeWorkspaceId = resolveActiveId(workspaces, cookieWorkspaceId);
  if (activeWorkspaceId === null) {
    return { workspaces: [], projects: [], activeWorkspaceId: '', activeProjectId: null, cookieWorkspaceId, cookieProjectId };
  }
  const projects = await getProjects(activeWorkspaceId);
  const activeProjectId = resolveActiveId(projects, cookieProjectId);
  return { workspaces, projects, activeWorkspaceId, activeProjectId, cookieWorkspaceId, cookieProjectId };
});
