import { randomUUID } from 'node:crypto';
import { FolderRepository } from '../hierarchy/folder.repository.js';
import { ListRepository } from '../hierarchy/list.repository.js';
import { ProjectRepository } from '../projects/project.repository.js';
import { CustomFieldRepository } from '../customfields/customfield.repository.js';
import { customFieldService } from '../customfields/customfield.service.js';
import { ViewRepository } from '../views/view.repository.js';
import { TagRepository } from '../tags/tag.repository.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { spacePath, folderPath, listPath } from '../hierarchy/path.js';
import { offsetToDate } from './offsets.js';
import { publishTaskEvent } from '../../graphql/task-events.js';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import { subLogger } from '../../shared/lib/logger.js';
import sql from 'mssql';
import type {
  TemplateSnapshot,
  TemplateTaskNode, TemplateListNode, TemplateFolderNode, TemplateSpaceNode,
} from '@projectflow/types';

const log = subLogger('template-apply');

/** What apply created — the new root node id + per-kind counts. */
export interface ApplyResult {
  rootId: string;
  counts: { lists: number; tasks: number; views: number; fields: number };
}

export interface ApplyInput {
  targetParentId: string;
  anchorDate: string;            // ISO; offsets are remapped onto this anchor
  selectedItemIds?: string[];    // snapshot nodeIds; when present, import ONLY these (+ ancestors)
}

/** Resolved target context shared by every recreate path. */
interface TargetContext {
  workspaceId: string;
  spaceId: string;                    // the Space the new subtree lives in (for tags + folder/list spaceId)
  parentFolderId: string | null;     // parent folder for top-level folders/lists, else null (Space root)
  parentPath: string;                 // materialized Path prefix the first level hangs off
}

export class TemplateApplyError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

/**
 * The APPLY engine (Phase 5d, Batch 2). Recreates a captured snapshot subtree
 * under a chosen target with FRESH ids, remapping every date onto a chosen
 * anchor and re-creating custom-field defs / shared views / tags / tasks.
 *
 * Composes the EXISTING create paths (project/folder/list/customfield/view/
 * task repos + services) — it never touches a table directly. Best-effort:
 * templates are additive, so a mid-apply failure logs and reports what was
 * created rather than rolling back.
 */
export class TemplateApplier {
  constructor(
    private folders: FolderRepository = new FolderRepository(),
    private lists: ListRepository = new ListRepository(),
    private projects: ProjectRepository = new ProjectRepository(),
    private cfRepo: CustomFieldRepository = new CustomFieldRepository(),
    private views: ViewRepository = new ViewRepository(),
    private tags: TagRepository = new TagRepository(),
    private taskRepo: TaskRepository = new TaskRepository(),
  ) {}

  /**
   * Apply a parsed snapshot under `targetParentId`.
   *
   * @param snapshot     the parsed Snapshot (root type matches scopeType)
   * @param input        target + anchor + optional selected-node filter
   * @param actorId      the recreating user (becomes view owner / task reporter)
   * @param targetWorkspaceId  the target's resolved workspace (authz already done by caller)
   */
  async apply(
    snapshot: TemplateSnapshot,
    input: ApplyInput,
    actorId: string,
    targetWorkspaceId: string,
  ): Promise<ApplyResult> {
    const counts = { lists: 0, tasks: 0, views: 0, fields: 0 };
    const selected = input.selectedItemIds && input.selectedItemIds.length > 0
      ? new Set(input.selectedItemIds)
      : null;
    // A space's tag map is per-space; cache name→id so repeated tags reuse a row.
    const tagCache = new Map<string, Map<string, string>>();
    const ctx = { counts, selected, anchor: input.anchorDate, actorId, tagCache };

    switch (snapshot.scopeType) {
      case 'SPACE':  return this.applySpace(snapshot.root as TemplateSpaceNode, input.targetParentId, targetWorkspaceId, ctx);
      case 'FOLDER': return this.applyFolderRoot(snapshot.root as TemplateFolderNode, input.targetParentId, targetWorkspaceId, ctx);
      case 'LIST':   return this.applyListRoot(snapshot.root as TemplateListNode, input.targetParentId, targetWorkspaceId, ctx);
      case 'TASK':   return this.applyTaskRoot(snapshot.root as TemplateTaskNode, input.targetParentId, targetWorkspaceId, ctx);
      default:
        throw new TemplateApplyError('UNSUPPORTED_SCOPE', `Unsupported scopeType '${(snapshot as any).scopeType}'`);
    }
  }

