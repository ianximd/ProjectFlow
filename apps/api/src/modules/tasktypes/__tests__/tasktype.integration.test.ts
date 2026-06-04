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
  const owner = await createTestUser({ email: `tt-${Date.now()}-${seq}@projectflow.test` });
  const t = owner.accessToken;
  const ws = await createTestWorkspace(t);
  const space = await createTestProject(ws.Id, t, { name: 'TT Space', key: `TT${(Date.now() + seq) % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Default', position: 0 },
  }), 201)).data;
  const listId = list.id ?? list.Id;
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token: t, json: { workspaceId: ws.Id, listId, title: 'TT task' },
  }), 201)).data;
  return { owner, t, ws, space, list, task };
}

describe('task types', () => {
  it('a freshly created workspace has a default Task type and a Milestone type', async () => {
    const { t, ws } = await setupTaskInList();
    const types = (await json<{ data: any[] }>(await request(`/task-types?workspaceId=${ws.Id}`, { token: t }), 200)).data;
    const def = types.find((x) => x.isDefault);
    const milestone = types.find((x) => x.isMilestone);
    expect(def?.nameSingular).toBe('Task');
    expect(milestone?.nameSingular).toBe('Milestone');
  });

  it('PATCH /tasks/:id/type sets TaskTypeId and syncs legacy Type (Bug -> BUG, Initiative -> TASK)', async () => {
    const { t, ws, task } = await setupTaskInList();
    const taskId = task.Id ?? task.id;

    const bug = (await json<{ data: any }>(await request('/task-types', {
      method: 'POST', token: t, json: { workspaceId: ws.Id, nameSingular: 'Bug', namePlural: 'Bugs' },
    }), 201)).data;
    const r1 = await request(`/tasks/${taskId}/type`, { method: 'PATCH', token: t, json: { taskTypeId: bug.id } });
    expect(r1.status).toBe(200);
    const body1 = await r1.json();
    expect(String(body1.data.Type ?? body1.data.type)).toBe('BUG');

    const initiative = (await json<{ data: any }>(await request('/task-types', {
      method: 'POST', token: t, json: { workspaceId: ws.Id, nameSingular: 'Initiative', namePlural: 'Initiatives' },
    }), 201)).data;
    const r2 = await request(`/tasks/${taskId}/type`, { method: 'PATCH', token: t, json: { taskTypeId: initiative.id } });
    expect(r2.status).toBe(200);
    const body2 = await r2.json();
    expect(String(body2.data.Type ?? body2.data.type)).toBe('TASK');
  });

  it('rejects deleting the default task type', async () => {
    const { t, ws } = await setupTaskInList();
    const types = (await json<{ data: any[] }>(await request(`/task-types?workspaceId=${ws.Id}`, { token: t }), 200)).data;
    const def = types.find((x) => x.isDefault);
    const res = await request(`/task-types/${def.id}`, { method: 'DELETE', token: t });
    expect([409, 400]).toContain(res.status);
  });
});
