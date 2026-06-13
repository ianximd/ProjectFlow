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
