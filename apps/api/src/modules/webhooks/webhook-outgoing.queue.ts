import { Queue } from 'bullmq';

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

export interface OutgoingWebhookJobData {
  webhookId:   string;
  workspaceId: string;
  event:       string;
  secret:      string;
  url:         string;
  payload:     Record<string, unknown>;
}

export const outgoingWebhookQueue = new Queue<OutgoingWebhookJobData>('outgoing-webhooks', {
  connection,
  defaultJobOptions: {
    attempts:  3,
    backoff:   { type: 'exponential', delay: 3000 },
    removeOnComplete: { count: 500 },
    removeOnFail:     { count: 200 },
  },
});
