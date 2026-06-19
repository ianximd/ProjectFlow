/**
 * BullMQ queue definition for the AI indexing pipeline (Phase 11a).
 *
 * Producers (ai-index.service) enqueue one job per object mutation; the worker
 * (ai-index.worker) consumes them and keeps dbo.AiChunks in sync. Mirrors the
 * connection / removeOnComplete conventions of recurrence.worker.
 *
 * The queue object is lazily created so importing this module never opens a
 * Redis connection (tests import the worker's runIndexJob directly, no Redis).
 */

import { Queue } from 'bullmq';
import type { AiObjectType } from './index.repository.js';

export const AI_INDEX_QUEUE = 'ai-index';

export interface AiIndexJobData {
  workspaceId: string;
  objectType: AiObjectType;
  objectId: string;
  op: 'upsert' | 'delete';
}

export const aiIndexConnection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

let queue: Queue<AiIndexJobData> | null = null;

/** Lazily construct (and memoize) the producer-side Queue. */
export function getAiIndexQueue(): Queue<AiIndexJobData> {
  if (!queue) {
    queue = new Queue<AiIndexJobData>(AI_INDEX_QUEUE, {
      connection: aiIndexConnection,
      defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    });
  }
  return queue;
}
