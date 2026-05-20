import 'server-only';
import { cache } from 'react';
import { serverFetchBody } from '../api';

export interface Version {
  id: string;
  name: string;
  status: string;
  description: string | null;
  startDate: string | null;
  releaseDate: string | null;
  createdAt: string | null;
  completedIssues: number;
  totalIssues: number;
}

// GET /versions returns { versions: [...] } — not the standard { data } envelope.
export const getVersions = cache(async (projectId: string): Promise<Version[]> => {
  const body = await serverFetchBody<{ versions: any[] }>(
    `/versions?projectId=${encodeURIComponent(projectId)}`,
  );
  return (body?.versions ?? []).map((r) => ({
    id:               String(r?.id ?? ''),
    name:             String(r?.name ?? ''),
    status:           String(r?.status ?? 'UNRELEASED'),
    description:      r?.description ?? null,
    startDate:        r?.startDate ?? null,
    releaseDate:      r?.releaseDate ?? null,
    createdAt:        r?.createdAt ?? null,
    completedIssues:  Number(r?.completedIssues ?? 0),
    totalIssues:      Number(r?.totalIssues ?? 0),
  }));
});
