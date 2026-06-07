# Phase 8c — Sprints/Agile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-model flat per-Project `Sprints` into the Phase 1 hierarchy (a Sprint = a List under a sprint-flagged Folder) with cadence-driven auto-start/auto-complete/auto-roll-forward and per-assignee story-point rollups.

**Architecture:** A `Folder` gains an `IsSprintFolder` flag + a 1:1 `SprintSettings` row (duration/start-day/auto flags/points field); each sprint is a `List` under that folder, with the existing `Sprints` row bound 1:1 to that List (`Sprints.ListId`/`FolderId`) while `Tasks.SprintId` is retained as a maintained denormalization so existing reports/automation keep working. A BullMQ repeatable-job `sprint.worker.ts` (copied from `recurrence.worker.ts`: idempotent, Redis-gated, fixed sweep interval, pure `runSprintSweep(now?)` test helper) sweeps sprint folders to auto-start/complete sprints, roll unfinished tasks into the next sprint List, and create the next sprint List per the folder cadence.

**Tech Stack:** Hono REST + graphql-yoga (Pothos) GraphQL over a shared `sprintService`; SQL Server stored procedures (`CREATE OR ALTER`, `SET NOCOUNT ON`, TRY/CATCH/TRANSACTION, `SELECT *` of affected rows); BullMQ + ioredis; tsx; vitest (unit + integration projects); Next.js SSR + next-intl; Playwright e2e.

**Prerequisite:** Phases 1–7 merged. (Independent of 8a/8b; 8d depends on this.)

---

## File Structure

**Create**
- `infra/sql/migrations/0045_sprint_folders.sql` — schema migration: `Folders.IsSprintFolder`, `SprintSettings` table, `Sprints.ListId`/`FolderId`; idempotent + GO-batched. **(unit: schema migration)**
- `infra/sql/migrations/rollback/0045_sprint_folders.down.sql` — reverses 0045 (drop `SprintSettings`, drop added columns).
- `infra/sql/migrations/0045b_sprint_data_migration.sql` — **idempotent DATA MIGRATION** (its own deployable unit): for each legacy flat `Sprint` → ensure sprint Folder, create sprint List, bind `Sprints.ListId`/`FolderId`, re-home its tasks' `Tasks.ListId` + maintain `Tasks.SprintId`. **(unit: data migration; local-Docker only)**
- `infra/sql/procedures/usp_Folder_SetSprintSettings.sql` — upsert a `SprintSettings` row + set `Folders.IsSprintFolder=1`.
- `infra/sql/procedures/usp_Sprint_CreateInFolder.sql` — create a sprint List under a sprint Folder + the bound `Sprints` row.
- `infra/sql/procedures/usp_Sprint_RollForward.sql` — move unfinished tasks from one sprint List to another (maintains `SprintId` denorm).
- `infra/sql/procedures/usp_Sprint_GetPointsRollup.sql` — `StoryPoints` summed per sprint AND split per assignee via `TaskAssignees`.
- `infra/sql/procedures/usp_Folder_GetSprintSettings.sql` — read a folder's `SprintSettings` (settings + `IsSprintFolder`).
- `infra/sql/procedures/usp_Sprint_ListDueFolders.sql` — sweep feeder: all sprint folders + their settings + the current sprint List window.
- `infra/sql/procedures/usp_Folder_GetWorkspaceId.sql` — workspace resolver for `requirePermission` on folder-scoped sprint routes (if not already present; create only if missing).
- `apps/api/src/modules/sprints/sprint.cadence.ts` — **pure cadence/roll-forward math** (`nextSprintWindow`, `selectRollForwardTasks`, `shouldAutoStart`, `shouldAutoComplete`), no I/O. **(scheduler math unit)**
- `apps/api/src/modules/sprints/sprint.worker.ts` — **the scheduler** (BullMQ repeatable job + `runSprintSweep(now?)`); copied from `recurrence.worker.ts`.
- `apps/api/src/modules/sprints/__tests__/sprint.cadence.unit.test.ts` — pure-math unit tests.
- `apps/api/src/modules/sprints/__tests__/sprint-folders.integration.test.ts` — folder/settings/sprint CRUD + roll-forward + points rollup against real SQL.
- `apps/api/src/modules/sprints/__tests__/sprint-migration.integration.test.ts` — migrates a legacy flat sprint into the hierarchy.
- `apps/api/src/modules/sprints/__tests__/sprint-sweep.integration.test.ts` — `runSprintSweep` auto-completes a past-`EndDate` sprint + rolls unfinished tasks.
- `apps/next-web/src/components/sprints/SprintSetup.tsx` — mark Folder as sprint folder + configure cadence/auto flags/points field.
- `apps/next-web/src/components/sprints/SprintList.tsx` — sprint List within a folder, with dates/status + per-assignee points display.
- `apps/next-web/src/components/sprints/SprintSetup.test.tsx` — component render test.
- `e2e/sprint-agile.spec.ts` — set up a sprint folder, run the sweep, observe auto-complete + roll-forward + points rollup.

**Modify**
- `infra/sql/procedures/usp_Report_SprintSummary.sql` — read sprint-List membership (prefer `Tasks.ListId = sprint's ListId`, falling back to `SprintId` denorm).
- `apps/api/src/modules/sprints/sprint.repository.ts` — add settings/folder/create-in-folder/roll-forward/points/sweep-feeder calls.
- `apps/api/src/modules/sprints/sprint.service.ts` — sprint-folder CRUD + settings, List-bound create/start/complete, per-assignee points, roll-forward (keep `sprint.started`/`sprint.completed` hooks).
- `apps/api/src/modules/sprints/sprint.routes.ts` — REST: folder-settings + create-in-folder + roll-forward + points endpoints.
- `apps/api/src/graphql/schema.ts` — extend `SprintType` (`listId`/`folderId`/`points`), add `sprintSettings` query + `setSprintSettings`/`createSprintInFolder`/`rollForwardSprint` mutations.
- `apps/api/src/server.ts` — register `startSprintWorker()` alongside the recurrence/oauth workers.
- `packages/types/index.ts` — add `Sprint`, `SprintSettings`, `SprintPointsRollup` interfaces.
- `apps/next-web/messages/en.json` + `apps/next-web/messages/id.json` — `Sprints.*` namespace (parity green).

---

## Tasks

### Task 1: Schema migration — `Folders.IsSprintFolder`, `SprintSettings`, `Sprints.ListId`/`FolderId`

**Files:** `infra/sql/migrations/0045_sprint_folders.sql`, `infra/sql/migrations/rollback/0045_sprint_folders.down.sql`, `apps/api/src/modules/sprints/__tests__/sprint-folders.integration.test.ts`

- [ ] Write a failing integration test asserting the new schema deploys. Create `apps/api/src/modules/sprints/__tests__/sprint-folders.integration.test.ts`:
```ts
/**
 * Phase 8c — sprint-folder schema + CRUD integration coverage.
 * DB SAFETY: must target the local Docker ProjectFlow_Test DB (see e2e/README).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { /* schema-only assertions need no truncate yet */ });
afterAll(async () => { await closePool(); });

describe('0045 sprint-folder schema', () => {
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
```
- [ ] Run it and watch it fail (columns/table do not exist yet). The integration project deploys migrations in `globalSetup`, but 0045 is not written yet, so the three columns/table are absent:
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-folders.integration.test.ts
```
Expected: 3 failing assertions — `expected null not to be null` for `IsSprintFolder`, `SprintSettings` `oid`, and `Sprints.ListId`/`FolderId`.
- [ ] Write the migration. Create `infra/sql/migrations/0045_sprint_folders.sql` (idempotent, GO-batched):
```sql
-- =============================================================================
-- Migration 0045: Sprint-folder hierarchy (Phase 8c)
-- A Sprint becomes a List under a sprint-flagged Folder.
--   * Folders.IsSprintFolder  — marks a folder as a sprint container.
--   * SprintSettings           — 1:1 with the sprint Folder: cadence + auto flags
--                                + the points field to roll up.
--   * Sprints.ListId/FolderId  — bind the existing flat row to its List + Folder.
--                                ProjectId is retained (denormalized) for back-compat.
-- Data migration of legacy flat sprints lives in 0045b_sprint_data_migration.sql.
-- Idempotent (sys-catalog / COL_LENGTH guards), GO-batched.
-- Rollback in rollback/0045_sprint_folders.down.sql.
-- =============================================================================

IF COL_LENGTH('dbo.Folders','IsSprintFolder') IS NULL
    ALTER TABLE dbo.Folders ADD IsSprintFolder BIT NOT NULL DEFAULT 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SprintSettings')
