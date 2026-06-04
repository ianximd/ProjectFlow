import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { viewService } from '../view.service.js';
import { createTestUser, createTestWorkspace, createTestProject, createTestTask } from '../../../__tests__/fixtures/factories.js';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool, getPool } from '../../../shared/lib/db.js';
import { isWorkspaceMember } from '../../workspaces/membership.js';
import { AccessRepository } from '../../access/access.repository.js';

// Build a Space (Project) -> folderless List -> task graph owned by `owner`,
// plus a SPACE-scoped custom field. Mirrors the Phase-2 custom-field value
// setup so the owner resolves object-level EDIT on the task's List (workspace
// owner => FULL floor in usp_ObjectAccess_Resolve).
async function setupTaskInListWithField(owner: { accessToken: string }) {
  const t = owner.accessToken;
  const ws = await createTestWorkspace(t);
  const space = await createTestProject(ws.Id, t, { name: 'Bulk Space', key: `BK${Date.now() % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Default', position: 0 },
  }), 201)).data;
  const listId = list.id ?? list.Id;
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token: t, json: { workspaceId: ws.Id, listId, title: 'Bulk task' },
  }), 201)).data;
  const taskId = task.Id ?? task.id;
  const field = (await json<{ data: any }>(await request('/custom-fields', {
    method: 'POST', token: t, json: { scopeType: 'SPACE', scopeId: space.Id, type: 'number', name: 'Estimate' },
  }), 201)).data;
  return { ws, space, list, listId, taskId, fieldId: field.id ?? field.Id };
}

describe('ViewService.bulkUpdate', () => {
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });

  it('sets priority on multiple tasks and reports success', async () => {
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const p = await createTestProject(ws.Id, u.accessToken);
    const t1 = await createTestTask(p.Id, ws.Id, u.accessToken);
    const t2 = await createTestTask(p.Id, ws.Id, u.accessToken);
    const result = await viewService.bulkUpdate(u.user.Id, {
      taskIds: [t1.Id, t2.Id],
      action: { kind: 'set_priority', priority: 'HIGH' },
    });
    expect(result.updated.sort()).toEqual([t1.Id, t2.Id].sort());
    expect(result.failed).toEqual([]);
    const pool = await getPool();
    const rows = await pool.request().input('Id', t1.Id).query('SELECT Priority FROM Tasks WHERE Id=@Id');
    expect(rows.recordset[0].Priority).toBe('HIGH');
  });

  it('reports per-task failure without aborting the batch', async () => {
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const p = await createTestProject(ws.Id, u.accessToken);
    const t1 = await createTestTask(p.Id, ws.Id, u.accessToken);
    const result = await viewService.bulkUpdate(u.user.Id, {
      taskIds: [t1.Id, '00000000-0000-0000-0000-000000000000'],
      action: { kind: 'set_priority', priority: 'LOW' },
    });
    expect(result.updated).toEqual([t1.Id]);
    expect(result.failed.length).toBe(1);
    expect(result.failed[0]!.id).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('set_status transitions tasks to a new status', async () => {
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const p = await createTestProject(ws.Id, u.accessToken);
    const t1 = await createTestTask(p.Id, ws.Id, u.accessToken);
    const result = await viewService.bulkUpdate(u.user.Id, {
      taskIds: [t1.Id],
      action: { kind: 'set_status', status: 'In Progress' },
    });
    expect(result.updated).toEqual([t1.Id]);
    expect(result.failed).toEqual([]);
  });

  it('delete removes tasks and reports success', async () => {
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const p = await createTestProject(ws.Id, u.accessToken);
    const t1 = await createTestTask(p.Id, ws.Id, u.accessToken);
    const result = await viewService.bulkUpdate(u.user.Id, {
      taskIds: [t1.Id],
      action: { kind: 'delete' },
    });
    expect(result.updated).toEqual([t1.Id]);
    expect(result.failed).toEqual([]);
  });

  // ── Security: per-task permission ───────────────────────────────────────────
  // A task owned by a different workspace must land in `failed`, not `updated`.
  // If this test fails (outsider task ends up in `updated`), the per-task
  // permission check is broken.
  it('per-task permission: outsider task lands in failed, own task succeeds', async () => {
    // user1 owns ws1/p1/t1
    const u1 = await createTestUser();
    const ws1 = await createTestWorkspace(u1.accessToken);
    const p1 = await createTestProject(ws1.Id, u1.accessToken);
    const t1 = await createTestTask(p1.Id, ws1.Id, u1.accessToken);

    // user2 owns ws2/p2/t2 — entirely separate workspace
    const u2 = await createTestUser();
    const ws2 = await createTestWorkspace(u2.accessToken);
    const p2 = await createTestProject(ws2.Id, u2.accessToken);
    const t2 = await createTestTask(p2.Id, ws2.Id, u2.accessToken);

    // user1 tries to bulk-edit [own task, user2's task]
    const result = await viewService.bulkUpdate(u1.user.Id, {
      taskIds: [t1.Id, t2.Id],
      action: { kind: 'set_priority', priority: 'LOWEST' },
    });

    expect(result.updated).toEqual([t1.Id]);
    expect(result.failed.length).toBe(1);
    expect(result.failed[0]!.id).toBe(t2.Id);
    expect(result.failed[0]!.reason).toMatch(/access|permission|not a member/i);
  });

  // ── Security: object-level ACL parity for set_custom_field ───────────────────
  // The bulk set_custom_field path must mirror PUT /tasks/:id/fields/:fieldId,
  // which gates on EDIT object-level access to the task's OWN List — NOT flat
  // workspace membership.

  // Positive: the workspace owner resolves FULL on their own List, so bulk
  // set_custom_field succeeds and the value persists.
  it('object-level: owner can bulk set_custom_field on their own task; value persists', async () => {
    const owner = await createTestUser();
    const { taskId, fieldId } = await setupTaskInListWithField(owner);

    const result = await viewService.bulkUpdate(owner.user.Id, {
      taskIds: [taskId],
      action: { kind: 'set_custom_field', fieldId, value: 42 },
    });

    expect(result.updated).toEqual([taskId]);
    expect(result.failed).toEqual([]);

    // Persisted value is visible via the same effective-fields read the REST
    // route uses.
    const eff = (await json<{ data: any[] }>(
      await request(`/tasks/${taskId}/fields`, { token: owner.accessToken }), 200,
    )).data;
    expect(eff.find((e) => e.field.id === fieldId)?.value).toBe(42);
  });

  // Negative (privilege gap closed): a second user who IS a workspace member but
  // has only an explicit USER VIEW grant on the List (below EDIT) must land in
  // `failed`. usp_ObjectAccess_Resolve gives any workspace member an EDIT floor,
  // so the ONLY way to make a member lack EDIT is an explicit sub-EDIT grant —
  // which is exactly the "private List, excluded member" scenario. We assert the
  // member is still a workspace member, proving the object-level check (not the
  // baseline isWorkspaceMember gate) is what rejects them.
  it('object-level: workspace member with VIEW-only List grant cannot bulk set_custom_field', async () => {
    const owner = await createTestUser();
    const { ws, listId, taskId, fieldId } = await setupTaskInListWithField(owner);

    // Add a second user to the SAME workspace as a plain member.
    const member = await createTestUser();
    const pool = await getPool();
    await pool.request()
      .input('WorkspaceId', ws.Id)
      .input('UserId', member.user.Id)
      .input('Role', 'MEMBER')
      .execute('usp_WorkspaceMember_Add');

    // Sanity: the member really is a workspace member (baseline gate passes).
    expect(await isWorkspaceMember(ws.Id, member.user.Id)).toBe(true);

    // Demote the member to VIEW-only on the List via an explicit USER grant.
    // This overrides the EDIT floor in usp_ObjectAccess_Resolve.
    await new AccessRepository().set(ws.Id, 'USER', member.user.Id, 'LIST', listId, 'VIEW');

    const result = await viewService.bulkUpdate(member.user.Id, {
      taskIds: [taskId],
      action: { kind: 'set_custom_field', fieldId, value: 7 },
    });

    expect(result.updated).toEqual([]);
    expect(result.failed.length).toBe(1);
    expect(result.failed[0]!.id).toBe(taskId);
    expect(result.failed[0]!.reason).toMatch(/EDIT access/i);

    // And the value must NOT have been written.
    const eff = (await json<{ data: any[] }>(
      await request(`/tasks/${taskId}/fields`, { token: owner.accessToken }), 200,
    )).data;
    expect(eff.find((e) => e.field.id === fieldId)?.value ?? null).toBeNull();
  });
});
