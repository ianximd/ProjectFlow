import { randomUUID } from 'node:crypto';
import { CustomFieldRepository } from './customfield.repository.js';
import { validateFieldValue } from './validators.js';
import { FieldValidationError, RequiredFieldsUnmetError } from './customfield.errors.js';
import { isWorkspaceMember } from '../workspaces/membership.js';
import type { CustomField, CustomFieldConfig, CustomFieldScopeType, CustomFieldType, EffectiveField } from '@projectflow/types';

export class CustomFieldService {
  constructor(private repo: CustomFieldRepository = new CustomFieldRepository()) {}

  /** Create a field at a SPACE/FOLDER/LIST scope. Returns null when the scope node is missing. */
  async create(input: {
    scopeType: CustomFieldScopeType; scopeId: string; type: CustomFieldType;
    name: string; config: CustomFieldConfig | null; required: boolean; position: number;
  }): Promise<CustomField | null> {
    const node = await this.repo.getScopeNode(input.scopeType, input.scopeId);
    if (!node) return null;
    const id = randomUUID().toUpperCase();
    return this.repo.create({
      id, workspaceId: node.workspaceId, scopeType: input.scopeType, scopeId: input.scopeId,
      scopePath: node.scopePath, type: input.type, name: input.name,
      config: input.config ? JSON.stringify(input.config) : null,
      required: input.required, position: input.position,
    });
  }

  update(id: string, p: { name?: string; config?: CustomFieldConfig | null; clearConfig?: boolean; required?: boolean }) {
    return this.repo.update(id, {
      name: p.name,
      config: p.config === undefined ? undefined : (p.config ? JSON.stringify(p.config) : null),
      clearConfig: p.clearConfig,
      required: p.required,
    });
  }

  delete(id: string) { return this.repo.delete(id); }
  list(scopeType: CustomFieldScopeType, scopeId: string) { return this.repo.list(scopeType, scopeId); }
  reorder(id: string, position: number) { return this.repo.reorder(id, position); }
  effectiveForTask(taskId: string): Promise<EffectiveField[]> { return this.repo.effectiveForTask(taskId); }
  getById(id: string) { return this.repo.getById(id); }

  /**
   * Set one value for one (task, field). Validates per-type; for `people` also
   * checks workspace membership; rejects writes to `progress_auto`.
   * Throws FieldValidationError (-> 422) on any failure.
   */
  async setValue(taskId: string, fieldId: string, value: unknown): Promise<void> {
    const field = await this.repo.getById(fieldId);
    if (!field) throw new FieldValidationError('FIELD_NOT_FOUND', 'Custom field not found');

    const result = validateFieldValue(field.type, value, field.config);
    if (!result.valid) throw new FieldValidationError(result.code ?? 'INVALID', result.message ?? 'Invalid value');

    if (field.type === 'people') {
      const ids = value as string[];
      for (const uid of ids) {
        if (!(await isWorkspaceMember(field.workspaceId, uid)))
          throw new FieldValidationError('NOT_MEMBER', `User ${uid} is not a workspace member`);
      }
    }
    await this.repo.setValue(taskId, fieldId, JSON.stringify(value));
  }

  deleteValue(taskId: string, fieldId: string) { return this.repo.deleteValue(taskId, fieldId); }

  /** Called by the tasks service before a transition. Throws RequiredFieldsUnmetError when blocked. */
  async assertRequiredMetForStatus(taskId: string, targetStatus: string): Promise<void> {
    const missing = await this.repo.requiredUnmetForStatus(taskId, targetStatus);
    if (missing.length > 0)
      throw new RequiredFieldsUnmetError(missing.map((m) => ({ id: m.id, name: m.name })));
  }

  recomputeProgressAuto(parentTaskId: string) { return this.repo.recomputeProgressAuto(parentTaskId); }
}

export const customFieldService = new CustomFieldService();
