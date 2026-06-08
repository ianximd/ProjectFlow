import { Worker } from 'bullmq';
import { AutomationRepository } from './automation.repository.js';
import { evaluateConditionTree, parseConditionTree } from './automation.conditions.js';
import { buildConditionContext } from './condition.context.js';
import { executeAction }        from './automation.actions.js';
import type { ActionContext }   from './automation.actions.context.js';
import { nextDelayedSlice }     from './automation.runner.js';
import { automationQueue }      from './automation.queue.js';
import type { AutomationJobData } from './automation.queue.js';
import type { AutomationRunStatus } from '@projectflow/types';
import { subLogger } from '../../shared/lib/logger.js';
import { registerCloser } from '../../shared/lib/shutdown.js';

const log = subLogger('automation');

const repo = new AutomationRepository();

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

export function startAutomationWorker() {
  const worker = new Worker<AutomationJobData>(
    'automation',
    async (job) => {
      const { ruleId, payload, workspaceId, projectId, eventType, depth, causationChain } = job.data;
      const startedAt = new Date();

      // 6c: a delayed-continuation job carries `actionIndex` — the position to
      // RESUME at. The initial trigger job has none (runs conditions, starts at 0).
      const isResume  = job.data.actionIndex !== undefined;
      const fromIndex = job.data.actionIndex ?? 0;

      // Load the rule fresh (parsed) so we always have the latest config.
      // Works for both PROJECT- and WORKSPACE-scoped rules. Re-checked on resume
      // too: a rule disabled mid-delay must not finish its remaining actions.
      const rule = await repo.getRuleById(ruleId);

      if (!rule || !rule.isEnabled) {
        await repo.recordRun({
          ruleId, workspaceId, projectId, triggerType: eventType, status: 'skipped',
          payload: JSON.stringify(payload), error: 'rule disabled or deleted',
          depth, startedAt, durationMs: Date.now() - startedAt.getTime(),
        }).catch(() => {});
        return;
      }

      // Phase 6b: evaluate the recursive AND/OR condition tree with real
      // PQL-filter + RBAC resolvers. A legacy flat array is read as implicit AND.
      // The resolvers do IO (USER_HAS_ROLE hits the DB), so guard the eval: a
      // resolver error records a 'failed' run (preserving the audit trail) and
      // rethrows so BullMQ still retries — rather than failing silently.
      //
      // Conditions are evaluated ONCE, on the initial pass. A resume job has
      // already passed them; re-evaluating could flip on now-changed state and
      // strand a partially-executed action batch.
      if (!isResume) {
        let passed: boolean;
        try {
          const cctx = buildConditionContext(payload, { workspaceId, actorId: payload.actorId as string | undefined });
          passed = await evaluateConditionTree(parseConditionTree(rule.conditions), cctx);
        } catch (err: any) {
          await repo.recordRun({
            ruleId, workspaceId, projectId, triggerType: eventType, status: 'failed',
            payload: JSON.stringify(payload), error: `condition eval error: ${err?.message}`,
            depth, startedAt, durationMs: Date.now() - startedAt.getTime(),
          }).catch(() => {});
          throw err;
        }
        if (!passed) {
          await repo.recordRun({
            ruleId, workspaceId, projectId, triggerType: eventType, status: 'skipped',
            payload: JSON.stringify(payload), error: 'conditions not met',
            depth, startedAt, durationMs: Date.now() - startedAt.getTime(),
          }).catch(() => {});
          return;
        }
      }

      // The action context. `loop` carries the INBOUND causal state; reEmit (in
      // the action layer) increments depth + appends this ruleId for any
      // downstream event a mutating action fires.
      const actionCtx: ActionContext = {
        ruleId, workspaceId, projectId,
        loop:    { depth, causationChain },
        payload,
      };

      // 6c: ordered, delay-aware slice. On a resume, the action AT fromIndex is
      // pre-paid (its delay already elapsed) so it runs now; otherwise the first
      // positive-delay action defers the rest to a re-enqueued delayed job.
      const slice = nextDelayedSlice(rule.actions, fromIndex, isResume);

      const actionResults: Array<{ type: string; ok: boolean; error?: string }> = [];
      let anyFailed = false;
      for (const i of slice.runNow) {
        const action = rule.actions[i];
        try {
          await executeAction(action, actionCtx);
          actionResults.push({ type: action.type, ok: true });
        } catch (err: any) {
          anyFailed = true;
          actionResults.push({ type: action.type, ok: false, error: err?.message });
          log.error({ ruleId, action: action.type, err: err?.message }, 'action failed');
          // Continue with remaining actions even if one fails.
        }
      }

      const deferred = slice.resumeAt !== null;
      const status: AutomationRunStatus =
        anyFailed
          ? (actionResults.some((r) => r.ok) ? 'partial' : 'failed')
          : 'success';

      await repo.recordRun({
        ruleId, workspaceId, projectId, triggerType: eventType, status,
        payload: JSON.stringify(payload),
        actionResults: JSON.stringify({ slice: { from: fromIndex, ran: slice.runNow, resumeAt: slice.resumeAt }, results: actionResults }),
        depth, startedAt, durationMs: Date.now() - startedAt.getTime(),
      }).catch((e: any) => log.error({ err: e?.message }, 'recordRun failed'));

      // Re-enqueue the remaining actions as a delayed continuation job, carrying
      // the same loop/payload context so order + depth + causation are preserved.
      if (deferred) {
        await automationQueue.add(
          job.name,
          { ...job.data, actionIndex: slice.resumeAt as number },
          { delay: slice.delayMs },
        ).catch((e: any) => log.error({ err: e?.message, ruleId }, 're-enqueue delayed slice failed'));
      }

      // Keep the legacy ExecutionCount / LastExecutedAt fields in sync. Bump only
      // when the batch is fully done (not on an intermediate deferred slice).
      if (!deferred) {
        await repo.recordExecution(ruleId).catch(() => {});
      }
    },
    {
      connection,
      concurrency: 5,
    },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err: err?.message }, 'job failed');
  });

  worker.on('error', (err) => {
    log.error({ err: err?.message }, 'worker error');
  });

  registerCloser('automation-worker', () => worker.close());
  log.info('worker started');
  return worker;
}
