import { redirect } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getWorkspaceProjectContext } from '@/server/context';
import { getAutomations } from '@/server/queries/automations';
import { AutomationsView } from './automations-view';

export default async function AutomationsPage() {
  await requireSession();
  const ctx = await getWorkspaceProjectContext();
  if (ctx.workspaces.length === 0) redirect('/setup');
  const automations = ctx.activeProjectId ? await getAutomations(ctx.activeProjectId) : [];
  return <AutomationsView ctx={ctx} automations={automations} />;
}
