import { redirect } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getWorkspaceProjectContext } from '@/server/context';
import { getWorkflow } from '@/server/queries/workflows';
import { WorkflowsView } from './workflows-view';

export default async function WorkflowsPage() {
  await requireSession();
  const ctx = await getWorkspaceProjectContext();
  if (ctx.workspaces.length === 0) redirect('/setup');
  const workflow = ctx.activeProjectId ? await getWorkflow(ctx.activeProjectId) : null;
  return <WorkflowsView ctx={ctx} workflow={workflow} />;
}
