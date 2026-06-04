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
  const owner = await createTestUser({ email: `cf-${Date.now()}-${seq}@projectflow.test` });
  const t = owner.accessToken;
  const ws = await createTestWorkspace(t);
  const space = await createTestProject(ws.Id, t, { name: 'CF Space', key: `CF${(Date.now() + seq) % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Default', position: 0 },
  }), 201)).data;
  const listId = list.id ?? list.Id;
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token: t, json: { workspaceId: ws.Id, listId, title: 'CF task' },
  }), 201)).data;
  return { owner, t, ws, space, list, task };
}

describe('custom field cascade', () => {
  it('a SPACE-level field appears on a task in a list beneath the space', async () => {
    const { t, space, task } = await setupTaskInList();
    await json(await request('/custom-fields', {
      method: 'POST', token: t, json: { scopeType: 'SPACE', scopeId: space.Id, type: 'text', name: 'Severity', required: false },
    }), 201);
    const eff = (await json<{ data: any[] }>(await request(`/tasks/${task.Id ?? task.id}/fields`, { token: t }), 200)).data;
    expect(eff.map((e) => e.field.name)).toContain('Severity');
  });

  it('a LIST-level field stays local to its list (not on a task in a different list)', async () => {
    const { t, ws, space, list } = await setupTaskInList();
    const l2 = (await json<{ data: any }>(await request('/lists', { method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'L2', position: 1 } }), 201)).data;
    const task2 = (await json<{ data: any }>(await request('/tasks', { method: 'POST', token: t, json: { workspaceId: ws.Id, listId: l2.id ?? l2.Id, title: 'in L2' } }), 201)).data;
    const firstListId = list.id ?? list.Id;
    await json(await request('/custom-fields', { method: 'POST', token: t, json: { scopeType: 'LIST', scopeId: firstListId, type: 'text', name: 'LocalOnly' } }), 201);
    const eff2 = (await json<{ data: any[] }>(await request(`/tasks/${task2.Id ?? task2.id}/fields`, { token: t }), 200)).data;
    expect(eff2.map((e) => e.field.name)).not.toContain('LocalOnly');
  });
});
