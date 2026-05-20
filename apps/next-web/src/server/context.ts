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
  activeWorkspaceId: string;        // '' means no workspaces exist; the caller should redirect to onboarding
  activeProjectId: string | null;   // null when the workspace has no projects
  cookieWorkspaceId: string | null;
  cookieProjectId: string | null;
}

export const getWorkspaceProjectContext = cache(async (): Promise<WorkspaceProjectContext> => {
  const [workspaces, selection] = await Promise.all([getWorkspaces(), getSelection()]);
  const { workspaceId: cookieWorkspaceId, projectId: cookieProjectId } = selection;
  const activeWorkspaceId = resolveActiveId(workspaces, cookieWorkspaceId);
  if (activeWorkspaceId === null) {
    // resolveActiveId returns null only when the list is empty, so `workspaces` is [] here.
    return { workspaces, projects: [], activeWorkspaceId: '', activeProjectId: null, cookieWorkspaceId, cookieProjectId };
  }
  const projects = await getProjects(activeWorkspaceId);
  const activeProjectId = resolveActiveId(projects, cookieProjectId);
  return { workspaces, projects, activeWorkspaceId, activeProjectId, cookieWorkspaceId, cookieProjectId };
});
