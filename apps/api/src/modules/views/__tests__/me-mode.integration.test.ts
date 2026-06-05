import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { viewService } from '../view.service.js';
import { TaskService } from '../../tasks/task.service.js';
import { TaskRepository } from '../../tasks/task.repository.js';
import { createTestUser, createTestWorkspace, createTestProject, createTestTask } from '../../../__tests__/fixtures/factories.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool, getPool } from '../../../shared/lib/db.js';

async function setListPath(id: string, lp: string) {
  const pool = await getPool();
  await pool.request().input('Id', id).input('LP', lp).query('UPDATE Tasks SET ListPath=@LP WHERE Id=@Id');
}

const taskService = new TaskService(new TaskRepository());

describe('Me-mode overlay', () => {
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });

  it('filters to tasks assigned to the current user without mutating the view config', async () => {
    const u   = await createTestUser();
    const ws  = await createTestWorkspace(u.accessToken);
    const p   = await createTestProject(ws.Id, u.accessToken);

    const mine  = await createTestTask(p.Id, ws.Id, u.accessToken, { title: 'mine' });
    const other = await createTestTask(p.Id, ws.Id, u.accessToken, { title: 'other' });

    await setListPath(mine.Id,  `/${p.Id}/`);
    await setListPath(other.Id, `/${p.Id}/`);

    // Assign only `mine` to the current user
    await taskService.setAssignees(mine.Id, [u.user.Id], u.user.Id);

    const view = await viewService.create(u.user.Id, {
      scopeType: 'SPACE',
      scopeId:   p.Id,
      type:      'list',
      name:      'V',
      isShared:  true,
      isDefault: false,
      config:    { filter: { conjunction: 'AND', rules: [] }, sort: [] },
    });

    const off = await viewService.runView(u.user.Id, view.id, { page: 1 });
    const on  = await viewService.runView(u.user.Id, view.id, { page: 1, meMode: true });

    expect(off.tasks.length).toBe(2);
    expect(on.tasks.map((t) => (t as any).Title)).toEqual(['mine']);

    // Me-mode is a call-time overlay: it must NOT persist into the saved view config.
    const refetched = await viewService.getOrThrow(view.id);
    expect(refetched.config.meMode).toBeFalsy();
  });
});
