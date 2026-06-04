import 'server-only';
import { cache } from 'react';
import type { TaskType } from '@projectflow/types';
import { serverFetch } from '../api';

// Standard { data } envelope — serverFetch unwraps to the inner array.
export const getTaskTypes = cache(async (workspaceId: string): Promise<TaskType[]> => {
  const data = await serverFetch<TaskType[]>(`/task-types?workspaceId=${encodeURIComponent(workspaceId)}`);
  return data ?? [];
});
