'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import { getIntegrations } from '../queries/integrations';
import type { IntegrationConnection, IntegrationEvent, IntegrationProvider } from '@projectflow/types';
import type { ActionResult } from './result';

export interface CreateIntegrationInput {
  provider:    IntegrationProvider;
  channelName: string;
  webhookUrl:  string;
  events:      IntegrationEvent[];
}

/** POST /integrations */
export async function createIntegration(
  workspaceId: string,
  input: CreateIntegrationInput,
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/integrations', {
      method: 'POST',
      body:   JSON.stringify({ workspaceId, ...input }),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/project-settings');
  return { ok: true };
}

/** DELETE /integrations/:id */
export async function deleteIntegration(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/integrations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/project-settings');
  return { ok: true };
}

/** POST /integrations/test — send a one-line test message to the webhook URL. */
export async function testIntegrationDelivery(
  input: { provider: IntegrationProvider; webhookUrl: string },
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/integrations/test', {
      method: 'POST',
      body:   JSON.stringify(input),
    });
  } catch (e) {
    return toActionError(e);
  }
  return { ok: true };
}

/** Refetch wrapper for the converted client component. */
export async function loadIntegrations(workspaceId: string): Promise<IntegrationConnection[]> {
  await requireSession();
  return getIntegrations(workspaceId);
}
