/**
 * BullMQ wiring for the recurring-task scheduled sweep (Phase 5c).
 *
 * A single JobScheduler-driven repeatable job (`recurrence-sweep`) ticks every
 * 15 min. The Worker calls usp_TaskRecurrence_ListDue(now) and spawns the next
 * occurrence for each due recurrence (mode incl. 'schedule'), advancing its
 * NextRunAt. Mirrors `oauth-maintenance.worker.ts` exactly: connection,
 * removeOnComplete/Fail, upsertJobScheduler (idempotent across restarts),
 * registerCloser for graceful shutdown.
 *
 * The actual work lives in recurrence.service.spawnNext so unit/integration
 * tests can drive it without Redis or a Worker. This module is only the timer.
 */

import { Queue, Worker } from 'bullmq';
import { recurrenceService } from './recurrence.service.js';
import { recurrenceRepository } from './recurrence.repository.js';
import { subLogger } from '../../shared/lib/logger.js';
import { registerCloser } from '../../shared/lib/shutdown.js';

const log = subLogger('recurrence-sweep');

const QUEUE_NAME = 'recurrence-sweep';

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

type JobName = 'recurrence-sweep';

interface JobData {
  /* No payload — the sweep reads fresh due rows from SQL each run. */
}

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

let started = false;

/**
 * Run one sweep: spawn every due recurrence. Exported for tests / manual runs.
 * Errors on an individual recurrence are logged and skipped so one bad row
 * doesn't stall the rest of the batch.
 */
export async function runRecurrenceSweep(now: Date = new Date()): Promise<{ scanned: number; spawned: number }> {
  const due = await recurrenceRepository.listDue(now);
  let spawned = 0;
  for (const rec of due) {
    try {
      const id = await recurrenceService.spawnNext(rec);
      if (id) spawned++;
    } catch (err: any) {
      log.error({ err: err?.message, recurrenceId: rec.id, taskId: rec.taskId }, 'sweep spawn failed');
    }
  }
  return { scanned: due.length, spawned };
}

export async function startRecurrenceWorker(): Promise<{ queue: Queue<JobData>; worker: Worker<JobData> } | null> {
  if (started) {
    throw new Error('startRecurrenceWorker called twice');
  }
  started = true;

  const queue = new Queue<JobData>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { count: 50 },
      removeOnFail:     { count: 50 },
    },
  });

  // Idempotent across restarts — leaves an existing scheduler entry alone.
  await queue.upsertJobScheduler(
    'recurrence-sweep-every-15m',
    { every: SWEEP_INTERVAL_MS },
    { name: 'recurrence-sweep' },
  );

  const worker = new Worker<JobData>(
    QUEUE_NAME,
    async (job) => {
      const name = job.name as JobName;
      if (name === 'recurrence-sweep') {
        const result = await runRecurrenceSweep();
        if (result.spawned > 0) {
          log.info(result, 'recurrence sweep');
        }
        return result;
      }
      throw new Error(`unknown recurrence job: ${name}`);
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobName: job?.name, jobId: job?.id, err: err?.message }, 'job failed');
  });
  worker.on('error', (err) => {
    log.error({ err: err?.message }, 'worker error');
  });

  registerCloser('recurrence-sweep-worker', () => worker.close());
  registerCloser('recurrence-sweep-queue',  () => queue.close());
  log.info({ sweepEveryMs: SWEEP_INTERVAL_MS }, 'worker started');
  return { queue, worker };
}