BEGIN
    CREATE TABLE dbo.SprintSettings (
        FolderId        UNIQUEIDENTIFIER PRIMARY KEY REFERENCES dbo.Folders(Id),
        DurationDays    INT              NOT NULL DEFAULT 14,
        StartDayOfWeek  TINYINT          NULL,            -- 0=Sun..6=Sat; NULL = anchor to prior EndDate
        AutoStart       BIT              NOT NULL DEFAULT 0,
        AutoComplete    BIT              NOT NULL DEFAULT 0,
        AutoRollForward BIT              NOT NULL DEFAULT 0,
        PointsFieldId   UNIQUEIDENTIFIER NULL,            -- NULL = use Tasks.StoryPoints
        CreatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

IF COL_LENGTH('dbo.Sprints','ListId') IS NULL
    ALTER TABLE dbo.Sprints ADD ListId UNIQUEIDENTIFIER NULL REFERENCES dbo.Lists(Id);
GO
IF COL_LENGTH('dbo.Sprints','FolderId') IS NULL
    ALTER TABLE dbo.Sprints ADD FolderId UNIQUEIDENTIFIER NULL REFERENCES dbo.Folders(Id);
GO

-- 1:1 sprint↔List: at most one sprint bound to a List.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Sprint_List' AND object_id = OBJECT_ID('dbo.Sprints'))
    CREATE UNIQUE NONCLUSTERED INDEX UQ_Sprint_List ON dbo.Sprints (ListId) WHERE ListId IS NOT NULL;
GO

-- Sweep cover: folder lookup + (Status, EndDate) for auto-complete scans.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Sprint_Folder' AND object_id = OBJECT_ID('dbo.Sprints'))
    CREATE NONCLUSTERED INDEX IX_Sprint_Folder ON dbo.Sprints (FolderId, Status, EndDate);
GO
```
- [ ] Write the rollback. Create `infra/sql/migrations/rollback/0045_sprint_folders.down.sql`:
```sql
-- Rollback 0045: sprint-folder hierarchy.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Sprint_Folder' AND object_id = OBJECT_ID('dbo.Sprints'))
    DROP INDEX IX_Sprint_Folder ON dbo.Sprints;
GO
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Sprint_List' AND object_id = OBJECT_ID('dbo.Sprints'))
    DROP INDEX UQ_Sprint_List ON dbo.Sprints;
GO
IF COL_LENGTH('dbo.Sprints','FolderId') IS NOT NULL
    ALTER TABLE dbo.Sprints DROP COLUMN FolderId;
GO
IF COL_LENGTH('dbo.Sprints','ListId') IS NOT NULL
    ALTER TABLE dbo.Sprints DROP COLUMN ListId;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SprintSettings')
    DROP TABLE dbo.SprintSettings;
GO
IF COL_LENGTH('dbo.Folders','IsSprintFolder') IS NOT NULL
    ALTER TABLE dbo.Folders DROP COLUMN IsSprintFolder;
GO
```
- [ ] Run the test again — it passes (globalSetup re-runs migrations including 0045):
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-folders.integration.test.ts
```
Expected: `3 passed`.
- [ ] Commit: `git add infra/sql/migrations/0045_sprint_folders.sql infra/sql/migrations/rollback/0045_sprint_folders.down.sql apps/api/src/modules/sprints/__tests__/sprint-folders.integration.test.ts && git commit -m "feat(8c): 0045 sprint-folder schema (Folders.IsSprintFolder, SprintSettings, Sprints.ListId/FolderId)"`

---

### Task 2: Data migration — fold a legacy flat sprint into the hierarchy

**Files:** `infra/sql/migrations/0045b_sprint_data_migration.sql`, `apps/api/src/modules/sprints/__tests__/sprint-migration.integration.test.ts`

- [ ] Write a failing integration test that seeds a legacy flat sprint, runs the data migration, and asserts the sprint is bound to a List under a sprint Folder with its tasks re-homed. Create `apps/api/src/modules/sprints/__tests__/sprint-migration.integration.test.ts`:
```ts
/**
 * Phase 8c — legacy flat-sprint data migration.
 * DB SAFETY: must target the local Docker ProjectFlow_Test DB. LOCAL-ONLY.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { getPool, closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

/** Run the data-migration script as a single GO-less batch (no GO inside it). */
async function runDataMigration() {
  const pool = await getPool();
  const filePath = resolve(process.cwd(), 'infra/sql/migrations/0045b_sprint_data_migration.sql');
  const text = await readFile(filePath, 'utf8');
  // Split on GO batch separators (line starting with GO) like the deployer does.
  for (const batch of text.split(/^\s*GO\s*$/im)) {
    if (batch.trim()) await pool.request().batch(batch);
  }
}

describe('0045b legacy flat-sprint data migration', () => {
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
      VALUES (@id, '${space.Id}', '${ws.Id}', 'MG-1', 'Legacy task', 'To Do', '${owner.id}', '${sprintId}');
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

  it('is idempotent — a second run does not duplicate Lists/Folders', async () => {
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

    const lists = (await pool.request()
      .input('SpaceId', sql.UniqueIdentifier, space.Id)
      .query(`SELECT COUNT(*) AS n FROM dbo.Lists WHERE SpaceId = @SpaceId AND DeletedAt IS NULL`)).recordset[0].n;
    // One default List from the Phase 1 backfill + exactly one sprint List.
    expect(lists).toBe(2);
  });
});
```
- [ ] Run it and watch it fail — the migration file does not exist yet:
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-migration.integration.test.ts
```
Expected: failure — `ENOENT` reading `0045b_sprint_data_migration.sql` (file missing).
- [ ] Write the data migration. Create `infra/sql/migrations/0045b_sprint_data_migration.sql` (idempotent; one sprint Folder per Project named "Sprints", one sprint List per legacy sprint):
```sql
-- =============================================================================
-- Migration 0045b: legacy flat-sprint → sprint-folder hierarchy data migration.
-- For each flat Sprint that is NOT yet bound to a List:
--   1. ensure a sprint Folder ("Sprints") under the sprint's Project (Space),
--   2. create a sprint List under that Folder, bind Sprints.ListId/FolderId,
--   3. re-home tasks currently referencing Sprints.Id via SprintId into the List
--      (Tasks.ListId/ListPath set; Tasks.SprintId denorm retained).
-- Idempotent: only processes Sprints whose ListId IS NULL; the Folder is reused
-- if it already exists. GO-batched. LOCAL-DOCKER ONLY (prod cutover deferred).
-- =============================================================================

SET NOCOUNT ON;
GO

BEGIN
    DECLARE @sid UNIQUEIDENTIFIER, @pid UNIQUEIDENTIFIER, @wsid UNIQUEIDENTIFIER,
            @sname NVARCHAR(255), @folderId UNIQUEIDENTIFIER, @listId UNIQUEIDENTIFIER,
            @folderPath NVARCHAR(900), @listPath NVARCHAR(900);

    DECLARE sprint_cur CURSOR LOCAL FAST_FORWARD FOR
        SELECT s.Id, s.ProjectId, p.WorkspaceId, s.Name
        FROM   dbo.Sprints s
        JOIN   dbo.Projects p ON p.Id = s.ProjectId
        WHERE  s.ListId IS NULL
          AND  p.Status <> 'DELETED';

    OPEN sprint_cur;
    FETCH NEXT FROM sprint_cur INTO @sid, @pid, @wsid, @sname;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        -- 1) Ensure ONE sprint Folder per Project (reuse if present).
        SELECT TOP 1 @folderId = f.Id
        FROM   dbo.Folders f
        WHERE  f.SpaceId = @pid AND f.IsSprintFolder = 1 AND f.DeletedAt IS NULL;

        IF @folderId IS NULL
        BEGIN
            SET @folderId = NEWID();
            SET @folderPath = '/' + CONVERT(NVARCHAR(36), @pid) + '/' + CONVERT(NVARCHAR(36), @folderId) + '/';
            INSERT INTO dbo.Folders (Id, WorkspaceId, SpaceId, ParentFolderId, Name, Position, Path, IsSprintFolder)
            VALUES (@folderId, @wsid, @pid, NULL, 'Sprints', 0, @folderPath, 1);

            -- Default cadence settings for the new sprint Folder.
            INSERT INTO dbo.SprintSettings (FolderId, DurationDays, AutoStart, AutoComplete, AutoRollForward)
            VALUES (@folderId, 14, 0, 0, 0);
        END

        -- 2) Create the sprint List + bind the Sprints row.
        SET @listId = NEWID();
        SET @listPath = '/' + CONVERT(NVARCHAR(36), @pid) + '/' + CONVERT(NVARCHAR(36), @folderId) + '/' + CONVERT(NVARCHAR(36), @listId) + '/';
        INSERT INTO dbo.Lists (Id, WorkspaceId, SpaceId, FolderId, Name, Position, Path, IsDefault)
        VALUES (@listId, @wsid, @pid, @folderId, @sname, 0, @listPath, 0);

        UPDATE dbo.Sprints SET ListId = @listId, FolderId = @folderId, UpdatedAt = GETUTCDATE()
        WHERE Id = @sid;

        -- 3) Re-home tasks referencing this sprint via the SprintId denorm.
        UPDATE dbo.Tasks
        SET ListId = @listId, ListPath = @listPath, UpdatedAt = GETUTCDATE()
        WHERE SprintId = @sid AND DeletedAt IS NULL;

        SET @folderId = NULL;  -- reset per-iteration

        FETCH NEXT FROM sprint_cur INTO @sid, @pid, @wsid, @sname;
    END
    CLOSE sprint_cur; DEALLOCATE sprint_cur;
END
GO
```
- [ ] Run the test again — it passes:
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-migration.integration.test.ts
```
Expected: `2 passed`.
- [ ] Commit: `git add infra/sql/migrations/0045b_sprint_data_migration.sql apps/api/src/modules/sprints/__tests__/sprint-migration.integration.test.ts && git commit -m "feat(8c): 0045b idempotent legacy flat-sprint data migration (local-Docker only)"`

---

### Task 3: SP `usp_Folder_SetSprintSettings` + `usp_Folder_GetSprintSettings`

**Files:** `infra/sql/procedures/usp_Folder_SetSprintSettings.sql`, `infra/sql/procedures/usp_Folder_GetSprintSettings.sql`, `apps/api/src/modules/sprints/__tests__/sprint-folders.integration.test.ts`

- [ ] Append a failing settings test to `sprint-folders.integration.test.ts` (add these imports + describe block; reuse the existing `getPool`/`closePool`):
```ts
import sql from 'mssql';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';

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
```
- [ ] Run it and watch it fail (SPs not deployed):
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-folders.integration.test.ts -t "usp_Folder_SetSprintSettings"
```
Expected: failure — `Could not find stored procedure 'usp_Folder_SetSprintSettings'`.
- [ ] Write `infra/sql/procedures/usp_Folder_SetSprintSettings.sql`:
```sql
CREATE OR ALTER PROCEDURE dbo.usp_Folder_SetSprintSettings
    @FolderId        UNIQUEIDENTIFIER,
    @DurationDays    INT,
    @StartDayOfWeek  TINYINT = NULL,
    @AutoStart       BIT,
    @AutoComplete    BIT,
    @AutoRollForward BIT,
    @PointsFieldId   UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        IF NOT EXISTS (SELECT 1 FROM dbo.Folders WHERE Id = @FolderId AND DeletedAt IS NULL)
            THROW 50045, 'Folder not found.', 1;

        UPDATE dbo.Folders SET IsSprintFolder = 1, UpdatedAt = GETUTCDATE() WHERE Id = @FolderId;

        IF EXISTS (SELECT 1 FROM dbo.SprintSettings WHERE FolderId = @FolderId)
            UPDATE dbo.SprintSettings
            SET DurationDays = @DurationDays, StartDayOfWeek = @StartDayOfWeek,
                AutoStart = @AutoStart, AutoComplete = @AutoComplete,
                AutoRollForward = @AutoRollForward, PointsFieldId = @PointsFieldId,
                UpdatedAt = GETUTCDATE()
            WHERE FolderId = @FolderId;
        ELSE
            INSERT INTO dbo.SprintSettings (FolderId, DurationDays, StartDayOfWeek, AutoStart, AutoComplete, AutoRollForward, PointsFieldId)
            VALUES (@FolderId, @DurationDays, @StartDayOfWeek, @AutoStart, @AutoComplete, @AutoRollForward, @PointsFieldId);

        COMMIT TRANSACTION;

        SELECT * FROM dbo.SprintSettings WHERE FolderId = @FolderId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO
```
- [ ] Write `infra/sql/procedures/usp_Folder_GetSprintSettings.sql`:
```sql
CREATE OR ALTER PROCEDURE dbo.usp_Folder_GetSprintSettings
    @FolderId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT s.*, f.IsSprintFolder
    FROM   dbo.Folders f
    LEFT JOIN dbo.SprintSettings s ON s.FolderId = f.Id
    WHERE  f.Id = @FolderId AND f.DeletedAt IS NULL;
END;
GO
```
- [ ] Deploy the SPs and re-run the test — it passes:
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; npx tsx scripts/db-deploy-sps.ts; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-folders.integration.test.ts -t "usp_Folder_SetSprintSettings"
```
Expected: `1 passed`.
- [ ] Commit: `git add infra/sql/procedures/usp_Folder_SetSprintSettings.sql infra/sql/procedures/usp_Folder_GetSprintSettings.sql apps/api/src/modules/sprints/__tests__/sprint-folders.integration.test.ts && git commit -m "feat(8c): usp_Folder_Set/GetSprintSettings (upsert + IsSprintFolder flag)"`

---

### Task 4: SP `usp_Sprint_CreateInFolder` (creates sprint List + bound Sprints row)

**Files:** `infra/sql/procedures/usp_Sprint_CreateInFolder.sql`, `apps/api/src/modules/sprints/__tests__/sprint-folders.integration.test.ts`