  // ─── SPACE ──────────────────────────────────────────────────────────────────
  /** targetParentId = workspaceId. Creates a brand-new Space, then its children. */
  private async applySpace(node: TemplateSpaceNode, workspaceId: string, _targetWorkspaceId: string, ctx: Ctx): Promise<ApplyResult> {
    const key = freshSpaceKey(node.name);
    const space = await this.projects.create(workspaceId, node.name, key, null, 'KANBAN', ctx.actorId);
    const spaceId: string = (space as any).Id;
    const target: TargetContext = {
      workspaceId, spaceId, parentFolderId: null, parentPath: spacePath(spaceId),
    };
    await this.recreateContainerChildren(node, target, ctx);
    return { rootId: spaceId, counts: ctx.counts };
  }

  // ─── FOLDER (root apply) ──────────────────────────────────────────────────────
  /** targetParentId = a Space or Folder. Creates the snapshot's folder under it. */
  private async applyFolderRoot(node: TemplateFolderNode, targetParentId: string, workspaceId: string, ctx: Ctx): Promise<ApplyResult> {
    const target = await this.resolveContainerTarget(targetParentId, workspaceId);
    const newFolderId = await this.createFolder(node, target, ctx);
    return { rootId: newFolderId, counts: ctx.counts };
  }

  // ─── LIST (root apply) ────────────────────────────────────────────────────────
  /** targetParentId = a Space or Folder. Creates the snapshot's list under it. */
  private async applyListRoot(node: TemplateListNode, targetParentId: string, workspaceId: string, ctx: Ctx): Promise<ApplyResult> {
    const target = await this.resolveContainerTarget(targetParentId, workspaceId);
    const newListId = await this.createList(node, target, ctx);
    if (!newListId) throw new TemplateApplyError('NOTHING_SELECTED', 'No selected nodes to apply');
    return { rootId: newListId, counts: ctx.counts };
  }

  // ─── TASK (root apply) ────────────────────────────────────────────────────────
  /** targetParentId = a List. Recreates the task subtree as top-level tasks of it. */
  private async applyTaskRoot(node: TemplateTaskNode, listId: string, workspaceId: string, ctx: Ctx): Promise<ApplyResult> {
    // A task applies INTO an existing list — its own list's field defs already
    // exist there, so values are remapped against THAT list's defs by name.
    const fieldMap = await this.buildFieldMapForExistingList(listId);
    const newTaskId = await this.createTaskTree(node, listId, null, workspaceId, fieldMap, ctx);
    if (!newTaskId) throw new TemplateApplyError('NOTHING_SELECTED', 'No selected nodes to apply');
    return { rootId: newTaskId, counts: ctx.counts };
  }

  // ─── Container recursion (space/folder children) ─────────────────────────────
  private async recreateContainerChildren(
    node: TemplateSpaceNode | TemplateFolderNode,
    target: TargetContext,
    ctx: Ctx,
  ): Promise<void> {
    for (const sub of node.folders) {
      if (!this.includeNode(sub, ctx)) continue;
      await this.createFolder(sub, target, ctx);
    }
    for (const list of node.lists) {
      if (!this.includeNode(list, ctx)) continue;
      await this.createList(list, target, ctx);
    }
  }

