'use client';

import { useEffect, useRef, useState } from 'react';
import { useSubscription } from '@apollo/client/react';
import type { Task } from '@/server/queries/normalize-task';
import { TASK_EVENTS } from './operations';
import { applyTaskEvent, type TaskEvent } from './apply-task-event';

export interface LiveScope {
  projectId?: string | null;
  workspaceId?: string | null;
}

/**
 * SSR-provided `base` with live `taskEvents` (created/updated/deleted) merged in.
 * SSR stays the source of truth (`base` re-seeds on change). Exactly one of
 * `scope.projectId` / `scope.workspaceId` drives the (server-keyed) subscription;
 * `accepts` decides whether a live `created` task belongs in this view.
 */
export function useLiveTasks(
  base: Task[],
  scope: LiveScope,
  accepts: (task: Task) => boolean = () => true,
): Task[] {
  const [tasks, setTasks] = useState<Task[]>(base);
  useEffect(() => { setTasks(base); }, [base]);

  // Ref-stabilizer: always reflects the latest `accepts` predicate without
  // being part of the subscription's dependency closure, so callers can pass
  // non-stable lambdas (e.g. `t => t.listId === listScopeId`) without
  // re-creating the subscription on every render.
  const acceptsRef = useRef(accepts);
  useEffect(() => { acceptsRef.current = accepts; });

  const projectId = scope.projectId ?? null;
  const workspaceId = scope.workspaceId ?? null;
  const enabled = Boolean(projectId || workspaceId);

  useSubscription<{ taskEvents: TaskEvent }>(TASK_EVENTS, {
    variables: { projectId, workspaceId },
    skip: !enabled,
    onData: ({ data }) => {
      const ev = data.data?.taskEvents;
      if (!ev) return;
      setTasks((prev) => applyTaskEvent(prev, ev, acceptsRef.current));
    },
  });

  return tasks;
}
