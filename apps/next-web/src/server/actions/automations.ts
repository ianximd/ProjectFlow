'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';


export interface CreateAutomationInput {
  projectId:  string;
  name:       string;
  trigger:    unknown;
  conditions: unknown[];
  actions:    unknown[];
}

export interface UpdateAutomationInput {
  name?:       string;
  trigger?:    unknown;
  conditions?: unknown[];
  actions?:    unknown[];
}

/** POST /automations */
export async function createAutomation(input: CreateAutomationInput): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/automations', {
      method: 'POST',
      body:   JSON.stringify({
        projectId:  input.projectId,
        name:       input.name,
        trigger:    input.trigger,
        conditions: input.conditions,
        actions:    input.actions,
      }),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/automations');
  return { ok: true };
}

/** PATCH /automations/:id */
export async function updateAutomation(
  id:    string,
  input: UpdateAutomationInput,
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/automations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body:   JSON.stringify(input),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/automations');
  return { ok: true };
}

/** POST /automations/:id/toggle */
export async function toggleAutomation(
  id:        string,
  isEnabled: boolean,
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/automations/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
      body:   JSON.stringify({ isEnabled }),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/automations');
  return { ok: true };
}

/** DELETE /automations/:id */
export async function deleteAutomation(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/automations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/automations');
  return { ok: true };
}
