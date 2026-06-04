import 'server-only';
import { cache } from 'react';
import type { TaskWatcher } from '@projectflow/types';
import { serverFetch } from '../api';

export const getTaskWatchers = cache(async (taskId: string): Promise<TaskWatcher[]> => {
  return (await serverFetch<TaskWatcher[]>(`/tasks/${encodeURIComponent(taskId)}/watchers`)) ?? [];
});
