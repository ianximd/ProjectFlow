/**
 * Phase 8c — sprint scheduler sweep against the REAL SQL stack.
 * DB SAFETY: must target the local Docker ProjectFlow_Test DB.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { getPool, closePool } from '../../../shared/lib/db.js';
import { sprintService } from '../sprint.service.js';
import { runSprintSweep } from '../sprint.worker.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

describe('runSprintSweep', () => {
  it('auto-completes a past-EndDate ACTIVE sprint and rolls unfinished tasks into the next sprint', async () => {
    const owner = await createTestUser({ email: `swp-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const space = await createTestProject(ws.Id, owner.accessToken, { name: 'Swp Space', key: `SW${Date.now() % 100000}` });
    const pool = await getPool();
    const folderId = (await pool.request().query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Folders (Id, WorkspaceId, SpaceId, Name, Position, Path, IsSprintFolder)
      VALUES (@id, '${ws.Id}', '${space.Id}', 'Sprints', 0, '/${space.Id}/f/', 1);
      INSERT INTO dbo.SprintSettings (FolderId, DurationDays, AutoStart, AutoComplete, AutoRollForward)
      VALUES (@id, 14, 1, 1, 1);
      SELECT @id AS Id;`)).recordset[0].Id;

    // An ACTIVE sprint that ended yesterday, with one open task.
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
    const s1: any = await sprintService.createInFolder(folderId, 'S1', null, new Date(now.getTime() - 15 * 24 * 3600 * 1000), yesterday);
    await sprintService.start(s1.Id);
    const taskId = (await pool.request().query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Tasks (Id, ProjectId, WorkspaceId, IssueKey, Title, Status, ReporterId, SprintId, ListId)
      VALUES (@id, '${space.Id}', '${ws.Id}', 'SW-1', 'Open', 'In Progress', '${owner.user.Id}', '${s1.Id}', '${s1.ListId}');
      SELECT @id AS Id;`)).recordset[0].Id;

    const result = await runSprintSweep(now);
    expect(result.completed).toBeGreaterThanOrEqual(1);

    // S1 is COMPLETED.
    const s1after = (await pool.request().input('Id', sql.UniqueIdentifier, s1.Id)
      .query(`SELECT Status FROM dbo.Sprints WHERE Id = @Id`)).recordset[0];
    expect(s1after.Status).toBe('COMPLETED');

    // A new sprint List was created in the folder and the open task moved into it.
    const newSprint = (await pool.request().input('Fid', sql.UniqueIdentifier, folderId)
      .query(`SELECT TOP 1 Id, ListId FROM dbo.Sprints WHERE FolderId = @Fid AND Id <> '${s1.Id}' ORDER BY CreatedAt DESC`)).recordset[0];
    expect(newSprint).toBeTruthy();
    const task = (await pool.request().input('Id', sql.UniqueIdentifier, taskId)
      .query(`SELECT ListId, SprintId FROM dbo.Tasks WHERE Id = @Id`)).recordset[0];
    expect(task.ListId).toBe(newSprint.ListId);
    expect(task.SprintId).toBe(newSprint.Id);
  });
});
