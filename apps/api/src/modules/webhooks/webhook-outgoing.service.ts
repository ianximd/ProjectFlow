import { WebhookOutgoingRepository } from './webhook-outgoing.repository.js';
import { outgoingWebhookQueue }       from './webhook-outgoing.queue.js';
import type { OutgoingWebhook, CreateWebhookInput, WebhookDelivery } from '@projectflow/types';

export class WebhookOutgoingService {
  private repo = new WebhookOutgoingRepository();

  async list(workspaceId: string): Promise<OutgoingWebhook[]> {
    return this.repo.list(workspaceId);
  }

  async create(input: CreateWebhookInput): Promise<OutgoingWebhook> {
    return this.repo.create({
      workspaceId: input.workspaceId,
      name:        input.name,
      url:         input.url,
      secret:      input.secret,
      events:      input.events,
    });
  }

  async delete(id: string): Promise<void> {
    return this.repo.delete(id);
  }

  async listDeliveries(webhookId: string): Promise<WebhookDelivery[]> {
    return this.repo.listDeliveries(webhookId);
  }

  /**
   * Fan-out: enqueue a delivery job for every active webhook that subscribes
   * to the given event. Fire-and-forget — never throws.
   */
  async dispatch(
    workspaceId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      const webhooks = await this.repo.getActive(workspaceId, event);
      const jobs = webhooks.map(wh =>
        outgoingWebhookQueue.add(`${event}:${wh.id}`, {
          webhookId:   wh.id,
          workspaceId,
          event,
          secret:      wh.secret,
          url:         wh.url,
          payload,
        }),
      );
      await Promise.allSettled(jobs);
    } catch (err: any) {
      console.error('[webhook-service] dispatch error:', err?.message);
    }
  }

  /**
   * Immediately deliver a test ping to a webhook endpoint (does NOT use the queue).
   * Returns the delivery result so the UI can show status.
   */
  async sendTestPing(webhookId: string, workspaceId: string): Promise<{ success: boolean; statusCode: number | null }> {
    // Load the webhook to get URL + secret
    const list = await this.repo.list(workspaceId);
    const wh   = list.find(w => w.id === webhookId);
    if (!wh) throw new Error('Webhook not found');

    const { deliverWebhook } = await import('./webhook-outgoing.dispatcher.js');
    const result = await deliverWebhook(wh.url, '', 'ping', { message: 'ProjectFlow webhook test' });
    return { success: result.success, statusCode: result.statusCode };
  }
}

export const webhookOutgoingService = new WebhookOutgoingService();