  private async createFolder(node: TemplateFolderNode, parent: TargetContext, ctx: Ctx): Promise<string> {
    const id = randomUUID().toUpperCase();
    const path = folderPath(parent.parentPath, id);
    await this.folders.create({
      id, workspaceId: parent.workspaceId, spaceId: parent.spaceId,
      parentFolderId: parent.parentFolderId, name: node.name, position: Date.now(), path,
    });
    // Children of this folder hang off its own Path; it becomes their parent folder.
    const childTarget: TargetContext = {
      workspaceId: parent.workspaceId, spaceId: parent.spaceId, parentFolderId: id, parentPath: path,
    };
    await this.recreateContainerChildren(node, childTarget, ctx);
    return id;
  }

  /** Create one list + its field defs + views + tasks. Returns the new list id,
   *  or null when import-selected pruned the whole list away. */
  private async createList(node: TemplateListNode, parent: TargetContext, ctx: Ctx): Promise<string | null> {
    if (!this.includeNode(node, ctx)) return null;
    const id = randomUUID().toUpperCase();
    const path = listPath(parent.parentPath, id);
    await this.lists.create({
      id, workspaceId: parent.workspaceId, spaceId: parent.spaceId,
      folderId: parent.parentFolderId, name: node.name, position: Date.now(), path, isDefault: false,
    });
    ctx.counts.lists += 1;

    // Field defs first (tasks' values reference them). Build an old→new field id map.
    const fieldMap = new Map<string, string>();
    for (let i = 0; i < node.fieldDefs.length; i++) {
      const def = node.fieldDefs[i];
      try {
        const created = await customFieldService.create({
          scopeType: 'LIST', scopeId: id, type: def.type as any,
          name: def.name, config: def.config ?? null, required: !!def.required, position: i,
        });
        if (created) { fieldMap.set(lc(def.id), created.id); ctx.counts.fields += 1; }
      } catch (err) {
        log.warn({ err: (err as Error).message, field: def.name }, 'apply: field-def create failed');
      }
    }

    // Shared views (saved config verbatim).
    for (const v of node.views) {
      try {
        await this.views.create({
          id: randomUUID(), workspaceId: parent.workspaceId, ownerId: ctx.actorId,
          scopeType: 'LIST', scopeId: id, scopePath: path,
          type: v.type, name: v.name, isShared: true, isDefault: false,
          config: JSON.stringify(v.config), position: Date.now(),
        });
        ctx.counts.views += 1;
      } catch (err) {
        log.warn({ err: (err as Error).message, view: v.name }, 'apply: view create failed');
      }
    }

    // Tasks (top-level + recursive subtasks).
    for (const task of node.tasks) {
      if (!this.includeNode(task, ctx)) continue;
      await this.createTaskTree(task, id, null, parent.workspaceId, fieldMap, ctx, parent.spaceId);
    }
    return id;
  }

