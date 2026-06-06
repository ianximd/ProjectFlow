import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { templateService } from '../template.service.js';
import { listService } from '../../hierarchy/list.service.js';
import { folderService } from '../../hierarchy/folder.service.js';
import { spacePath } from '../../hierarchy/path.js';
import { viewService } from '../../views/view.service.js';
import { customFieldService } from '../../customfields/customfield.service.js';
import { CustomFieldRepository } from '../../customfields/customfield.repository.js';
import { HierarchyRepository } from '../../hierarchy/hierarchy.repository.js';
import { ViewRepository } from '../../views/view.repository.js';
import { ProjectRepository } from '../../projects/project.repository.js';
import { TaskService } from '../../tasks/task.service.js';
import { TaskRepository } from '../../tasks/task.repository.js';
import { offsetToDate } from '../offsets.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool } from '../../../shared/lib/db.js';

const cfRepo = new CustomFieldRepository();
const hierarchy = new HierarchyRepository();
const viewRepo = new ViewRepository();
const projectRepo = new ProjectRepository();

// Read-back helpers (rows are PascalCase SELECT *).
async function listsOfSpace(spaceId: string): Promise<any[]> {
  return (await listService.list(spaceId, null, true)) as any[];
}
async function tasksOfList(listId: string): Promise<any[]> {
  return (await hierarchy.descendantTasks('LIST', listId)) as any[];
}
function dayMs(d: Date | string | null): number | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}

