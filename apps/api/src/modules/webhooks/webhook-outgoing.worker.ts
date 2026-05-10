import { Worker } from 'bullmq';
import { deliverWebhook }            from './webhook-outgoing.dispatcher.js';
import { WebhookOutgoingRepository } from './webhook-outgoing.repository.js';
import type { OutgoingWebhookJobData } from './webhook-outgoing.queue.js';

const repo = new WebhookOutgoingRepository();

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

export function startOutgoingWebhookWorker() {
  const worker = new Worker<OutgoingWebhookJobData>(
    'outgoing-webhooks',
    async (job) => {
      const { webhookId, url, secret, event, payload } = job.data;
      const attempt = (job.attemptsMade ?? 0) + 1;

      const result = await deliverWebhook(url, secret, event, payload);

      // Log every attempt to the DB (fire-and-forget; never crash the job)
      repo.logDelivery({
        webhookId,
        event,
        payload: JSON.stringify({ event, data: payload }),
        statusCode:   result.statusCode,
        responseBody: result.responseBody,
        durationMs:   result.durationMs,
        attempt,
        success:      result.success,
      }).catch((err: any) =>
        console.error('[webhook-worker] log delivery failed:', err?.message),
      );

      if (!result.success) {
        throw new Error(
          `Delivery failed with status ${result.statusCode ?? 'network error'}`,
        );
      }
    },
    { connection, concurrency: 10 },
  );

  worker.on('failed', (job, err) => {
    console.error(`[webhook-worker] job ${job?.id} failed:`, err?.message);
  });

  worker.on('error', (err) => {
    console.error('[webhook-worker] worker error:', err?.message);
  });

  console.log('[webhook-worker] outgoing webhook worker started');
  return worker;
}
