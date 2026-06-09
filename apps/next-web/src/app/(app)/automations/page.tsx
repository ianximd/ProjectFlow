import { redirect } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getWorkspaceProjectContext } from '@/server/context';
import { getAutomations, getAutomationTemplates, getAutomationUsage } from '@/server/queries/automations';
import { AutomationsView } from './automations-view';

export default async function AutomationsPage() {
  await requireSession();
  const ctx = await getWorkspaceProjectContext();
  if (ctx.workspaces.length === 0) redirect('/setup');
  const [automations, templates, usage] = await Promise.all([
    ctx.activeProjectId ? getAutomations(ctx.activeProjectId) : Promise.resolve([]),
    getAutomationTemplates(),
    ctx.activeWorkspaceId ? getAutomationUsage(ctx.activeWorkspaceId) : Promise.resolve(null),
  ]);
  return (
    <AutomationsView
      ctx={ctx}
      automations={automations}
      templates={templates}
      usageRunCount={usage?.runCount ?? null}
    />
  );
}
