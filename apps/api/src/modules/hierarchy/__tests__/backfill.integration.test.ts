import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../../../shared/lib/db.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

// The idempotent backfill SQL, kept in sync with the batch in 0029_hierarchy.sql.
const BACKFILL = `
DECLARE @sid UNIQUEIDENTIFIER, @wsid UNIQUEIDENTIFIER, @pname NVARCHAR(255), @lid UNIQUEIDENTIFIER;
DECLARE space_cur CURSOR LOCAL FAST_FORWARD FOR
  SELECT p.Id, p.WorkspaceId, p.Name FROM dbo.Projects p
  WHERE p.DeletedAt IS NULL AND NOT EXISTS (SELECT 1 FROM dbo.Lists l WHERE l.SpaceId = p.Id AND l.IsDefault = 1 AND l.DeletedAt IS NULL);
OPEN space_cur; FETCH NEXT FROM space_cur INTO @sid, @wsid, @pname;
WHILE @@FETCH_STATUS = 0 BEGIN
  SET @lid = NEWID();
  INSERT INTO dbo.Lists (Id, WorkspaceId, SpaceId, FolderId, Name, Position, Path, IsDefault)
  VALUES (@lid, @wsid, @sid, NULL, @pname, 0, '/' + CONVERT(NVARCHAR(36), @sid) + '/' + CONVERT(NVARCHAR(36), @lid) + '/', 1);
  FETCH NEXT FROM space_cur INTO @sid, @wsid, @pname;
END
CLOSE space_cur; DEALLOCATE space_cur;
UPDATE t SET t.ListId = l.Id, t.ListPath = l.Path
FROM dbo.Tasks t JOIN dbo.Lists l ON l.SpaceId = t.ProjectId AND l.IsDefault = 1 AND l.DeletedAt IS NULL
WHERE t.ListId IS NULL;`;

describe('backfill', () => {
  it('creates exactly one default List per Space and re-homes ListId-less tasks; is idempotent', async () => {
    const owner = await createTestUser({ email: `bf-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const space = await createTestProject(ws.Id, owner.accessToken, { name: 'Legacy', key: `LEG${Date.now() % 10000}` });
    const pool = await getPool();

    // Legacy task with no ListId (simulates pre-0029 data).
    await pool.request().query(`
      INSERT INTO dbo.Tasks (Id, ProjectId, WorkspaceId, IssueKey, Title, Status, Priority, ReporterId, Position)
      VALUES (NEWID(), '${space.Id}', '${ws.Id}', 'LEG-1', 'Legacy task', 'To Do', 'MEDIUM', '${owner.user.Id}', 0)`);

    await pool.request().batch(BACKFILL);
    await pool.request().batch(BACKFILL); // idempotent re-run

    const lists = await pool.request().query(`SELECT * FROM dbo.Lists WHERE SpaceId = '${space.Id}' AND IsDefault = 1`);
    expect(lists.recordset.length).toBe(1);

    const tasks = await pool.request().query(`SELECT ListId, ListPath FROM dbo.Tasks WHERE ProjectId = '${space.Id}'`);
    expect(tasks.recordset.every((r) => r.ListId && r.ListPath)).toBe(true);
  });
});
