/**
 * BullMQ wiring for the sprint scheduled sweep (Phase 8c).
 *
 * A single JobScheduler-driven repeatable job (`sprint-sweep`) ticks every
 * 15 min. The Worker calls usp_Sprint_ListDueFolders and, per sprint folder:
 *   - auto-STARTS the current PLANNED sprint once its StartDate arrived,
 *   - auto-COMPLETES the current ACTIVE sprint once its EndDate passed (fires the
 *     existing sprint.completed hook via sprintService.complete),
 *   - creates the NEXT sprint List per the folder cadence, and rolls unfinished
 *     tasks from the just-completed sprint into it.
 *
 * Mirrors recurrence.worker.ts exactly: connection, removeOnComplete/Fail,
 * upsertJobScheduler (idempotent across restarts), registerCloser. The work lives
 * in runSprintSweep so unit/integration tests can drive it without Redis.
 */

import { Queue, Worker } from 'bullmq';
import { sprintService } from './sprint.service.js';
import { SprintRepository } from './sprint.repository.js';
import { shouldAutoStart, shouldAutoComplete, nextSprintWindow } from './sprint.cadence.js';
import { subLogger } from '../../shared/lib/logger.js';
import { registerCloser } from '../../shared/lib/shutdown.js';

const log = subLogger('sprint-sweep');
const QUEUE_NAME = 'sprint-sweep';

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

type JobName = 'sprint-sweep';
interface JobData { /* No payload — the sweep reads fresh due folders each run. */ }

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const repo = new SprintRepository();

let started = false;

function asDate(v: unknown): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v as any);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Run one sweep. Exported for tests / manual runs. Per-folder errors are logged
 * and skipped so one bad folder doesn't stall the rest of the batch.
 */
export async function runSprintSweep(now: Date = new Date()): Promise<{ scanned: number; started: number; completed: number; created: number }> {
  const folders = await repo.listDueFolders();
  let startedCount = 0, completedCount = 0, createdCount = 0;

  for (const f of folders) {
    try {
      const sprintId = f.CurrentSprintId as string | null;
      if (!sprintId) continue;

      const sprint = {
        status:    String(f.CurrentSprintStatus ?? ''),
        startDate: asDate(f.CurrentStartDate),
        endDate:   asDate(f.CurrentEndDate),
      };

      // Auto-start.
      if (f.AutoStart && shouldAutoStart(sprint, now)) {
        await sprintService.start(sprintId);
        startedCount++;
        continue; // started this tick; complete on a later sweep
      }

      // Auto-complete + create next + roll-forward.
      if (f.AutoComplete && shouldAutoComplete(sprint, now)) {
        await sprintService.complete(sprintId);
        completedCount++;

        const win = nextSprintWindow({
          priorEndDate: sprint.endDate,
          durationDays: Number(f.DurationDays ?? 14),
          startDayOfWeek: f.StartDayOfWeek == null ? null : Number(f.StartDayOfWeek),
          now,
        });
        const next: any = await sprintService.createInFolder(
          f.FolderId, `Sprint ${win.start.toISOString().slice(0, 10)}`, null, win.start, win.end,
        );
        createdCount++;

        const nextId = next?.Id ?? next?.id;
        if (f.AutoRollForward && nextId) {
          await sprintService.rollForward(sprintId, nextId);
        }
      }
    } catch (err: any) {
      log.error({ err: err?.message, folderId: f.FolderId }, 'sweep folder failed');
    }
  }

  return { scanned: folders.length, started: startedCount, completed: completedCount, created: createdCount };
}

export async function startSprintWorker(): Promise<{ queue: Queue<JobData>; worker: Worker<JobData> } | null> {
  if (started) throw new Error('startSprintWorker called twice');
  started = true;

  const queue = new Queue<JobData>(QUEUE_NAME, {
    connection,
    defaultJobOptions: { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } },
  });

  await queue.upsertJobScheduler(
    'sprint-sweep-every-15m',
    { every: SWEEP_INTERVAL_MS },
    { name: 'sprint-sweep' },
  );

  const worker = new Worker<JobData>(
    QUEUE_NAME,
    async (job) => {
      const name = job.name as JobName;
      if (name === 'sprint-sweep') {
        const result = await runSprintSweep();
        if (result.completed > 0 || result.started > 0) log.info(result, 'sprint sweep');
        return result;
      }
      throw new Error(`unknown sprint job: ${name}`);
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => log.error({ jobName: job?.name, jobId: job?.id, err: err?.message }, 'job failed'));
  worker.on('error', (err) => log.error({ err: err?.message }, 'worker error'));

  registerCloser('sprint-sweep-worker', () => worker.close());
  registerCloser('sprint-sweep-queue',  () => queue.close());
  log.info({ sweepEveryMs: SWEEP_INTERVAL_MS }, 'worker started');
  return { queue, worker };
}
