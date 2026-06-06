import { redirect } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getWorkspaceProjectContext } from '@/server/context';
import { getFolders, getLists } from '@/server/queries/hierarchy';
import { listTemplates } from '@/server/actions/templates';
import type { Folder, List } from '@/server/queries/normalize';
import type { HierarchyTreeData } from '@/components/hierarchy/SidebarTree';
import { TemplateCenter } from './template-center';

/**
 * Template Center (Phase 5d). Lists the active workspace's templates grouped by
 * scope, each with Apply (reuses ApplyTemplateModal) + Delete. The hierarchy
 * tree is loaded SSR for the apply modal's target picker.
 */
export default async function TemplatesPage() {
  await requireSession();
  const ctx = await getWorkspaceProjectContext();
  if (ctx.workspaces.length === 0) redirect('/setup');

  // Build the same hierarchy shape the sidebar uses, for the target picker.
  const foldersBySpace: Record<string, Folder[]> = {};
  const listsBySpace: Record<string, List[]> = {};
  await Promise.all(
    ctx.projects.map(async (s) => {
      const [f, l] = await Promise.all([
        getFolders(s.id).catch(() => []),
        getLists(s.id).catch(() => []),
      ]);
      foldersBySpace[s.id] = f;
      listsBySpace[s.id] = l;
    }),
  );
  const hierarchy: HierarchyTreeData = {
    workspaceId: ctx.activeWorkspaceId,
    spaces: ctx.projects,
    foldersBySpace,
    listsBySpace,
  };

  const templates = await listTemplates();

  return <TemplateCenter templates={templates} hierarchy={hierarchy} />;
}
