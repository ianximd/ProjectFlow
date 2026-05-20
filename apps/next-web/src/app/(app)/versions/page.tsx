import { redirect } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getWorkspaceProjectContext } from '@/server/context';
import { getVersions } from '@/server/queries/versions';
import { VersionsView } from './versions-view';

export default async function VersionsPage() {
  await requireSession();
  const ctx = await getWorkspaceProjectContext();
  if (ctx.workspaces.length === 0) redirect('/setup');
  const versions = ctx.activeProjectId ? await getVersions(ctx.activeProjectId) : [];
  return <VersionsView ctx={ctx} versions={versions} />;
}
