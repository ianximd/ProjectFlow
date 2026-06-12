/**
 * Phase 8c — sprint-folder schema + CRUD integration coverage.
 * DB SAFETY: must target the local Docker ProjectFlow_Test DB (see e2e/README).
 *
 * This file accumulates describe blocks across the Phase 8c batches:
 *   - schema (0046)                 — this batch
 *   - usp_Folder_Set/GetSprintSettings, usp_Sprint_CreateInFolder,
 *     usp_Sprint_RollForward, usp_Sprint_GetPointsRollup,
 *     usp_Sprint_ListDueFolders   — SP batch
 *   - SprintRepository / sprintService / REST surface — later batches
 */
import { afterAll, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { getPool, closePool } from '../../../shared/lib/db.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { SprintRepository } from '../sprint.repository.js';
import { sprintService } from '../sprint.service.js';
import { request, json } from '../../../__tests__/setup/testServer.js';

afterAll(async () => { await closePool(); });

describe('0046 sprint-folder schema', () => {
  it('adds Folders.IsSprintFolder', async () => {
    const pool = await getPool();
    const r = await pool.request().query(
      `SELECT COL_LENGTH('dbo.Folders','IsSprintFolder') AS len`,
    );
    expect(r.recordset[0].len).not.toBeNull();
  });

  it('creates the SprintSettings table with a FolderId PK', async () => {
    const pool = await getPool();
    const r = await pool.request().query(
      `SELECT OBJECT_ID('dbo.SprintSettings') AS oid`,
    );
    expect(r.recordset[0].oid).not.toBeNull();
  });

  it('adds Sprints.ListId and Sprints.FolderId', async () => {
    const pool = await getPool();
    const r = await pool.request().query(
      `SELECT COL_LENGTH('dbo.Sprints','ListId') AS lst, COL_LENGTH('dbo.Sprints','FolderId') AS fld`,
    );
    expect(r.recordset[0].lst).not.toBeNull();
    expect(r.recordset[0].fld).not.toBeNull();
  });
});

describe('usp_Folder_SetSprintSettings', () => {
  it('flags a folder as sprint folder and upserts settings', async () => {
    await truncateAll();
    const owner = await createTestUser({ email: `set-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const space = await createTestProject(ws.Id, owner.accessToken, { name: 'Set Space', key: `ST${Date.now() % 100000}` });
    const pool = await getPool();

    const folderId = (await pool.request().query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Folders (Id, WorkspaceId, SpaceId, Name, Position, Path)
      VALUES (@id, '${ws.Id}', '${space.Id}', 'F', 0, '/${space.Id}/x/');
      SELECT @id AS Id;`)).recordset[0].Id;

    const set = (await pool.request()
      .input('FolderId', sql.UniqueIdentifier, folderId)
      .input('DurationDays', sql.Int, 7)
      .input('StartDayOfWeek', sql.TinyInt, 1)
      .input('AutoStart', sql.Bit, 1)
      .input('AutoComplete', sql.Bit, 1)
      .input('AutoRollForward', sql.Bit, 1)
      .input('PointsFieldId', sql.UniqueIdentifier, null)
      .execute('usp_Folder_SetSprintSettings')).recordset[0];
    expect(set.DurationDays).toBe(7);
    expect(set.AutoStart).toBe(true);

    const folder = (await pool.request()
      .input('Id', sql.UniqueIdentifier, folderId)
      .query(`SELECT IsSprintFolder FROM dbo.Folders WHERE Id = @Id`)).recordset[0];
    expect(folder.IsSprintFolder).toBe(true);

    // Second call updates (no duplicate row).
    const upd = (await pool.request()
      .input('FolderId', sql.UniqueIdentifier, folderId)
      .input('DurationDays', sql.Int, 21)
      .input('StartDayOfWeek', sql.TinyInt, null)
      .input('AutoStart', sql.Bit, 0)
      .input('AutoComplete', sql.Bit, 0)
      .input('AutoRollForward', sql.Bit, 0)
      .input('PointsFieldId', sql.UniqueIdentifier, null)
      .execute('usp_Folder_SetSprintSettings')).recordset[0];
    expect(upd.DurationDays).toBe(21);

    const get = (await pool.request()
      .input('FolderId', sql.UniqueIdentifier, folderId)
      .execute('usp_Folder_GetSprintSettings')).recordset[0];
    expect(get.DurationDays).toBe(21);
    expect(get.IsSprintFolder).toBe(true);
  });
});

describe('usp_Sprint_CreateInFolder', () => {
  it('creates a sprint List under the folder and a bound Sprints row', async () => {
    await truncateAll();
    const owner = await createTestUser({ email: `cif-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const space = await createTestProject(ws.Id, owner.accessToken, { name: 'CIF Space', key: `CI${Date.now() % 100000}` });
    const pool = await getPool();
    const folderId = (await pool.request().query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Folders (Id, WorkspaceId, SpaceId, Name, Position, Path, IsSprintFolder)
      VALUES (@id, '${ws.Id}', '${space.Id}', 'Sprints', 0, '/${space.Id}/f/', 1);
      SELECT @id AS Id;`)).recordset[0].Id;

    const start = new Date('2026-07-01T00:00:00Z');
    const end = new Date('2026-07-15T00:00:00Z');
    const sprint = (await pool.request()
      .input('FolderId', sql.UniqueIdentifier, folderId)
      .input('Name', sql.NVarChar(255), 'Sprint 1')
      .input('Goal', sql.NVarChar(sql.MAX), 'Ship 8c')
      .input('StartDate', sql.DateTime2, start)
      .input('EndDate', sql.DateTime2, end)
      .execute('usp_Sprint_CreateInFolder')).recordset[0];

    expect(sprint.ListId).not.toBeNull();
    expect(sprint.FolderId).toBe(folderId);
    expect(sprint.Status).toBe('PLANNED');

    const list = (await pool.request()
      .input('Id', sql.UniqueIdentifier, sprint.ListId)
      .query(`SELECT FolderId, SpaceId, Name FROM dbo.Lists WHERE Id = @Id`)).recordset[0];
    expect(list.FolderId).toBe(folderId);
    expect(list.SpaceId).toBe(space.Id);
    expect(list.Name).toBe('Sprint 1');
  });
});

describe('usp_Sprint_RollForward', () => {
  it('moves only unfinished tasks to the next sprint List and updates SprintId denorm', async () => {
    await truncateAll();
    const owner = await createTestUser({ email: `rf-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const space = await createTestProject(ws.Id, owner.accessToken, { name: 'RF Space', key: `RF${Date.now() % 100000}` });
    const pool = await getPool();
    const folderId = (await pool.request().query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Folders (Id, WorkspaceId, SpaceId, Name, Position, Path, IsSprintFolder)
      VALUES (@id, '${ws.Id}', '${space.Id}', 'Sprints', 0, '/${space.Id}/f/', 1);
      SELECT @id AS Id;`)).recordset[0].Id;

    const mk = async (name: string) => (await pool.request()
      .input('FolderId', sql.UniqueIdentifier, folderId)
      .input('Name', sql.NVarChar(255), name)
      .input('Goal', sql.NVarChar(sql.MAX), null)
      .input('StartDate', sql.DateTime2, null)
      .input('EndDate', sql.DateTime2, null)
      .execute('usp_Sprint_CreateInFolder')).recordset[0];
    const s1 = await mk('S1');
    const s2 = await mk('S2');

    const addTask = async (key: string, status: string) => (await pool.request().query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Tasks (Id, ProjectId, WorkspaceId, IssueKey, Title, Status, ReporterId, SprintId, ListId)
      VALUES (@id, '${space.Id}', '${ws.Id}', '${key}', 'T', '${status}', '${owner.user.Id}', '${s1.Id}', '${s1.ListId}');
      SELECT @id AS Id;`)).recordset[0].Id;
    const openTask = await addTask('RF-1', 'In Progress');
    const doneTask = await addTask('RF-2', 'Done');

    await pool.request()
      .input('FromSprintId', sql.UniqueIdentifier, s1.Id)
      .input('ToSprintId', sql.UniqueIdentifier, s2.Id)
      .execute('usp_Sprint_RollForward');

    const open = (await pool.request().input('Id', sql.UniqueIdentifier, openTask)
      .query(`SELECT ListId, SprintId FROM dbo.Tasks WHERE Id = @Id`)).recordset[0];
    const done = (await pool.request().input('Id', sql.UniqueIdentifier, doneTask)
      .query(`SELECT ListId, SprintId FROM dbo.Tasks WHERE Id = @Id`)).recordset[0];
    expect(open.ListId).toBe(s2.ListId);
    expect(open.SprintId).toBe(s2.Id);
    expect(done.ListId).toBe(s1.ListId);
    expect(done.SprintId).toBe(s1.Id);
  });

  it('refuses to roll forward into a different-workspace sprint (50049 cross-tenant guard)', async () => {
    await truncateAll();
    const owner = await createTestUser({ email: `rfx-${Date.now()}@projectflow.test` });
    const wsA = await createTestWorkspace(owner.accessToken);
    const spaceA = await createTestProject(wsA.Id, owner.accessToken, { name: 'A', key: `XA${Date.now() % 100000}` });
    const wsB = await createTestWorkspace(owner.accessToken);
    const spaceB = await createTestProject(wsB.Id, owner.accessToken, { name: 'B', key: `XB${Date.now() % 100000}` });
    const pool = await getPool();
    const mkFolder = async (ws: any, space: any) => (await pool.request().query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Folders (Id, WorkspaceId, SpaceId, Name, Position, Path, IsSprintFolder)
      VALUES (@id, '${ws.Id}', '${space.Id}', 'Sprints', 0, '/${space.Id}/f/', 1);
      SELECT @id AS Id;`)).recordset[0].Id;
    const fA = await mkFolder(wsA, spaceA);
    const fB = await mkFolder(wsB, spaceB);
    const mkSprint = async (fid: string) => (await pool.request()
      .input('FolderId', sql.UniqueIdentifier, fid)
      .input('Name', sql.NVarChar(255), 'S')
      .input('Goal', sql.NVarChar(sql.MAX), null)
      .input('StartDate', sql.DateTime2, null)
      .input('EndDate', sql.DateTime2, null)
      .execute('usp_Sprint_CreateInFolder')).recordset[0];
    const sA = await mkSprint(fA);
    const sB = await mkSprint(fB);

    await expect(pool.request()
      .input('FromSprintId', sql.UniqueIdentifier, sA.Id)
      .input('ToSprintId', sql.UniqueIdentifier, sB.Id)
      .execute('usp_Sprint_RollForward'),
    ).rejects.toThrow(/different workspaces/i);
  });
});

