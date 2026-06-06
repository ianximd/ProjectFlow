import { RelationshipRepository } from './relationship.repository.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { CustomFieldRepository } from '../customfields/customfield.repository.js';
import type { CustomField, FieldRef, RelationshipRef, RollupFunction } from '@projectflow/types';

/** A task not found in the expected workspace (cross-workspace IDOR). */
export class RelationshipNotFoundError extends Error {
  code = 'RELATIONSHIP_NOT_FOUND';
  constructor(message = 'Task not found') {
    super(message);
    this.name = 'RelationshipNotFoundError';
  }
}

/**
 * Coerce an arbitrary stored value to a finite number, or null. Custom-field
 * values arrive JSON-decoded (number | string | boolean | …); builtin columns
 * arrive as numbers/strings. Used by the numeric rollup functions.
 */
function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Pure rollup aggregation. `values` are the raw per-related-task source values
 * (already extracted from the builtin column or custom-field value).
 *   - sum/avg/min/max coerce to numbers and ignore non-numeric entries.
 *   - count = number of (non-undefined) values.
 *   - first = the first value (null when empty).
 *   - concat = non-empty stringified values joined with ', '.
 * Empty set → null for every function EXCEPT count, which is 0.
 */
export function aggregateRollup(fn: RollupFunction, values: unknown[]): unknown {
  if (fn === 'count') return values.length;
  if (values.length === 0) return null;

  switch (fn) {
    case 'sum': {
      const nums = values.map(toNumber).filter((n): n is number => n !== null);
      return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
    }
    case 'avg': {
      const nums = values.map(toNumber).filter((n): n is number => n !== null);
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    }
    case 'min': {
      const nums = values.map(toNumber).filter((n): n is number => n !== null);
      return nums.length ? Math.min(...nums) : null;
    }
    case 'max': {
      const nums = values.map(toNumber).filter((n): n is number => n !== null);
      return nums.length ? Math.max(...nums) : null;
    }
    case 'first':
      return values[0] ?? null;
    case 'concat': {
      const parts = values
        .filter((v) => v !== null && v !== undefined && String(v) !== '')
        .map((v) => String(v));
      return parts.length ? parts.join(', ') : null;
    }
    default:
      return null;
  }
}

export class RelationshipService {
  constructor(
    private repo = new RelationshipRepository(),
    private taskRepo = new TaskRepository(),
    private fieldRepo = new CustomFieldRepository(),
  ) {}

  /**
   * Link `fromTaskId` → `toTaskId` for a relationship field. Defense-in-depth:
   * resolve `toTaskId`'s workspace and reject (RelationshipNotFoundError) on a
   * mismatch BEFORE the SP runs — mirrors the 5a cross-workspace IDOR fix. The
   * SP re-validates both tasks + the field as a backstop.
   */
  async add(fieldId: string, fromTaskId: string, toTaskId: string, workspaceId: string): Promise<RelationshipRef[]> {
    const toWs = await this.taskRepo.getWorkspaceId(toTaskId);
    if (!toWs || toWs !== workspaceId) throw new RelationshipNotFoundError();
    await this.repo.add(fieldId, fromTaskId, toTaskId, workspaceId);
    return this.list(fieldId, fromTaskId);
  }

  async remove(fieldId: string, fromTaskId: string, toTaskId: string): Promise<number> {
    return this.repo.remove(fieldId, fromTaskId, toTaskId);
  }

  async list(fieldId: string, fromTaskId: string): Promise<RelationshipRef[]> {
    return this.repo.listForField(fieldId, fromTaskId);
  }

  /**
   * Compute a `rollup` field's value for `taskId`. Resolves the related tasks
   * via the configured relationship field, reads each related task's source
   * field value (builtin column or custom-field value), then aggregates by the
   * configured function. Returns null when the rollup is misconfigured.
   */
  async computeRollup(taskId: string, field: CustomField): Promise<unknown> {
    const cfg = field.config;
    const relFieldId = cfg?.rollupRelationshipFieldId;
    const source = cfg?.rollupSourceField as FieldRef | undefined;
    const fn = cfg?.rollupFunction;
    if (!relFieldId || !source || !fn) return null;

    const relatedIds = await this.repo.relatedTaskIds(relFieldId, taskId);
    if (relatedIds.length === 0) return aggregateRollup(fn, []);

    const values = await Promise.all(relatedIds.map((id) => this.readSourceValue(id, source)));
    return aggregateRollup(fn, values);
  }

  /** Read one source-field value off a task: builtin column or custom-field value. */
  private async readSourceValue(taskId: string, source: FieldRef): Promise<unknown> {
    if (source.kind === 'builtin') {
      const task = await this.taskRepo.getById(taskId);
      if (!task) return null;
      return readBuiltin(task as any, source.key);
    }
    // custom: source.key is the CustomFields.Id (GUID). Pull from the task's
    // effective values (which include the LEFT-joined CurrentValue per field).
    const effective = await this.fieldRepo.effectiveForTask(taskId);
    const match = effective.find((e) => String(e.field.id).toUpperCase() === String(source.key).toUpperCase());
    return match ? match.value : null;
  }
}

/**
 * Read a builtin source value from a task row (PascalCase from usp_Task_GetById
 * SELECT *, or camelCase from a normalized read). Keys mirror the Views engine
 * builtin field-ref keys (storyPoints, priority, status, …).
 */
function readBuiltin(task: any, key: string): unknown {
  const get = (camel: string, pascal: string) => task[camel] ?? task[pascal] ?? null;
  switch (key) {
    case 'storyPoints': return get('storyPoints', 'StoryPoints');
    case 'priority':    return get('priority', 'Priority');
    case 'status':      return get('status', 'Status');
    case 'title':       return get('title', 'Title');
    case 'type':        return get('type', 'Type');
    case 'dueDate':     return get('dueDate', 'DueDate');
    case 'startDate':   return get('startDate', 'StartDate');
    case 'position':    return get('position', 'Position');
    default:            return task[key] ?? task[key.charAt(0).toUpperCase() + key.slice(1)] ?? null;
  }
}

export const relationshipService = new RelationshipService();
