/**
 * BullMQ wiring for the automation scheduler sweep (Phase 6c).
 *
 * A single JobScheduler-driven repeatable job ticks every 5 min. The Worker:
 *  1. Reads the last-sweep cursor from Redis.
 *  2. Calls usp_AutomationRule_ListDueDateRules(since, now) and enqueues one
 *     automationQueue job per (rule, task) pair for DUE_DATE_PASSED / DATE_ARRIVED.
 *  3. Calls usp_AutomationRule_ListScheduledRules(), evaluates each rule's cron
 *     expression against the (since, now] window, and enqueues matching rules.
 *  4. Writes now as the new cursor.
 *
 * The actual sweep logic lives in the exported pure `runScheduledSweep` so
 * integration tests can drive it without Redis or a BullMQ Worker.
 *
 * Design note: we enqueue DIRECTLY to `automationQueue` (bypassing the 6a
 * domain-event bus) because DUE_DATE_PASSED/DATE_ARRIVED/SCHEDULED are not
 * discriminated union members of AutomationDomainEvent, and resolving SCHEDULED
 * rules via getByTrigger would wrongly fan-out to every scheduled rule regardless
 * of each rule's individual cron. The 6a worker then loads the rule, evaluates
 * 6b conditions, runs actions, and records the AutomationRuns audit row uniformly.
 * Cooldown is NOT applied here — the (since, now] window + cron gate already
 * deduplicate per-crossing.
 */

import { Queue, Worker } from 'bullmq';
import { automationQueue } from './automation.queue.js';
import { automationSchedulerRepository } from './automation.scheduler.repository.js';
import { cronWindowElapsed } from './automation.runner.js';
import { getRedis } from '../../shared/lib/redis.js';
import { subLogger } from '../../shared/lib/logger.js';
import { registerCloser } from '../../shared/lib/shutdown.js';

const log = subLogger('automation-scheduler');

const QUEUE_NAME = 'automation-scheduler';
const CURSOR_KEY = 'automation:scheduler:lastSweepAt';
export const SWEEP_INTERVAL_MS = 5 * 60 * 1_000;

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

interface SchedulerJobData {
  /* No payload — the sweep reads fresh rows from SQL each run. */
}

let started = false;

/**
 * Run one sweep: enqueue automation jobs for all due-date and scheduled rules.
 * Exported for tests / manual runs — no Redis or Worker dependency.
 *
 * Per-row errors are logged and skipped so one bad row does not stall the batch.
 */
export async function runScheduledSweep(
  now: Date = new Date(),
  since: Date = new Date(now.getTime() - SWEEP_INTERVAL_MS),
): Promise<{ dueDate: number; scheduled: number }> {
  let dueDate = 0;
  let scheduled = 0;

  // ── DUE_DATE_PASSED / DATE_ARRIVED ────────────────────────────────────────
  const dueRows = await automationSchedulerRepository.listDueDateRules(since, now);
  for (const row of dueRows) {
    try {
      await automationQueue.add(`${row.TriggerType}:${row.RuleId}`, {
        ruleId:          row.RuleId,
        projectId:       row.TaskProjectId,
        workspaceId:     row.TaskWorkspaceId,
        eventType:       row.TriggerType,
        payload:         { taskId: row.TaskId, projectId: row.TaskProjectId },
        depth:           0,
        causationChain:  [],
      });
      dueDate++;
    } catch (err: any) {
      log.error(
        { err: err?.message, ruleId: row.RuleId, taskId: row.TaskId },
        'failed to enqueue due-date rule',
      );
    }
  }

  // ── SCHEDULED (cron) ──────────────────────────────────────────────────────
  const cronRows = await automationSchedulerRepository.listScheduledRules();
  for (const row of cronRows) {
    try {
      const cron = (JSON.parse(row.TriggerConfig)?.cron ?? '') as string;
      if (!cron || !cronWindowElapsed(cron, since, now)) continue;

      await automationQueue.add(`SCHEDULED:${row.RuleId}`, {
        ruleId:          row.RuleId,
        projectId:       row.ProjectId,
        workspaceId:     row.WorkspaceId,
        eventType:       'SCHEDULED',
        payload:         { ruleId: row.RuleId },
        depth:           0,
        causationChain:  [],
      });
      scheduled++;
    } catch (err: any) {
      log.error(
        { err: err?.message, ruleId: row.RuleId },
        'failed to enqueue scheduled rule',
      );
    }
  }

  return { dueDate, scheduled };
}

export async function startSchedulerWorker(): Promise<{ queue: Queue<SchedulerJobData>; worker: Worker<SchedulerJobData> } | null> {
  if (started) {
    throw new Error('startSchedulerWorker called twice');
  }
  started = true;

  const queue = new Queue<SchedulerJobData>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { count: 50 },
      removeOnFail:     { count: 50 },
    },
  });

  // Idempotent across restarts — leaves an existing scheduler entry alone.
  await queue.upsertJobScheduler(
    'automation-scheduler-every-5m',
    { every: SWEEP_INTERVAL_MS },
    { name: 'automation-scheduler' },
  );

  const worker = new Worker<SchedulerJobData>(
    QUEUE_NAME,
    async (_job) => {
      const now = new Date();
      const redis = getRedis();

      // Read last-sweep cursor; default to one interval ago on first run.
      const raw = await redis.get(CURSOR_KEY).catch(() => null);
      const since = raw ? new Date(raw) : new Date(now.getTime() - SWEEP_INTERVAL_MS);

      const result = await runScheduledSweep(now, since);

      // Advance the cursor so the next sweep covers only new crossings.
      await redis.set(CURSOR_KEY, now.toISOString()).catch((err: any) => {
        log.warn({ err: err?.message }, 'failed to write scheduler cursor');
      });

      if (result.dueDate > 0 || result.scheduled > 0) {
        log.info(result, 'automation scheduler sweep');
      }
      return result;
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobName: job?.name, jobId: job?.id, err: err?.message }, 'job failed');
  });
  worker.on('error', (err) => {
    log.error({ err: err?.message }, 'worker error');
  });

  registerCloser('automation-scheduler-worker', () => worker.close());
  registerCloser('automation-scheduler-queue',  () => queue.close());
  log.info({ sweepEveryMs: SWEEP_INTERVAL_MS }, 'worker started');
  return { queue, worker };
}
