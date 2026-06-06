import { randomUUID } from 'node:crypto';
import { TemplateRepository, templateRepository } from './template.repository.js';
import { dateToOffset } from './offsets.js';
import { HierarchyRepository } from '../hierarchy/hierarchy.repository.js';
import { FolderRepository } from '../hierarchy/folder.repository.js';
import { ListRepository } from '../hierarchy/list.repository.js';
import { ProjectRepository } from '../projects/project.repository.js';
import { CustomFieldRepository } from '../customfields/customfield.repository.js';
import { customFieldService } from '../customfields/customfield.service.js';
import { ViewRepository } from '../views/view.repository.js';
import { TagRepository } from '../tags/tag.repository.js';
import { TaskRepository } from '../tasks/task.repository.js';
import type {
  Template, TemplateScopeType, TemplateSnapshot,
  TemplateTaskNode, TemplateListNode, TemplateFolderNode, TemplateSpaceNode,
  CustomFieldType, EffectiveField,
} from '@projectflow/types';

/**
 * Custom-field VALUE types we DROP at capture (not portable to a fresh subtree):
 *  - relationship/rollup: point at / aggregate over SPECIFIC linked task ids
 *    that won't exist in the applied copy.
 *  - progress_auto: computed from subtask completion, never a stored value.
 * Their field DEFINITIONS are still copied (apply re-creates the defs); only the
 * per-task VALUES are skipped.
 */
const NON_PORTABLE_VALUE_TYPES = new Set<CustomFieldType>(['relationship', 'rollup', 'progress_auto']);

/** A descendant-task row (usp_Hierarchy_DescendantTasks / usp_Task_GetById, SELECT * PascalCase). */
interface TaskRow {
  Id: string;
  ListId: string | null;
  ParentTaskId: string | null;
  Title: string;
  Description: string | null;
  Type: string | null;
  Priority: string | null;
  StoryPoints: number | null;
  StartDate: Date | string | null;
  DueDate: Date | string | null;
}

export class TemplateService {
  constructor(
    private repo: TemplateRepository = templateRepository,
    private hierarchy: HierarchyRepository = new HierarchyRepository(),
    private folders: FolderRepository = new FolderRepository(),
    private lists: ListRepository = new ListRepository(),
    private projects: ProjectRepository = new ProjectRepository(),
    private cfRepo: CustomFieldRepository = new CustomFieldRepository(),
    private views: ViewRepository = new ViewRepository(),
    private tags: TagRepository = new TagRepository(),
    private taskRepo: TaskRepository = new TaskRepository(),
  ) {}

  // ─── CRUD reads (metadata) ────────────────────────────────────────────────
  list(workspaceId: string, scopeType: TemplateScopeType | null) { return this.repo.list(workspaceId, scopeType); }
  getById(id: string) { return this.repo.getById(id); }
  delete(id: string) { return this.repo.delete(id); }

  /** Resolve the workspace a template belongs to (for authz on get/delete). */
  async getWorkspaceId(id: string): Promise<string | null> {
    const row = await this.repo.getRowById(id);
    return row?.WorkspaceId ?? null;
  }

  /** Creator of a template (for delete authz: creator OR workspace admin). */
  async getCreatorId(id: string): Promise<string | null> {
    const row = await this.repo.getRowById(id);
    return row?.CreatedById ?? null;
  }

  /** Raw Snapshot JSON string for a live template (null when absent). Used by
   *  the GraphQL `template.snapshot` field and the apply path (later batch). */
  async getSnapshotJson(id: string): Promise<string | null> {
    const row = await this.repo.getRowById(id);
    return row?.Snapshot ?? null;
  }

  // ─── Capture ──────────────────────────────────────────────────────────────
  /**
   * Capture a source node's subtree into a template snapshot and persist it.
   * Composes EXISTING reads (hierarchy descendant tasks, folder/list lists,
   * custom-field defs + effective values, shared views, tags) — no raw table
   * queries. The workspace is resolved from the source node.
   *
   * ANCHOR: the earliest start/due date in the captured subtree, else "now".
   * Computed in a pre-pass over the subtree's task dates so every offset below
   * is relative to a single, known anchor.
   */
  async captureTemplate(
    scopeType: TemplateScopeType,
    sourceId: string,
    name: string,
    description: string | null,
    actorId: string,
  ): Promise<Template> {
    const workspaceId = await this.resolveWorkspaceId(scopeType, sourceId);
    if (!workspaceId) throw new TemplateSourceNotFoundError();

    const snapshot = await this.buildSnapshot(scopeType, sourceId);

    return this.repo.create({
      id: randomUUID().toUpperCase(),
      workspaceId,
      scopeType,
      name,
      description,
      snapshot: JSON.stringify(snapshot),
      createdById: actorId,
    });
  }

