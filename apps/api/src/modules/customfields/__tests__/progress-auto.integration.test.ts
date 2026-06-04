import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

let seq = 0;
async function setupTaskInList() {
  seq += 1;
  const owner = await createTestUser({ email: `cfp-${Date.now()}-${seq}@projectflow.test` });
  const t = owner.accessToken;
  const ws = await createTestWorkspace(t);
  const space = await createTestProject(ws.Id, t, { name: 'CFP Space', key: `CP${(Date.now() + seq) % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Default', position: 0 },
  }), 201)).data;
  const listId = list.id ?? list.Id;
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token: t, json: { workspaceId: ws.Id, listId, title: 'CFP parent' },
  }), 201)).data;
  return { t, ws, space, list, task, listId };
}

describe('progress_auto', () => {
  it('updates the parent percentage when a subtask is resolved', async () => {
    const { t, ws, space, listId, task } = await setupTaskInList();
    const parentId = task.Id ?? task.id;
    const f = (await json<{ data: any }>(await request('/custom-fields', { method: 'POST', token: t, json: { scopeType: 'SPACE', scopeId: space.Id, type: 'progress_auto', name: 'Progress', config: { source: 'subtasks' } } }), 201)).data;
    const s1 = (await json<{ data: any }>(await request('/tasks', { method: 'POST', token: t, json: { workspaceId: ws.Id, listId, title: 's1', parentTaskId: parentId } }), 201)).data;
    await json(await request('/tasks', { method: 'POST', token: t, json: { workspaceId: ws.Id, listId, title: 's2', parentTaskId: parentId } }), 201);
    const s1Id = s1.Id ?? s1.id;
    await request(`/tasks/${s1Id}/transition`, { method: 'PATCH', token: t, json: { status: 'Done' } });
    let eff = (await json<{ data: any[] }>(await request(`/tasks/${parentId}/fields`, { token: t }), 200)).data;
    expect(eff.find((e) => e.field.id === f.id)?.value).toBe(50);

    // Reopening the done subtask must DECREMENT progress back to 0 — the
    // transition proc now clears ResolvedAt on a non-DONE transition.
    await json(await request(`/tasks/${s1Id}/transition`, { method: 'PATCH', token: t, json: { status: 'To Do' } }), 200);
    eff = (await json<{ data: any[] }>(await request(`/tasks/${parentId}/fields`, { token: t }), 200)).data;
    expect(eff.find((e) => e.field.id === f.id)?.value).toBe(0);
  });
});
