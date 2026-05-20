import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';

import type {
  BurndownReport,
  VelocityEntry,
  SprintSummaryReport,
  WorkloadEntry,
  CreatedVsResolvedEntry,
} from '@projectflow/types';

const q = <T>(path: string) => serverFetch<T>(path);

export const getBurndown = cache((sprintId: string) =>
  q<BurndownReport>(`/reports/burndown?sprintId=${encodeURIComponent(sprintId)}`),
);

export const getVelocity = cache((projectId: string, n = 6) =>
  q<VelocityEntry[]>(`/reports/velocity?projectId=${encodeURIComponent(projectId)}&numSprints=${n}`),
);

export const getSprintSummary = cache((sprintId: string) =>
  q<SprintSummaryReport>(`/reports/sprint-summary?sprintId=${encodeURIComponent(sprintId)}`),
);

export const getWorkload = cache((projectId: string) =>
  q<WorkloadEntry[]>(`/reports/workload?projectId=${encodeURIComponent(projectId)}`),
);

export const getCreatedVsResolved = cache((projectId: string, weeks = 8) =>
  q<CreatedVsResolvedEntry[]>(`/reports/created-vs-resolved?projectId=${encodeURIComponent(projectId)}&weeks=${weeks}`),
);