- [ ] Append a failing test to `sprint-folders.integration.test.ts`:
```ts
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
```
- [ ] Run it and watch it fail:
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-folders.integration.test.ts -t "usp_Sprint_CreateInFolder"
```
Expected: failure — `Could not find stored procedure 'usp_Sprint_CreateInFolder'`.
- [ ] Write `infra/sql/procedures/usp_Sprint_CreateInFolder.sql`:
```sql
CREATE OR ALTER PROCEDURE dbo.usp_Sprint_CreateInFolder
    @FolderId  UNIQUEIDENTIFIER,
    @Name      NVARCHAR(255),
    @Goal      NVARCHAR(MAX) = NULL,
    @StartDate DATETIME2     = NULL,
    @EndDate   DATETIME2     = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @SpaceId UNIQUEIDENTIFIER, @WorkspaceId UNIQUEIDENTIFIER;
        SELECT @SpaceId = SpaceId, @WorkspaceId = WorkspaceId
        FROM   dbo.Folders WHERE Id = @FolderId AND IsSprintFolder = 1 AND DeletedAt IS NULL;
        IF @SpaceId IS NULL
            THROW 50046, 'Folder not found or not a sprint folder.', 1;

        DECLARE @ListId UNIQUEIDENTIFIER = NEWID();
        DECLARE @ListPath NVARCHAR(900) =
            '/' + CONVERT(NVARCHAR(36), @SpaceId) + '/' + CONVERT(NVARCHAR(36), @FolderId) + '/' + CONVERT(NVARCHAR(36), @ListId) + '/';
        INSERT INTO dbo.Lists (Id, WorkspaceId, SpaceId, FolderId, Name, Position, Path, IsDefault)
        VALUES (@ListId, @WorkspaceId, @SpaceId, @FolderId, @Name, 0, @ListPath, 0);

        DECLARE @SprintId UNIQUEIDENTIFIER = NEWID();
        INSERT INTO dbo.Sprints (Id, ProjectId, Name, Goal, Status, StartDate, EndDate, ListId, FolderId)
        VALUES (@SprintId, @SpaceId, @Name, @Goal, 'PLANNED', @StartDate, @EndDate, @ListId, @FolderId);

        COMMIT TRANSACTION;

        SELECT * FROM dbo.Sprints WHERE Id = @SprintId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO
```
- [ ] Deploy + re-run — it passes:
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; npx tsx scripts/db-deploy-sps.ts; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-folders.integration.test.ts -t "usp_Sprint_CreateInFolder"
```
Expected: `1 passed`.
- [ ] Commit: `git add infra/sql/procedures/usp_Sprint_CreateInFolder.sql apps/api/src/modules/sprints/__tests__/sprint-folders.integration.test.ts && git commit -m "feat(8c): usp_Sprint_CreateInFolder (sprint List + bound Sprints row)"`

---

### Task 5: SP `usp_Sprint_RollForward` (move unfinished tasks → next sprint List)

**Files:** `infra/sql/procedures/usp_Sprint_RollForward.sql`, `apps/api/src/modules/sprints/__tests__/sprint-folders.integration.test.ts`

- [ ] Append a failing test that creates two sprints, adds one done + one open task to the first, rolls forward, and asserts only the open task moved (and its `SprintId` denorm updated):
```ts
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
      VALUES (@id, '${space.Id}', '${ws.Id}', '${key}', 'T', '${status}', '${owner.id}', '${s1.Id}', '${s1.ListId}');
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
});
```
- [ ] Run it and watch it fail (SP missing):
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-folders.integration.test.ts -t "usp_Sprint_RollForward"
```
Expected: failure — `Could not find stored procedure 'usp_Sprint_RollForward'`.
- [ ] Write `infra/sql/procedures/usp_Sprint_RollForward.sql` (returns the rolled count):
```sql
CREATE OR ALTER PROCEDURE dbo.usp_Sprint_RollForward
    @FromSprintId UNIQUEIDENTIFIER,
    @ToSprintId   UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @ToListId UNIQUEIDENTIFIER, @ToListPath NVARCHAR(900);
        SELECT @ToListId = l.Id, @ToListPath = l.Path
        FROM   dbo.Sprints s JOIN dbo.Lists l ON l.Id = s.ListId
        WHERE  s.Id = @ToSprintId;
        IF @ToListId IS NULL
            THROW 50047, 'Target sprint has no List.', 1;

        DECLARE @FromListId UNIQUEIDENTIFIER;
        SELECT @FromListId = ListId FROM dbo.Sprints WHERE Id = @FromSprintId;

        -- Move only unfinished tasks (not in a DONE-category status) currently in
        -- the source sprint List; update the SprintId denorm to the target sprint.
        UPDATE dbo.Tasks
        SET    ListId = @ToListId, ListPath = @ToListPath, SprintId = @ToSprintId, UpdatedAt = GETUTCDATE()
        WHERE  ListId = @FromListId
          AND  SprintId = @FromSprintId
          AND  ResolvedAt IS NULL
          AND  Status NOT IN ('Done','DONE')
          AND  DeletedAt IS NULL;

        DECLARE @Rolled INT = @@ROWCOUNT;
        COMMIT TRANSACTION;

        SELECT @Rolled AS Rolled;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO
```
- [ ] Deploy + re-run — it passes:
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; npx tsx scripts/db-deploy-sps.ts; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-folders.integration.test.ts -t "usp_Sprint_RollForward"
```
Expected: `1 passed`.
- [ ] Commit: `git add infra/sql/procedures/usp_Sprint_RollForward.sql apps/api/src/modules/sprints/__tests__/sprint-folders.integration.test.ts && git commit -m "feat(8c): usp_Sprint_RollForward (unfinished-only re-home + SprintId denorm)"`

---

### Task 6: SP `usp_Sprint_GetPointsRollup` + extend `usp_Report_SprintSummary`

**Files:** `infra/sql/procedures/usp_Sprint_GetPointsRollup.sql`, `infra/sql/procedures/usp_Report_SprintSummary.sql`, `apps/api/src/modules/sprints/__tests__/sprint-folders.integration.test.ts`

- [ ] Append a failing test asserting total + per-assignee points, and that the summary reads List membership:
```ts
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

    const t1 = (await pool.request().query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Tasks (Id, ProjectId, WorkspaceId, IssueKey, Title, Status, ReporterId, SprintId, ListId, StoryPoints)
      VALUES (@id, '${space.Id}', '${ws.Id}', 'PR-1', 'T1', 'To Do', '${owner.id}', '${s1.Id}', '${s1.ListId}', 5);
      INSERT INTO dbo.TaskAssignees (TaskId, UserId) VALUES (@id, '${owner.id}');
      SELECT @id AS Id;`)).recordset[0].Id;
    await pool.request().query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Tasks (Id, ProjectId, WorkspaceId, IssueKey, Title, Status, ReporterId, SprintId, ListId, StoryPoints)
      VALUES (@id, '${space.Id}', '${ws.Id}', 'PR-2', 'T2', 'To Do', '${owner.id}', '${s1.Id}', '${s1.ListId}', 3);`);

    const res = await pool.request().input('SprintId', sql.UniqueIdentifier, s1.Id).execute('usp_Sprint_GetPointsRollup');
    const total = res.recordsets[0][0];
    const perAssignee = res.recordsets[1];
    expect(total.TotalPoints).toBe(8);
    expect(perAssignee.find((r: any) => r.UserId === owner.id)?.Points).toBe(5);

    const summary = await pool.request().input('SprintId', sql.UniqueIdentifier, s1.Id).execute('usp_Report_SprintSummary');
    expect(summary.recordsets[0][0].TotalIssues).toBe(2);
    expect(summary.recordsets[0][0].TotalPoints).toBe(8);
  });
});
```
- [ ] Run it and watch it fail:
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-folders.integration.test.ts -t "usp_Sprint_GetPointsRollup"
```
Expected: failure — `Could not find stored procedure 'usp_Sprint_GetPointsRollup'`.
- [ ] Write `infra/sql/procedures/usp_Sprint_GetPointsRollup.sql` (two result sets: total + per-assignee, reading sprint-List membership):
```sql
CREATE OR ALTER PROCEDURE dbo.usp_Sprint_GetPointsRollup
    @SprintId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ListId UNIQUEIDENTIFIER;
    SELECT @ListId = ListId FROM dbo.Sprints WHERE Id = @SprintId;

    -- Sprint membership = tasks in the sprint List (falling back to the SprintId
    -- denorm when the sprint is not yet List-bound, e.g. mid-migration).
    ;WITH SprintTasks AS (
        SELECT t.Id, t.StoryPoints,
               CASE WHEN t.ResolvedAt IS NOT NULL THEN 1 ELSE 0 END AS IsDone
        FROM   dbo.Tasks t
        WHERE  t.DeletedAt IS NULL
          AND  ( (@ListId IS NOT NULL AND t.ListId = @ListId) OR t.SprintId = @SprintId )
    )
    -- ResultSet 1: total
    SELECT
        ISNULL(SUM(ISNULL(StoryPoints,0)), 0) AS TotalPoints,
        ISNULL(SUM(CASE WHEN IsDone = 1 THEN ISNULL(StoryPoints,0) ELSE 0 END), 0) AS CompletedPoints
    FROM SprintTasks;

    -- ResultSet 2: per-assignee split via TaskAssignees.
    ;WITH SprintTasks AS (
        SELECT t.Id, t.StoryPoints
        FROM   dbo.Tasks t
        WHERE  t.DeletedAt IS NULL
          AND  ( (@ListId IS NOT NULL AND t.ListId = @ListId) OR t.SprintId = @SprintId )
    )
    SELECT
        ta.UserId,
        u.Name AS UserName,
        ISNULL(SUM(ISNULL(st.StoryPoints,0)), 0) AS Points
    FROM SprintTasks st
    JOIN dbo.TaskAssignees ta ON ta.TaskId = st.Id
    JOIN dbo.Users u ON u.Id = ta.UserId
    GROUP BY ta.UserId, u.Name
    ORDER BY Points DESC;