  /**
   * Recreate a task + its subtasks. Dates remapped onto the chosen anchor; status
   * defaults at the create path (the list's default). Custom-field values are set
   * via the field-id map (skipped when the def didn't resolve). Tags re-created /
   * reused per-space. Returns the new task id (null when import-selected pruned it).
   */
  private async createTaskTree(
    node: TemplateTaskNode,
    listId: string,
    parentTaskId: string | null,
    workspaceId: string,
    fieldMap: Map<string, string>,
    ctx: Ctx,
    knownSpaceId?: string,
  ): Promise<string | null> {
    if (!this.includeNode(node, ctx)) return null;

    const dueDate = offsetToDate(node.dueOffset, ctx.anchor);
    const startDate = offsetToDate(node.startOffset, ctx.anchor);
    // NOTE: usp_Task_Create has no StartDate param, so it remaps dueOffset onto
    // the deadline only. The remapped StartDate is stamped post-create via
    // usp_Task_UpdateDates below (same pattern as recurrence.spawnNext).
    const created = await this.taskRepo.create({
      workspaceId,
      listId,
      parentTaskId,
      title: node.title,
      description: node.description ?? null,
      type: node.type ?? undefined,
      priority: node.priority ?? undefined,
      reporterId: ctx.actorId,
      storyPoints: node.estimate ?? null,
      dueDate: dueDate ? dueDate.toISOString() : null,
      // status intentionally omitted → SP defaults to the list's effective status
    } as any);
    const newTaskId: string = (created as any).Id ?? (created as any).id;
    ctx.counts.tasks += 1;

    // usp_Task_Create cannot set StartDate. When the node had a start offset,
    // stamp the remapped StartDate (and re-confirm the remapped DueDate) via
    // usp_Task_UpdateDates — the same post-create dates path recurrence uses.
    // Best-effort: a failure logs and continues (templates are additive).
    if (startDate) {
      try {
        await execSpOne('usp_Task_UpdateDates', [
          { name: 'TaskId',      type: sql.UniqueIdentifier, value: newTaskId },
          { name: 'RequesterId', type: sql.UniqueIdentifier, value: ctx.actorId },
          { name: 'StartDate',   type: sql.Date,             value: startDate },
          { name: 'DueDate',     type: sql.DateTime2,        value: dueDate },
        ]);
      } catch (err) {
        log.warn({ err: (err as Error).message, task: node.title }, 'apply: set start date failed');
      }
    }

    // Live boards/views react to the recreated task.
    const projectId = (created as any).ProjectId ?? (created as any).projectId;
    if (projectId) {
      await publishTaskEvent('created', { projectId, task: created });
    }

    // Custom-field values — remap field id, skip unresolved defs / non-portable.
    for (const cf of node.customFieldValues) {
      const newFieldId = fieldMap.get(lc(cf.fieldId));
      if (!newFieldId || cf.value == null) continue;
      try {
        await customFieldService.setValue(newTaskId, newFieldId, cf.value);
      } catch (err) {
        log.warn({ err: (err as Error).message, field: newFieldId }, 'apply: field value set failed');
      }
    }

    // Tags — reuse-or-create per target space, then link.
    if (node.tags.length > 0) {
      const spaceId = knownSpaceId ?? (await this.resolveSpaceIdForList(listId));
      if (spaceId) {
        for (const name of node.tags) {
          try {
            const tagId = await this.resolveOrCreateTag(spaceId, name, ctx);
            await this.tags.linkTask(newTaskId, tagId);
          } catch (err) {
            log.warn({ err: (err as Error).message, tag: name }, 'apply: tag link failed');
          }
        }
      }
    }

    // Subtasks (parent = the new task). They live in the same list/space.
    const childSpaceId = knownSpaceId ?? undefined;
    for (const sub of node.subtasks) {
      if (!this.includeNode(sub, ctx)) continue;
      await this.createTaskTree(sub, listId, newTaskId, workspaceId, fieldMap, ctx, childSpaceId);
    }
    return newTaskId;
  }

  // ─── import-selected predicate ───────────────────────────────────────────────
  /**
   * With no selection active, everything is included. Otherwise (per spec) a node
   * is included iff it is selected, OR any descendant is selected — so the
   * REQUIRED ANCESTORS of a selected leaf are recreated while unselected siblings
   * off the selected branch are pruned. (Note: this does NOT auto-pull a selected
   * container's whole subtree; to take a whole list, select its task nodes too.)
   */
  private includeNode(node: AnyNode, ctx: Ctx): boolean {
    if (!ctx.selected) return true;
    if (ctx.selected.has(node.nodeId)) return true;    // this node selected
    return hasSelectedDescendant(node, ctx.selected);  // ancestor of a selected leaf
  }

