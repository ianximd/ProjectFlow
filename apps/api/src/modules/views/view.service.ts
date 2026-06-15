import { randomUUID } from 'node:crypto';
import { ViewRepository } from './view.repository.js';
import { CustomFieldRepository } from '../customfields/customfield.repository.js';
import { buildCatalog } from './query/field-catalog.js';
import { compile, builtinGroupExpr } from './query/compiler.js';
import { ViewNotFoundError, ViewValidationError } from './view.errors.js';
import { normalizeEmbedUrl, EmbedUrlError } from '../activity/embed-url.js';
import { TaskService } from '../tasks/task.service.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { customFieldService } from '../customfields/customfield.service.js';
import { WorkflowService } from '../workflows/workflow.service.js';
import { isWorkspaceMember } from '../workspaces/membership.js';
import { accessService } from '../access/access.service.js';
import { roleService } from '../roles/role.service.js';
import type { SavedView, ViewConfig, ViewScopeType, ViewType, ViewTaskPage, CustomField, BulkAction, BulkUpdateResult, CapacityResult, EmbedViewConfig } from '@projectflow/types';
import { aggregateCapacity } from './capacity/capacity-aggregate.js';

export { EmbedUrlError };

// Bulk action → the workspace permission slug its single-task REST route enforces.
// set_custom_field / move_to_list are intentionally absent: their single-task
// routes (PUT /tasks/:id/fields/:fieldId, PATCH /tasks/:id/move) gate on
// object-level EDIT via requireObjectAccess — NOT a slug — and the bulk path
// mirrors that with accessService.can(...,'EDIT') below.
const ACTION_PERMISSION_SLUG: Partial<Record<BulkAction['kind'], string>> = {
  set_status:    'task.transition', // PATCH /tasks/:id/transition
  set_priority:  'task.update',     // PATCH /tasks/:id
  set_assignees: 'task.assign',     // PUT   /tasks/:id/assignees
  delete:        'task.delete',     // DELETE /tasks/:id
};

const _taskRepo = new TaskRepository();
const _taskService = new TaskService(_taskRepo);

/** Hard cap on a single view page — bounds client-supplied config.pageSize. */
const MAX_PAGE_SIZE = 200;

// usp_Task_GetById returns SELECT * (PascalCase); read both casings defensively.
// Mirrors the helper used by the single-task REST custom-field route.
const taskListId = (t: any): string | null => t?.listId ?? t?.ListId ?? null;

/** Inclusive whole-day span between two ISO dates; 0 when either side is open. */
function daySpanInclusive(from: string | null, to: string | null): number {
  if (!from || !to) return 0;
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / 86_400_000) + 1;
}

interface ScopeNode { workspaceId: string; scopePath: string | null }

export class ViewService {
  private repo = new ViewRepository();
  private cfRepo = new CustomFieldRepository();
  private workflowService = new WorkflowService();

  /**
   * Resolve the EFFECTIVE WORKFLOW statuses for a scope so the engine Board can
   * source its columns from the workflow (parity with the legacy board) instead
   * of inferring them from the task page. A scope's project is the first segment
   * of its materialized path (`/spaceId/.../`), and a space IS a project here.
   * Returns null for EVERYTHING (spans projects → no single workflow) or when the
   * project has no workflow; the Board then falls back to task-derived columns.
   */
  async effectiveWorkflowStatuses(
    scopeType: ViewScopeType,
    scopeId: string | null,
    workspaceId?: string,
  ): Promise<Array<{ id: string; name: string; category: string; color: string; position: number }> | null> {
    if (scopeType === 'EVERYTHING') return null;
    const scope = await this.resolveScope(scopeType, scopeId, workspaceId);
    if (!scope.scopePath) return null;
    const projectId = scope.scopePath.split('/').filter(Boolean)[0];
    if (!projectId) return null;
    const wf = await this.workflowService.getByProject(projectId);
    return wf?.statuses.map((s) => ({ id: s.id, name: s.name, category: s.category, color: s.color, position: s.position })) ?? null;
  }

