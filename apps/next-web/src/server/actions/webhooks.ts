'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import { getOutgoingWebhooks, getWebhookDeliveries } from '../queries/webhooks';
import type { OutgoingWebhook, WebhookDelivery, OutgoingWebhookEvent } from '@projectflow/types';
import type { ActionResult } from './result';

export interface CreateOutgoingWebhookInput {
  name:   string;
  url:    string;
  secret: string;
  events: OutgoingWebhookEvent[];
}

/** POST /outgoing-webhooks */
export async function createOutgoingWebhook(
  workspaceId: string,
  input: CreateOutgoingWebhookInput,
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/outgoing-webhooks', {
      method: 'POST',
      body:   JSON.stringify({ workspaceId, ...input }),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/project-settings');
  return { ok: true };
}

/** DELETE /outgoing-webhooks/:id */
export async function deleteOutgoingWebhook(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/outgoing-webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/project-settings');
  return { ok: true };
}

export interface PingResult {
  success:    boolean;
  statusCode: number | null;
  error?:     string;
}

/** POST /outgoing-webhooks/:id/ping — sends a test delivery. The HTTP call can
 *  succeed while the delivery itself fails (success:false + statusCode), so the
 *  result carries the delivery outcome separately from the action ok/fail. */
export async function pingWebhook(webhookId: string, workspaceId: string): Promise<ActionResult<PingResult>> {
  await requireSession();
  try {
    const data = await serverFetch<{ success?: boolean; statusCode?: number; error?: string }>(
      `/outgoing-webhooks/${encodeURIComponent(webhookId)}/ping?workspaceId=${encodeURIComponent(workspaceId)}`,
      { method: 'POST' },
    );
    return {
      ok:   true,
      data: { success: !!data?.success, statusCode: data?.statusCode ?? null, error: data?.error },
    };
  } catch (e) {
    return toActionError(e);
  }
}

/** Refetch wrappers for the converted client component. */
export async function loadOutgoingWebhooks(workspaceId: string): Promise<OutgoingWebhook[]> {
  await requireSession();
  return getOutgoingWebhooks(workspaceId);
}

export async function loadWebhookDeliveries(webhookId: string): Promise<WebhookDelivery[]> {
  await requireSession();
  return getWebhookDeliveries(webhookId);
}
