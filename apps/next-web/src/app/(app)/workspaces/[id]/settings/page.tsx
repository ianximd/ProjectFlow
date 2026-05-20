import { notFound } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getWorkspace } from '@/server/queries/workspace';
import { ApiError } from '@/server/api';
import { WorkspaceSettingsView } from './workspace-settings-view';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  let workspace;
  try {
    workspace = await getWorkspace(id);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  return <WorkspaceSettingsView workspace={workspace} />;
}
