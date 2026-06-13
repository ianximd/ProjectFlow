import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';
import type { Dashboard, CardData, DashboardScopeType } from '@projectflow/types';

export const getDashboards = cache((scopeType: DashboardScopeType, scopeId: string | null, workspaceId?: string) => {
  const q = new URLSearchParams({ scopeType });
  if (scopeId) q.set('scopeId', scopeId);
  if (workspaceId) q.set('workspaceId', workspaceId);
  return serverFetch<Dashboard[]>(`/dashboards?${q.toString()}`);
});

export const getDashboard = cache((id: string) =>
  serverFetch<Dashboard>(`/dashboards/${encodeURIComponent(id)}`),
);

export const getCardData = (cardId: string) =>
  serverFetch<CardData>(`/dashboards/cards/${encodeURIComponent(cardId)}/data`);

/** Workspace-scoped dashboards for the active workspace, seeding a default
 *  "Overview" once if none exist. Uses a direct serverFetch POST (NOT the
 *  createDashboard action) so it is safe to call during page render
 *  (the action's revalidatePath throws during render). */
export async function ensureWorkspaceDashboards(workspaceId: string): Promise<Dashboard[]> {
  const existing = await getDashboards('workspace', null, workspaceId);
  if (existing.length > 0) return existing;
  const created = await serverFetch<Dashboard>('/dashboards', {
    method: 'POST',
    body: JSON.stringify({ scopeType: 'workspace', scopeId: null, name: 'Overview', visibility: 'shared', workspaceId }),
  });
  return [created];
}
