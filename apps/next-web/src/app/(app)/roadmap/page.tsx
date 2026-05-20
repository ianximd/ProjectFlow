import { redirect } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getWorkspaceProjectContext } from '@/server/context';
import { getRoadmap } from '@/server/queries/roadmap';
import { RoadmapView } from './roadmap-view';

export default async function RoadmapPage() {
  await requireSession();
  const ctx = await getWorkspaceProjectContext();
  if (ctx.workspaces.length === 0) redirect('/setup');
  const roadmap = ctx.activeProjectId
    ? await getRoadmap(ctx.activeProjectId)
    : { items: [], deps: [] };
  return <RoadmapView ctx={ctx} items={roadmap.items} deps={roadmap.deps} />;
}
