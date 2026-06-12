/**
 * Phase 8c — legacy flat-sprint data migration (0046b).
 * DB SAFETY: must target the local Docker ProjectFlow_Test DB. LOCAL-ONLY.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { getPool, closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

/** Run the data-migration script, splitting on GO batch separators (like the deployer). */
async function runDataMigration() {
  const pool = await getPool();
  // Resolve from this file (cwd-independent — the integration project runs with
  // cwd = apps/api, but the migrations live at the repo root). __tests__ → repo root = 6 up.
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
  const filePath = resolve(repoRoot, 'infra/sql/migrations/0046b_sprint_data_migration.sql');
  const text = await readFile(filePath, 'utf8');
  for (const batch of text.split(/^\s*GO\s*$/im)) {
    if (batch.trim()) await pool.request().batch(batch);
  }
}

describe('0046b legacy flat-sprint data migration', () => {
  it('binds a flat sprint to a List under a sprint Folder and re-homes its tasks', async () => {
    const owner = await createTestUser({ email: `mig-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const space = await createTestProject(ws.Id, owner.accessToken, { name: 'Mig Space', key: `MG${Date.now() % 100000}` });
    const pool = await getPool();

    // Legacy flat sprint (no ListId/FolderId), via the OLD create SP.
    const sprintRow = (await pool.request()
      .input('ProjectId', sql.UniqueIdentifier, space.Id)
      .input('Name', sql.NVarChar(255), 'Legacy Sprint')
      .input('Goal', sql.NVarChar(sql.MAX), null)
      .input('StartDate', sql.DateTime2, null)
      .input('EndDate', sql.DateTime2, null)
      .execute('usp_Sprint_Create')).recordset[0];
    const sprintId: string = sprintRow.Id;

    // A task that references the sprint via the SprintId denorm (legacy shape).
    const taskId = (await pool.request().query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Tasks (Id, ProjectId, WorkspaceId, IssueKey, Title, Status, ReporterId, SprintId)
      VALUES (@id, '${space.Id}', '${ws.Id}', 'MG-1', 'Legacy task', 'To Do', '${owner.user.Id}', '${sprintId}');
      SELECT @id AS Id;`)).recordset[0].Id;

    await runDataMigration();

    const after = (await pool.request()
      .input('Id', sql.UniqueIdentifier, sprintId)
      .query(`SELECT ListId, FolderId FROM dbo.Sprints WHERE Id = @Id`)).recordset[0];
    expect(after.ListId).not.toBeNull();
    expect(after.FolderId).not.toBeNull();

    const folder = (await pool.request()
      .input('Id', sql.UniqueIdentifier, after.FolderId)
      .query(`SELECT IsSprintFolder FROM dbo.Folders WHERE Id = @Id`)).recordset[0];
    expect(folder.IsSprintFolder).toBe(true);

    const task = (await pool.request()
      .input('Id', sql.UniqueIdentifier, taskId)
      .query(`SELECT ListId, SprintId FROM dbo.Tasks WHERE Id = @Id`)).recordset[0];
    expect(task.ListId).toBe(after.ListId);
    expect(task.SprintId).toBe(sprintId);
  });

  it('is idempotent — a second run does not duplicate the sprint List/Folder', async () => {
    const owner = await createTestUser({ email: `mig2-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const space = await createTestProject(ws.Id, owner.accessToken, { name: 'Mig2 Space', key: `M2${Date.now() % 100000}` });
    const pool = await getPool();
    await pool.request()
      .input('ProjectId', sql.UniqueIdentifier, space.Id)
      .input('Name', sql.NVarChar(255), 'S')
      .input('Goal', sql.NVarChar(sql.MAX), null)
      .input('StartDate', sql.DateTime2, null)
      .input('EndDate', sql.DateTime2, null)
      .execute('usp_Sprint_Create');

    await runDataMigration();
    await runDataMigration();

    // Count sprint-bound Lists (a List under a sprint Folder) — robust to whether
    // a separate default List exists. Exactly one sprint List for the one legacy
    // sprint, stable across the second (idempotent) run.
    const sprintLists = (await pool.request()
      .input('SpaceId', sql.UniqueIdentifier, space.Id)
      .query(`
        SELECT COUNT(*) AS n
        FROM dbo.Lists l
        JOIN dbo.Folders f ON f.Id = l.FolderId AND f.IsSprintFolder = 1
        WHERE l.SpaceId = @SpaceId AND l.DeletedAt IS NULL`)).recordset[0].n;
    expect(sprintLists).toBe(1);

    // And exactly one sprint Folder.
    const sprintFolders = (await pool.request()
      .input('SpaceId', sql.UniqueIdentifier, space.Id)
      .query(`SELECT COUNT(*) AS n FROM dbo.Folders WHERE SpaceId = @SpaceId AND IsSprintFolder = 1 AND DeletedAt IS NULL`)).recordset[0].n;
    expect(sprintFolders).toBe(1);
  });
});
