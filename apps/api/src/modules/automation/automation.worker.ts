import { Worker } from 'bullmq';
import { AutomationRepository } from './automation.repository.js';
import { evaluateConditions }   from './automation.conditions.js';
import { executeAction }        from './automation.actions.js';
import type { AutomationJobData } from './automation.queue.js';

const repo = new AutomationRepository();

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

export function startAutomationWorker() {
  const worker = new Worker<AutomationJobData>(
    'automation',
    async (job) => {
      const { ruleId, payload } = job.data;

      // Load the rule fresh so we always have the latest config
      const rules = await repo.list(job.data.projectId);
      const rule  = rules.find(r => r.id === ruleId);

      if (!rule || !rule.isEnabled) {
        return; // Rule was disabled or deleted since enqueue
      }

      // Evaluate conditions
      if (!evaluateConditions(rule.conditions, payload)) {
        return; // Conditions not met
      }

      // Execute actions sequentially
      for (const action of rule.actions) {
        try {
          await executeAction(action, payload);
        } catch (err: any) {
          console.error(`[automation] action ${action.type} failed for rule ${ruleId}:`, err?.message);
          // Continue with remaining actions even if one fails
        }
      }

      // Update execution stats
      await repo.recordExecution(ruleId);
    },
    {
      connection,
      concurrency: 5,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[automation] job ${job?.id} failed:`, err?.message);
  });

  worker.on('error', (err) => {
    console.error('[automation] worker error:', err?.message);
  });

  console.log('[automation] worker started');
  return worker;
}
