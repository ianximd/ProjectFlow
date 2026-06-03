import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { getPool, closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function setup() {
  const owner = await createTestUser({ email: `tree-${Date.now()}-${Math.random().toString(36).slice(2)}@projectflow.test` });
  const ws = await createTestWorkspace(owner.accessToken);
  const space = await createTestProject(ws.Id, owner.accessToken, { name: 'Space A', key: `SPCA${Date.now() % 10000}` });
  return { owner, ws, space };
}

describe('hierarchy tree', () => {
  it('builds Space -> Folder -> List AND a folderless List under the Space', async () => {
    const { owner, ws, space } = await setup();
    const t = owner.accessToken;

    const f = (await json<{ data: any }>(await request('/folders', {
      method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, name: 'Folder 1', position: 0 },
    }), 201)).data;

    const listInFolder = (await json<{ data: any }>(await request('/lists', {
      method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: f.Id, name: 'List in folder', position: 0 },
    }), 201)).data;
    expect(listInFolder.FolderId).toBe(f.Id);
    expect(listInFolder.Path).toBe(`/${space.Id}/${f.Id}/${listInFolder.Id}/`);

    const folderless = (await json<{ data: any }>(await request('/lists', {
      method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Folderless', position: 1 },
    }), 201)).data;
    expect(folderless.FolderId).toBeNull();
    expect(folderless.Path).toBe(`/${space.Id}/${folderless.Id}/`);
  });

  it('everythingUnder returns descendant tasks via ListPath (Space-wide and folder-scoped)', async () => {
    const { owner, ws, space } = await setup();
    const t = owner.accessToken;
    const f = (await json<{ data: any }>(await request('/folders', { method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, name: 'F', position: 0 } }), 201)).data;
    const l1 = (await json<{ data: any }>(await request('/lists', { method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: f.Id, name: 'L1', position: 0 } }), 201)).data;
    const l2 = (await json<{ data: any }>(await request('/lists', { method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'L2', position: 1 } }), 201)).data;

    await request('/tasks', { method: 'POST', token: t, json: { title: 'in L1', listId: l1.Id, workspaceId: ws.Id } });
    await request('/tasks', { method: 'POST', token: t, json: { title: 'in L2', listId: l2.Id, workspaceId: ws.Id } });

    const all = (await json<{ data: any[] }>(await request(`/hierarchy/everything?nodeType=SPACE&nodeId=${space.Id}`, { token: t }), 200)).data;
    expect(all.length).toBe(2);

    const underF = (await json<{ data: any[] }>(await request(`/hierarchy/everything?nodeType=FOLDER&nodeId=${f.Id}`, { token: t }), 200)).data;
    expect(underF.length).toBe(1);
    expect(underF[0].Title).toBe('in L1');
  });

  it('effective statuses: List-level workflow overrides the Space-level workflow', async () => {
    const { owner, ws, space } = await setup();
    const t = owner.accessToken;
    const list = (await json<{ data: any }>(await request('/lists', {
      method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'StatusList', position: 0 },
    }), 201)).data;

    // Seed a Space-level workflow and a List-level workflow directly. Workflow
    // CRUD isn't exposed over the hierarchy REST surface, so we write rows via
    // the pool (same DB the SP reads). Each workflow gets a single, distinctly
    // named status so we can assert which one "wins".
    const pool = await getPool();
    const spaceWf = '11111111-1111-1111-1111-111111111111';
    const listWf  = '22222222-2222-2222-2222-222222222222';
    await pool.request().query(`
      INSERT INTO dbo.Workflows (Id, ProjectId, Name, IsDefault) VALUES ('${spaceWf}', '${space.Id}', 'Space WF', 0);
      INSERT INTO dbo.Workflows (Id, ProjectId, Name, IsDefault) VALUES ('${listWf}',  '${space.Id}', 'List WF',  0);
      INSERT INTO dbo.WorkflowStatuses (Id, WorkflowId, Name, Category, Color, Position)
        VALUES (NEWID(), '${spaceWf}', 'SpaceOnly', 'TODO', '#111', 0);
      INSERT INTO dbo.WorkflowStatuses (Id, WorkflowId, Name, Category, Color, Position)
        VALUES (NEWID(), '${listWf}', 'ListOnly', 'TODO', '#222', 0);
      UPDATE dbo.Projects SET WorkflowId = '${spaceWf}' WHERE Id = '${space.Id}';
      UPDATE dbo.Lists     SET WorkflowId = '${listWf}'  WHERE Id = '${list.Id}';
    `);

    const statuses = (await json<{ data: any[] }>(
      await request(`/lists/${list.Id}/effective-statuses`, { token: t }), 200,
    )).data;

    // The List-level workflow must win over the Space-level workflow.
    expect(statuses.map((s) => s.name)).toEqual(['ListOnly']);
    expect(statuses.map((s) => s.name)).not.toContain('SpaceOnly');
  });
});
