import { Worker } from 'bullmq';
import { deliverWebhook }            from './webhook-outgoing.dispatcher.js';
import { WebhookOutgoingRepository } from './webhook-outgoing.repository.js';
import type { OutgoingWebhookJobData } from './webhook-outgoing.queue.js';
import { subLogger } from '../../shared/lib/logger.js';
import { registerCloser } from '../../shared/lib/shutdown.js';

const log = subLogger('webhook-outgoing');

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
        log.error({ err: err?.message }, 'log delivery failed'),
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
    log.error({ jobId: job?.id, err: err?.message }, 'job failed');
  });

  worker.on('error', (err) => {
    log.error({ err: err?.message }, 'worker error');
  });

  registerCloser('outgoing-webhook-worker', () => worker.close());
  log.info('worker started');
  return worker;
}
