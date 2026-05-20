import 'server-only';
import { cache } from 'react';
import { serverFetchEnvelope } from '../api';
import { normalizeTask, type Task, type AssigneeRow } from './normalize-task';

export type { Task, AssigneeRow };

export const getTasks = cache(async (
  projectId: string,
  opts: { pageSize?: number } = {},
): Promise<{ tasks: Task[]; assigneesByTaskId: Record<string, AssigneeRow[]> }> => {
  const qs = new URLSearchParams({ projectId });
  if (opts.pageSize) qs.set('pageSize', String(opts.pageSize));

  const { data, meta } = await serverFetchEnvelope<
    any[],
    { assigneesByTaskId?: Record<string, AssigneeRow[]> }
  >(`/tasks?${qs}`);

  return {
    tasks: (data ?? []).map(normalizeTask),
    assigneesByTaskId: meta?.assigneesByTaskId ?? {},
  };
});