END;
GO
```
- [ ] Update `infra/sql/procedures/usp_Report_SprintSummary.sql` to read sprint-List membership (prefer the List, fall back to `SprintId`). Replace the two `LEFT JOIN`/`WHERE` blocks' membership predicate. The new file:
```sql
-- usp_Report_SprintSummary
-- Returns summary stats and status breakdown for a sprint.
-- Phase 8c: membership now reads the sprint's List (Tasks.ListId = Sprints.ListId),
-- falling back to the Tasks.SprintId denorm when the sprint isn't List-bound.
-- ResultSet 1: sprint overview row
-- ResultSet 2: per-status breakdown
CREATE OR ALTER PROCEDURE dbo.usp_Report_SprintSummary
  @SprintId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @ListId UNIQUEIDENTIFIER;
  SELECT @ListId = ListId FROM dbo.Sprints WHERE Id = @SprintId;

  -- ResultSet 1: overview
  SELECT
    s.Id   AS SprintId,
    s.Name AS SprintName,
    CAST(s.StartDate AS DATE)    AS StartDate,
    CAST(s.EndDate   AS DATE)    AS EndDate,
    COUNT(t.Id)                  AS TotalIssues,
    SUM(CASE WHEN t.ResolvedAt IS NOT NULL THEN 1 ELSE 0 END) AS CompletedIssues,
    SUM(CASE WHEN t.ResolvedAt IS NULL     THEN 1 ELSE 0 END) AS IncompleteIssues,
    ISNULL(SUM(ISNULL(t.StoryPoints, 0)), 0) AS TotalPoints,
    ISNULL(SUM(CASE WHEN t.ResolvedAt IS NOT NULL THEN ISNULL(t.StoryPoints, 0) ELSE 0 END), 0) AS CompletedPoints
  FROM dbo.Sprints s
  LEFT JOIN dbo.Tasks t
    ON t.DeletedAt IS NULL
   AND ( (@ListId IS NOT NULL AND t.ListId = @ListId) OR t.SprintId = s.Id )
  WHERE s.Id = @SprintId
  GROUP BY s.Id, s.Name, s.StartDate, s.EndDate;

  -- ResultSet 2: per-status breakdown
  SELECT
    t.Status,
    COUNT(t.Id) AS IssueCount,
    ISNULL(SUM(ISNULL(t.StoryPoints, 0)), 0) AS StoryPoints
  FROM dbo.Tasks t
  WHERE t.DeletedAt IS NULL
    AND ( (@ListId IS NOT NULL AND t.ListId = @ListId) OR t.SprintId = @SprintId )
  GROUP BY t.Status
  ORDER BY COUNT(t.Id) DESC;
END;
GO
```
- [ ] Deploy + re-run — it passes:
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; npx tsx scripts/db-deploy-sps.ts; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-folders.integration.test.ts -t "usp_Sprint_GetPointsRollup"
```
Expected: `1 passed`.
- [ ] Commit: `git add infra/sql/procedures/usp_Sprint_GetPointsRollup.sql infra/sql/procedures/usp_Report_SprintSummary.sql apps/api/src/modules/sprints/__tests__/sprint-folders.integration.test.ts && git commit -m "feat(8c): usp_Sprint_GetPointsRollup (total + per-assignee) + summary reads List membership"`

---

### Task 7: SP `usp_Sprint_ListDueFolders` (sweep feeder) + `usp_Folder_GetWorkspaceId`

**Files:** `infra/sql/procedures/usp_Sprint_ListDueFolders.sql`, `infra/sql/procedures/usp_Folder_GetWorkspaceId.sql`, `apps/api/src/modules/sprints/__tests__/sprint-folders.integration.test.ts`

- [ ] Confirm `usp_Folder_GetWorkspaceId` does not already exist, then append a failing feeder test:
```ts
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

    const wsRow = (await pool.request()
      .input('FolderId', sql.UniqueIdentifier, folderId)
      .execute('usp_Folder_GetWorkspaceId')).recordset[0];
    expect(wsRow.WorkspaceId).toBe(ws.Id);
  });
});
```
- [ ] Run it and watch it fail:
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-folders.integration.test.ts -t "usp_Sprint_ListDueFolders"
```
Expected: failure — `Could not find stored procedure 'usp_Sprint_ListDueFolders'`.
- [ ] Write `infra/sql/procedures/usp_Sprint_ListDueFolders.sql` (one row per sprint folder + settings + its latest non-completed sprint window):
```sql
CREATE OR ALTER PROCEDURE dbo.usp_Sprint_ListDueFolders
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        f.Id            AS FolderId,
        f.WorkspaceId,
        f.SpaceId       AS ProjectId,
        ss.DurationDays,
        ss.StartDayOfWeek,
        ss.AutoStart,
        ss.AutoComplete,
        ss.AutoRollForward,
        ss.PointsFieldId,
        cur.Id          AS CurrentSprintId,
        cur.Status      AS CurrentSprintStatus,
        cur.StartDate   AS CurrentStartDate,
        cur.EndDate     AS CurrentEndDate
    FROM dbo.Folders f
    JOIN dbo.SprintSettings ss ON ss.FolderId = f.Id
    OUTER APPLY (
        SELECT TOP 1 s.Id, s.Status, s.StartDate, s.EndDate
        FROM   dbo.Sprints s
        WHERE  s.FolderId = f.Id AND s.Status <> 'COMPLETED'
        ORDER BY s.EndDate DESC, s.CreatedAt DESC
    ) cur
    WHERE f.IsSprintFolder = 1 AND f.DeletedAt IS NULL;
END;
GO
```
- [ ] Write `infra/sql/procedures/usp_Folder_GetWorkspaceId.sql` (skip if it already exists in the repo):
```sql
CREATE OR ALTER PROCEDURE dbo.usp_Folder_GetWorkspaceId
    @FolderId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 WorkspaceId FROM dbo.Folders WHERE Id = @FolderId AND DeletedAt IS NULL;
END;
GO
```
- [ ] Deploy + re-run — it passes:
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; npx tsx scripts/db-deploy-sps.ts; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-folders.integration.test.ts -t "usp_Sprint_ListDueFolders"
```
Expected: `1 passed`.
- [ ] Commit: `git add infra/sql/procedures/usp_Sprint_ListDueFolders.sql infra/sql/procedures/usp_Folder_GetWorkspaceId.sql apps/api/src/modules/sprints/__tests__/sprint-folders.integration.test.ts && git commit -m "feat(8c): usp_Sprint_ListDueFolders sweep feeder + usp_Folder_GetWorkspaceId resolver"`

---

### Task 8: Pure cadence/roll-forward math (`sprint.cadence.ts`) — unit-test-first

**Files:** `apps/api/src/modules/sprints/sprint.cadence.ts`, `apps/api/src/modules/sprints/__tests__/sprint.cadence.unit.test.ts`

- [ ] Write the failing unit test. Create `apps/api/src/modules/sprints/__tests__/sprint.cadence.unit.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  shouldAutoStart, shouldAutoComplete, nextSprintWindow,
} from '../sprint.cadence.js';

const d = (s: string) => new Date(s);

describe('shouldAutoStart', () => {
  it('starts a PLANNED sprint once its StartDate has arrived', () => {
    expect(shouldAutoStart({ status: 'PLANNED', startDate: d('2026-07-01T00:00:00Z') }, d('2026-07-01T06:00:00Z'))).toBe(true);
  });
  it('does not start before StartDate', () => {
    expect(shouldAutoStart({ status: 'PLANNED', startDate: d('2026-07-02T00:00:00Z') }, d('2026-07-01T00:00:00Z'))).toBe(false);
  });
  it('does not start a non-PLANNED sprint', () => {
    expect(shouldAutoStart({ status: 'ACTIVE', startDate: d('2026-07-01T00:00:00Z') }, d('2026-07-05T00:00:00Z'))).toBe(false);
  });
  it('does not start when StartDate is null', () => {
    expect(shouldAutoStart({ status: 'PLANNED', startDate: null }, d('2026-07-05T00:00:00Z'))).toBe(false);
  });
});

describe('shouldAutoComplete', () => {
  it('completes an ACTIVE sprint once its EndDate has passed', () => {
    expect(shouldAutoComplete({ status: 'ACTIVE', endDate: d('2026-07-15T00:00:00Z') }, d('2026-07-15T01:00:00Z'))).toBe(true);
  });
  it('does not complete before EndDate', () => {
    expect(shouldAutoComplete({ status: 'ACTIVE', endDate: d('2026-07-16T00:00:00Z') }, d('2026-07-15T00:00:00Z'))).toBe(false);
  });
  it('does not complete a non-ACTIVE sprint', () => {
    expect(shouldAutoComplete({ status: 'PLANNED', endDate: d('2026-07-01T00:00:00Z') }, d('2026-07-05T00:00:00Z'))).toBe(false);
  });
});

describe('nextSprintWindow', () => {
  it('anchors the next window to the prior EndDate when StartDayOfWeek is null', () => {
    const w = nextSprintWindow({ priorEndDate: d('2026-07-15T00:00:00Z'), durationDays: 14, startDayOfWeek: null });
    expect(w.start.toISOString()).toBe('2026-07-15T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-07-29T00:00:00.000Z');
  });
  it('snaps the start to the next StartDayOfWeek (1=Mon) after the prior EndDate', () => {
    // Prior end Wed 2026-07-15 → next Monday is 2026-07-20.
    const w = nextSprintWindow({ priorEndDate: d('2026-07-15T00:00:00Z'), durationDays: 7, startDayOfWeek: 1 });
    expect(w.start.getUTCDay()).toBe(1);
    expect(w.start.toISOString()).toBe('2026-07-20T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-07-27T00:00:00.000Z');
  });
  it('seeds from `now` when there is no prior EndDate', () => {
    const w = nextSprintWindow({ priorEndDate: null, durationDays: 10, startDayOfWeek: null, now: d('2026-08-01T00:00:00Z') });
    expect(w.start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-08-11T00:00:00.000Z');
  });
});
```
- [ ] Run it and watch it fail (module missing):
```
npx vitest run --project unit src/modules/sprints/__tests__/sprint.cadence.unit.test.ts
```
Expected: failure — `Cannot find module '../sprint.cadence.js'`.
- [ ] Write `apps/api/src/modules/sprints/sprint.cadence.ts` (pure, UTC, no I/O — mirrors `recurrence.ts` style):
```ts
/**
 * Pure sprint cadence + auto-state math for Phase 8c. No I/O — unit-tested.
 * All date math is UTC so it matches SQL DATETIME2/DATE round-trips.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole-day UTC add. */
function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY);
}

/** True when a PLANNED sprint's StartDate has arrived (at or before `now`). */
export function shouldAutoStart(
  sprint: { status: string; startDate: Date | null },
  now: Date,
): boolean {
  if (sprint.status !== 'PLANNED') return false;
  if (!sprint.startDate) return false;
  return sprint.startDate.getTime() <= now.getTime();
}

/** True when an ACTIVE sprint's EndDate has passed (strictly before `now`). */
export function shouldAutoComplete(
  sprint: { status: string; endDate: Date | null },
  now: Date,
): boolean {
  if (sprint.status !== 'ACTIVE') return false;
  if (!sprint.endDate) return false;
  return sprint.endDate.getTime() < now.getTime();
}

export interface SprintWindow { start: Date; end: Date; }

/**
 * Compute the next sprint's [start, end) window.
 *   - start = the prior sprint's EndDate (back-to-back) unless StartDayOfWeek is
 *     set, in which case start snaps forward to the next matching weekday
 *     (0=Sun..6=Sat) AT OR AFTER the anchor. When there is no prior EndDate,
 *     the anchor is `now`.
 *   - end   = start + durationDays.
 */
export function nextSprintWindow(p: {
  priorEndDate: Date | null;
  durationDays: number;
  startDayOfWeek: number | null;
  now?: Date;
}): SprintWindow {
  const duration = p.durationDays > 0 ? p.durationDays : 14;
  const anchor = p.priorEndDate ?? p.now ?? new Date();
  let start = new Date(Date.UTC(
    anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate(),
    anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds(),
  ));

  if (p.startDayOfWeek != null) {
    // Snap forward to the next matching weekday at or after the anchor.
    let guard = 0;
    while (start.getUTCDay() !== p.startDayOfWeek && guard < 7) {
      start = addDays(start, 1);
      guard++;
    }
  }

  return { start, end: addDays(start, duration) };
}

/** Select only unfinished task ids from a candidate set (status/resolved aware). */
export function selectRollForwardTasks(
  tasks: Array<{ id: string; status: string; resolvedAt: Date | null }>,
): string[] {
  const DONE = new Set(['Done', 'DONE']);
  return tasks
    .filter((t) => t.resolvedAt == null && !DONE.has(t.status))
    .map((t) => t.id);
}
```
- [ ] Run it again — it passes:
```
npx vitest run --project unit src/modules/sprints/__tests__/sprint.cadence.unit.test.ts
```
Expected: `10 passed` (the four `shouldAutoStart`, three `shouldAutoComplete`, three `nextSprintWindow`).
- [ ] Commit: `git add apps/api/src/modules/sprints/sprint.cadence.ts apps/api/src/modules/sprints/__tests__/sprint.cadence.unit.test.ts && git commit -m "feat(8c): pure sprint cadence/auto-state math (shouldAutoStart/Complete, nextSprintWindow, selectRollForwardTasks)"`

