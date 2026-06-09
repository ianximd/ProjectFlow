'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch, serverFetchBody } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type { AutomationCondition, AutomationRun, ConditionNode } from '@projectflow/types';


export interface CreateAutomationInput {
  scopeType:   'PROJECT' | 'WORKSPACE';
  workspaceId: string;
  projectId:   string | null;
  name:        string;
  trigger:     unknown;
  conditions:  AutomationCondition[] | ConditionNode;
  actions:     unknown[];
}

export interface UpdateAutomationInput {
  name?:       string;
  trigger?:    unknown;
  conditions?: AutomationCondition[] | ConditionNode;
  actions?:    unknown[];
}

/** POST /automations */
export async function createAutomation(input: CreateAutomationInput): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/automations', {
      method: 'POST',
      body:   JSON.stringify({
        scopeType:   input.scopeType,
        workspaceId: input.workspaceId,
        projectId:   input.projectId,
        name:        input.name,
        trigger:     input.trigger,
        conditions:  input.conditions,
        actions:     input.actions,
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

/** GET /automations/:id/runs — run-history drawer pagination (offset-based, client-callable). */
export async function loadAutomationRuns(
  ruleId: string,
  offset = 0,
): Promise<ActionResult & { runs?: AutomationRun[] }> {
  await requireSession();
  try {
    const body = await serverFetchBody<{ runs: AutomationRun[] }>(
      `/automations/${encodeURIComponent(ruleId)}/runs?limit=20&offset=${offset}`,
    );
    return { ok: true, runs: body?.runs ?? [] };
  } catch (e) {
    return toActionError(e);
  }
}