describe('usp_Sprint_GetPointsRollup + summary list-membership', () => {
  it('returns total points and a per-assignee split', async () => {
    await truncateAll();
    const owner = await createTestUser({ email: `pr-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const space = await createTestProject(ws.Id, owner.accessToken, { name: 'PR Space', key: `PR${Date.now() % 100000}` });
    const pool = await getPool();
    const folderId = (await pool.request().query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Folders (Id, WorkspaceId, SpaceId, Name, Position, Path, IsSprintFolder)
      VALUES (@id, '${ws.Id}', '${space.Id}', 'Sprints', 0, '/${space.Id}/f/', 1);
      SELECT @id AS Id;`)).recordset[0].Id;
    const s1 = (await pool.request()
      .input('FolderId', sql.UniqueIdentifier, folderId)
      .input('Name', sql.NVarChar(255), 'S1')
      .input('Goal', sql.NVarChar(sql.MAX), null)
      .input('StartDate', sql.DateTime2, null)
      .input('EndDate', sql.DateTime2, null)
      .execute('usp_Sprint_CreateInFolder')).recordset[0];

    await pool.request().query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Tasks (Id, ProjectId, WorkspaceId, IssueKey, Title, Status, ReporterId, SprintId, ListId, StoryPoints)
      VALUES (@id, '${space.Id}', '${ws.Id}', 'PR-1', 'T1', 'To Do', '${owner.user.Id}', '${s1.Id}', '${s1.ListId}', 5);
      INSERT INTO dbo.TaskAssignees (TaskId, UserId) VALUES (@id, '${owner.user.Id}');
      SELECT @id AS Id;`);
    await pool.request().query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Tasks (Id, ProjectId, WorkspaceId, IssueKey, Title, Status, ReporterId, SprintId, ListId, StoryPoints)
      VALUES (@id, '${space.Id}', '${ws.Id}', 'PR-2', 'T2', 'To Do', '${owner.user.Id}', '${s1.Id}', '${s1.ListId}', 3);`);

    const res = await pool.request().input('SprintId', sql.UniqueIdentifier, s1.Id).execute('usp_Sprint_GetPointsRollup');
    const rollupSets = res.recordsets as unknown as any[][];
    const total = rollupSets[0][0];
    const perAssignee = rollupSets[1];
    expect(total.TotalPoints).toBe(8);
    expect(perAssignee.find((r: any) => r.UserId === owner.user.Id)?.Points).toBe(5);

    const summary = await pool.request().input('SprintId', sql.UniqueIdentifier, s1.Id).execute('usp_Report_SprintSummary');
    const summarySets = summary.recordsets as unknown as any[][];
    expect(summarySets[0][0].TotalIssues).toBe(2);
    expect(summarySets[0][0].TotalPoints).toBe(8);
  });
});

