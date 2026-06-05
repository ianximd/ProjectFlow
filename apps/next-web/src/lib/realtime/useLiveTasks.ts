'use client';

import { useEffect, useState } from 'react';
import { useSubscription } from '@apollo/client/react';
import type { Task } from '@/server/queries/normalize-task';
import { TASK_UPDATED } from './operations';
import { mergeTaskDelta, type TaskDelta } from './merge-task-delta';

/**
 * Returns the SSR-provided task list with live `taskUpdated` deltas merged in.
 *
 * SSR stays the single source of truth: `base` is re-seeded whenever it changes
 * (navigation / revalidation), and the subscription only patches existing cards
 * in place via `mergeTaskDelta` (update-only — no live add/remove in v1). No-op
 * without a `projectId` (the subscription is skipped).
 */
export function useLiveTasks(
  projectId: string | null | undefined,
  base: Task[],
): Task[] {
  const [tasks, setTasks] = useState<Task[]>(base);
  useEffect(() => { setTasks(base); }, [base]);

  useSubscription<{ taskUpdated: TaskDelta }>(TASK_UPDATED, {
    variables: { projectId: projectId ?? '' },
    skip: !projectId,
    onData: ({ data }) => {
      const delta = data.data?.taskUpdated;
      if (!delta) return;
      setTasks((prev) => mergeTaskDelta(prev, delta));
    },
  });

  return tasks;
}