  private async resolveScope(
    scopeType: ViewScopeType,
    scopeId: string | null,
    fallbackWorkspaceId?: string,
  ): Promise<ScopeNode> {
    if (scopeType === 'EVERYTHING') {
      if (!fallbackWorkspaceId) throw new ViewValidationError('EVERYTHING scope requires a workspaceId');
      return { workspaceId: fallbackWorkspaceId, scopePath: null };
    }
    if (!scopeId) throw new ViewValidationError(`scopeId required for ${scopeType} scope`);
    // Reuse the existing CustomFieldRepository helper which calls usp_CustomField_GetScopeNode
    // (@ScopeType NVARCHAR(8), @ScopeId UNIQUEIDENTIFIER → WorkspaceId, ScopePath)
    const node = await this.cfRepo.getScopeNode(scopeType as any, scopeId);
    if (!node) throw new ViewValidationError('Scope node not found');
    return { workspaceId: node.workspaceId, scopePath: node.scopePath };
  }

  private async catalogFor(scopeType: ViewScopeType, scopeId: string | null) {
    let fields: CustomField[] = [];
    if (scopeType !== 'EVERYTHING' && scopeId) {
      // CustomFieldRepository.list(scopeType: CustomFieldScopeType, scopeId: string)
      fields = await this.cfRepo.list(scopeType as any, scopeId);
    }
    return buildCatalog(fields);
  }

  private async validateConfig(
    scopeType: ViewScopeType,
    scopeId: string | null,
    scope: ScopeNode,
    config: ViewConfig,
  ): Promise<void> {
    const catalog = await this.catalogFor(scopeType, scopeId);
    try {
      compile({
        workspaceId: scope.workspaceId,
        scope: { scopeType, scopePath: scope.scopePath },
        catalog,
        filter: config.filter ?? { conjunction: 'AND', rules: [] },
        sort: config.sort ?? [],
      });
    } catch (e) {
      throw new ViewValidationError((e as Error).message);
    }
  }

  async create(
    userId: string,
    input: {
      scopeType: ViewScopeType;
      scopeId: string | null;
      type: ViewType;
      name: string;
      isShared: boolean;
      isDefault: boolean;
      config: ViewConfig;
      workspaceId?: string;
    },
  ): Promise<SavedView> {
    const scope = await this.resolveScope(input.scopeType, input.scopeId, input.workspaceId);
    await this.validateConfig(input.scopeType, input.scopeId, scope, input.config);
    // Embed views: validate + normalize the URL before persisting so the stored
    // value is always a canonical http/https URL (no javascript:, data:, etc.).
    const configToStore: ViewConfig =
      input.type === 'embed'
        ? ({ ...input.config, url: normalizeEmbedUrl((input.config as EmbedViewConfig).url ?? '') } as EmbedViewConfig)
        : input.config;
    return this.repo.create({
      id: randomUUID(),
      workspaceId: scope.workspaceId,
      ownerId: userId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      scopePath: scope.scopePath,
      type: input.type,
      name: input.name,
      isShared: input.isShared,
      isDefault: input.isDefault,
      config: JSON.stringify(configToStore),
      position: Date.now(),
    });
  }

  async update(
    id: string,
    patch: { name?: string; isShared?: boolean; isDefault?: boolean; config?: ViewConfig },
  ): Promise<SavedView> {
    const existing = await this.getOrThrow(id);
    let configToStore: ViewConfig | undefined = patch.config;
    if (patch.config) {
      const scope = await this.resolveScope(existing.scopeType, existing.scopeId, existing.workspaceId);
      await this.validateConfig(existing.scopeType, existing.scopeId, scope, patch.config);
      // Embed views: validate + normalize the URL before persisting.
      if (existing.type === 'embed') {
        configToStore = ({
          ...patch.config,
          url: normalizeEmbedUrl((patch.config as EmbedViewConfig).url ?? ''),
        } as EmbedViewConfig);
      }
    }
    const updated = await this.repo.update(id, {
      name: patch.name,
      isShared: patch.isShared,
      isDefault: patch.isDefault,
      config: configToStore ? JSON.stringify(configToStore) : undefined,
    });
    if (!updated) throw new ViewNotFoundError();
    return updated;
  }

  async delete(id: string): Promise<SavedView> {
    const v = await this.repo.delete(id);
    if (!v) throw new ViewNotFoundError();
    return v;
  }

  async reorder(id: string, position: number): Promise<SavedView> {
    const v = await this.repo.reorder(id, position);
    if (!v) throw new ViewNotFoundError();
    return v;
  }

  async list(
    userId: string,
    scopeType: ViewScopeType,
    scopeId: string | null,
    workspaceId?: string,
  ): Promise<SavedView[]> {
    const scope = await this.resolveScope(scopeType, scopeId, workspaceId);
    return this.repo.list(scope.workspaceId, userId, scopeType, scopeId);
  }