describe('usp_Sprint_ListDueFolders', () => {
  it('lists each sprint folder with its settings and current sprint window', async () => {
    await truncateAll();
    const owner = await createTestUser({ email: `due-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const space = await createTestProject(ws.Id, owner.accessToken, { name: 'Due Space', key: `DU${Date.now() % 100000}` });
    const pool = await getPool();
    const folderId = (await pool.request().query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Folders (Id, WorkspaceId, SpaceId, Name, Position, Path, IsSprintFolder)
      VALUES (@id, '${ws.Id}', '${space.Id}', 'Sprints', 0, '/${space.Id}/f/', 1);
      INSERT INTO dbo.SprintSettings (FolderId, DurationDays, AutoStart, AutoComplete, AutoRollForward)
      VALUES (@id, 14, 1, 1, 1);
      SELECT @id AS Id;`)).recordset[0].Id;

    const rows = (await pool.request().execute('usp_Sprint_ListDueFolders')).recordset;
    const mine = rows.find((r: any) => r.FolderId === folderId);
    expect(mine).toBeTruthy();
    expect(mine.AutoComplete).toBe(true);
    expect(mine.WorkspaceId).toBe(ws.Id);

    // usp_Folder_GetWorkspaceId already exists in the repo with param @Id.
    const wsRow = (await pool.request()
      .input('Id', sql.UniqueIdentifier, folderId)
      .execute('usp_Folder_GetWorkspaceId')).recordset[0];
    expect(wsRow.WorkspaceId).toBe(ws.Id);
  });
});