  /** Workspace lookup for a source node (used by capture + REST/GraphQL authz). */
  async resolveWorkspaceId(scopeType: TemplateScopeType, sourceId: string): Promise<string | null> {
    if (scopeType === 'TASK') return this.taskRepo.getWorkspaceId(sourceId);
    // SPACE/FOLDER/LIST all resolve through the shared scope-node read.
    const node = await this.cfRepo.getScopeNode(scopeType as any, sourceId);
    return node?.workspaceId ?? null;
  }

  /** The source LIST id for a task (for VIEW-on-the-task's-list authz). */
  async taskListId(taskId: string): Promise<string | null> {
    const t = await this.taskRepo.getById(taskId);
    return (t as any)?.listId ?? (t as any)?.ListId ?? null;
  }

  // ─── Snapshot builders ──────────────────────────────────────────────────────
  private async buildSnapshot(scopeType: TemplateScopeType, sourceId: string): Promise<TemplateSnapshot> {
    if (scopeType === 'TASK') return this.buildTaskSnapshot(sourceId);
    if (scopeType === 'LIST') return this.buildListSnapshot(sourceId);
    if (scopeType === 'FOLDER') return this.buildFolderSnapshot(sourceId);
    return this.buildSpaceSnapshot(sourceId);
  }

  // ── TASK ──
  private async buildTaskSnapshot(taskId: string): Promise<TemplateSnapshot> {
    const row = (await this.taskRepo.getById(taskId)) as any as TaskRow | null;
    if (!row) throw new TemplateSourceNotFoundError();

    // Pull the source task's whole LIST subtree once, then walk this task's
    // descendants via ParentTaskId — no per-subtask query. Fall back to the
    // single row when the task has no list.
    const all = row.ListId
      ? ((await this.hierarchy.descendantTasks('LIST', row.ListId)) as any as TaskRow[])
      : [row];
    if (!all.some((t) => sameId(t.Id, taskId))) all.push(row);

    const subtreeRows = collectTaskSubtree(row, all);
    const anchor = pickAnchor(allDatesOf(subtreeRows));
    const byParent = indexByParent(all);

    const root = await this.buildTaskNode(row, byParent, 'task/0', anchor);
    return { scopeType: 'TASK', anchor, root };
  }

  /** Recursively build a task node from a row + a parent→children index. */
  private async buildTaskNode(
    row: TaskRow,
    byParent: Map<string, TaskRow[]>,
    nodeId: string,
    anchor: string,
  ): Promise<TemplateTaskNode> {
    const [cfValues, tagRows] = await Promise.all([
      this.portableFieldValues(row.Id),
      this.tags.listForTask(row.Id),
    ]);

    const children = byParent.get(String(row.Id).toLowerCase()) ?? [];
    const subtasks: TemplateTaskNode[] = [];
    for (let i = 0; i < children.length; i++) {
      subtasks.push(await this.buildTaskNode(children[i], byParent, `${nodeId}/sub/${i}`, anchor));
    }

    return {
      nodeId,
      title: row.Title,
      description: row.Description ?? null,
      type: row.Type ?? null,
      priority: row.Priority ?? null,
      estimate: row.StoryPoints ?? null,
      startOffset: dateToOffset(row.StartDate, anchor),
      dueOffset: dateToOffset(row.DueDate, anchor),
      customFieldValues: cfValues,
      tags: tagRows.map((t) => t.name),
      subtasks,
    };
  }

