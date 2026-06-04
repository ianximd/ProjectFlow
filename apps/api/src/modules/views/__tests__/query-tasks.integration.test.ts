import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { ViewRepository } from '../view.repository.js';
import { buildCatalog } from '../query/field-catalog.js';
import { compile } from '../query/compiler.js';
import { createTestUser, createTestWorkspace, createTestProject, createTestTask } from '../../../__tests__/fixtures/factories.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool, getPool } from '../../../shared/lib/db.js';
import { CustomFieldRepository } from '../../customfields/customfield.repository.js';
import { randomUUID } from 'node:crypto';

const repo = new ViewRepository();

async function setTaskListPath(taskId: string, listPath: string) {
  const pool = await getPool();
  await pool.request().input('Id', taskId).input('LP', listPath).query('UPDATE Tasks SET ListPath = @LP WHERE Id = @Id');
}

describe('ViewRepository.queryTasks', () => {
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });

  it('filters tasks by a built-in title within a space scope', async () => {
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const p = await createTestProject(ws.Id, u.accessToken);
    const t1 = await createTestTask(p.Id, ws.Id, u.accessToken, { title: 'A' });
    const t2 = await createTestTask(p.Id, ws.Id, u.accessToken, { title: 'B' });
    await setTaskListPath(t1.Id, `/${p.Id}/`);
    await setTaskListPath(t2.Id, `/${p.Id}/`);

    const cat = buildCatalog([]);
    const compiled = compile({
      workspaceId: ws.Id, scope: { scopeType: 'SPACE', scopePath: `/${p.Id}/` }, catalog: cat,
      filter: { conjunction: 'AND', rules: [{ field: { kind: 'builtin', key: 'title' }, op: '=', value: 'A' }] }, sort: [],
    });
    const page = await repo.queryTasks(compiled, { page: 1, pageSize: 25 });
    expect(page.total).toBe(1);
    expect((page.tasks[0]! as any).Title).toBe('A');
  });

  it('never returns tasks from another workspace (multitenancy isolation)', async () => {
    const u1 = await createTestUser(); const ws1 = await createTestWorkspace(u1.accessToken); const p1 = await createTestProject(ws1.Id, u1.accessToken);
    const u2 = await createTestUser(); const ws2 = await createTestWorkspace(u2.accessToken); const p2 = await createTestProject(ws2.Id, u2.accessToken);
    const tA = await createTestTask(p1.Id, ws1.Id, u1.accessToken, { title: 'ws1-task' });
    const tB = await createTestTask(p2.Id, ws2.Id, u2.accessToken, { title: 'ws2-task' });
    await setTaskListPath(tA.Id, `/${p1.Id}/`);
    await setTaskListPath(tB.Id, `/${p2.Id}/`);

    const cat = buildCatalog([]);
    const compiled = compile({ workspaceId: ws1.Id, scope: { scopeType: 'EVERYTHING', scopePath: null }, catalog: cat, filter: { conjunction: 'AND', rules: [] }, sort: [] });
    const page = await repo.queryTasks(compiled, { page: 1, pageSize: 100 });
    const titles = page.tasks.map((t: any) => t.Title);
    expect(titles).toContain('ws1-task');
    expect(titles).not.toContain('ws2-task');
  });

  it('filters by a custom number field', async () => {
    const u = await createTestUser(); const ws = await createTestWorkspace(u.accessToken); const p = await createTestProject(ws.Id, u.accessToken);
    const t1 = await createTestTask(p.Id, ws.Id, u.accessToken, { title: 'low' });
    const t2 = await createTestTask(p.Id, ws.Id, u.accessToken, { title: 'high' });
    await setTaskListPath(t1.Id, `/${p.Id}/`); await setTaskListPath(t2.Id, `/${p.Id}/`);

    const cf = new CustomFieldRepository();
    const field = await cf.create({ id: randomUUID(), workspaceId: ws.Id, scopeType: 'SPACE', scopeId: p.Id, scopePath: `/${p.Id}/`, type: 'number', name: 'Est', config: null, required: false, position: 0 });
    await cf.setValue(t1.Id, field.id, JSON.stringify(2));
    await cf.setValue(t2.Id, field.id, JSON.stringify(8));

    const cat = buildCatalog([field]);
    const compiled = compile({ workspaceId: ws.Id, scope: { scopeType: 'SPACE', scopePath: `/${p.Id}/` }, catalog: cat,
      filter: { conjunction: 'AND', rules: [{ field: { kind: 'custom', key: field.id }, op: '>=', value: 5 }] }, sort: [] });
    const page = await repo.queryTasks(compiled, { page: 1, pageSize: 25 });
    expect(page.tasks.map((t: any) => t.Title)).toEqual(['high']);
  });

  it('rejects an invalid page number', async () => {
    const u = await createTestUser(); const ws = await createTestWorkspace(u.accessToken); const p = await createTestProject(ws.Id, u.accessToken);
    const cat = buildCatalog([]);
    const compiled = compile({ workspaceId: ws.Id, scope: { scopeType: 'SPACE', scopePath: `/${p.Id}/` }, catalog: cat, filter: { conjunction: 'AND', rules: [] }, sort: [] });
    await expect(repo.queryTasks(compiled, { page: 0, pageSize: 25 })).rejects.toThrow();
  });
});