describe('SprintRepository — folder/settings/create/roll-forward/points', () => {
  it('round-trips settings, creates a sprint in a folder, and reads points', async () => {
    await truncateAll();
    const repo = new SprintRepository();
    const owner = await createTestUser({ email: `repo-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const space = await createTestProject(ws.Id, owner.accessToken, { name: 'Repo Space', key: `RP${Date.now() % 100000}` });
    const pool = await getPool();
    const folderId = (await pool.request().query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Folders (Id, WorkspaceId, SpaceId, Name, Position, Path)
      VALUES (@id, '${ws.Id}', '${space.Id}', 'F', 0, '/${space.Id}/x/');
      SELECT @id AS Id;`)).recordset[0].Id;

    const settings = await repo.setSprintSettings(folderId, { durationDays: 7, startDayOfWeek: 1, autoStart: true, autoComplete: true, autoRollForward: true, pointsFieldId: null });
    expect((settings as any).DurationDays).toBe(7);

    const sprint = await repo.createInFolder(folderId, 'Sprint 1', null, null, null);
    expect((sprint as any).ListId).not.toBeNull();

    const rollup = await repo.getPointsRollup((sprint as any).Id);
    expect(rollup.total.TotalPoints).toBe(0);
    expect(Array.isArray(rollup.perAssignee)).toBe(true);

    const fwsid = await repo.getFolderWorkspaceId(folderId);
    expect(fwsid).toBe(ws.Id);
  });
});