---

### Task 9: Repository — settings/folder/create-in-folder/roll-forward/points/sweep-feeder

**Files:** `apps/api/src/modules/sprints/sprint.repository.ts`, `apps/api/src/modules/sprints/__tests__/sprint-folders.integration.test.ts`

- [ ] Append a failing repository test (exercises the new repo methods end-to-end against the deployed SPs):
```ts
import { SprintRepository } from '../sprint.repository.js';

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
  });
});
```
- [ ] Run it and watch it fail (methods don't exist → TypeScript/runtime error):
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-folders.integration.test.ts -t "SprintRepository — folder"
```
Expected: failure — `repo.setSprintSettings is not a function`.
- [ ] Extend `apps/api/src/modules/sprints/sprint.repository.ts` by adding these methods to the `SprintRepository` class (use `execSp` for multi-resultset SPs; keep the existing `execSpOne` imports — add `execSp`):
```ts
import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';

  async getSprintSettings(folderId: string) {
    const rows = await execSpOne('usp_Folder_GetSprintSettings', [
      { name: 'FolderId', type: sql.UniqueIdentifier, value: folderId },
    ]);
    return rows[0] ?? null;
  }

  async setSprintSettings(folderId: string, s: {
    durationDays: number; startDayOfWeek: number | null;
    autoStart: boolean; autoComplete: boolean; autoRollForward: boolean;
    pointsFieldId: string | null;
  }) {
    const rows = await execSpOne('usp_Folder_SetSprintSettings', [
      { name: 'FolderId',        type: sql.UniqueIdentifier, value: folderId },
      { name: 'DurationDays',    type: sql.Int,              value: s.durationDays },
      { name: 'StartDayOfWeek',  type: sql.TinyInt,          value: s.startDayOfWeek },
      { name: 'AutoStart',       type: sql.Bit,              value: s.autoStart ? 1 : 0 },
      { name: 'AutoComplete',    type: sql.Bit,              value: s.autoComplete ? 1 : 0 },
      { name: 'AutoRollForward', type: sql.Bit,              value: s.autoRollForward ? 1 : 0 },
      { name: 'PointsFieldId',   type: sql.UniqueIdentifier, value: s.pointsFieldId },
    ]);
    return rows[0];
  }

  async createInFolder(folderId: string, name: string, goal: string | null, startDate: Date | null, endDate: Date | null) {
    const rows = await execSpOne('usp_Sprint_CreateInFolder', [
      { name: 'FolderId',  type: sql.UniqueIdentifier,  value: folderId },
      { name: 'Name',      type: sql.NVarChar(255),     value: name },
      { name: 'Goal',      type: sql.NVarChar(sql.MAX), value: goal ?? null },
      { name: 'StartDate', type: sql.DateTime2,         value: startDate ?? null },
      { name: 'EndDate',   type: sql.DateTime2,         value: endDate ?? null },
    ]);
    return rows[0];
  }

  async rollForward(fromSprintId: string, toSprintId: string): Promise<number> {
    const rows = await execSpOne<{ Rolled: number }>('usp_Sprint_RollForward', [
      { name: 'FromSprintId', type: sql.UniqueIdentifier, value: fromSprintId },
      { name: 'ToSprintId',   type: sql.UniqueIdentifier, value: toSprintId },
    ]);
    return rows[0]?.Rolled ?? 0;
  }

  async getPointsRollup(sprintId: string): Promise<{ total: any; perAssignee: any[] }> {
    const sets = await execSp('usp_Sprint_GetPointsRollup', [
      { name: 'SprintId', type: sql.UniqueIdentifier, value: sprintId },
    ]);
    return { total: (sets[0]?.[0] as any) ?? { TotalPoints: 0, CompletedPoints: 0 }, perAssignee: (sets[1] as any[]) ?? [] };
  }

  async listDueFolders(): Promise<any[]> {
    const rows = await execSpOne('usp_Sprint_ListDueFolders', []);
    return rows as any[];
  }

  async getFolderWorkspaceId(folderId: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_Folder_GetWorkspaceId', [
      { name: 'FolderId', type: sql.UniqueIdentifier, value: folderId },
    ]);
    return rows[0]?.WorkspaceId ?? null;
  }
```
- [ ] Run it again — it passes:
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-folders.integration.test.ts -t "SprintRepository — folder"
```
Expected: `1 passed`.
- [ ] Commit: `git add apps/api/src/modules/sprints/sprint.repository.ts apps/api/src/modules/sprints/__tests__/sprint-folders.integration.test.ts && git commit -m "feat(8c): SprintRepository settings/createInFolder/rollForward/points/sweep-feeder methods"`

---

### Task 10: Service — folder settings, List-bound create/start/complete, points, roll-forward (keep hooks)

**Files:** `apps/api/src/modules/sprints/sprint.service.ts`, `apps/api/src/modules/sprints/__tests__/sprint-folders.integration.test.ts`

- [ ] Append a failing service test (exercises the shared service the REST + GraphQL surfaces will delegate to):
```ts
import { sprintService } from '../sprint.service.js';

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
      VALUES (@id, '${space.Id}', '${ws.Id}', 'SV-1', 'T', 'To Do', '${owner.id}', '${s1.Id}', '${s1.ListId}');`);

    await sprintService.start(s1.Id);
    await sprintService.complete(s1.Id);
    const rolled = await sprintService.rollForward(s1.Id, s2.Id);
    expect(rolled).toBe(1);

    const points = await sprintService.getPoints(s2.Id);
    expect(points.total.TotalPoints).toBe(0);
  });
});
```
- [ ] Run it and watch it fail (`sprintService.setSettings is not a function`):
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-folders.integration.test.ts -t "sprintService — sprint-folder ops"
```
Expected: failure — `sprintService.setSettings is not a function`.
- [ ] Extend `apps/api/src/modules/sprints/sprint.service.ts` (keep the existing `create`/`list`/`start`/`complete` exactly; add the new methods). Replace the file body's exported object with:
```ts
import { SprintRepository } from './sprint.repository.js';
import { webhookOutgoingService } from '../webhooks/webhook-outgoing.service.js';

const repo = new SprintRepository();

export const sprintService = {
  // ── Legacy flat surface (unchanged) ───────────────────────────────────────
  create:   (projectId: string, name: string, goal: string | null, startDate: Date | null, endDate: Date | null) =>
              repo.create(projectId, name, goal, startDate, endDate),
  list:     (projectId: string) => repo.list(projectId),

  start: async (id: string) => {
    const sprint = await repo.start(id);
    if (sprint) {
      webhookOutgoingService.dispatch(
        (sprint as any).WorkspaceId ?? '', 'sprint.started',
        { id: (sprint as any).Id, name: (sprint as any).Name, projectId: (sprint as any).ProjectId },
      ).catch(() => {});
    }
    return sprint;
  },

  complete: async (id: string) => {
    const sprint = await repo.complete(id);
    if (sprint) {
      webhookOutgoingService.dispatch(
        (sprint as any).WorkspaceId ?? '', 'sprint.completed',
        { id: (sprint as any).Id, name: (sprint as any).Name, projectId: (sprint as any).ProjectId },
      ).catch(() => {});
    }
    return sprint;
  },

  // ── Sprint-folder hierarchy (Phase 8c) ────────────────────────────────────
  getSettings: (folderId: string) => repo.getSprintSettings(folderId),

  setSettings: (folderId: string, s: {
    durationDays: number; startDayOfWeek: number | null;
    autoStart: boolean; autoComplete: boolean; autoRollForward: boolean;
    pointsFieldId: string | null;
  }) => repo.setSprintSettings(folderId, s),

  createInFolder: (folderId: string, name: string, goal: string | null, startDate: Date | null, endDate: Date | null) =>
    repo.createInFolder(folderId, name, goal, startDate, endDate),

  rollForward: (fromSprintId: string, toSprintId: string) => repo.rollForward(fromSprintId, toSprintId),

  getPoints: (sprintId: string) => repo.getPointsRollup(sprintId),
};
```
- [ ] Run it again — it passes:
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-folders.integration.test.ts -t "sprintService — sprint-folder ops"
```
Expected: `1 passed`.
- [ ] Commit: `git add apps/api/src/modules/sprints/sprint.service.ts apps/api/src/modules/sprints/__tests__/sprint-folders.integration.test.ts && git commit -m "feat(8c): sprintService folder settings + List-bound create + points + rollForward (hooks retained)"`

---

### Task 11: Scheduler worker (`sprint.worker.ts`) + `runSprintSweep` helper

**Files:** `apps/api/src/modules/sprints/sprint.worker.ts`, `apps/api/src/modules/sprints/__tests__/sprint-sweep.integration.test.ts`

- [ ] Write the failing sweep integration test. Create `apps/api/src/modules/sprints/__tests__/sprint-sweep.integration.test.ts`:
```ts
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
      VALUES (@id, '${space.Id}', '${ws.Id}', 'SW-1', 'Open', 'In Progress', '${owner.id}', '${s1.Id}', '${s1.ListId}');
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
```
- [ ] Run it and watch it fail (module missing):
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-sweep.integration.test.ts
```
Expected: failure — `Cannot find module '../sprint.worker.js'`.
- [ ] Write `apps/api/src/modules/sprints/sprint.worker.ts` (copied structure from `recurrence.worker.ts`: idempotent `startSprintWorker()`, Redis-gated connection, fixed interval, pure `runSprintSweep(now?)`):
```ts
/**
 * BullMQ wiring for the sprint scheduled sweep (Phase 8c).
 *
 * A single JobScheduler-driven repeatable job (`sprint-sweep`) ticks every
 * 15 min. The Worker calls usp_Sprint_ListDueFolders and, per sprint folder:
 *   - auto-STARTS the current PLANNED sprint once its StartDate arrived,
 *   - auto-COMPLETES the current ACTIVE sprint once its EndDate passed (fires the
 *     existing sprint.completed hook via sprintService.complete),
 *   - creates the NEXT sprint List per the folder cadence, and rolls unfinished
 *     tasks from the just-completed sprint into it.
 *
 * Mirrors recurrence.worker.ts exactly: connection, removeOnComplete/Fail,
 * upsertJobScheduler (idempotent across restarts), registerCloser. The work lives
 * in runSprintSweep so unit/integration tests can drive it without Redis.
 */

import { Queue, Worker } from 'bullmq';
import { sprintService } from './sprint.service.js';
import { SprintRepository } from './sprint.repository.js';
import { shouldAutoStart, shouldAutoComplete, nextSprintWindow } from './sprint.cadence.js';
import { subLogger } from '../../shared/lib/logger.js';
import { registerCloser } from '../../shared/lib/shutdown.js';

const log = subLogger('sprint-sweep');
const QUEUE_NAME = 'sprint-sweep';

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

type JobName = 'sprint-sweep';
interface JobData { /* No payload — the sweep reads fresh due folders each run. */ }

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const repo = new SprintRepository();

let started = false;

function asDate(v: unknown): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v as any);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Run one sweep. Exported for tests / manual runs. Per-folder errors are logged
 * and skipped so one bad folder doesn't stall the rest of the batch.
 */
export async function runSprintSweep(now: Date = new Date()): Promise<{ scanned: number; started: number; completed: number; created: number }> {
  const folders = await repo.listDueFolders();
  let startedCount = 0, completedCount = 0, createdCount = 0;

  for (const f of folders) {
    try {
      const sprintId = f.CurrentSprintId as string | null;
      if (!sprintId) continue;

      const sprint = {
        status:    String(f.CurrentSprintStatus ?? ''),
        startDate: asDate(f.CurrentStartDate),
        endDate:   asDate(f.CurrentEndDate),
      };

      // Auto-start.
      if (f.AutoStart && shouldAutoStart(sprint, now)) {
        await sprintService.start(sprintId);
        startedCount++;
        continue; // started this tick; complete on a later sweep
      }

      // Auto-complete + create next + roll-forward.
      if (f.AutoComplete && shouldAutoComplete(sprint, now)) {
        await sprintService.complete(sprintId);
        completedCount++;

        const win = nextSprintWindow({
          priorEndDate: sprint.endDate,
          durationDays: Number(f.DurationDays ?? 14),
          startDayOfWeek: f.StartDayOfWeek == null ? null : Number(f.StartDayOfWeek),
          now,
        });
        const next: any = await sprintService.createInFolder(
          f.FolderId, `Sprint ${win.start.toISOString().slice(0, 10)}`, null, win.start, win.end,
        );
        createdCount++;

        if (f.AutoRollForward && next?.Id) {
          await sprintService.rollForward(sprintId, next.Id);
        }
      }
    } catch (err: any) {
      log.error({ err: err?.message, folderId: f.FolderId }, 'sweep folder failed');
    }
  }

  return { scanned: folders.length, started: startedCount, completed: completedCount, created: createdCount };
}

export async function startSprintWorker(): Promise<{ queue: Queue<JobData>; worker: Worker<JobData> } | null> {
  if (started) throw new Error('startSprintWorker called twice');
  started = true;

  const queue = new Queue<JobData>(QUEUE_NAME, {
    connection,
    defaultJobOptions: { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } },
  });

  await queue.upsertJobScheduler(
    'sprint-sweep-every-15m',
    { every: SWEEP_INTERVAL_MS },
    { name: 'sprint-sweep' },
  );

  const worker = new Worker<JobData>(
    QUEUE_NAME,
    async (job) => {
      const name = job.name as JobName;
      if (name === 'sprint-sweep') {
        const result = await runSprintSweep();
        if (result.completed > 0 || result.started > 0) log.info(result, 'sprint sweep');
        return result;
      }
      throw new Error(`unknown sprint job: ${name}`);
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => log.error({ jobName: job?.name, jobId: job?.id, err: err?.message }, 'job failed'));
  worker.on('error', (err) => log.error({ err: err?.message }, 'worker error'));

  registerCloser('sprint-sweep-worker', () => worker.close());
  registerCloser('sprint-sweep-queue',  () => queue.close());
  log.info({ sweepEveryMs: SWEEP_INTERVAL_MS }, 'worker started');
  return { queue, worker };
}
```
- [ ] Run the sweep test again — it passes:
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-sweep.integration.test.ts
```
Expected: `1 passed`.
- [ ] Commit: `git add apps/api/src/modules/sprints/sprint.worker.ts apps/api/src/modules/sprints/__tests__/sprint-sweep.integration.test.ts && git commit -m "feat(8c): sprint.worker scheduler (auto-start/complete/create-next/roll-forward) + runSprintSweep helper"`

---

### Task 12: Register the worker in `server.ts`

**Files:** `apps/api/src/server.ts`

- [ ] Verify the worker is not yet imported (it isn't). Add the import next to the recurrence worker import:
```ts
import { startRecurrenceWorker } from './modules/recurrence/recurrence.worker.js';
import { startSprintWorker } from './modules/sprints/sprint.worker.js';
```
- [ ] Register it inside the Redis-gated block, immediately after the recurrence worker start (mirroring the existing pattern):
```ts
  if (process.env.REDIS_URL || process.env.REDIS_HOST) {
    startRecurrenceWorker().catch((err) =>
      logger.warn({ err: err?.message }, 'recurrence worker failed to start'),
    );

    // Start the sprint scheduled sweep (Phase 8c). Conditional on Redis — the
    // BullMQ queue/worker need it. Manual sprint start/complete works without it.
    startSprintWorker().catch((err) =>
      logger.warn({ err: err?.message }, 'sprint worker failed to start'),
    );
  }
