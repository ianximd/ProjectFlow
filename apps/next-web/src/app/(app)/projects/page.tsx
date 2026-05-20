// apps/next-web/src/app/(app)/projects/page.tsx
import { redirect } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getSelection } from '@/server/selection';
import { getWorkspaces } from '@/server/queries/workspaces';
import { getProjects } from '@/server/queries/projects';
import { ProjectsView } from './projects-view';

export default async function ProjectsPage() {
  await requireSession();

  const workspaces = await getWorkspaces();
  if (workspaces.length === 0) redirect('/setup');

  const { workspaceId: cookieWorkspaceId } = await getSelection();
  // Trust the cookie only if it still points at a workspace the user has.
  const activeWorkspaceId =
    cookieWorkspaceId && workspaces.some((w) => w.id === cookieWorkspaceId)
      ? cookieWorkspaceId
      : workspaces[0]!.id;

  const projects = await getProjects(activeWorkspaceId);

  return (
    <ProjectsView
      workspaces={workspaces}
      projects={projects}
      activeWorkspaceId={activeWorkspaceId}
      cookieWorkspaceId={cookieWorkspaceId}
    />
  );
}
