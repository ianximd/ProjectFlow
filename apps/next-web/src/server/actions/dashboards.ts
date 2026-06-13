'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type {
  Dashboard,
  DashboardCard,
  CardData,
  CreateDashboardInput,
  UpdateDashboardInput,
  CreateDashboardCardInput,
  UpdateDashboardCardInput,
  ReorderCardEntry,
} from '@projectflow/types';

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  await requireSession();
  let result: T;
  try {
    result = await fn();
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/dashboard');
  return { ok: true, data: result } as ActionResult<T>;
}

export const createDashboard = (input: CreateDashboardInput) =>
  run<Dashboard>(() =>
    serverFetch<Dashboard>('/dashboards', { method: 'POST', body: JSON.stringify(input) }),
  );

export const updateDashboard = (id: string, patch: UpdateDashboardInput) =>
  run<Dashboard>(() =>
    serverFetch<Dashboard>(`/dashboards/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  );

export const deleteDashboard = (id: string) =>
  run<Dashboard>(() =>
    serverFetch<Dashboard>(`/dashboards/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  );

export const setDefaultDashboard = (id: string) =>
  run<Dashboard>(() =>
    serverFetch<Dashboard>(`/dashboards/${encodeURIComponent(id)}/set-default`, {
      method: 'POST',
    }),
  );

export const addCard = (dashboardId: string, input: CreateDashboardCardInput) =>
  run<DashboardCard>(() =>
    serverFetch<DashboardCard>(`/dashboards/${encodeURIComponent(dashboardId)}/cards`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );

export const updateCard = (cardId: string, patch: UpdateDashboardCardInput) =>
  run<DashboardCard>(() =>
    serverFetch<DashboardCard>(`/dashboards/cards/${encodeURIComponent(cardId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  );

export const deleteCard = (cardId: string) =>
  run<DashboardCard>(() =>
    serverFetch<DashboardCard>(`/dashboards/cards/${encodeURIComponent(cardId)}`, {
      method: 'DELETE',
    }),
  );

export const reorderCards = (dashboardId: string, cards: ReorderCardEntry[]) =>
  run<DashboardCard[]>(() =>
    serverFetch<DashboardCard[]>(
      `/dashboards/${encodeURIComponent(dashboardId)}/reorder-cards`,
      { method: 'PUT', body: JSON.stringify({ cards }) },
    ),
  );

export const loadCardData = (cardId: string) =>
  run<CardData>(() =>
    serverFetch<CardData>(`/dashboards/cards/${encodeURIComponent(cardId)}/data`),
  );
