import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';

export interface Sprint {
  id: string;
  name: string;
  status?: string;
  startDate?: string | null;
  endDate?: string | null;
  [k: string]: unknown;
}

export const getSprints = cache(async (projectId: string): Promise<Sprint[]> => {
  const data = await serverFetch<any[]>(`/sprints?projectId=${encodeURIComponent(projectId)}`);
  return (data ?? []).map((r) => ({
    ...r,
    id: String(r?.Id ?? r?.id ?? ''),
    name: String(r?.Name ?? r?.name ?? ''),
    status: r?.Status ?? r?.status,
    startDate: (r?.StartDate ?? r?.startDate) || null,
    endDate: (r?.EndDate ?? r?.endDate) || null,
  }));
});
