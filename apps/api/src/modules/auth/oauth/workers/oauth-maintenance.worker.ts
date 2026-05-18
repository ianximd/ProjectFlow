/**
 * BullMQ wiring for the two OAuth maintenance sweeps (Phase 1.E):
 *   - silent-refresh — refresh tokens approaching expiry every 5 min
 *   - key-rotation   — re-encrypt rows under PRIMARY every 15 min
 *
 * Both are JobScheduler-driven (BullMQ ≥5) — the scheduler upserts a
 * recurring entry in Redis on boot, and the Worker picks up each tick.
 * Restart-safe: if the scheduler entry already exists, upsertJobScheduler
 * leaves it alone.
 *
 * The work itself lives in `refreshTokens.service.ts` /
 * `keyRotation.service.ts` so unit tests can drive it without
 * spinning up Redis or a Worker.
 *
 * Everything here is a no-op when token encryption isn't configured,
 * which is the OSS default — the worker queue is created but never
 * scheduled, so it's free.
 */

import { Queue, Worker } from 'bullmq';
import { isConfigured as cryptoConfigured } from '../../../../shared/lib/tokenCrypto.js';
import { runRefreshSweep } from './refreshTokens.service.js';
import { runRotationSweep } from './keyRotation.service.js';
import { subLogger } from '../../../../shared/lib/logger.js';
import { registerCloser } from '../../../../shared/lib/shutdown.js';

const log = subLogger('oauth-maintenance');

const QUEUE_NAME = 'oauth-maintenance';

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

type JobName = 'refresh-tokens' | 'key-rotation';

interface JobData {
  /* No payload — the sweep functions read fresh state from SQL each run. */
}

const REFRESH_INTERVAL_MS  = 5  * 60 * 1000;
const ROTATION_INTERVAL_MS = 15 * 60 * 1000;

let started = false;

export async function startOAuthMaintenanceWorker(): Promise<{ queue: Queue<JobData>; worker: Worker<JobData> } | null> {
  if (started) {
    throw new Error('startOAuthMaintenanceWorker called twice');
  }
  if (!cryptoConfigured()) {
    // Nothing to do — token encryption is opt-in. Silently skip.
    return null;
  }
  started = true;

  const queue = new Queue<JobData>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { count: 50 },
      removeOnFail:     { count: 50 },
    },
  });

  // Recurring sweeps. upsertJobScheduler is idempotent across restarts —
  // if the scheduler is already in Redis with the same id, this leaves
  // it alone.
  await queue.upsertJobScheduler(
    'oauth-refresh-tokens-every-5m',
    { every: REFRESH_INTERVAL_MS },
    { name: 'refresh-tokens' },
  );
  await queue.upsertJobScheduler(
    'oauth-key-rotation-every-15m',
    { every: ROTATION_INTERVAL_MS },
    { name: 'key-rotation' },
  );

  const worker = new Worker<JobData>(
    QUEUE_NAME,
    async (job) => {
      const name = job.name as JobName;
      if (name === 'refresh-tokens') {
        const result = await runRefreshSweep();
        if (result.scanned > 0) {
          log.info(result, 'refresh sweep');
        }
        return result;
      }
      if (name === 'key-rotation') {
        const result = await runRotationSweep();
        if (result.scanned > 0) {
          log.info(result, 'rotation sweep');
        }
        return result;
      }
      throw new Error(`unknown OAuth maintenance job: ${name}`);
    },
    { connection, concurrency: 1 }, // serialise — both sweeps touch the same table
  );

  worker.on('failed', (job, err) => {
    log.error({ jobName: job?.name, jobId: job?.id, err: err?.message }, 'job failed');
  });
  worker.on('error', (err) => {
    log.error({ err: err?.message }, 'worker error');
  });

  registerCloser('oauth-maintenance-worker', () => worker.close());
  registerCloser('oauth-maintenance-queue',  () => queue.close());
  log.info({ refreshEveryMs: REFRESH_INTERVAL_MS, rotateEveryMs: ROTATION_INTERVAL_MS }, 'worker started');
  return { queue, worker };
}
