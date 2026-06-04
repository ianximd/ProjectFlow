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
  const owner = await createTestUser({ email: `w-${Date.now()}-${seq}@projectflow.test` });
  const t = owner.accessToken;
  const ws = await createTestWorkspace(t);
  const space = await createTestProject(ws.Id, t, { name: 'W Space', key: `WW${(Date.now() + seq) % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Default', position: 0 },
  }), 201)).data;
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token: t, json: { workspaceId: ws.Id, listId: list.id ?? list.Id, title: 'W task' },
  }), 201)).data;
  return { owner, t, ws, space, task };
}

describe('task watchers', () => {
  it('adds a watcher (idempotent), lists it, and removes it', async () => {
    const { owner, t, task } = await setupTaskInList();
    const taskId = task.Id ?? task.id;
    const uid = owner.user.Id;

    await json(await request(`/tasks/${taskId}/watchers/${uid}`, { method: 'POST', token: t }), 200);
    await json(await request(`/tasks/${taskId}/watchers/${uid}`, { method: 'POST', token: t }), 200); // idempotent
    let watchers = (await json<{ data: any[] }>(await request(`/tasks/${taskId}/watchers`, { token: t }), 200)).data;
    expect(watchers.filter((w) => (w.userId ?? w.UserId)?.toUpperCase() === String(uid).toUpperCase())).toHaveLength(1);

    await json(await request(`/tasks/${taskId}/watchers/${uid}`, { method: 'DELETE', token: t }), 200);
    watchers = (await json<{ data: any[] }>(await request(`/tasks/${taskId}/watchers`, { token: t }), 200)).data;
    expect(watchers).toHaveLength(0);
  });

  it("user B cannot add a watcher to user A's task", async () => {
    const { task } = await setupTaskInList();
    const taskId = task.Id ?? task.id;
    const b = await createTestUser({ email: `w-b-${Date.now()}@projectflow.test` });
    const res = await request(`/tasks/${taskId}/watchers/${b.user.Id}`, { method: 'POST', token: b.accessToken });
    expect([403, 404]).toContain(res.status);
  });
});
