import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { templateService } from '../template.service.js';
import { listService } from '../../hierarchy/list.service.js';
import { spacePath } from '../../hierarchy/path.js';
import { viewService } from '../../views/view.service.js';
import { customFieldService } from '../../customfields/customfield.service.js';
import { TaskService } from '../../tasks/task.service.js';
import { TaskRepository } from '../../tasks/task.repository.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool } from '../../../shared/lib/db.js';
import type { TemplateSnapshot, TemplateListNode } from '@projectflow/types';

describe('TemplateService.captureTemplate (LIST)', () => {
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });

  it('captures a LIST snapshot with task nodes, a shared view, field defs, and a non-null dueOffset', async () => {
    const taskService = new TaskService(new TaskRepository());
    // ── Seed: user / workspace / space ──
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const space = await createTestProject(ws.Id, u.accessToken);

    // ── A real List under the space ──
    const list = await listService.create({
      workspaceId: ws.Id,
      spaceId: space.Id,
      folderId: null,
      name: 'Sprint Backlog',
      position: 1000,
      parentPath: spacePath(space.Id)!,
    }) as any;
    const listId: string = list.Id;

    // ── A custom-field DEFINITION on the list scope ──
    const field = await customFieldService.create({
      scopeType: 'LIST', scopeId: listId, type: 'number',
      name: 'Effort', config: null, required: false, position: 0,
    });
    expect(field).not.toBeNull();

    // ── Two tasks in the list; one carries a due date ──
    const due = new Date('2026-07-01T00:00:00.000Z');
    // usp_Task_Create returns SELECT * (PascalCase); read Id off the raw row.
    const datedTask = await taskService.createTask({
      workspaceId: ws.Id, listId, title: 'Dated Task', reporterId: u.user.Id,
      dueDate: due.toISOString(),
    } as any, u.user.Id) as any;
    const plainTask = await taskService.createTask({
      workspaceId: ws.Id, listId, title: 'Plain Task', reporterId: u.user.Id,
    } as any, u.user.Id) as any;
    const datedTaskId: string = datedTask.Id ?? datedTask.id;
    const plainTaskId: string = plainTask.Id ?? plainTask.id;
    expect(datedTaskId).toBeTruthy();
    expect(plainTaskId).toBeTruthy();

    // Give the dated task a custom-field value so the snapshot carries one.
    await customFieldService.setValue(datedTaskId, field!.id, 5);

    // ── A SHARED saved view on the list ──
    await viewService.create(u.user.Id, {
      scopeType: 'LIST', scopeId: listId, type: 'board', name: 'Board',
      isShared: true, isDefault: false,
      config: { filter: { conjunction: 'AND', rules: [] }, sort: [] },
    });

    // ── Capture ──
    const tpl = await templateService.captureTemplate('LIST', listId, 'List Template', 'desc', u.user.Id);
    expect(tpl.scopeType).toBe('LIST');
    expect(tpl.workspaceId.toLowerCase()).toBe(String(ws.Id).toLowerCase());

    // ── Read back the stored snapshot ──
    const snapJson = await templateService.getSnapshotJson(tpl.id);
    expect(snapJson).toBeTruthy();
    const snap = JSON.parse(snapJson!) as TemplateSnapshot;
    expect(snap.scopeType).toBe('LIST');
    expect(typeof snap.anchor).toBe('string');

    const root = snap.root as TemplateListNode;
    expect(root.name).toBe('Sprint Backlog');

    // 2 top-level task nodes.
    expect(root.tasks).toHaveLength(2);
    const titles = root.tasks.map((t) => t.title).sort();
    expect(titles).toEqual(['Dated Task', 'Plain Task']);

    // The shared view was captured.
    expect(root.views).toHaveLength(1);
    expect(root.views[0].name).toBe('Board');
    expect(root.views[0].type).toBe('board');

    // The field DEFINITION was captured.
    expect(root.fieldDefs.some((f) => f.name === 'Effort' && f.type === 'number')).toBe(true);

    // The dated task has a non-null dueOffset; the plain task does not.
    const dated = root.tasks.find((t) => t.title === 'Dated Task')!;
    const plain = root.tasks.find((t) => t.title === 'Plain Task')!;
    expect(dated.dueOffset).not.toBeNull();
    expect(typeof dated.dueOffset).toBe('number');
    expect(plain.dueOffset).toBeNull();

    // The dated task carried its portable custom-field value.
    expect(dated.customFieldValues.some((v) => v.value === 5)).toBe(true);

    // Stable nodeIds are assigned.
    expect(root.nodeId).toBe('root');
    expect(root.tasks.every((t) => typeof t.nodeId === 'string' && t.nodeId.length > 0)).toBe(true);
  });

  it('delete is idempotent-404: first delete returns the row (Snapshot omitted), a second delete returns null', async () => {
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const space = await createTestProject(ws.Id, u.accessToken);
    const list = await listService.create({
      workspaceId: ws.Id, spaceId: space.Id, folderId: null,
      name: 'Disposable', position: 1000, parentPath: spacePath(space.Id)!,
    }) as any;

    const tpl = await templateService.captureTemplate('LIST', list.Id, 'To Delete', null, u.user.Id);

    // First delete: succeeds, returns the mapped (metadata-only) row.
    const first = await templateService.delete(tpl.id);
    expect(first).not.toBeNull();
    expect(String(first!.id).toLowerCase()).toBe(String(tpl.id).toLowerCase());
    // The SP must NOT return the large Snapshot column.
    expect((first as any).snapshot).toBeUndefined();
    expect((first as any).Snapshot).toBeUndefined();

    // Second delete of the SAME template: no row deleted → null (the route/GraphQL
    // map this to a 404 / `false`, not a silent 200/true).
    const second = await templateService.delete(tpl.id);
    expect(second).toBeNull();
  });
});
