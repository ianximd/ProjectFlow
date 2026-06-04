/**
 * Regression coverage for the Phase 2 review fixes (2026-06-04):
 *   - task-type duplicate name → 409 (not 500)
 *   - task-type name reuse after soft-delete (migration 0031 filtered index)
 *   - watcher cross-tenant user injection → 422 (SP membership guard)
 *   - tag cross-space link → 422 (SP same-space guard)
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from './setup/testServer.js';
import { truncateAll } from './fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from './fixtures/factories.js';
import { closePool } from '../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

let seq = 0;
async function space(token: string, wsId: string, name: string) {
  seq += 1;
  return createTestProject(wsId, token, { name, key: `PF${(Date.now() + seq) % 100000}` });
}
async function listIn(token: string, wsId: string, spaceId: string) {
  const l = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: wsId, spaceId, folderId: null, name: 'Default', position: 0 },
  }), 201)).data;
  return l.id ?? l.Id;
}
async function taskIn(token: string, wsId: string, listId: string, title = 'task') {
  const tk = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token, json: { workspaceId: wsId, listId, title },
  }), 201)).data;
  return tk.id ?? tk.Id;
}

describe('Phase 2 fixes — task types', () => {
  it('returns 409 on duplicate name, not 500', async () => {
    const a = await createTestUser({ email: `pf-tt-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(a.accessToken);
    const body = { workspaceId: ws.Id, nameSingular: 'Epic', namePlural: 'Epics' };
    await json(await request('/task-types', { method: 'POST', token: a.accessToken, json: body }), 201);
    const dup = await request('/task-types', { method: 'POST', token: a.accessToken, json: body });
    expect(dup.status).toBe(409);
    expect((await dup.json() as any).error.code).toBe('TASK_TYPE_NAME_TAKEN');
  });

  it('allows reusing a name after the type is soft-deleted (migration 0031)', async () => {
    const a = await createTestUser({ email: `pf-tt2-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(a.accessToken);
    const body = { workspaceId: ws.Id, nameSingular: 'Spike', namePlural: 'Spikes' };
    const created = (await json<{ data: any }>(await request('/task-types', { method: 'POST', token: a.accessToken, json: body }), 201)).data;
    await json(await request(`/task-types/${created.id ?? created.Id}`, { method: 'DELETE', token: a.accessToken }), 200);
    // Re-creating with the same name must now succeed — the soft-deleted row no
    // longer occupies the unique key.
    await json(await request('/task-types', { method: 'POST', token: a.accessToken, json: body }), 201);
  });
});

describe('Phase 2 fixes — tenant guards', () => {
  it('rejects adding a non-member as a watcher with 422', async () => {
    const a = await createTestUser({ email: `pf-w-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(a.accessToken);
    const sp = await space(a.accessToken, ws.Id, 'WS');
    const listId = await listIn(a.accessToken, ws.Id, sp.Id);
    const taskId = await taskIn(a.accessToken, ws.Id, listId);
    const outsider = await createTestUser({ email: `pf-w-out-${Date.now()}@projectflow.test` });
    // A (owner, has task.update) tries to add a user who is not a member of A's workspace.
    const res = await request(`/tasks/${taskId}/watchers/${outsider.user.Id}`, { method: 'POST', token: a.accessToken });
    expect(res.status).toBe(422);
    expect((await res.json() as any).error.code).toBe('WATCHER_NOT_MEMBER');
  });

  it('rejects linking a tag from another space with 422', async () => {
    const a = await createTestUser({ email: `pf-tag-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(a.accessToken);
    const space1 = await space(a.accessToken, ws.Id, 'S1');
    const space2 = await space(a.accessToken, ws.Id, 'S2');
    const tag = (await json<{ data: any }>(await request('/tags', {
      method: 'POST', token: a.accessToken, json: { spaceId: space1.Id, name: 'cross', color: '#112233' },
    }), 201)).data;
    const listId = await listIn(a.accessToken, ws.Id, space2.Id);
    const taskId = await taskIn(a.accessToken, ws.Id, listId);
    const res = await request(`/tasks/${taskId}/tags/${tag.id ?? tag.Id}`, { method: 'POST', token: a.accessToken });
    expect(res.status).toBe(422);
    expect((await res.json() as any).error.code).toBe('TAG_WRONG_SPACE');
  });
});
