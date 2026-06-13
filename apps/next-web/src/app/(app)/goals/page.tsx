import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/server/session';
import { getWorkspaceProjectContext } from '@/server/context';
import { getGoalFolders, getGoals } from '@/server/queries/goals';
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

  // Goals from the list endpoint don't carry targets — cast to GoalWithProgress
  // with empty targets so the view renders; progress will be 0 until the user
  // expands a goal and the individual GET /goals/:id data is fetched client-side.
  const goalsWithProgress: GoalWithProgress[] = goals.map((g) => ({
    ...g,
    targets: [],
    progress: 0,
  }));

  return (
    <GoalsView
      workspaceId={activeWorkspaceId}
      folders={folders}
      goals={goalsWithProgress}
    />
  );
}
