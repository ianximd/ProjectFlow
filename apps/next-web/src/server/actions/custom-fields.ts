'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type { CustomFieldConfig, CustomFieldScopeType, CustomFieldType, EffectiveField } from '@projectflow/types';


export interface CreateFieldInput {
  scopeType: CustomFieldScopeType;
  scopeId:   string;
  type:      CustomFieldType;
  name:      string;
  config?:   CustomFieldConfig | null;
  required?: boolean;
  position?: number;
}

/** POST /custom-fields */
export async function createCustomField(input: CreateFieldInput): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/custom-fields', {
      method: 'POST',
      body:   JSON.stringify(input),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/project-settings');
  return { ok: true };
}

/** PATCH /custom-fields/:id */
export async function updateCustomField(
  id: string,
  input: { name?: string; config?: CustomFieldConfig | null; clearConfig?: boolean; required?: boolean },
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/custom-fields/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body:   JSON.stringify(input),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/project-settings');
  return { ok: true };
}

/** DELETE /custom-fields/:id */
export async function deleteCustomField(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/custom-fields/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/project-settings');
  return { ok: true };
}

/** GET /tasks/:id/fields — effective fields + current values for the TaskDrawer.
 *  Returns the array directly (mirrors loadWorkspaceMembers) for client-side use. */
export async function loadTaskCustomFields(taskId: string): Promise<EffectiveField[]> {
  await requireSession();
  try {
    return (await serverFetch<EffectiveField[]>(`/tasks/${encodeURIComponent(taskId)}/fields`)) ?? [];
  } catch {
    return [];
  }
}

/** PATCH /custom-fields/:id/reorder */
export async function reorderCustomField(id: string, position: number): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/custom-fields/${encodeURIComponent(id)}/reorder`, {
      method: 'PATCH',
      body:   JSON.stringify({ position }),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/project-settings');
  return { ok: true };
}
