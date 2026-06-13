'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type { Goal, GoalFolder, Target, GoalStatus } from '@projectflow/types';

// ── Folders ──────────────────────────────────────────────────────────────────

export async function createGoalFolder(
  workspaceId: string,
  name: string,
): Promise<ActionResult<GoalFolder>> {
  await requireSession();
  let data: GoalFolder;
  try {
    data = await serverFetch<GoalFolder>('/goals/folders', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, name }),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/goals');
  return { ok: true, data };
}

export async function deleteGoalFolder(id: string): Promise<ActionResult<void>> {
  await requireSession();
  try {
    await serverFetch(`/goals/folders/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/goals');
  return { ok: true };
}

// ── Goals ─────────────────────────────────────────────────────────────────────

export async function createGoal(input: {
  workspaceId: string;
  name: string;
  folderId?: string | null;
  description?: string | null;
  dueDate?: string | null;
}): Promise<ActionResult<Goal>> {
  await requireSession();
  let data: Goal;
  try {
    data = await serverFetch<Goal>('/goals', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/goals');
  return { ok: true, data };
}

export async function updateGoal(
  id: string,
  patch: { name?: string; status?: GoalStatus; dueDate?: string | null; folderId?: string | null },
): Promise<ActionResult<Goal>> {
  await requireSession();
  let data: Goal;
  try {
    data = await serverFetch<Goal>(`/goals/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/goals');
  return { ok: true, data };
}

export async function deleteGoal(id: string): Promise<ActionResult<void>> {
  await requireSession();
  try {
    await serverFetch(`/goals/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/goals');
  return { ok: true };
}

// ── Targets ───────────────────────────────────────────────────────────────────

export async function createTarget(
  goalId: string,
  input: {
    kind: string;
    name: string;
    unit?: string | null;
    currencyCode?: string | null;
    startValue?: number | null;
    targetValue?: number | null;
    currentValue?: number | null;
    taskFilter?: string | null;
  },
): Promise<ActionResult<Target>> {
  await requireSession();
  let data: Target;
  try {
    data = await serverFetch<Target>(`/goals/${encodeURIComponent(goalId)}/targets`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/goals');
  return { ok: true, data };
}

export async function updateTarget(
  goalId: string,
  targetId: string,
  patch: {
    name?: string;
    unit?: string | null;
    currencyCode?: string | null;
    startValue?: number | null;
    targetValue?: number | null;
    currentValue?: number | null;
    taskFilter?: string | null;
  },
): Promise<ActionResult<Target>> {
  await requireSession();
  let data: Target;
  try {
    data = await serverFetch<Target>(
      `/goals/${encodeURIComponent(goalId)}/targets/${encodeURIComponent(targetId)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/goals');
  return { ok: true, data };
}

export async function deleteTarget(goalId: string, targetId: string): Promise<ActionResult<void>> {
  await requireSession();
  try {
    await serverFetch(
      `/goals/${encodeURIComponent(goalId)}/targets/${encodeURIComponent(targetId)}`,
      { method: 'DELETE' },
    );
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/goals');
  return { ok: true };
}