  // ── LIST ──
  private async buildListSnapshot(listId: string): Promise<TemplateSnapshot> {
    const list = (await this.lists.getById(listId)) as any;
    if (!list) throw new TemplateSourceNotFoundError();

    const taskRows = (await this.hierarchy.descendantTasks('LIST', listId)) as any as TaskRow[];
    const anchor = pickAnchor(allDatesOf(taskRows));
    const node = await this.buildListNode(list, taskRows, 'root', anchor);
    return { scopeType: 'LIST', anchor, root: node };
  }

  /** Build a list node from its row + the list's flat task rows. */
  private async buildListNode(
    list: any,
    taskRows: TaskRow[],
    nodeId: string,
    anchor: string,
  ): Promise<TemplateListNode> {
    const [fieldDefs, viewRows] = await Promise.all([
      this.cfRepo.list('LIST', list.Id),
      this.views.listForScope('LIST', list.Id),
    ]);
    const tasks = await this.buildTopLevelTaskNodes(taskRows, `${nodeId}/list-tasks`, anchor);

    return {
      nodeId,
      name: list.Name,
      fieldDefs,
      views: viewRows.map((v) => ({ name: v.name, type: v.type, config: v.config })),
      tasks,
    };
  }

  // ── FOLDER ──
  private async buildFolderSnapshot(folderId: string): Promise<TemplateSnapshot> {
    const folder = (await this.folders.getById(folderId)) as any;
    if (!folder) throw new TemplateSourceNotFoundError();
    const spaceId: string = folder.SpaceId;

    // One descendant read across the folder's whole subtree gives every date for
    // the anchor pre-pass; per-list rows are sliced from it (keyed by ListPath).
    const subtreeTasks = (await this.hierarchy.descendantTasks('FOLDER', folderId)) as any as TaskRow[];
    const anchor = pickAnchor(allDatesOf(subtreeTasks));

    const [allFolders, allLists] = await Promise.all([
      this.folders.list(spaceId) as Promise<any[]>,
      this.lists.list(spaceId, null, true) as Promise<any[]>,
    ]);
    const tasksByList = indexTasksByList(subtreeTasks);

    const node = await this.buildFolderNode(folder, allFolders, allLists, tasksByList, 'root', anchor);
    return { scopeType: 'FOLDER', anchor, root: node };
  }

  private async buildFolderNode(
    folder: any,
    allFolders: any[],
    allLists: any[],
    tasksByList: Map<string, TaskRow[]>,
    nodeId: string,
    anchor: string,
  ): Promise<TemplateFolderNode> {
    const childFolders = allFolders.filter((f) => sameId(f.ParentFolderId, folder.Id));
    const childLists = allLists.filter((l) => sameId(l.FolderId, folder.Id));

    const folders: TemplateFolderNode[] = [];
    for (let i = 0; i < childFolders.length; i++) {
      folders.push(await this.buildFolderNode(childFolders[i], allFolders, allLists, tasksByList, `${nodeId}/folder/${i}`, anchor));
    }
    const lists: TemplateListNode[] = [];
    for (let i = 0; i < childLists.length; i++) {
      const rows = tasksByList.get(String(childLists[i].Id).toLowerCase()) ?? [];
      lists.push(await this.buildListNode(childLists[i], rows, `${nodeId}/list/${i}`, anchor));
    }

    return { nodeId, name: folder.Name, folders, lists };
  }

