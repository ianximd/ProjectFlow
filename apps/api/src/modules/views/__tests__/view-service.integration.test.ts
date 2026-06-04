import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { viewService } from '../view.service.js';
import { ViewValidationError } from '../view.errors.js';
import { createTestUser, createTestWorkspace, createTestProject, createTestTask } from '../../../__tests__/fixtures/factories.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool, getPool } from '../../../shared/lib/db.js';

async function setTaskListPath(taskId: string, lp: string) {
  const pool = await getPool();
  await pool.request().input('Id', taskId).input('LP', lp).query('UPDATE Tasks SET ListPath=@LP WHERE Id=@Id');
}

describe('ViewService', () => {
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });

  it('runs a saved view and returns filtered tasks', async () => {
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const p = await createTestProject(ws.Id, u.accessToken);
    const t = await createTestTask(p.Id, ws.Id, u.accessToken, { title: 'keep' });
    await setTaskListPath(t.Id, `/${p.Id}/`);

    const view = await viewService.create(u.user.Id, {
      scopeType: 'SPACE', scopeId: p.Id, type: 'table', name: 'V', isShared: true, isDefault: false,
      config: { filter: { conjunction: 'AND', rules: [{ field: { kind: 'builtin', key: 'title' }, op: '=', value: 'keep' }] }, sort: [] },
    });
    const page = await viewService.runView(u.user.Id, view.id, { page: 1, pageSize: 25 });
    expect(page.tasks.map((x) => (x as any).Title)).toEqual(['keep']);
  });

  it('rejects a config referencing an unknown field', async () => {
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const p = await createTestProject(ws.Id, u.accessToken);
    await expect(viewService.create(u.user.Id, {
      scopeType: 'SPACE', scopeId: p.Id, type: 'list', name: 'bad', isShared: false, isDefault: false,
      config: { filter: { conjunction: 'AND', rules: [{ field: { kind: 'builtin', key: 'nonexistent' }, op: '=', value: 1 }] }, sort: [] },
    })).rejects.toThrow(ViewValidationError);
  });
});
