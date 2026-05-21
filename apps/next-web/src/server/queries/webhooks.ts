import 'server-only';
import { cache } from 'react';
import type { OutgoingWebhook, WebhookDelivery } from '@projectflow/types';
import { serverFetch } from '../api';

// Both endpoints return the standard { data } envelope (the pre-migration
// client read `json.data ?? []`).
export const getOutgoingWebhooks = cache(async (workspaceId: string): Promise<OutgoingWebhook[]> => {
  return (await serverFetch<OutgoingWebhook[]>(
    `/outgoing-webhooks?workspaceId=${encodeURIComponent(workspaceId)}`,
  )) ?? [];
});

export const getWebhookDeliveries = cache(async (webhookId: string): Promise<WebhookDelivery[]> => {
  return (await serverFetch<WebhookDelivery[]>(
    `/outgoing-webhooks/${encodeURIComponent(webhookId)}/deliveries`,
  )) ?? [];
});
