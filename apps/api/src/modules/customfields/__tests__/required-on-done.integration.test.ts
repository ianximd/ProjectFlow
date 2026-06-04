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
  const owner = await createTestUser({ email: `cfr-${Date.now()}-${seq}@projectflow.test` });
  const t = owner.accessToken;
  const ws = await createTestWorkspace(t);
  const space = await createTestProject(ws.Id, t, { name: 'CFR Space', key: `CR${(Date.now() + seq) % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Default', position: 0 },
  }), 201)).data;
  const listId = list.id ?? list.Id;
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token: t, json: { workspaceId: ws.Id, listId, title: 'CFR task' },
  }), 201)).data;
  return { t, ws, space, list, task };
}

describe('required field blocks status -> done', () => {
  it('returns 422 CUSTOM_FIELD_REQUIRED when transitioning to Done with an empty required field, succeeds once filled', async () => {
    const { t, space, task } = await setupTaskInList();
    const taskId = task.Id ?? task.id;
    const f = (await json<{ data: any }>(await request('/custom-fields', { method: 'POST', token: t, json: { scopeType: 'SPACE', scopeId: space.Id, type: 'text', name: 'Root Cause', required: true } }), 201)).data;
    const blocked = await request(`/tasks/${taskId}/transition`, { method: 'PATCH', token: t, json: { status: 'Done' } });
    expect(blocked.status).toBe(422);
    const body = await blocked.json();
    expect(body.error.code).toBe('CUSTOM_FIELD_REQUIRED');
    await json(await request(`/tasks/${taskId}/fields/${f.id}`, { method: 'PUT', token: t, json: { value: 'fixed' } }), 200);
    const okRes = await request(`/tasks/${taskId}/transition`, { method: 'PATCH', token: t, json: { status: 'Done' } });
    expect([200, 201]).toContain(okRes.status);
  });
});