```
- [ ] Build the API to confirm the import + registration typecheck:
```
npm run build --workspace apps/api
```
Expected: `tsc` exits 0 (no errors).
- [ ] Commit: `git add apps/api/src/server.ts && git commit -m "feat(8c): register startSprintWorker in server.ts (Redis-gated, alongside recurrence/oauth)"`

---

### Task 13: REST routes — folder settings, create-in-folder, roll-forward, points

**Files:** `apps/api/src/modules/sprints/sprint.routes.ts`, `apps/api/src/modules/sprints/__tests__/sprint-folders.integration.test.ts`

- [ ] Append a failing REST integration test (uses the shared `request`/`json` harness):
```ts
import { request, json } from '../../../__tests__/setup/testServer.js';
import { grantSuperAdmin } from '../../../__tests__/fixtures/factories.js';

describe('sprint REST — folder surface', () => {
  it('PUT settings, POST create-in-folder, GET points, POST roll-forward', async () => {
    await truncateAll();
    const owner = await createTestUser({ email: `rest-${Date.now()}@projectflow.test` });
    await grantSuperAdmin(owner.id); // ensure sprint.manage permission for the test actor
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
  });
});
```
- [ ] Run it and watch it fail (routes 404):
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-folders.integration.test.ts -t "sprint REST — folder surface"
```
Expected: failure — settings request returns 404, not 200.
- [ ] Extend `apps/api/src/modules/sprints/sprint.routes.ts` (append after the existing routes; reuse `requirePermission` + a folder workspace resolver). Add:
```ts
const resolveFolderWorkspace = (c: any) => sprintRepoForLookup.getFolderWorkspaceId(c.req.param('folderId'));

// PUT /api/v1/sprints/folders/:folderId/settings
sprintRoutes.put(
  '/folders/:folderId/settings',
  requirePermission('sprint.manage', { resolveWorkspace: resolveFolderWorkspace }),
  async (c) => {
    const folderId = c.req.param('folderId')!;
    const b = await c.req.json();
    if (typeof b?.durationDays !== 'number' || b.durationDays <= 0)
      return c.json({ error: { message: 'durationDays must be a positive integer' } }, 400);
    const settings = await sprintService.setSettings(folderId, {
      durationDays:    b.durationDays,
      startDayOfWeek:  b.startDayOfWeek ?? null,
      autoStart:       !!b.autoStart,
      autoComplete:    !!b.autoComplete,
      autoRollForward: !!b.autoRollForward,
      pointsFieldId:   b.pointsFieldId ?? null,
    });
    return c.json({ data: settings });
  },
);

// GET /api/v1/sprints/folders/:folderId/settings
sprintRoutes.get(
  '/folders/:folderId/settings',
  requirePermission('sprint.manage', { resolveWorkspace: resolveFolderWorkspace }),
  async (c) => c.json({ data: await sprintService.getSettings(c.req.param('folderId')!) }),
);

// POST /api/v1/sprints/folders/:folderId/sprints
sprintRoutes.post(
  '/folders/:folderId/sprints',
  requirePermission('sprint.create', { resolveWorkspace: resolveFolderWorkspace }),
  async (c) => {
    const folderId = c.req.param('folderId')!;
    const { name, goal, startDate, endDate } = await c.req.json();
    if (!name) return c.json({ error: { message: 'name is required' } }, 400);
    const sprint = await sprintService.createInFolder(
      folderId, name, goal ?? null,
      startDate ? new Date(startDate) : null,
      endDate ? new Date(endDate) : null,
    );
    return c.json({ data: sprint }, 201);
  },
);

// GET /api/v1/sprints/:id/points
sprintRoutes.get(
  '/:id/points',
  requirePermission('sprint.start', { resolveWorkspace: resolveSprintWorkspace }),
  async (c) => c.json({ data: await sprintService.getPoints(c.req.param('id')!) }),
);

// POST /api/v1/sprints/:id/roll-forward
sprintRoutes.post(
  '/:id/roll-forward',
  requirePermission('sprint.manage', { resolveWorkspace: resolveSprintWorkspace }),
  async (c) => {
    const { toSprintId } = await c.req.json();
    if (!toSprintId) return c.json({ error: { message: 'toSprintId is required' } }, 400);
    const rolled = await sprintService.rollForward(c.req.param('id')!, toSprintId);
    return c.json({ data: { rolled } });
  },
);
```
- [ ] Run it again — it passes:
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/modules/sprints/__tests__/sprint-folders.integration.test.ts -t "sprint REST — folder surface"
```
Expected: `1 passed`. (If `sprint.manage` is not a seeded permission key, the `grantSuperAdmin` fixture bypasses the gate; record the new permission key in `DECISIONS.md` for the RBAC seed follow-up.)
- [ ] Commit: `git add apps/api/src/modules/sprints/sprint.routes.ts apps/api/src/modules/sprints/__tests__/sprint-folders.integration.test.ts && git commit -m "feat(8c): REST sprint-folder settings/create/points/roll-forward (requirePermission gated)"`

---

### Task 14: GraphQL mirror — extend `SprintType`; add settings query + folder/roll-forward mutations

**Files:** `apps/api/src/graphql/schema.ts`, `apps/api/src/graphql/__tests__/sprint-graphql.integration.test.ts`

- [ ] Write a failing GraphQL integration test. Create `apps/api/src/graphql/__tests__/sprint-graphql.integration.test.ts`:
```ts
/**
 * Phase 8c — GraphQL sprint-folder mirror. DB SAFETY: local Docker ProjectFlow_Test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { truncateAll } from '../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../__tests__/fixtures/factories.js';
import { getPool, closePool } from '../../shared/lib/db.js';
import { request } from '../../__tests__/setup/testServer.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function gql(query: string, variables: any, token: string) {
  const res = await request('/graphql', { method: 'POST', token, json: { query, variables } });
  return (await res.json()) as any;
}

describe('GraphQL sprint-folder mirror', () => {
  it('createSprintInFolder returns listId/folderId and points resolves', async () => {
    const owner = await createTestUser({ email: `gql-${Date.now()}@projectflow.test` });
    const token = owner.accessToken;
    const ws = await createTestWorkspace(token);
    const space = await createTestProject(ws.Id, token, { name: 'Gql Space', key: `GQ${Date.now() % 100000}` });
    const pool = await getPool();
    const folderId = (await pool.request().query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Folders (Id, WorkspaceId, SpaceId, Name, Position, Path, IsSprintFolder)
      VALUES (@id, '${ws.Id}', '${space.Id}', 'Sprints', 0, '/${space.Id}/f/', 1);
      INSERT INTO dbo.SprintSettings (FolderId, DurationDays, AutoStart, AutoComplete, AutoRollForward)
      VALUES (@id, 14, 0, 0, 0);
      SELECT @id AS Id;`)).recordset[0].Id;

    const r = await gql(
      `mutation ($f: String!, $n: String!) { createSprintInFolder(folderId: $f, name: $n) { id listId folderId status } }`,
      { f: folderId, n: 'S1' }, token,
    );
    expect(r.errors).toBeUndefined();
    expect(r.data.createSprintInFolder.listId).toBeTruthy();
    expect(r.data.createSprintInFolder.folderId).toBe(folderId);
  });
});
```
- [ ] Run it and watch it fail (`createSprintInFolder` not in schema):
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/graphql/__tests__/sprint-graphql.integration.test.ts
```
Expected: failure — GraphQL response carries `errors` (Cannot query field `createSprintInFolder`).
- [ ] Extend `SprintType` in `apps/api/src/graphql/schema.ts` with the new fields (add to the existing `fields:` block, reading both casings since service rows are PascalCase SP rows):
```ts
    listId:    t.string({ nullable: true, resolve: (s: any) => s.listId ?? s.ListId ?? null }),
    folderId:  t.string({ nullable: true, resolve: (s: any) => s.folderId ?? s.FolderId ?? null }),
    points:    t.field({
      type: 'Float', nullable: true,
      resolve: async (s: any) => {
        const id = s.id ?? s.Id; if (!id) return null;
        const r = await sprintService.getPoints(id);
        return Number(r.total?.TotalPoints ?? 0);
      },
    }),
```
Also update `SprintShape` (the `objectRef` shape interface near line 95) to add `listId?: string | null; folderId?: string | null;`.
- [ ] Add the mutations to the Mutation builder block in `schema.ts` (next to the existing task/sprint resolvers; all gated by `requireAuth`):
```ts
    createSprintInFolder: t.field({
      type: SprintType,
      args: {
        folderId:  t.arg.string({ required: true }),
        name:      t.arg.string({ required: true }),
        goal:      t.arg.string({ required: false }),
        startDate: t.arg.field({ type: 'Date', required: false }),
        endDate:   t.arg.field({ type: 'Date', required: false }),
      },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        return (await sprintService.createInFolder(
          a.folderId, a.name, a.goal ?? null,
          a.startDate ? new Date(a.startDate as any) : null,
          a.endDate ? new Date(a.endDate as any) : null,
        )) as unknown as SprintShape;
      },
    }),

    rollForwardSprint: t.field({
      type: 'Int',
      args: { fromSprintId: t.arg.string({ required: true }), toSprintId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        return await sprintService.rollForward(a.fromSprintId, a.toSprintId);
      },
    }),
```
- [ ] Run it again — it passes:
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; $env:REDIS_HOST='localhost'; npx vitest run --project integration src/graphql/__tests__/sprint-graphql.integration.test.ts
```
Expected: `1 passed`.
- [ ] Commit: `git add apps/api/src/graphql/schema.ts apps/api/src/graphql/__tests__/sprint-graphql.integration.test.ts && git commit -m "feat(8c): GraphQL mirror — SprintType listId/folderId/points + createSprintInFolder/rollForwardSprint"`

---

### Task 15: Shared types — `Sprint`, `SprintSettings`, `SprintPointsRollup`

**Files:** `packages/types/index.ts`

- [ ] Add the interfaces to `packages/types/index.ts` directly after the `SprintSummaryReport` interface (around line 359). No test runs in this package; consumers (web/api) are typechecked by their builds in later tasks. Add:
```ts
export interface Sprint {
  id: string;
  projectId: string;
  listId: string | null;
  folderId: string | null;
  name: string;
  goal: string | null;
  status: 'PLANNED' | 'ACTIVE' | 'COMPLETED';
  startDate: string | null;
  endDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SprintSettings {
  folderId: string;
  durationDays: number;
  startDayOfWeek: number | null;   // 0=Sun..6=Sat; null = anchor to prior EndDate
  autoStart: boolean;
  autoComplete: boolean;
  autoRollForward: boolean;
  pointsFieldId: string | null;
  isSprintFolder?: boolean;        // surfaced by usp_Folder_GetSprintSettings
}

export interface SprintAssigneePoints {
  userId: string;
  userName: string | null;
  points: number;
}

export interface SprintPointsRollup {
  total: { totalPoints: number; completedPoints: number };
  perAssignee: SprintAssigneePoints[];
}
```
- [ ] Build the API to confirm the shared types compile and are consumable:
```
npm run build --workspace apps/api
```
Expected: `tsc` exits 0.
- [ ] Commit: `git add packages/types/index.ts && git commit -m "feat(8c): @projectflow/types Sprint/SprintSettings/SprintPointsRollup"`

---

### Task 16: Frontend — sprint setup UI + sprint list with per-assignee points + i18n

**Files:** `apps/next-web/src/components/sprints/SprintSetup.tsx`, `apps/next-web/src/components/sprints/SprintList.tsx`, `apps/next-web/src/components/sprints/SprintSetup.test.tsx`, `apps/next-web/messages/en.json`, `apps/next-web/messages/id.json`

- [ ] Read the in-repo Next.js docs before writing web code, per `apps/next-web/AGENTS.md`:
```
Get-ChildItem apps/next-web/node_modules/next/dist/docs/ -Recurse -Filter *.md | Select-Object -First 40 FullName
```
- [ ] Write the failing component test. Create `apps/next-web/src/components/sprints/SprintSetup.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../messages/en.json';
import { SprintSetup } from './SprintSetup';

function renderWithIntl(ui: React.ReactNode) {
  return render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);
}

describe('SprintSetup', () => {
  it('renders the cadence + auto-state controls', () => {
    renderWithIntl(
      <SprintSetup
        folderId="f1"
        settings={{ folderId: 'f1', durationDays: 14, startDayOfWeek: null, autoStart: false, autoComplete: false, autoRollForward: false, pointsFieldId: null }}
        onSave={() => {}}
      />,
    );
    expect(screen.getByText(en.Sprints.durationDays)).toBeInTheDocument();
    expect(screen.getByText(en.Sprints.autoComplete)).toBeInTheDocument();
  });
});
```
- [ ] Run it and watch it fail (component missing):
```
npx vitest run --project unit --root apps/next-web src/components/sprints/SprintSetup.test.tsx
```
Expected: failure — `Failed to resolve import "./SprintSetup"`.
- [ ] Add the `Sprints` namespace to `apps/next-web/messages/en.json` (insert as a new top-level key):
```json
  "Sprints": {
    "title": "Sprints",
    "setupTitle": "Sprint folder settings",
    "markAsSprintFolder": "Make this a sprint folder",
    "durationDays": "Sprint length (days)",
    "startDayOfWeek": "Start day of week",
    "autoStart": "Auto-start at start date",
    "autoComplete": "Auto-complete at end date",
    "autoRollForward": "Roll unfinished tasks to next sprint",
    "pointsField": "Story points field",
    "save": "Save settings",
    "addSprint": "Add sprint",
    "status": "Status",
    "startDate": "Start date",
    "endDate": "End date",
    "points": "Points",
    "pointsByAssignee": "Points by assignee",
    "noSprints": "No sprints yet",
    "statusPlanned": "Planned",
    "statusActive": "Active",
    "statusCompleted": "Completed"
  },
```
- [ ] Add the parity-matching `Sprints` namespace to `apps/next-web/messages/id.json` (real Indonesian, identical key set):
```json
  "Sprints": {
    "title": "Sprint",
    "setupTitle": "Pengaturan folder sprint",
    "markAsSprintFolder": "Jadikan ini folder sprint",
    "durationDays": "Durasi sprint (hari)",
    "startDayOfWeek": "Hari mulai dalam minggu",
    "autoStart": "Mulai otomatis pada tanggal mulai",
    "autoComplete": "Selesai otomatis pada tanggal akhir",
    "autoRollForward": "Pindahkan tugas yang belum selesai ke sprint berikutnya",
    "pointsField": "Bidang story point",
    "save": "Simpan pengaturan",
    "addSprint": "Tambah sprint",
    "status": "Status",
    "startDate": "Tanggal mulai",
    "endDate": "Tanggal akhir",
    "points": "Poin",
    "pointsByAssignee": "Poin per penerima tugas",
    "noSprints": "Belum ada sprint",
    "statusPlanned": "Direncanakan",
    "statusActive": "Aktif",
    "statusCompleted": "Selesai"
  },
```
- [ ] Write `apps/next-web/src/components/sprints/SprintSetup.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { SprintSettings } from '@projectflow/types';

interface Props {
  folderId: string;
  settings: SprintSettings;
  onSave: (next: SprintSettings) => void;
}

export function SprintSetup({ folderId, settings, onSave }: Props) {
  const t = useTranslations('Sprints');
  const [s, setS] = useState<SprintSettings>(settings);

  const upd = (patch: Partial<SprintSettings>) => setS((prev) => ({ ...prev, ...patch }));

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave({ ...s, folderId }); }}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <h3>{t('setupTitle')}</h3>

      <label>
        <span>{t('durationDays')}</span>
        <input
          type="number" min={1} value={s.durationDays}
          onChange={(e) => upd({ durationDays: Math.max(1, Number(e.target.value)) })}
        />
      </label>

      <label>
        <span>{t('startDayOfWeek')}</span>
        <select
          value={s.startDayOfWeek ?? ''}
          onChange={(e) => upd({ startDayOfWeek: e.target.value === '' ? null : Number(e.target.value) })}
        >
          <option value="">—</option>
          {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </label>

      <label>
        <input type="checkbox" checked={s.autoStart} onChange={(e) => upd({ autoStart: e.target.checked })} />
        <span>{t('autoStart')}</span>
      </label>
      <label>
        <input type="checkbox" checked={s.autoComplete} onChange={(e) => upd({ autoComplete: e.target.checked })} />
        <span>{t('autoComplete')}</span>
      </label>
      <label>
        <input type="checkbox" checked={s.autoRollForward} onChange={(e) => upd({ autoRollForward: e.target.checked })} />
        <span>{t('autoRollForward')}</span>
      </label>

      <button type="submit">{t('save')}</button>
    </form>
  );
}
```
- [ ] Write `apps/next-web/src/components/sprints/SprintList.tsx` (sprint rows + per-assignee points):
```tsx
'use client';

import { useTranslations } from 'next-intl';
import type { Sprint, SprintPointsRollup } from '@projectflow/types';

interface Props {
  sprints: Array<Sprint & { rollup?: SprintPointsRollup }>;
}

export function SprintList({ sprints }: Props) {
  const t = useTranslations('Sprints');
  if (sprints.length === 0) return <p>{t('noSprints')}</p>;

  const statusLabel = (status: Sprint['status']) =>
    status === 'ACTIVE' ? t('statusActive')
    : status === 'COMPLETED' ? t('statusCompleted')
    : t('statusPlanned');

  return (
    <ul style={{ display: 'flex', flexDirection: 'column', gap: 10, listStyle: 'none', padding: 0 }}>
      {sprints.map((s) => (
        <li key={s.id} style={{ border: '1px solid var(--color-border,#2d3250)', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>{s.name}</strong>
            <span>{statusLabel(s.status)}</span>
          </div>
          <div style={{ fontSize: 12, color: '#8892b0' }}>
            {t('startDate')}: {s.startDate ?? '—'} · {t('endDate')}: {s.endDate ?? '—'}
          </div>
          <div style={{ fontSize: 13 }}>
            {t('points')}: {s.rollup?.total.totalPoints ?? 0}
          </div>
          {s.rollup?.perAssignee?.length ? (
            <div style={{ fontSize: 12, marginTop: 4 }}>
              <div style={{ color: '#8892b0' }}>{t('pointsByAssignee')}</div>
              {s.rollup.perAssignee.map((a) => (
                <div key={a.userId}>{a.userName ?? a.userId}: {a.points}</div>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
```
- [ ] Run the component test + i18n parity test — both pass:
```
npx vitest run --project unit --root apps/next-web src/components/sprints/SprintSetup.test.tsx src/i18n/__tests__/messages.unit.test.ts
```
Expected: both files pass (`SprintSetup` 1 passed; message catalogs 2 passed).
- [ ] Build the web app to confirm SSR typecheck/compile:
```
npm run build --workspace apps/next-web
```
Expected: `next build` completes with no type errors.
- [ ] Commit: `git add apps/next-web/src/components/sprints/ apps/next-web/messages/en.json apps/next-web/messages/id.json && git commit -m "feat(8c): sprint setup UI + sprint list with per-assignee points + i18n (en/id parity)"`

---

### Task 17: e2e — set up a sprint folder, run the sweep, observe auto-complete + roll-forward + points

**Files:** `e2e/sprint-agile.spec.ts`

- [ ] Read an existing e2e spec for the harness's auth/setup helpers before writing:
```
Get-ChildItem e2e -Filter *.spec.ts | Select-Object FullName
```
- [ ] Write the e2e spec. Create `e2e/sprint-agile.spec.ts` (drives the REST surface + the sweep helper exposed via a test-only API call path; mirrors the recurrence e2e flow of seed → act → assert). Use the same login/seed helpers the other specs use (import from `e2e/global-setup.ts` exports or the shared helper module the repo already has):
```ts
import { test, expect } from '@playwright/test';
import { apiLogin, apiSeedWorkspaceProject, apiPost, apiGet } from './helpers';

/**
 * Phase 8c — sprint auto-complete + roll-forward headline flow.
 * Sets up a sprint folder (auto-complete + roll-forward on), creates a sprint
 * that already ended, adds an open task, triggers the sweep, and verifies the
 * sprint completed, a next sprint was created, the open task rolled into it, and
 * the points rollup is readable.
 *
 * DB SAFETY: runs against the local dev stack (local Docker ProjectFlow_Test).
 */
