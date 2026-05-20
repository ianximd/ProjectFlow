'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';

export type { ActionResult };

export async function createWorkflow(
  projectId: string,
  name: string,
  template: string,
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/workflows', {
      method: 'POST',
      body:   JSON.stringify({ projectId, name, template }),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/workflows');
  return { ok: true };
}

export async function addStatus(
  workflowId: string,
  input: { name: string; category: string; color: string },
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/workflows/${encodeURIComponent(workflowId)}/statuses`, {
      method: 'POST',
      body:   JSON.stringify(input),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/workflows');
  return { ok: true };
}

export async function updateStatus(
  statusId: string,
  changed: Partial<{ name: string; category: string; color: string }>,
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/workflows/statuses/${encodeURIComponent(statusId)}`, {
      method: 'PATCH',
      body:   JSON.stringify(changed),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/workflows');
  return { ok: true };
}

export async function deleteStatus(statusId: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/workflows/statuses/${encodeURIComponent(statusId)}`, {
      method: 'DELETE',
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/workflows');
  return { ok: true };
}

export async function addTransition(
  workflowId: string,
  input: { fromStatus: string; toStatus: string },
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/workflows/${encodeURIComponent(workflowId)}/transitions`, {
      method: 'POST',
      body:   JSON.stringify(input),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/workflows');
  return { ok: true };
}

export async function deleteTransition(
  workflowId: string,
  input: { fromStatus: string; toStatus: string },
): Promise<ActionResult> {
  await requireSession();
  try {
    // DELETE with body — the API reads { fromStatus, toStatus } from the request body.
    await serverFetch(`/workflows/${encodeURIComponent(workflowId)}/transitions`, {
      method: 'DELETE',
      body:   JSON.stringify(input),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/workflows');
  return { ok: true };
}
