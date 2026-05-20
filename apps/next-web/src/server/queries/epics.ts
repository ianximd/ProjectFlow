import 'server-only';
import { cache } from 'react';
import { serverFetchBody } from '../api';

export interface Epic {
  id: string;
  issueKey: string;
  title: string;
  status: string;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  totalChildren: number;
  completedChildren: number;
}

// The /epics endpoint returns { epics: EpicSummary[] } (no data envelope),
// so we use serverFetchBody to access the raw body.
export const getEpics = cache(async (projectId: string): Promise<Epic[]> => {
  const body = await serverFetchBody<{ epics: any[] }>(
    `/epics?projectId=${encodeURIComponent(projectId)}`,
  );
  const rows = body?.epics ?? [];
  return rows.map((r): Epic => ({
    id:                String(r?.id ?? r?.Id ?? ''),
    issueKey:          String(r?.issueKey ?? r?.IssueKey ?? ''),
    title:             String(r?.title ?? r?.Title ?? '(untitled)'),
    status:            String(r?.status ?? r?.Status ?? 'To Do'),
    priority:          String(r?.priority ?? r?.Priority ?? 'Medium'),
    startDate:         (r?.startDate ?? r?.StartDate) || null,
    dueDate:           (r?.dueDate ?? r?.DueDate) || null,
    totalChildren:     Number(r?.totalChildren ?? r?.TotalChildren ?? 0),
    completedChildren: Number(r?.completedChildren ?? r?.CompletedChildren ?? 0),
  }));
});
