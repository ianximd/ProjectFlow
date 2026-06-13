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

// Next.js 'use server' requires every export to be an async function declaration
// (arrow-const exports are rejected: "Server Actions must be async functions").
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

export async function createDashboard(input: CreateDashboardInput): Promise<ActionResult<Dashboard>> {
  return run<Dashboard>(() =>
    serverFetch<Dashboard>('/dashboards', { method: 'POST', body: JSON.stringify(input) }),
  );
}

export async function updateDashboard(id: string, patch: UpdateDashboardInput): Promise<ActionResult<Dashboard>> {
  return run<Dashboard>(() =>
    serverFetch<Dashboard>(`/dashboards/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  );
}

export async function deleteDashboard(id: string): Promise<ActionResult<Dashboard>> {
  return run<Dashboard>(() =>
    serverFetch<Dashboard>(`/dashboards/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  );
}

export async function setDefaultDashboard(id: string): Promise<ActionResult<Dashboard>> {
  return run<Dashboard>(() =>
    serverFetch<Dashboard>(`/dashboards/${encodeURIComponent(id)}/set-default`, {
      method: 'POST',
    }),
  );
}

export async function addCard(dashboardId: string, input: CreateDashboardCardInput): Promise<ActionResult<DashboardCard>> {
  return run<DashboardCard>(() =>
    serverFetch<DashboardCard>(`/dashboards/${encodeURIComponent(dashboardId)}/cards`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
}

export async function updateCard(cardId: string, patch: UpdateDashboardCardInput): Promise<ActionResult<DashboardCard>> {
  return run<DashboardCard>(() =>
    serverFetch<DashboardCard>(`/dashboards/cards/${encodeURIComponent(cardId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  );
}

export async function deleteCard(cardId: string): Promise<ActionResult<DashboardCard>> {
  return run<DashboardCard>(() =>
    serverFetch<DashboardCard>(`/dashboards/cards/${encodeURIComponent(cardId)}`, {
      method: 'DELETE',
    }),
  );
}

export async function reorderCards(dashboardId: string, cards: ReorderCardEntry[]): Promise<ActionResult<DashboardCard[]>> {
  return run<DashboardCard[]>(() =>
    serverFetch<DashboardCard[]>(
      `/dashboards/${encodeURIComponent(dashboardId)}/reorder-cards`,
      { method: 'PUT', body: JSON.stringify({ cards }) },
    ),
  );
}

export async function loadCardData(cardId: string): Promise<ActionResult<CardData>> {
  return run<CardData>(() =>
    serverFetch<CardData>(`/dashboards/cards/${encodeURIComponent(cardId)}/data`),
  );
}
