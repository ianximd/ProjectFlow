import { Worker } from 'bullmq';
import { AutomationRepository } from './automation.repository.js';
import { evaluateConditionTree, parseConditionTree } from './automation.conditions.js';
import { buildConditionContext } from './condition.context.js';
import { executeAction }        from './automation.actions.js';
import type { AutomationJobData } from './automation.queue.js';
import type { LoopContext } from './automation.bus.js';
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

      // Load the rule fresh (parsed) so we always have the latest config.
      // Works for both PROJECT- and WORKSPACE-scoped rules.
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
      let passed: boolean;
      try {
        const ctx = buildConditionContext(payload, { workspaceId, actorId: payload.actorId as string | undefined });
        passed = await evaluateConditionTree(parseConditionTree(rule.conditions), ctx);
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

      // The loop context a mutating action will propagate: one deeper, this rule appended.
      const childLoop: LoopContext = {
        depth: depth + 1,
        causationChain: [...causationChain, ruleId],
      };

      const actionResults: Array<{ type: string; ok: boolean; error?: string }> = [];
      let anyFailed = false;
      for (const action of rule.actions) {
        try {
          await executeAction(action, payload, { workspaceId, projectId, loop: childLoop });
          actionResults.push({ type: action.type, ok: true });
        } catch (err: any) {
          anyFailed = true;
          actionResults.push({ type: action.type, ok: false, error: err?.message });
          log.error({ ruleId, action: action.type, err: err?.message }, 'action failed');
          // Continue with remaining actions even if one fails.
        }
      }

      const status: AutomationRunStatus =
        !anyFailed ? 'success' : actionResults.some((r) => r.ok) ? 'partial' : 'failed';

      await repo.recordRun({
        ruleId, workspaceId, projectId, triggerType: eventType, status,
        payload: JSON.stringify(payload), actionResults: JSON.stringify(actionResults),
        depth, startedAt, durationMs: Date.now() - startedAt.getTime(),
      }).catch((e: any) => log.error({ err: e?.message }, 'recordRun failed'));

      // Keep the legacy ExecutionCount / LastExecutedAt fields in sync.
      await repo.recordExecution(ruleId).catch(() => {});
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
