import { requireSession } from '@/server/session';
import { getWorkspace } from '@/server/queries/workspace';
import { WorkspaceSettingsView } from './workspace-settings-view';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const workspace = await getWorkspace(id);
  return <WorkspaceSettingsView workspace={workspace} />;
}
