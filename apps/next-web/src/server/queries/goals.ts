import 'server-only';
import { serverFetch } from '../api';
import type { Goal, GoalFolder, GoalWithProgress, Target } from '@projectflow/types';

/** GET /goals/folders?workspaceId= */
export async function getGoalFolders(workspaceId: string): Promise<GoalFolder[]> {
  const qs = new URLSearchParams({ workspaceId });
  return serverFetch<GoalFolder[]>(`/goals/folders?${qs.toString()}`);
}

/** GET /goals?workspaceId=&folderId= — folderId is optional */
export async function getGoals(workspaceId: string, folderId?: string): Promise<Goal[]> {
  const qs = new URLSearchParams({ workspaceId });
  if (folderId) qs.set('folderId', folderId);
  return serverFetch<Goal[]>(`/goals?${qs.toString()}`);
}

/** GET /goals/:id — returns goal + targets[] with per-target ratio + overall progress */
export async function getGoalWithProgress(id: string): Promise<GoalWithProgress> {
  return serverFetch<GoalWithProgress>(`/goals/${encodeURIComponent(id)}`);
}

/** GET /goals/:goalId/targets */
export async function getGoalTargets(goalId: string): Promise<Target[]> {
  return serverFetch<Target[]>(`/goals/${encodeURIComponent(goalId)}/targets`);
}
