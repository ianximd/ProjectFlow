import { AutomationRepository } from './automation.repository.js';
import { getTemplateCatalog } from './automation.templates.js';
import type {
  AutomationTriggerConfig,
  AutomationCondition,
  AutomationAction,
  AutomationRule,
  AutomationScopeType,
  AutomationRun,
  AutomationTemplate,
  AutomationUsage,
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

  /** Localized in-code template catalog (no DB). */
  listTemplates(locale: string): AutomationTemplate[] {
    return getTemplateCatalog(locale);
  }

  /** Read-only metering for a workspace in the current period (YYYYMM, UTC). */
  getUsage(workspaceId: string): Promise<AutomationUsage> {
    const now = new Date();
    const period = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    return repo.getUsage(workspaceId, period);
  }
}