  async getOrThrow(id: string): Promise<SavedView> {
    const v = await this.repo.getById(id);
    if (!v) throw new ViewNotFoundError();
    return v;
  }

  /**
   * Bulk-apply one action to many tasks. Partial-success: a per-task error
   * pushes to `failed` without aborting the rest of the batch.
   *
   * Per-task permission: we resolve the task's workspaceId and assert that the
   * caller is a workspace member. The individual task-service methods do NOT
   * self-check access, so this explicit gate is mandatory. On top of that
   * baseline, set_custom_field and move_to_list additionally enforce object-level
   * (hierarchy ACL) EDIT, mirroring their single-task REST routes.
   */
  async bulkUpdate(
    userId: string,
    input: { taskIds: string[]; action: BulkAction },
  ): Promise<BulkUpdateResult> {
    const updated: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    // Cache the caller's permission slugs per workspace so a batch of tasks in the
    // same workspace resolves slugs once, not per task.
    const permCache = new Map<string, Set<string>>();
    for (const id of input.taskIds) {
      try {
        await this.applyAction(userId, id, input.action, permCache);
        updated.push(id);
      } catch (e) {
        failed.push({ id, reason: (e as Error).message });
      }
    }
    return { updated, failed };
  }

  private async applyAction(
    userId: string,
    taskId: string,
    action: BulkAction,
    permCache: Map<string, Set<string>>,
  ): Promise<void> {
    // Per-task permission baseline: resolve the workspace the task belongs to and
    // verify the caller is a member. None of the task-service methods enforce this
    // themselves, so we must gate here before calling any of them. This is the
    // cheap cross-workspace gate; object-level (hierarchy ACL) checks are layered
    // on top below for the actions whose single-task REST routes enforce them.
    const workspaceId = await _taskRepo.getWorkspaceId(taskId);
    if (!workspaceId) throw new Error(`Task not found: ${taskId}`);
    const isMember = await isWorkspaceMember(workspaceId, userId);
    if (!isMember) throw new Error(`User is not a member of the task's workspace`);

    // Permission-slug parity with the single-task REST routes. isWorkspaceMember is
    // strictly weaker than the slug a single-task route requires (e.g. a
    // workspace-viewer is a member but holds no task.* mutation slug), so without
    // this the bulk endpoint would let a member perform a mutation their
    // single-task route rejects (privilege escalation). set_custom_field /
    // move_to_list have no entry here — they use object-level EDIT below instead.
    const requiredSlug = ACTION_PERMISSION_SLUG[action.kind];
    if (requiredSlug) {
      let slugs = permCache.get(workspaceId);
      if (!slugs) {
        slugs = await roleService.getUserPermissionSlugs(userId, workspaceId);
        permCache.set(workspaceId, slugs);
      }
      if (!slugs.has(requiredSlug))
        throw new Error(`User lacks '${requiredSlug}' permission`);
    }

    switch (action.kind) {
      case 'set_status':
        await _taskService.transitionTask(taskId, action.status, userId);
        break;
      case 'set_priority':
        await _taskService.updateTask(taskId, { priority: action.priority }, userId);
        break;
      case 'set_assignees':
        await _taskService.setAssignees(taskId, action.userIds, userId);
        break;
      case 'set_custom_field': {
        // Object-level parity with PUT /tasks/:id/fields/:fieldId, which gates on
        // EDIT access to the task's OWN List. A workspace member excluded from a
        // private List (explicit sub-EDIT grant) must not bulk-write fields there.
        const listId = taskListId(await _taskRepo.getById(taskId));
        if (!listId) throw new Error(`Task is not in a List: ${taskId}`);
        if (!(await accessService.can(userId, 'LIST', listId, 'EDIT')))
          throw new Error(`User lacks EDIT access on the task's list`);
        await customFieldService.setValue(taskId, action.fieldId, action.value);
        break;
      }
      case 'move_to_list': {
        // Object-level parity with PATCH /tasks/:id/move, which gates on EDIT
        // access to the DESTINATION List (not the task's current List).
        if (!(await accessService.can(userId, 'LIST', action.listId, 'EDIT')))
          throw new Error(`User lacks EDIT access on the destination list`);
        await _taskService.moveTask(taskId, action.listId, 0);
        break;
      }
      case 'delete':
        await _taskService.deleteTask(taskId, userId);
        break;
      default: {
        // Exhaustive check — TypeScript will error if a BulkAction kind is unhandled
        const _exhaustive: never = action;
        throw new Error(`Unknown action kind: ${(_exhaustive as any).kind}`);
      }
    }
  }

