import 'server-only';
import { cache } from 'react';
import type { Tag } from '@projectflow/types';
import { serverFetch } from '../api';

export const getSpaceTags = cache(async (spaceId: string): Promise<Tag[]> => {
  return (await serverFetch<Tag[]>(`/tags?spaceId=${encodeURIComponent(spaceId)}`)) ?? [];
});

export const getTaskTags = cache(async (taskId: string): Promise<Tag[]> => {
  return (await serverFetch<Tag[]>(`/tasks/${encodeURIComponent(taskId)}/tags`)) ?? [];
});