describe('TemplateService.apply (Phase 5d Batch 2)', () => {
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });

  it('LIST → applies into a target Space: list + 2 tasks + view + field def recreated, due date remapped, cf value carried', async () => {
    const taskService = new TaskService(new TaskRepository());
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const srcSpace = await createTestProject(ws.Id, u.accessToken);

    // ── Source LIST with a field, two tasks (one dated + a cf value), a view ──
    const srcList = await listService.create({
      workspaceId: ws.Id, spaceId: srcSpace.Id, folderId: null,
      name: 'Sprint Backlog', position: 1000, parentPath: spacePath(srcSpace.Id)!,
    }) as any;
    const field = await customFieldService.create({
      scopeType: 'LIST', scopeId: srcList.Id, type: 'number',
      name: 'Effort', config: null, required: false, position: 0,
    });
    const due = new Date('2026-07-10T00:00:00.000Z');
    const dated = await taskService.createTask({
      workspaceId: ws.Id, listId: srcList.Id, title: 'Dated Task', reporterId: u.user.Id,
      dueDate: due.toISOString(),
    } as any, u.user.Id) as any;
    await taskService.createTask({
      workspaceId: ws.Id, listId: srcList.Id, title: 'Plain Task', reporterId: u.user.Id,
    } as any, u.user.Id);
    await customFieldService.setValue(dated.Id ?? dated.id, field!.id, 5);
    await viewService.create(u.user.Id, {
      scopeType: 'LIST', scopeId: srcList.Id, type: 'board', name: 'Board',
      isShared: true, isDefault: false,
      config: { filter: { conjunction: 'AND', rules: [] }, sort: [] },
    });

    const tpl = await templateService.captureTemplate('LIST', srcList.Id, 'List Tpl', null, u.user.Id);

    // ── Target Space (distinct from the source) ──
    const dstSpace = await createTestProject(ws.Id, u.accessToken, { key: 'DST1' });

    const anchor = '2026-09-01T00:00:00.000Z';
    const result = await templateService.apply(tpl.id, { targetParentId: dstSpace.Id, anchorDate: anchor }, u.user.Id);

    expect(result.counts.lists).toBe(1);
    expect(result.counts.tasks).toBe(2);
    expect(result.counts.views).toBe(1);
    expect(result.counts.fields).toBe(1);

    const newList = (await listsOfSpace(dstSpace.Id)).find((l) => l.Name === 'Sprint Backlog');
    expect(newList).toBeTruthy();
    expect(String(newList.Id).toLowerCase()).toBe(String(result.rootId).toLowerCase());

    const tasks = await tasksOfList(newList.Id);
    expect(tasks.map((t) => t.Title).sort()).toEqual(['Dated Task', 'Plain Task']);

    // View recreated on the new list scope.
    const views = await viewRepo.listForScope('LIST', newList.Id);
    expect(views.some((v) => v.name === 'Board' && v.type === 'board')).toBe(true);

    // Field def recreated.
    const defs = await cfRepo.list('LIST', newList.Id);
    const newField = defs.find((d) => d.name === 'Effort' && d.type === 'number');
    expect(newField).toBeTruthy();
    expect(String(newField!.id).toLowerCase()).not.toBe(String(field!.id).toLowerCase()); // FRESH id

    // Dated task's due date = anchor + the captured offset (remapped).
    const newDated = tasks.find((t) => t.Title === 'Dated Task');
    const snap = JSON.parse((await templateService.getSnapshotJson(tpl.id))!);
    const datedNode = (snap.root.tasks as any[]).find((n) => n.title === 'Dated Task');
    const expectedDue = offsetToDate(datedNode.dueOffset, anchor)!;
    expect(dayMs(newDated.DueDate)).toBe(dayMs(expectedDue));

    // CF value carried onto the right task, mapped to the NEW field id.
    const eff = await customFieldService.effectiveForTask(newDated.Id);
    expect(eff.some((e) => e.field.name === 'Effort' && e.value === 5)).toBe(true);
    // The plain task has no Effort value.
    const newPlain = tasks.find((t) => t.Title === 'Plain Task');
    const effPlain = await customFieldService.effectiveForTask(newPlain.Id);
    expect(effPlain.some((e) => e.field.name === 'Effort' && e.value === 5)).toBe(false);
  });

  it('TASK → applies into a target list with subtasks: subtree recreated, dates remapped', async () => {
    const taskService = new TaskService(new TaskRepository());
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const space = await createTestProject(ws.Id, u.accessToken);
    const srcList = await listService.create({
      workspaceId: ws.Id, spaceId: space.Id, folderId: null,
      name: 'Src', position: 1000, parentPath: spacePath(space.Id)!,
    }) as any;

    const due = new Date('2026-07-05T00:00:00.000Z');
    const parent = await taskService.createTask({
      workspaceId: ws.Id, listId: srcList.Id, title: 'Parent', reporterId: u.user.Id,
      dueDate: due.toISOString(),
    } as any, u.user.Id) as any;
    await taskService.createTask({
      workspaceId: ws.Id, listId: srcList.Id, title: 'Child', reporterId: u.user.Id,
      parentTaskId: parent.Id ?? parent.id,
    } as any, u.user.Id);

    const tpl = await templateService.captureTemplate('TASK', parent.Id ?? parent.id, 'Task Tpl', null, u.user.Id);

    // Target list (fresh, empty).
    const dstList = await listService.create({
      workspaceId: ws.Id, spaceId: space.Id, folderId: null,
      name: 'Dst', position: 2000, parentPath: spacePath(space.Id)!,
    }) as any;

    const anchor = '2026-10-01T00:00:00.000Z';
    const result = await templateService.apply(tpl.id, { targetParentId: dstList.Id, anchorDate: anchor }, u.user.Id);
    expect(result.counts.tasks).toBe(2);

    const tasks = await tasksOfList(dstList.Id);
    expect(tasks.map((t) => t.Title).sort()).toEqual(['Child', 'Parent']);
    const newParent = tasks.find((t) => t.Title === 'Parent');
    const newChild = tasks.find((t) => t.Title === 'Child');
    expect(String(newChild.ParentTaskId).toLowerCase()).toBe(String(newParent.Id).toLowerCase());
    expect(String(newParent.Id).toLowerCase()).toBe(String(result.rootId).toLowerCase());

    // Parent's due remapped onto the new anchor.
    const snap = JSON.parse((await templateService.getSnapshotJson(tpl.id))!);
    const expectedDue = offsetToDate(snap.root.dueOffset, anchor)!;
    expect(dayMs(newParent.DueDate)).toBe(dayMs(expectedDue));
  });

  it('FOLDER → applies under a target Space: folder + nested list + tasks recreated', async () => {
    const taskService = new TaskService(new TaskRepository());
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const space = await createTestProject(ws.Id, u.accessToken);
    const srcFolder = await folderService.create({
      workspaceId: ws.Id, spaceId: space.Id, parentFolderId: null,
      name: 'Phase 1', position: 1000, parentPath: spacePath(space.Id)!,
    }) as any;
    const srcList = await listService.create({
      workspaceId: ws.Id, spaceId: space.Id, folderId: srcFolder.Id,
      name: 'Tasks', position: 1000, parentPath: srcFolder.Path,
    }) as any;
    await taskService.createTask({
      workspaceId: ws.Id, listId: srcList.Id, title: 'A', reporterId: u.user.Id,
    } as any, u.user.Id);

    const tpl = await templateService.captureTemplate('FOLDER', srcFolder.Id, 'Folder Tpl', null, u.user.Id);
    const dstSpace = await createTestProject(ws.Id, u.accessToken, { key: 'DSTF' });

    const result = await templateService.apply(tpl.id, { targetParentId: dstSpace.Id, anchorDate: '2026-09-01T00:00:00.000Z' }, u.user.Id);
    expect(result.counts.lists).toBe(1);
    expect(result.counts.tasks).toBe(1);

    const newFolder = (await folderService.list(dstSpace.Id) as any[]).find((f) => f.Name === 'Phase 1');
    expect(newFolder).toBeTruthy();
    expect(String(newFolder.Id).toLowerCase()).toBe(String(result.rootId).toLowerCase());
    const newList = (await listsOfSpace(dstSpace.Id)).find((l) => l.Name === 'Tasks');
    expect(newList).toBeTruthy();
    expect(String(newList.FolderId).toLowerCase()).toBe(String(newFolder.Id).toLowerCase());
    const tasks = await tasksOfList(newList.Id);
    expect(tasks.map((t) => t.Title)).toEqual(['A']);
  });

  it('SPACE → applies into the workspace: a new Space + children recreated', async () => {
    const taskService = new TaskService(new TaskRepository());
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const space = await createTestProject(ws.Id, u.accessToken);
    const srcList = await listService.create({
      workspaceId: ws.Id, spaceId: space.Id, folderId: null,
      name: 'Root List', position: 1000, parentPath: spacePath(space.Id)!,
    }) as any;
    await taskService.createTask({
      workspaceId: ws.Id, listId: srcList.Id, title: 'T1', reporterId: u.user.Id,
    } as any, u.user.Id);

    const tpl = await templateService.captureTemplate('SPACE', space.Id, 'Space Tpl', null, u.user.Id);

    // targetParentId = workspaceId for a SPACE apply.
    const result = await templateService.apply(tpl.id, { targetParentId: ws.Id, anchorDate: '2026-09-01T00:00:00.000Z' }, u.user.Id);
    expect(result.counts.lists).toBe(1);
    expect(result.counts.tasks).toBe(1);

    const newSpace = await projectRepo.getById(result.rootId) as any;
    expect(newSpace).toBeTruthy();
    expect(newSpace.Name).toBe(space.Name);
    expect(String(newSpace.Id).toLowerCase()).not.toBe(String(space.Id).toLowerCase()); // FRESH space
    const newList = (await listsOfSpace(result.rootId)).find((l) => l.Name === 'Root List');
    expect(newList).toBeTruthy();
    expect((await tasksOfList(newList.Id)).map((t) => t.Title)).toEqual(['T1']);
  });

  it('import-selected → applies a LIST selecting only 1 of 2 tasks: only that task recreated', async () => {
    const taskService = new TaskService(new TaskRepository());
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const space = await createTestProject(ws.Id, u.accessToken);
    const srcList = await listService.create({
      workspaceId: ws.Id, spaceId: space.Id, folderId: null,
      name: 'Selective', position: 1000, parentPath: spacePath(space.Id)!,
    }) as any;
    await taskService.createTask({ workspaceId: ws.Id, listId: srcList.Id, title: 'Keep', reporterId: u.user.Id } as any, u.user.Id);
    await taskService.createTask({ workspaceId: ws.Id, listId: srcList.Id, title: 'Drop', reporterId: u.user.Id } as any, u.user.Id);

    const tpl = await templateService.captureTemplate('LIST', srcList.Id, 'Sel Tpl', null, u.user.Id);
    const snap = JSON.parse((await templateService.getSnapshotJson(tpl.id))!);
    const rootNodeId: string = snap.root.nodeId;
    const keepNodeId: string = (snap.root.tasks as any[]).find((t) => t.title === 'Keep').nodeId;

    const dstSpace = await createTestProject(ws.Id, u.accessToken, { key: 'DSTS' });
    const result = await templateService.apply(
      tpl.id,
      { targetParentId: dstSpace.Id, anchorDate: '2026-09-01T00:00:00.000Z', selectedItemIds: [rootNodeId, keepNodeId] },
      u.user.Id,
    );
    expect(result.counts.lists).toBe(1);
    expect(result.counts.tasks).toBe(1);

    const newList = (await listsOfSpace(dstSpace.Id)).find((l) => l.Name === 'Selective');
    expect((await tasksOfList(newList.Id)).map((t) => t.Title)).toEqual(['Keep']);
  });

  it('cross-workspace target is rejected (the 5a/5b IDOR guard)', async () => {
    const u = await createTestUser();
    const wsA = await createTestWorkspace(u.accessToken);
    const wsB = await createTestWorkspace(u.accessToken);
    const spaceA = await createTestProject(wsA.Id, u.accessToken, { key: 'WSA1' });
    const srcList = await listService.create({
      workspaceId: wsA.Id, spaceId: spaceA.Id, folderId: null,
      name: 'A List', position: 1000, parentPath: spacePath(spaceA.Id)!,
    }) as any;
    const tpl = await templateService.captureTemplate('LIST', srcList.Id, 'A Tpl', null, u.user.Id);

    // Target a Space in a DIFFERENT workspace → must be refused.
    const spaceB = await createTestProject(wsB.Id, u.accessToken, { key: 'WSB1' });
    await expect(
      templateService.apply(tpl.id, { targetParentId: spaceB.Id, anchorDate: '2026-09-01T00:00:00.000Z' }, u.user.Id),
    ).rejects.toMatchObject({ code: 'TEMPLATE_WORKSPACE_MISMATCH' });
  });
});