  async runView(
    userId: string,
    id: string,
    opts: { page: number; pageSize?: number; meMode?: boolean },
  ): Promise<ViewTaskPage> {
    const view = await this.getOrThrow(id);
    return this.runConfig(view.scopeType, view.scopeId, view.config, opts, view.workspaceId, userId);
  }

  async runConfig(
    scopeType: ViewScopeType,
    scopeId: string | null,
    config: ViewConfig,
    opts: { page: number; pageSize?: number; meMode?: boolean },
    workspaceId: string | undefined,
    userId: string,
  ): Promise<ViewTaskPage> {
    const scope = await this.resolveScope(scopeType, scopeId, workspaceId);
    const catalog = await this.catalogFor(scopeType, scopeId);
    const compiled = compile({
      workspaceId: scope.workspaceId,
      scope: { scopeType, scopePath: scope.scopePath },
      catalog,
      filter: config.filter ?? { conjunction: 'AND', rules: [] },
      sort: config.sort ?? [],
      meUserId: (opts.meMode ?? config.meMode) ? userId : undefined,
    });
    // Clamp pageSize to a sane integer range. config.pageSize comes from
    // client-supplied JSON (notably previewViewTasks), so cap it to avoid an
    // unbounded page that would scan/return the entire scope.
    const requestedSize = opts.pageSize ?? config.pageSize ?? 25;
    const pageSize = Math.min(Math.max(Math.floor(Number(requestedSize)) || 25, 1), MAX_PAGE_SIZE);
    const page = await this.repo.queryTasks(compiled, { page: opts.page, pageSize });
    if (config.groupBy) {
      page.groups = await this.repo.groupCounts(compiled, builtinGroupExpr(catalog, config.groupBy));
    }
    return page;
  }

  /**
   * Phase 8d — capacity aggregation for the Workload/Box views. Reuses the Views
   * query compiler so the same scope/filter/tenant guarantees apply, then sums
   * assigned estimates (8a) + points (8c) per assignee over an optional DueDate
   * range and classifies each assignee over/at/under capacity (pure helpers).
   *
   * @param workspaceId required when scopeType is 'EVERYTHING' (resolveScope throws
   *   otherwise); forwarded from the authenticated workspace context by the caller.
   * @param range inclusive calendar-day bounds (ISO 'YYYY-MM-DD'). Capacity is
   *   per-day granular, so any time component is dropped (see normalization below).
   */
  async capacity(
    scopeType: ViewScopeType,
    scopeId: string | null,
    config: ViewConfig,
    range: { from: string | null; to: string | null },
    workspaceId: string | undefined,
    userId: string,
  ): Promise<CapacityResult> {
    const scope = await this.resolveScope(scopeType, scopeId, workspaceId);
    const catalog = await this.catalogFor(scopeType, scopeId);
    const compiled = compile({
      workspaceId: scope.workspaceId,
      scope: { scopeType, scopePath: scope.scopePath },
      catalog,
      filter: config.filter ?? { conjunction: 'AND', rules: [] },
      sort: [], // capacity does not sort tasks; rows are re-ordered by overload ratio in aggregateCapacity
      meUserId: config.meMode ? userId : undefined,
    });
    // Capacity is calendar-day granular (capacityPerDaySeconds × days). Normalize the
    // bounds to date-only ONCE here so the SQL DueDate range (Task 3, whole-`to`-day
    // inclusive) and the daySpanInclusive day-count always agree, whether the caller
    // passes a date or a datetime string.
    const from = range.from ? range.from.slice(0, 10) : null;
    const to = range.to ? range.to.slice(0, 10) : null;
    const raw = await this.repo.capacityByAssignee(compiled, { from, to });
    const metric = config.capacityMetric ?? 'time';
    const days = daySpanInclusive(from, to);
    return aggregateCapacity(raw, {
      metric,
      from,
      to,
      capacityPerDaySeconds: config.capacityPerDaySeconds,
      capacityPerSprintPoints: config.capacityPerSprintPoints,
      days,
    });
  }
}

export const viewService = new ViewService();
