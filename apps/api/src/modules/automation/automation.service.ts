import { AutomationRepository } from './automation.repository.js';
import type {
  AutomationTriggerConfig,
  AutomationCondition,
  AutomationAction,
  AutomationRule,
  AutomationScopeType,
  AutomationRun,
} from '@projectflow/types';

const repo = new AutomationRepository();

export class AutomationService {
  /** List all rules for a project. */
  async list(projectId: string): Promise<AutomationRule[]> {
    return repo.list(projectId);
  }

  /** Create a new rule (PROJECT or WORKSPACE scope). */
  async create(
    scopeType: AutomationScopeType,
    workspaceId: string,
    projectId: string | null,
    name: string,
    trigger: AutomationTriggerConfig,
    conditions: AutomationCondition[],
    actions: AutomationAction[],
  ): Promise<AutomationRule> {
    return repo.create(scopeType, workspaceId, projectId, name, trigger, conditions, actions);
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

  /** Audited run history for a rule (newest first). */
  async listRuns(ruleId: string, limit = 50, offset = 0): Promise<AutomationRun[]> {
    return repo.listRunsByRule(ruleId, limit, offset);
  }
}
