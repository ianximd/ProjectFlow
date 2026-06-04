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
  const owner = await createTestUser({ email: `tag-${Date.now()}-${seq}@projectflow.test` });
  const t = owner.accessToken;
  const ws = await createTestWorkspace(t);
  const space = await createTestProject(ws.Id, t, { name: 'Tag Space', key: `TG${(Date.now() + seq) % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Default', position: 0 },
  }), 201)).data;
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token: t, json: { workspaceId: ws.Id, listId: list.id ?? list.Id, title: 'Tag task' },
  }), 201)).data;
  return { owner, t, ws, space, list, task };
}

describe('tags', () => {
  it('creates a tag, links/unlinks it to a task, and lists task tags', async () => {
    const { t, space, task } = await setupTaskInList();
    const taskId = task.Id ?? task.id;
    const tag = (await json<{ data: any }>(await request('/tags', {
      method: 'POST', token: t, json: { spaceId: space.Id, name: 'urgent', color: '#ff0000' },
    }), 201)).data;

    await json(await request(`/tasks/${taskId}/tags/${tag.id}`, { method: 'POST', token: t }), 200);
    let linked = (await json<{ data: any[] }>(await request(`/tasks/${taskId}/tags`, { token: t }), 200)).data;
    expect(linked.map((x) => x.id)).toContain(tag.id);

    await json(await request(`/tasks/${taskId}/tags/${tag.id}`, { method: 'DELETE', token: t }), 200);
    linked = (await json<{ data: any[] }>(await request(`/tasks/${taskId}/tags`, { token: t }), 200)).data;
    expect(linked.map((x) => x.id)).not.toContain(tag.id);
  });

  it('deleting a linked tag clears the link without an FK error', async () => {
    const { t, space, task } = await setupTaskInList();
    const taskId = task.Id ?? task.id;
    const tag = (await json<{ data: any }>(await request('/tags', {
      method: 'POST', token: t, json: { spaceId: space.Id, name: 'temp' },
    }), 201)).data;
    await json(await request(`/tasks/${taskId}/tags/${tag.id}`, { method: 'POST', token: t }), 200);
    const del = await request(`/tags/${tag.id}`, { method: 'DELETE', token: t });
    expect(del.status).toBe(200);
    const linked = (await json<{ data: any[] }>(await request(`/tasks/${taskId}/tags`, { token: t }), 200)).data;
    expect(linked).toHaveLength(0);
  });

  it('rejects a duplicate tag name in the same space with 409', async () => {
    const { t, space } = await setupTaskInList();
    await json(await request('/tags', { method: 'POST', token: t, json: { spaceId: space.Id, name: 'dup' } }), 201);
    const second = await request('/tags', { method: 'POST', token: t, json: { spaceId: space.Id, name: 'dup' } });
    expect(second.status).toBe(409);
  });
});