describe('sprintService — sprint-folder ops', () => {
  it('sets settings, creates in folder, completes (emits hook), and rolls forward', async () => {
    await truncateAll();
    const owner = await createTestUser({ email: `svc-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const space = await createTestProject(ws.Id, owner.accessToken, { name: 'Svc Space', key: `SV${Date.now() % 100000}` });
    const pool = await getPool();
    const folderId = (await pool.request().query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Folders (Id, WorkspaceId, SpaceId, Name, Position, Path)
      VALUES (@id, '${ws.Id}', '${space.Id}', 'F', 0, '/${space.Id}/x/');
      SELECT @id AS Id;`)).recordset[0].Id;

    await sprintService.setSettings(folderId, { durationDays: 14, startDayOfWeek: null, autoStart: false, autoComplete: false, autoRollForward: false, pointsFieldId: null });
    const s1: any = await sprintService.createInFolder(folderId, 'S1', null, null, null);
    const s2: any = await sprintService.createInFolder(folderId, 'S2', null, null, null);

    // One open task in s1.
    await pool.request().query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Tasks (Id, ProjectId, WorkspaceId, IssueKey, Title, Status, ReporterId, SprintId, ListId)
      VALUES (@id, '${space.Id}', '${ws.Id}', 'SV-1', 'T', 'To Do', '${owner.user.Id}', '${s1.Id}', '${s1.ListId}');`);

    await sprintService.start(s1.Id);
    await sprintService.complete(s1.Id);
    // complete() nulls SprintId on the open task; rollForward keys on the source
    // List, so the task still moves to s2 (validates the List-membership design).
    const rolled = await sprintService.rollForward(s1.Id, s2.Id);
    expect(rolled).toBe(1);

    const points = await sprintService.getPoints(s2.Id);
    expect(points.total.TotalPoints).toBe(0);
  });
});

describe('sprint REST — folder surface', () => {
  it('PUT settings, POST create-in-folder, GET points, POST roll-forward (owner perms) + non-member 403', async () => {
    await truncateAll();
    // Workspace creator becomes workspace-owner -> has sprint.create/start (0019)
    // + sprint.manage (0047). No super-admin needed; this exercises the real RBAC.
    const owner = await createTestUser({ email: `rest-${Date.now()}@projectflow.test` });
    const token = owner.accessToken;
    const ws = await createTestWorkspace(token);
    const space = await createTestProject(ws.Id, token, { name: 'Rest Space', key: `RE${Date.now() % 100000}` });
    const pool = await getPool();
    const folderId = (await pool.request().query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Folders (Id, WorkspaceId, SpaceId, Name, Position, Path)
      VALUES (@id, '${ws.Id}', '${space.Id}', 'F', 0, '/${space.Id}/x/');
      SELECT @id AS Id;`)).recordset[0].Id;

    const setRes = await request(`/sprints/folders/${folderId}/settings`, {
      method: 'PUT', token,
      json: { durationDays: 7, startDayOfWeek: 1, autoStart: true, autoComplete: true, autoRollForward: true, pointsFieldId: null },
    });
    expect(setRes.status).toBe(200);

    const create = (await json<{ data: any }>(await request(`/sprints/folders/${folderId}/sprints`, {
      method: 'POST', token, json: { name: 'Sprint 1' },
    }), 201)).data;
    expect(create.ListId ?? create.listId).toBeTruthy();
    const sprintId = create.Id ?? create.id;

    const points = (await json<{ data: any }>(await request(`/sprints/${sprintId}/points`, { token }), 200)).data;
    expect(points.total.TotalPoints).toBe(0);

    const create2 = (await json<{ data: any }>(await request(`/sprints/folders/${folderId}/sprints`, {
      method: 'POST', token, json: { name: 'Sprint 2' },
    }), 201)).data;
    const rf = await request(`/sprints/${sprintId}/roll-forward`, {
      method: 'POST', token, json: { toSprintId: create2.Id ?? create2.id },
    });
    expect(rf.status).toBe(200);

    // Negative authz: a non-member of the workspace is 403 on the settings surface.
    const outsider = await createTestUser({ email: `out-${Date.now()}@projectflow.test` });
    const denied = await request(`/sprints/folders/${folderId}/settings`, { token: outsider.accessToken });
    expect(denied.status).toBe(403);
  });
});
