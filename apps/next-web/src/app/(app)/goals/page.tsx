import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/server/session';
import { getWorkspaceProjectContext } from '@/server/context';
import { getGoalFolders, getGoals, getGoalWithProgress } from '@/server/queries/goals';
import { GoalsView } from '@/features/goals/goals-view';
import type { GoalWithProgress } from '@projectflow/types';

export default async function GoalsPage() {
  await requireSession();

  const { activeWorkspaceId } = await getWorkspaceProjectContext();
  const t = await getTranslations('Goals');

  if (!activeWorkspaceId) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
        <h1 className="text-base font-semibold text-foreground">{t('title')}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t('noWorkspace')}</p>
      </main>
    );
  }

  const [folders, goals] = await Promise.all([
    getGoalFolders(activeWorkspaceId),
    getGoals(activeWorkspaceId),
  ]);

  // Fetch full per-goal data (targets[] + computed progress) for every goal in
  // parallel. Filter out nulls from any goal deleted between the list and detail
  // fetch (TOCTOU window is tiny but possible).
  const goalsWithProgress = (
    await Promise.all(goals.map((g) => getGoalWithProgress(g.id)))
  ).filter(Boolean) as GoalWithProgress[];

  return (
    <GoalsView
      workspaceId={activeWorkspaceId}
      folders={folders}
      goals={goalsWithProgress}
    />
  );
}