test('sprint auto-completes at end date and rolls unfinished tasks to the next sprint', async ({ request }) => {
  const token = await apiLogin(request);
  const { workspaceId, projectId, folderId } = await apiSeedWorkspaceProject(request, token, { withSprintFolder: true });

  // Enable auto-complete + roll-forward on the sprint folder.
  await apiPost(request, token, `/sprints/folders/${folderId}/settings`, {
    durationDays: 14, startDayOfWeek: null, autoStart: false, autoComplete: true, autoRollForward: true, pointsFieldId: null,
  }, 'PUT');

  // Create a sprint that ended yesterday, then start it (so it is ACTIVE).
  const now = Date.now();
  const start = new Date(now - 15 * 24 * 3600 * 1000).toISOString();
  const end = new Date(now - 24 * 3600 * 1000).toISOString();
  const sprint = (await apiPost(request, token, `/sprints/folders/${folderId}/sprints`, { name: 'S1', startDate: start, endDate: end })).data;
  const sprintId = sprint.Id ?? sprint.id;
  const listId = sprint.ListId ?? sprint.listId;
  await apiPost(request, token, `/sprints/${sprintId}/start`, {});

  // Add an open task into the sprint List.
  await apiPost(request, token, `/tasks`, { workspaceId, listId, title: 'Open work', storyPoints: 5 });

  // Trigger the sweep via the test-only endpoint (registered only when
  // NODE_ENV=test|development; calls runSprintSweep(now)).
  const sweep = (await apiPost(request, token, `/sprints/_sweep`, { now: new Date(now).toISOString() })).data;
  expect(sweep.completed).toBeGreaterThanOrEqual(1);

  // S1 is completed.
  const s1 = (await apiGet(request, token, `/sprints?projectId=${projectId}`)).data.find((s: any) => (s.Id ?? s.id) === sprintId);
  expect(s1.Status ?? s1.status).toBe('COMPLETED');

  // A next sprint exists and the open task rolled into it (its points show up).
  const list = (await apiGet(request, token, `/sprints?projectId=${projectId}`)).data;
  const next = list.find((s: any) => (s.Id ?? s.id) !== sprintId);
  expect(next).toBeTruthy();
  const points = (await apiGet(request, token, `/sprints/${next.Id ?? next.id}/points`)).data;
  expect(points.total.TotalPoints).toBeGreaterThanOrEqual(5);
});
```
- [ ] Add the test-only sweep endpoint the spec calls. In `apps/api/src/modules/sprints/sprint.routes.ts`, register it only outside production (so it can never be hit on prod):
```ts
import { runSprintSweep } from './sprint.worker.js';