  // ─── target / helper resolution ──────────────────────────────────────────────
  /** Resolve a FOLDER/LIST/SPACE container target into a recreate context. */
  private async resolveContainerTarget(targetParentId: string, workspaceId: string): Promise<TargetContext> {
    // Try SPACE first (top-level), then FOLDER. A LIST cannot be a container parent.
    const asSpace = await this.cfRepo.getScopeNode('SPACE', targetParentId);
    if (asSpace) {
      return { workspaceId, spaceId: targetParentId, parentFolderId: null, parentPath: spacePath(targetParentId) };
    }
    const asFolder = await this.cfRepo.getScopeNode('FOLDER', targetParentId);
    if (asFolder) {
      const spaceId = firstPathSegment(asFolder.scopePath) ?? '';
      return { workspaceId, spaceId, parentFolderId: targetParentId, parentPath: asFolder.scopePath };
    }
    throw new TemplateApplyError('TARGET_NOT_FOUND', 'Target parent is not a Space or Folder');
  }

  /**
   * For a TASK apply: the destination list already owns its field defs, so the
   * source field id can be reused ONLY when it matches a def on the dest list
   * (i.e. applying back into the same list). A TASK snapshot carries no fieldDefs
   * (so no names to match across distinct lists), so values whose source id isn't
   * a def on the target list are skipped — the honest, no-orphan-value behavior.
   */
  private async buildFieldMapForExistingList(listId: string): Promise<Map<string, string>> {
    const defs = await this.cfRepo.list('LIST', listId);
    const byId = new Map<string, string>();
    for (const d of defs) byId.set(lc(d.id), d.id);
    return byId;
  }

  private async resolveSpaceIdForList(listId: string): Promise<string | null> {
    const node = await this.cfRepo.getScopeNode('LIST', listId);
    return node ? firstPathSegment(node.scopePath) : null;
  }

  /** Reuse an existing same-name tag in the space, else create one. Cached. */
  private async resolveOrCreateTag(spaceId: string, name: string, ctx: Ctx): Promise<string> {
    let m = ctx.tagCache.get(lc(spaceId));
    if (!m) {
      m = new Map<string, string>();
      const existing = await this.tags.list(spaceId);
      for (const t of existing) m.set(lc(t.name), t.id);
      ctx.tagCache.set(lc(spaceId), m);
    }
    const hit = m.get(lc(name));
    if (hit) return hit;
    const created = await this.tags.create(randomUUID().toUpperCase(), spaceId, name, null);
    m.set(lc(name), created.id);
    return created.id;
  }
}

// ── shared apply-walk context ──
type AnyNode = { nodeId: string; folders?: AnyNode[]; lists?: AnyNode[]; tasks?: AnyNode[]; subtasks?: AnyNode[] };
interface Ctx {
  counts: { lists: number; tasks: number; views: number; fields: number };
  selected: Set<string> | null;
  anchor: string;
  actorId: string;
  tagCache: Map<string, Map<string, string>>;
}

function lc(s: string): string { return String(s).toLowerCase(); }

function firstPathSegment(path: string | null): string | null {
  if (!path) return null;
  const seg = path.split('/').filter(Boolean);
  return seg[0] ?? null;
}

/** Children of any node kind (folders + lists + tasks + subtasks). */
function childrenOf(node: AnyNode): AnyNode[] {
  return [
    ...(node.folders ?? []),
    ...(node.lists ?? []),
    ...(node.tasks ?? []),
    ...(node.subtasks ?? []),
  ];
}

function hasSelectedDescendant(node: AnyNode, selected: Set<string>): boolean {
  for (const c of childrenOf(node)) {
    if (selected.has(c.nodeId)) return true;
    if (hasSelectedDescendant(c, selected)) return true;
  }
  return false;
}

/** A short, unique, uppercase project key derived from the space name (<=20). */
function freshSpaceKey(name: string): string {
  const base = (name || 'SPACE').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6) || 'SPACE';
  const suffix = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  return `${base}${suffix}`.slice(0, 20);
}

export const templateApplier = new TemplateApplier();
