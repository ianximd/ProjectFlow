import { redirect } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getWorkspaceProjectContext } from '@/server/context';
import { getEpics } from '@/server/queries/epics';
import { EpicsView } from './epics-view';

export default async function EpicsPage() {
  await requireSession();
  const ctx = await getWorkspaceProjectContext();
  if (ctx.workspaces.length === 0) redirect('/setup');
  const epics = ctx.activeProjectId ? await getEpics(ctx.activeProjectId) : [];
  return <EpicsView ctx={ctx} epics={epics} />;
}
