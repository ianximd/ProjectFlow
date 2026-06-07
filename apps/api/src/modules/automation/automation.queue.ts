import { Queue } from 'bullmq';
import { registerCloser } from '../../shared/lib/shutdown.js';

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

export interface AutomationJobData {
  ruleId:         string;
  projectId:      string | null;
  workspaceId:    string;
  eventType:      string;
  /** Serialised payload (task, sprint, etc.) carrying old/new diffs. */
  payload:        Record<string, unknown>;
  /** Loop-guard causal depth at enqueue time. */
  depth:          number;
  /** Rule ids already fired in this causal chain. */
  causationChain: string[];
}

export const automationQueue = new Queue<AutomationJobData>('automation', {
  connection,
  defaultJobOptions: {
    attempts:    3,
    backoff:     { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 200 },
    removeOnFail:     { count: 100 },
  },
});

registerCloser('automation-queue', () => automationQueue.close());
