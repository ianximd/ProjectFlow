import { AutomationRepository } from './automation.repository.js';
import { automationQueue }      from './automation.queue.js';
import type {
  AutomationTriggerConfig,
  AutomationCondition,
  AutomationAction,
  AutomationRule,
} from '@projectflow/types';

const repo = new AutomationRepository();

export class AutomationService {
  /** List all rules for a project */
  async list(projectId: string): Promise<AutomationRule[]> {
    return repo.list(projectId);
  }

  /** Create a new rule */
  async create(
    projectId: string,
    name: string,
    trigger: AutomationTriggerConfig,
    conditions: AutomationCondition[],
    actions: AutomationAction[],
  ): Promise<AutomationRule> {
    return repo.create(projectId, name, trigger, conditions, actions);
  }

  /** Partial update a rule */
  async update(
    id: string,
    patch: {
      name?:       string;
      isEnabled?:  boolean;
      trigger?:    AutomationTriggerConfig;
      conditions?: AutomationCondition[];
      actions?:    AutomationAction[];
    },
  ): Promise<AutomationRule | null> {
    return repo.update(id, patch);
  }

  /** Delete a rule */
  async delete(id: string): Promise<void> {
    return repo.delete(id);
  }

  /**
   * Called from other modules when an event fires (e.g., task created, sprint started).
   * Looks up matching enabled rules and enqueues a job for each.
   */
  async enqueueForEvent(
    projectId: string,
    triggerType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const rules = await repo.getByTrigger(projectId, triggerType);

    for (const rule of rules) {
      await automationQueue.add(`${triggerType}:${rule.id}`, {
        ruleId:    rule.id,
        projectId: rule.projectId,
        eventType: triggerType,
        payload,
      });
    }
  }
}