  // ── SPACE ──
  private async buildSpaceSnapshot(spaceId: string): Promise<TemplateSnapshot> {
    const space = (await this.projects.getById(spaceId)) as any;
    if (!space) throw new TemplateSourceNotFoundError();

    const subtreeTasks = (await this.hierarchy.descendantTasks('SPACE', spaceId)) as any as TaskRow[];
    const anchor = pickAnchor(allDatesOf(subtreeTasks));

    const [allFolders, allLists] = await Promise.all([
      this.folders.list(spaceId) as Promise<any[]>,
      this.lists.list(spaceId, null, true) as Promise<any[]>,
    ]);
    const tasksByList = indexTasksByList(subtreeTasks);

    // Top-level folders (no parent) and root lists (no folder).
    const topFolders = allFolders.filter((f) => f.ParentFolderId == null);
    const rootLists = allLists.filter((l) => l.FolderId == null);

    const folders: TemplateFolderNode[] = [];
    for (let i = 0; i < topFolders.length; i++) {
      folders.push(await this.buildFolderNode(topFolders[i], allFolders, allLists, tasksByList, `root/folder/${i}`, anchor));
    }
    const lists: TemplateListNode[] = [];
    for (let i = 0; i < rootLists.length; i++) {
      const rows = tasksByList.get(String(rootLists[i].Id).toLowerCase()) ?? [];
      lists.push(await this.buildListNode(rootLists[i], rows, `root/list/${i}`, anchor));
    }

    const node: TemplateSpaceNode = { nodeId: 'root', name: space.Name, folders, lists };
    return { scopeType: 'SPACE', anchor, root: node };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  /**
   * Top-level (non-subtask) tasks of a flat descendant set, each with its
   * recursive subtasks. descendantTasks returns the WHOLE list subtree flat;
   * keep only roots (ParentTaskId null) and rebuild the tree from there.
   */
  private async buildTopLevelTaskNodes(rows: TaskRow[], nodeIdBase: string, anchor: string): Promise<TemplateTaskNode[]> {
    const byParent = indexByParent(rows);
    const roots = rows.filter((t) => t.ParentTaskId == null);
    const nodes: TemplateTaskNode[] = [];
    for (let i = 0; i < roots.length; i++) {
      nodes.push(await this.buildTaskNode(roots[i], byParent, `${nodeIdBase}/task/${i}`, anchor));
    }
    return nodes;
  }

  /** Effective custom-field values for a task, MINUS non-portable types. */
  private async portableFieldValues(taskId: string): Promise<Array<{ fieldId: string; value: unknown }>> {
    const effective: EffectiveField[] = await customFieldService.effectiveForTask(taskId);
    return effective
      .filter((ef) => !NON_PORTABLE_VALUE_TYPES.has(ef.field.type) && ef.value != null)
      .map((ef) => ({ fieldId: ef.field.id, value: ef.value }));
  }
}

export class TemplateSourceNotFoundError extends Error {
  code = 'TEMPLATE_SOURCE_NOT_FOUND';
  constructor() { super('Template source node not found'); }
}

// ── Date utilities ──
function toDateOrNull(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function allDatesOf(rows: TaskRow[]): Date[] {
  const out: Date[] = [];
  for (const r of rows) {
    const s = toDateOrNull(r.StartDate); if (s) out.push(s);
    const d = toDateOrNull(r.DueDate);   if (d) out.push(d);
  }
  return out;
}

/**
 * Anchor = the EARLIEST start/due date in the captured subtree, else "now".
 * Offsets are then mostly >= 0, and applying onto a chosen anchor preserves the
 * relative spacing of the whole plan from its first scheduled day.
 */
function pickAnchor(dates: Date[]): string {
  if (dates.length === 0) return new Date().toISOString();
  let min = dates[0];
  for (const d of dates) if (d.getTime() < min.getTime()) min = d;
  return min.toISOString();
}

// ── Subtree indexing ──
function indexByParent(rows: TaskRow[]): Map<string, TaskRow[]> {
  const m = new Map<string, TaskRow[]>();
  for (const r of rows) {
    if (r.ParentTaskId == null) continue;
    const k = String(r.ParentTaskId).toLowerCase();
    const list = m.get(k) ?? [];
    list.push(r);
    m.set(k, list);
  }
  return m;
}

/** Group descendant rows by their ListId (lowercased) for per-list slicing. */
function indexTasksByList(rows: TaskRow[]): Map<string, TaskRow[]> {
  const m = new Map<string, TaskRow[]>();
  for (const r of rows) {
    if (r.ListId == null) continue;
    const k = String(r.ListId).toLowerCase();
    const list = m.get(k) ?? [];
    list.push(r);
    m.set(k, list);
  }
  return m;
}

/** All rows in the subtree rooted at `root` (root included), via ParentTaskId. */
function collectTaskSubtree(root: TaskRow, all: TaskRow[]): TaskRow[] {
  const byParent = indexByParent(all);
  const out: TaskRow[] = [];
  const stack: TaskRow[] = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    out.push(cur);
    const kids = byParent.get(String(cur.Id).toLowerCase()) ?? [];
    for (const k of kids) stack.push(k);
  }
  return out;
}

function sameId(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

export const templateService = new TemplateService();