// Test/dev-only manual sweep trigger (NEVER mounted in production). Lets e2e
// drive the scheduler deterministically without waiting for the 15-min tick.
if (process.env.NODE_ENV !== 'production') {
  sprintRoutes.post('/_sweep', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const now = body?.now ? new Date(body.now) : new Date();
    const result = await runSprintSweep(now);
    return c.json({ data: result });
  });
}
```
- [ ] Run the e2e (local dev stack must be up; Playwright auto-starts both apps per `playwright.config.ts`):
```
$env:DB_NAME='ProjectFlow_Test'; npx playwright test e2e/sprint-agile.spec.ts
```
Expected: `1 passed` — sprint COMPLETED, next sprint created, open task rolled forward, points ≥ 5. (If `helpers` exports differ in the repo, adapt the import to the existing e2e helper module; the flow — login → seed → PUT settings → create+start sprint → add task → POST `/sprints/_sweep` → assert — is fixed.)
- [ ] Commit: `git add e2e/sprint-agile.spec.ts apps/api/src/modules/sprints/sprint.routes.ts && git commit -m "test(8c): e2e sprint auto-complete + roll-forward + points (test-only /_sweep trigger)"`

---

### Task 18: Full-slice verification + DECISIONS.md

**Files:** `DECISIONS.md`

- [ ] Run the full API unit suite — green:
```
npx vitest run --project unit --root apps/api
```
Expected: all unit tests pass (including the new `sprint.cadence.unit.test.ts`).
- [ ] Run the full API integration suite against local Docker — green:
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='Your_password123'; npx tsx scripts/db-deploy-sps.ts; $env:REDIS_HOST='localhost'; npx vitest run --project integration --root apps/api
```
Expected: all integration tests pass (sprint-folders, sprint-migration, sprint-sweep, sprint-graphql + the pre-existing suite).
- [ ] Run web unit + i18n parity — green:
```
npx vitest run --root apps/next-web
```
Expected: all pass, parity green.
- [ ] Build both apps — clean:
```
npm run build --workspace apps/api; npm run build --workspace apps/next-web
```
Expected: both exit 0.
- [ ] Run the headline e2e once more — green:
```
$env:DB_NAME='ProjectFlow_Test'; npx playwright test e2e/sprint-agile.spec.ts
```
Expected: `1 passed`.
- [ ] Append a Phase 8c entry to `DECISIONS.md` recording: sprint = List-under-sprint-Folder model; `Tasks.SprintId` retained as maintained denorm; data migration is local-Docker-only (prod cutover deferred per spec §10.6); new permission key `sprint.manage` (RBAC seed follow-up); test-only `/sprints/_sweep` endpoint never mounted in production.
- [ ] Commit: `git add DECISIONS.md && git commit -m "docs(8c): DECISIONS entry — sprint-folder hierarchy, SprintId denorm, local-only data migration, sprint.manage key"`

---

## Definition of Done

- [ ] **Acceptance (BUILD_PLAN §6.5):** Sprint auto-completes at end date and rolls unfinished tasks to the next sprint — proven by `runSprintSweep` integration test (Task 11) **and** the `e2e/sprint-agile.spec.ts` headline flow (Task 17).
- [ ] `Folders.IsSprintFolder` + `SprintSettings` + `Sprints.ListId`/`FolderId` migrated idempotently (0045) with a matching `rollback/0045_sprint_folders.down.sql` (reversible).
- [ ] Legacy flat sprints fold into the hierarchy idempotently (0045b) — verified by `sprint-migration.integration.test.ts` (legacy sprint → bound List under a sprint Folder, tasks re-homed, `SprintId` denorm maintained); **local-Docker-only, prod cutover deferred**.
- [ ] SP-per-op: `usp_Folder_Set/GetSprintSettings`, `usp_Sprint_CreateInFolder`, `usp_Sprint_RollForward`, `usp_Sprint_GetPointsRollup` (total + per-assignee), `usp_Sprint_ListDueFolders`, `usp_Folder_GetWorkspaceId`; `usp_Report_SprintSummary` reads sprint-List membership; all `CREATE OR ALTER` + `SET NOCOUNT ON` + TRY/CATCH/TRANSACTION where mutating.
- [ ] Pure cadence/auto-state math (`sprint.cadence.ts`) unit-tested first (`shouldAutoStart`/`shouldAutoComplete`/`nextSprintWindow`/`selectRollForwardTasks`).
- [ ] BullMQ `sprint.worker.ts` copies the recurrence pattern: idempotent `startSprintWorker()`, Redis-gated, fixed 15-min sweep, pure `runSprintSweep(now?)` test helper; registered in `server.ts` alongside recurrence/oauth workers.
- [ ] REST primary + GraphQL mirror over the shared `sprintService` (`SprintType.listId/folderId/points`; `createSprintInFolder`/`rollForwardSprint`); `start`/`complete` still emit `sprint.started`/`sprint.completed`.
- [ ] `requirePermission` (`sprint.manage`/`sprint.create`/`sprint.start`) with folder/sprint workspace resolvers — fail-closed.
- [ ] `@projectflow/types` updated (`Sprint`, `SprintSettings`, `SprintPointsRollup`); `SprintSummaryWidget` still works (List-backed summary).
- [ ] Frontend sprint setup UI + sprint list with per-assignee points; i18n en/id parity green.
- [ ] Unit + integration tests for new endpoints/behavior; ≥1 Playwright e2e for the headline flow; both app builds clean; all DB work ran ONLY against local Docker `ProjectFlow_Test`.
- [ ] `DECISIONS.md` entry logs deviations; **stop for review/merge** before Slice 8d.

> Note: the legacy-sprint data migration (0045b) is **local-Docker-only** this phase — a production cutover runbook is deferred to an ops follow-up (spec §10.6).
