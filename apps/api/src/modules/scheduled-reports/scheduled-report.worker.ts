/**
 * BullMQ wiring for the scheduled-report sweep (Phase 9c).
 *
 * A single JobScheduler-driven repeatable job ticks every 5 min. The Worker calls
 * scheduledReportService.listDue(now) and runs each due schedule: snapshot → record
 * a run (idempotent per PeriodKey) → deliver via the channel adapter → advance
 * NextRunAt. Mirrors recurrence.worker.ts exactly. The real work lives in
 * scheduledReportService.runDue so unit/integration tests can drive it (via
 * runScheduledReportSweep) without Redis or a Worker.
 */

import { Queue, Worker } from 'bullmq';
import { scheduledReportService } from './scheduled-report.service.js';
import { subLogger } from '../../shared/lib/logger.js';
import { registerCloser } from '../../shared/lib/shutdown.js';

const log = subLogger('scheduled-report-sweep');

const QUEUE_NAME = 'scheduled-report-sweep';

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

type JobName = 'scheduled-report-sweep';

interface JobData {
  /* No payload — the sweep reads fresh due rows from SQL each run. */
}

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

let started = false;

/**
 * Run one sweep: deliver every due schedule. Exported for tests / manual runs.
 * Errors on an individual schedule are logged and skipped so one bad row doesn't
 * stall the rest (runDue itself records a 'failed' run and advances).
 */
export async function runScheduledReportSweep(now: Date = new Date()): Promise<{ scanned: number; delivered: number }> {
  const due = await scheduledReportService.listDue(now);
  let delivered = 0;
  for (const schedule of due) {
    try {
      const { delivered: didDeliver } = await scheduledReportService.runDue(schedule, now);
      if (didDeliver) delivered++;
    } catch (err: any) {
      log.error({ err: err?.message, scheduledReportId: schedule.id }, 'sweep runDue failed');
    }
  }
  return { scanned: due.length, delivered };
}

export async function startScheduledReportWorker(): Promise<{ queue: Queue<JobData>; worker: Worker<JobData> } | null> {
  if (started) {
    throw new Error('startScheduledReportWorker called twice');
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
    'scheduled-report-sweep-every-5m',
    { every: SWEEP_INTERVAL_MS },
    { name: 'scheduled-report-sweep' },
  );

  const worker = new Worker<JobData>(
    QUEUE_NAME,
    async (job) => {
      const name = job.name as JobName;
      if (name === 'scheduled-report-sweep') {
        const result = await runScheduledReportSweep();
        if (result.delivered > 0) {
          log.info(result, 'scheduled-report sweep');
        }
        return result;
      }
      throw new Error(`unknown scheduled-report job: ${name}`);
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobName: job?.name, jobId: job?.id, err: err?.message }, 'job failed');
  });
  worker.on('error', (err) => {
    log.error({ err: err?.message }, 'worker error');
  });

  registerCloser('scheduled-report-sweep-worker', () => worker.close());
  registerCloser('scheduled-report-sweep-queue',  () => queue.close());
  log.info({ sweepEveryMs: SWEEP_INTERVAL_MS }, 'worker started');
  return { queue, worker };
}
