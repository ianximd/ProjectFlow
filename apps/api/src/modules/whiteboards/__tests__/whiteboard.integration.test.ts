/**
 * Phase 7b — Whiteboard REST integration coverage.
 * CRUD + convert-to-task + doc round-trip + authz 404.
 * DB SAFETY: must target local Docker ProjectFlow_Test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { whiteboardRepository } from '../whiteboard.repository.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function seedWhiteboard() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const owner = await createTestUser({ email: `wb-${stamp}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, {
    name: 'WB Space',
    key: `WB${stamp.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()}`,
  });

  // Create a List inside the space for convert-to-task tests.
  const listRes = await request('/lists', {
    method: 'POST',
    token,
    json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'WB List', position: 0 },
  });
  const list = (await json<{ data: any }>(listRes, 201)).data;

  // Create a whiteboard scoped to the space.
  const wb = (await json<{ data: any }>(await request('/whiteboards', {
    method: 'POST',
    token,
    json: { workspaceId: ws.Id, scopeType: 'SPACE', scopeId: space.Id, name: 'My Board' },
  }), 201)).data;

  return { token, userId: owner.user.Id, ws, space, list, wb };
}

describe('whiteboards', () => {
  // ── 1. CRUD ──────────────────────────────────────────────────────────────────

  it('creates a whiteboard, lists it, renames it, then soft-deletes it', async () => {
    const { token, ws, space, wb } = await seedWhiteboard();

    // List — should contain the created whiteboard.
    const listed = (await json<{ data: any[] }>(
      await request(`/whiteboards?workspaceId=${ws.Id}&scopeType=SPACE&scopeId=${space.Id}`, { token }),
    )).data;
    expect(listed.map((w: any) => w.id)).toContain(wb.id);

    // Rename.
    const renamed = (await json<{ data: any }>(
      await request(`/whiteboards/${wb.id}`, {
        method: 'PATCH', token, json: { name: 'Renamed Board' },
      }),
    )).data;
    expect(renamed.name).toBe('Renamed Board');

    // Soft-delete.
    const deleted = (await json<{ data: any }>(
      await request(`/whiteboards/${wb.id}`, { method: 'DELETE', token }),
    )).data;
    expect(deleted.id).toBe(wb.id);

    // List — should no longer appear.
    const afterDelete = (await json<{ data: any[] }>(
      await request(`/whiteboards?workspaceId=${ws.Id}&scopeType=SPACE&scopeId=${space.Id}`, { token }),
    )).data;
    expect(afterDelete.map((w: any) => w.id)).not.toContain(wb.id);
  });

  // ── 2. Convert-to-task ───────────────────────────────────────────────────────

  it('converts a sticky shape into a task and creates a task link', async () => {
    const { token, wb, list } = await seedWhiteboard();
    const listId = list.id ?? list.Id;

    const result = (await json<{ data: any }>(
      await request(`/whiteboards/${wb.id}/convert-to-task`, {
        method: 'POST',
        token,
        json: {
          targetListId: listId,
          shapeId: 'shape:abc',
          shape: { id: 'shape:abc', type: 'note', props: { text: 'Design the onboarding flow' } },
        },
      }),
    201)).data;

    // Title extracted from shape.props.text.
    expect(result.task.title ?? result.task.Title).toBe('Design the onboarding flow');

    // Task link fields.
    expect(result.link.taskId ?? result.link.TaskId).toBe(result.task.id ?? result.task.Id);
    expect(result.link.shapeId ?? result.link.ShapeId).toBe('shape:abc');

    // Task is fetchable and placed in the correct list.
    const taskId = result.task.id ?? result.task.Id;
    const fetched = (await json<{ data: any }>(await request(`/tasks/${taskId}`, { token }))).data;
    const fetchedListId = fetched.listId ?? fetched.ListId;
    expect(fetchedListId).toBe(listId);

    // Repository-level link list contains the new link.
    const links = await whiteboardRepository.listTaskLinks(wb.id);
    expect(links.map((l) => l.taskId)).toContain(taskId);
  });

  // ── 3. Doc round-trip (saveDoc / getDoc) ────────────────────────────────────

  it('saves and retrieves a Yjs doc snapshot via the repository', async () => {
    const { wb } = await seedWhiteboard();
    const yjsBytes = Buffer.from([1, 2, 3, 4]);
    const docJson  = JSON.stringify({ document: {} });

    await whiteboardRepository.saveDoc(wb.id, yjsBytes, docJson);

    const got = await whiteboardRepository.getDoc(wb.id);
    expect(got).not.toBeNull();
    expect(Buffer.isBuffer(got!.docYjs)).toBe(true);
    expect(got!.docYjs!.equals(yjsBytes)).toBe(true);
    expect(got!.docJson).toContain('document');
  });

  // ── 4. Authz 404 (fail-closed, no existence leak) ───────────────────────────

  it('returns 404 for an outsider requesting a whiteboard they cannot access', async () => {
    const { wb } = await seedWhiteboard();

    // A completely unrelated user — different workspace, no access to the space.
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const outsider = await createTestUser({ email: `outsider-${stamp}@projectflow.test` });

    const res = await request(`/whiteboards/${wb.id}`, { token: outsider.accessToken });
    // Must fail-closed — 404 (no existence leak) or 403.
    expect([403, 404]).toContain(res.status);
  });

  // ── 5. I1 guard — workspaceId/scope mismatch rejected on create ──────────────

  it('rejects POST /whiteboards when workspaceId does not match the scope\'s real workspace', async () => {
    // Seed two independent workspaces under the same owner.
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const owner = await createTestUser({ email: `i1-${stamp}@projectflow.test` });
    const token = owner.accessToken;

    const wsA = await createTestWorkspace(token, 'I1-WS-A');
    const wsB = await createTestWorkspace(token, 'I1-WS-B');

    const spaceA = await createTestProject(wsA.Id, token, {
      name: 'I1 Space A',
      key: `I1A${stamp.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase()}`,
    });

    // Attempt: scopeId lives in wsA but we supply wsB as workspaceId.
    const res = await request('/whiteboards', {
      method: 'POST',
      token,
      json: { workspaceId: wsB.Id, scopeType: 'SPACE', scopeId: spaceA.Id, name: 'Cross-tenant board' },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error?.code ?? body.error?.message).toBeTruthy();
  });

  // ── 6. C1 integrity — convert-to-task uses target list's workspace ────────────

  it('creates the task in the TARGET LIST\'s workspace, not the board\'s workspace', async () => {
    // Seed two workspaces under the same owner so authz passes in both.
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const owner = await createTestUser({ email: `c1-${stamp}@projectflow.test` });
    const token = owner.accessToken;

    // Workspace A — board lives here.
    const wsA = await createTestWorkspace(token, 'C1-WS-A');
    const spaceA = await createTestProject(wsA.Id, token, {
      name: 'C1 Space A',
      key: `C1A${stamp.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase()}`,
    });
    const wbRes = await request('/whiteboards', {
      method: 'POST',
      token,
      json: { workspaceId: wsA.Id, scopeType: 'SPACE', scopeId: spaceA.Id, name: 'C1 Board' },
    });
    const wb = (await json<{ data: any }>(wbRes, 201)).data;

    // Workspace B — target list lives here.
    const wsB = await createTestWorkspace(token, 'C1-WS-B');
    const spaceB = await createTestProject(wsB.Id, token, {
      name: 'C1 Space B',
      key: `C1B${stamp.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase()}`,
    });
    const listBRes = await request('/lists', {
      method: 'POST',
      token,
      json: { workspaceId: wsB.Id, spaceId: spaceB.Id, folderId: null, name: 'C1 List B', position: 0 },
    });
    const listB = (await json<{ data: any }>(listBRes, 201)).data;
    const listBId = listB.id ?? listB.Id;

    // Convert a shape on the wsA board targeting listB (in wsB).
    const result = (await json<{ data: any }>(
      await request(`/whiteboards/${wb.id}/convert-to-task`, {
        method: 'POST',
        token,
        json: {
          targetListId: listBId,
          shapeId: 'shape:c1',
          shape: { id: 'shape:c1', type: 'note', props: { text: 'C1 cross-workspace task' } },
        },
      }),
    201)).data;

    // Fetch the created task and assert it belongs to wsB, NOT wsA.
    const taskId = result.task.id ?? result.task.Id;
    const fetched = (await json<{ data: any }>(await request(`/tasks/${taskId}`, { token }))).data;
    const taskWorkspaceId = fetched.workspaceId ?? fetched.WorkspaceId;
    expect(taskWorkspaceId).toBe(wsB.Id);
    expect(taskWorkspaceId).not.toBe(wsA.Id);
  });
});
