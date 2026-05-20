import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';
import type { ProjectType, ProjectStatus } from './normalize';

export type { ProjectType, ProjectStatus };

export interface ProjectDetail {
  id: string;
  name: string;
  key: string;
  description: string | null;
  avatarUrl: string | null;
  type: ProjectType;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  createdAt: string | null;
}

export const getProject = cache(async (id: string): Promise<ProjectDetail> => {
  const r = await serverFetch<any>(`/projects/${encodeURIComponent(id)}`);
  return {
    id:          String(r?.Id          ?? r?.id          ?? id),
    name:        String(r?.Name        ?? r?.name        ?? ''),
    key:         String(r?.Key         ?? r?.key         ?? ''),
    description: (r?.Description ?? r?.description) || null,
    avatarUrl:   (r?.AvatarUrl   ?? r?.avatarUrl)   || null,
    type:        String(r?.Type        ?? r?.type        ?? 'KANBAN') as ProjectType,
    status:      String(r?.Status      ?? r?.status      ?? 'ACTIVE') as ProjectStatus,
    startDate:   (r?.StartDate   ?? r?.startDate)   || null,
    endDate:     (r?.EndDate     ?? r?.endDate)     || null,
    createdAt:   (r?.CreatedAt   ?? r?.createdAt)   || null,
  };
});
