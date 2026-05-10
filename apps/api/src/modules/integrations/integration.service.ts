import type { IntegrationConnection, IntegrationEvent } from '@projectflow/types';
import { IntegrationRepository } from './integration.repository.js';
import { dispatchToIntegration, type IntegrationMessage } from './integration.notifier.js';

const repo = new IntegrationRepository();

export class IntegrationService {
  list(workspaceId: string): Promise<IntegrationConnection[]> {
    return repo.list(workspaceId);
  }

  create(
    workspaceId: string,
    provider:    string,
    channelName: string,
    webhookUrl:  string,
    events:      string[] | null,
  ): Promise<IntegrationConnection> {
    return repo.create(workspaceId, provider, channelName, webhookUrl, events);
  }

  delete(id: string): Promise<void> {
    return repo.delete(id);
  }

  /**
   * Fan-out a notification to every active integration in the workspace that
   * subscribes to `event`.  Fire-and-forget — never throws.
   */
  async notify(
    workspaceId: string,
    event:       IntegrationEvent,
    msg:         IntegrationMessage,
  ): Promise<void> {
    try {
      const connections = await repo.list(workspaceId);
      const active = connections.filter(
        (c) => c.isActive && (c.events as string[]).includes(event),
      );
      await Promise.allSettled(
        active.map((c) => dispatchToIntegration(c.provider, c.webhookUrl, { ...msg, event })),
      );
    } catch (err: any) {
      console.error('[IntegrationService.notify] Error:', err?.message);
    }
  }

  /**
   * Send a test message to verify the webhook URL is reachable.
   */
  async test(provider: string, webhookUrl: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await dispatchToIntegration(provider, webhookUrl, {
        event:  'test',
        title:  'ProjectFlow Integration Test',
        detail: 'Your webhook is connected successfully!',
      });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Unknown error' };
    }
  }
}

export const integrationService = new IntegrationService();
