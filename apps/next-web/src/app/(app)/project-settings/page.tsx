import { redirect } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getWorkspaceProjectContext } from '@/server/context';
import { getLabels } from '@/server/queries/labels';
import { getComponents } from '@/server/queries/components';
import { getCustomFields } from '@/server/queries/custom-fields';
import { ProjectSettingsView } from './project-settings-view';

export default async function ProjectSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireSession();
  const ctx = await getWorkspaceProjectContext();
  if (ctx.workspaces.length === 0) redirect('/setup');

  const sp = await searchParams;
  // The active Project IS the Space (Phase 1: Projects == Spaces) — custom
  // fields are scoped to it at SPACE level.
  const [labels, components, customFields] = ctx.activeProjectId
    ? await Promise.all([
        getLabels(ctx.activeProjectId),
        getComponents(ctx.activeProjectId),
        getCustomFields('SPACE', ctx.activeProjectId),
      ])
    : [[], [], []];

  return (
    <ProjectSettingsView
      ctx={ctx}
      labels={labels}
      components={components}
      customFields={customFields}
      initialTab={sp.tab ?? 'labels'}
    />
  );
}
