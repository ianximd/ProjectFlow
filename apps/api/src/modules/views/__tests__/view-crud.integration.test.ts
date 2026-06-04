import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { ViewRepository } from '../view.repository.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool } from '../../../shared/lib/db.js';
import { randomUUID } from 'node:crypto';

const repo = new ViewRepository();
const emptyConfig = JSON.stringify({ filter: { conjunction: 'AND', rules: [] }, sort: [] });

describe('ViewRepository CRUD', () => {
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });

  it('creates, lists (shared∪own), updates, reorders, soft-deletes', async () => {
    const owner = await createTestUser();
    const ws = await createTestWorkspace(owner.accessToken);
    const project = await createTestProject(ws.Id, owner.accessToken);

    const created = await repo.create({
      id: randomUUID(), workspaceId: ws.Id, ownerId: owner.user.Id,
      scopeType: 'SPACE', scopeId: project.Id, scopePath: `/${project.Id}/`,
      type: 'table', name: 'My Table', isShared: false, isDefault: true,
      config: emptyConfig, position: 1,
    });
    expect(created.name).toBe('My Table');
    expect(created.isDefault).toBe(true);

    const ownList = await repo.list(ws.Id, owner.user.Id, 'SPACE', project.Id);
    expect(ownList.map((v) => v.id)).toContain(created.id);

    const other = await createTestUser();
    const otherList = await repo.list(ws.Id, other.user.Id, 'SPACE', project.Id);
    expect(otherList.map((v) => v.id)).not.toContain(created.id);

    await repo.update(created.id, { isShared: true });
    const otherList2 = await repo.list(ws.Id, other.user.Id, 'SPACE', project.Id);
    expect(otherList2.map((v) => v.id)).toContain(created.id);

    const reordered = await repo.reorder(created.id, 5);
    expect(reordered?.position).toBe(5);

    const deleted = await repo.delete(created.id);
    expect(deleted?.id).toBe(created.id);
    const afterDelete = await repo.list(ws.Id, owner.user.Id, 'SPACE', project.Id);
    expect(afterDelete.map((v) => v.id)).not.toContain(created.id);
  });

  it('getWorkspaceId returns the owning workspace', async () => {
    const owner = await createTestUser();
    const ws = await createTestWorkspace(owner.accessToken);
    const project = await createTestProject(ws.Id, owner.accessToken);
    const v = await repo.create({
      id: randomUUID(), workspaceId: ws.Id, ownerId: owner.user.Id,
      scopeType: 'SPACE', scopeId: project.Id, scopePath: `/${project.Id}/`,
      type: 'list', name: 'L', isShared: true, isDefault: false, config: emptyConfig, position: 0,
    });
    expect(await repo.getWorkspaceId(v.id)).toBe(ws.Id);
  });
});
