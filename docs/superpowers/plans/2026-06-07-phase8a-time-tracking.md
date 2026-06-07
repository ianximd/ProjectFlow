# Phase 8a — Time Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing `WorkLogs` CRUD module into a real time-tracking system: a start/stop running timer (one active per user), billable flag, entry tags, manual/range/timer entry sources, per-task time estimates with estimate-vs-actual, subtask→parent rollup, and a GraphQL mirror over the shared service.

**Architecture:** A running timer *is* an open `WorkLogs` row (`EndedAt IS NULL`, `Source='timer'`); stop sets `EndedAt` and derives `TimeSpentSeconds` via `DATEDIFF`. "One active timer per user" is enforced by a filtered unique index `UQ_WorkLog_ActiveTimer ON WorkLogs(UserId) WHERE EndedAt IS NULL` plus an auto-stop guard inside `usp_WorkLog_StartTimer`. New behavior is SP-per-op in `infra/sql/procedures/`, surfaced through `worklog.repository` → `worklog.service`, exposed as Hono REST (primary) and a new graphql-yoga/Pothos mirror (`worklog.schema.ts`), both delegating to the one shared service. Rollup sums a task's own + descendant logged time and estimate down the `ParentTaskId` subtree (the Phase 2 `progress_auto` subtree pattern). Frontend adds a global timer widget in the app shell, upgrades `WorkLogSection.tsx`, and adds an estimate field + estimate-vs-actual bar + rollup total to the task panel.

**Tech Stack:** SQL Server stored procedures (`CREATE OR ALTER`, `SET NOCOUNT ON`, TRY/CATCH/TRANSACTION); Hono REST + `@hono/zod-validator`; graphql-yoga + Pothos (`@pothos/core`); `mssql` via `execSp`/`execSpOne`; vitest (`--project unit` / `--project integration`); Next.js App Router (SSR) + `next-intl`; Playwright e2e. DB work runs ONLY against local Docker `ProjectFlow_Test`.

**Prerequisite:** Phases 1–7 merged. (Phase 8 builds after 6→7.)

---

## File Structure

**Migrations**
- `infra/sql/migrations/0043_time_tracking.sql` — **Create.** Idempotent, GO-batched: evolve `WorkLogs` (`EndedAt`, `Billable`, `Source`) + `UQ_WorkLog_ActiveTimer`; create `WorkLogTags`; add `Tasks.TimeEstimateSeconds`; create `TaskEstimates`.
- `infra/sql/migrations/rollback/0043_time_tracking.down.sql` — **Create.** Reverse: drop `TaskEstimates`, `WorkLogTags`, the new index + columns on `WorkLogs`, and `Tasks.TimeEstimateSeconds`.

**Stored procedures** (`infra/sql/procedures/`)
- `usp_WorkLog_StartTimer.sql` — **Create.** Auto-stop the user's open entry, insert a new open `Source='timer'` row, return it.
- `usp_WorkLog_StopTimer.sql` — **Create.** Set `EndedAt`, compute `TimeSpentSeconds = DATEDIFF(SECOND, StartedAt, EndedAt)` for the user's open entry, return it.
- `usp_WorkLog_GetActiveTimer.sql` — **Create.** Return the user's open entry (or no rows).
- `usp_WorkLog_Create.sql` — **Modify.** Add `@Billable`, `@Source`, `@EndedAt` params; insert + return new columns.
- `usp_WorkLog_Update.sql` — **Modify.** Add `@Billable`, `@EndedAt` params (ISNULL-coalesced); return new columns.
- `usp_WorkLog_ListByTask.sql` — **Modify.** SELECT `EndedAt`, `Billable`, `Source` in both result sets.
- `usp_WorkLogTag_Set.sql` — **Create.** Replace a worklog's tag set (delete + re-insert from a TVP-free id list), return the linked tags.
- `usp_Task_SetEstimate.sql` — **Create.** Upsert `Tasks.TimeEstimateSeconds` and/or a `TaskEstimates(TaskId,UserId)` row.
- `usp_Task_GetTimeRollup.sql` — **Create.** Recursive CTE down `ParentTaskId`: sum logged `TimeSpentSeconds` + `TimeEstimateSeconds` for a task and all descendants; also return own-only totals.

**API** (`apps/api/src/`)
- `modules/worklogs/worklog.repository.ts` — **Modify.** Map new row columns; add `startTimer`/`stopTimer`/`getActiveTimer`/`setTags`/`setEstimate`/`getTimeRollup`; extend `create`/`update`.
- `modules/worklogs/worklog.service.ts` — **Modify.** Add `startTimer`/`stopTimer`/`getActiveTimer`/`setEstimate`/`getEstimate`/`getRollup`; thread billable + tags.
- `modules/worklogs/worklog.routes.ts` — **Modify.** Add `POST /worklogs/timer/start`, `POST /worklogs/timer/stop`, `GET /worklogs/timer/active`, `PUT /worklogs/tasks/:taskId/estimate`, `GET /worklogs/tasks/:taskId/rollup`; extend create/update schemas with `billable`/`source`/`tagIds`/`endedAt`.
- `graphql/worklog.schema.ts` — **Create.** `registerWorkLogGraphql()`: `WorkLogType`/`TaskTimeRollupType` + `taskWorkLogs`/`activeTimer` queries + `startTimer`/`stopTimer`/`createWorkLog`/`updateWorkLog`/`deleteWorkLog` mutations.
- `graphql/schema.ts` — **Modify.** Import + call `registerWorkLogGraphql()`.

**Types** (`packages/types/`)
- `index.ts` — **Modify.** Extend `WorkLog` (`endedAt`/`billable`/`source`/`tags`); add `WorkLogSource`, `WorkLogTag`, `ActiveTimer`, `TaskTimeRollup`; extend `CreateWorkLogInput`/`UpdateWorkLogInput`.

**Frontend** (`apps/next-web/src/`)
- `server/actions/worklogs.ts` — **Modify.** Add `startTimer`/`stopTimer`/`getActiveTimer`/`setEstimate`/`getRollup` server actions; thread billable/tagIds/source.
- `components/GlobalTimerWidget.tsx` — **Create.** App-shell timer: start/stop, running task, live elapsed tick.
- `components/GlobalTimerWidget.module.css` — **Create.** Styles for the widget.
- `components/WorkLogSection.tsx` — **Modify.** Billable toggle, tag picker, manual-vs-range entry, "Start timer here" button.
- `components/TaskEstimateBar.tsx` — **Create.** Estimate field + estimate-vs-actual bar + rollup total.
- `components/TaskEstimateBar.module.css` — **Create.** Styles for the bar.
- `messages/en.json` — **Modify.** New `Timer` namespace keys + `WorkLog`/`Estimate` additions.
- `messages/id.json` — **Modify.** Same keys, real Indonesian.

**Tests**
- `apps/api/src/modules/worklogs/__tests__/rollup.unit.test.ts` — **Create.** Pure rollup/estimate-vs-actual math.
- `apps/api/src/modules/worklogs/__tests__/duration.unit.test.ts` — **Create.** Pure timer-duration helper.
- `apps/api/src/modules/worklogs/__tests__/timer.integration.test.ts` — **Create.** start→stop, second-start auto-stop, billable+tags persist, rollup sums subtasks.
- `apps/next-web/src/components/__tests__/GlobalTimerWidget.unit.test.tsx` — **Create.** Live-tick formatting.
- `apps/next-web/e2e/time-tracking.spec.ts` — **Create.** Start/stop the global timer on a task; estimate vs actual renders.

---

## Tasks

### Task 1: Migration + rollback (`0043_time_tracking.sql`)

**Files:**
- Create: `infra/sql/migrations/0043_time_tracking.sql`
- Create: `infra/sql/migrations/rollback/0043_time_tracking.down.sql`
- Test: manual deploy against local Docker `ProjectFlow_Test` (migrations have no unit harness; verified via the integration suite in Task 6).

Steps:

- [ ] Write the migration. Idempotent (`COL_LENGTH` / `sys.indexes` / `sys.tables` guards), GO-batched, matching the `0010`/`0036` style:

```sql
-- =============================================================================
-- Migration 0043: Time Tracking (Phase 8a)
-- Evolves WorkLogs into a timer + estimate system:
--   * EndedAt (NULL = running timer), Billable, Source ('manual'|'range'|'timer')
--   * UQ_WorkLog_ActiveTimer — at most one OPEN (EndedAt IS NULL) entry per user
--   * WorkLogTags — entry tags, reusing the Phase 2 Space-scoped Tags
--   * Tasks.TimeEstimateSeconds + TaskEstimates(TaskId,UserId) for per-assignee estimates
-- Idempotent (catalog guards), GO-batched.
-- Rollback in rollback/0043_time_tracking.down.sql.
-- =============================================================================

IF COL_LENGTH('dbo.WorkLogs', 'EndedAt') IS NULL
    ALTER TABLE dbo.WorkLogs ADD EndedAt DATETIME2 NULL;
GO

IF COL_LENGTH('dbo.WorkLogs', 'Billable') IS NULL
    ALTER TABLE dbo.WorkLogs ADD Billable BIT NOT NULL CONSTRAINT DF_WorkLogs_Billable DEFAULT 0;
GO

IF COL_LENGTH('dbo.WorkLogs', 'Source') IS NULL
    ALTER TABLE dbo.WorkLogs ADD Source NVARCHAR(10) NOT NULL CONSTRAINT DF_WorkLogs_Source DEFAULT 'manual';
GO

-- At most one OPEN timer per user. Manual/range entries always set EndedAt, so
-- only live timer rows fall under the filter.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_WorkLog_ActiveTimer' AND object_id = OBJECT_ID('dbo.WorkLogs'))
    CREATE UNIQUE NONCLUSTERED INDEX UQ_WorkLog_ActiveTimer
        ON dbo.WorkLogs (UserId) WHERE EndedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WorkLogTags')
BEGIN
    CREATE TABLE dbo.WorkLogTags (
        WorkLogId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_WorkLogTags_WorkLog REFERENCES dbo.WorkLogs(Id) ON DELETE CASCADE,
        TagId     UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_WorkLogTags_Tag     REFERENCES dbo.Tags(Id)     ON DELETE CASCADE,
        CONSTRAINT PK_WorkLogTags PRIMARY KEY (WorkLogId, TagId)
    );
END
GO

IF COL_LENGTH('dbo.Tasks', 'TimeEstimateSeconds') IS NULL
    ALTER TABLE dbo.Tasks ADD TimeEstimateSeconds INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskEstimates')
BEGIN
    CREATE TABLE dbo.TaskEstimates (
        TaskId          UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_TaskEstimates_Task REFERENCES dbo.Tasks(Id) ON DELETE CASCADE,
        UserId          UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_TaskEstimates_User REFERENCES dbo.Users(Id),
        EstimateSeconds INT              NOT NULL,
        CreatedAt       DATETIME2        NOT NULL CONSTRAINT DF_TaskEstimates_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt       DATETIME2        NOT NULL CONSTRAINT DF_TaskEstimates_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_TaskEstimates PRIMARY KEY (TaskId, UserId)
    );
END
GO
```

- [ ] Write the rollback `rollback/0043_time_tracking.down.sql` (reverse order; tables first, then index, then columns; drop DEFAULT constraints before dropping columns):

```sql
-- Rollback 0043: Time Tracking.
-- Drops TaskEstimates, WorkLogTags, the active-timer index, and the new
-- WorkLogs/Tasks columns (with their DEFAULT constraints) in reverse order.

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskEstimates') DROP TABLE dbo.TaskEstimates;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WorkLogTags')   DROP TABLE dbo.WorkLogTags;
GO

IF COL_LENGTH('dbo.Tasks', 'TimeEstimateSeconds') IS NOT NULL
    ALTER TABLE dbo.Tasks DROP COLUMN TimeEstimateSeconds;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_WorkLog_ActiveTimer' AND object_id = OBJECT_ID('dbo.WorkLogs'))
    DROP INDEX UQ_WorkLog_ActiveTimer ON dbo.WorkLogs;
GO

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_WorkLogs_Source')
    ALTER TABLE dbo.WorkLogs DROP CONSTRAINT DF_WorkLogs_Source;
IF COL_LENGTH('dbo.WorkLogs', 'Source') IS NOT NULL   ALTER TABLE dbo.WorkLogs DROP COLUMN Source;
GO
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_WorkLogs_Billable')
    ALTER TABLE dbo.WorkLogs DROP CONSTRAINT DF_WorkLogs_Billable;
IF COL_LENGTH('dbo.WorkLogs', 'Billable') IS NOT NULL ALTER TABLE dbo.WorkLogs DROP COLUMN Billable;
GO
IF COL_LENGTH('dbo.WorkLogs', 'EndedAt') IS NOT NULL  ALTER TABLE dbo.WorkLogs DROP COLUMN EndedAt;
GO
```

- [ ] Run against local Docker `ProjectFlow_Test` only (explicit local DB env, never `apps/api/.env`). Run: apply `0043_time_tracking.sql` then immediately the `.down.sql` then re-apply `0043` to prove idempotency + reversibility. Expected: all three runs succeed with no errors; second `0043` apply is a clean no-op (guards skip everything).

- [ ] Commit:
```
git add infra/sql/migrations/0043_time_tracking.sql infra/sql/migrations/rollback/0043_time_tracking.down.sql
git commit -m "feat(8a): time-tracking migration — WorkLogs timer/billable/source + tags + estimates"
```

---

### Task 2: Timer SPs (`StartTimer`, `StopTimer`, `GetActiveTimer`)

**Files:**
- Create: `infra/sql/procedures/usp_WorkLog_StartTimer.sql`
- Create: `infra/sql/procedures/usp_WorkLog_StopTimer.sql`
- Create: `infra/sql/procedures/usp_WorkLog_GetActiveTimer.sql`
- Test: covered by `timer.integration.test.ts` (Task 6); deploy via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`.

Steps:

- [ ] Write `usp_WorkLog_StartTimer.sql` — auto-stop any open entry, then insert an open `timer` row, returning the standard joined shape (`UserName`/`AvatarUrl` + new columns), matching `usp_WorkLog_Create`'s SELECT:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_WorkLog_StartTimer
  @TaskId UNIQUEIDENTIFIER,
  @UserId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @NewId UNIQUEIDENTIFIER = NEWID();
  DECLARE @Now   DATETIME2        = SYSUTCDATETIME();

  BEGIN TRY
    BEGIN TRANSACTION;

    -- Auto-stop any existing open timer for this user so the new start is always
    -- safe under UQ_WorkLog_ActiveTimer.
    UPDATE dbo.WorkLogs
      SET EndedAt          = @Now,
          TimeSpentSeconds = DATEDIFF(SECOND, StartedAt, @Now)
      WHERE UserId = @UserId AND EndedAt IS NULL;

    INSERT INTO dbo.WorkLogs (Id, TaskId, UserId, TimeSpentSeconds, StartedAt, EndedAt, Source, Billable)
    VALUES (@NewId, @TaskId, @UserId, 0, @Now, NULL, 'timer', 0);

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;

  SELECT
    wl.Id, wl.TaskId, wl.UserId, u.Name AS UserName, u.AvatarUrl,
    wl.TimeSpentSeconds, wl.StartedAt, wl.EndedAt, wl.Billable, wl.Source,
    wl.Description, wl.CreatedAt
  FROM dbo.WorkLogs wl
  JOIN dbo.Users    u ON u.Id = wl.UserId
  WHERE wl.Id = @NewId;
END;
GO
```

- [ ] Write `usp_WorkLog_StopTimer.sql` — close the user's open entry and compute duration:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_WorkLog_StopTimer
  @UserId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @Now DATETIME2 = SYSUTCDATETIME();
  DECLARE @Id  UNIQUEIDENTIFIER;

  SELECT TOP 1 @Id = Id FROM dbo.WorkLogs WHERE UserId = @UserId AND EndedAt IS NULL;

  IF @Id IS NOT NULL
    UPDATE dbo.WorkLogs
      SET EndedAt          = @Now,
          TimeSpentSeconds = DATEDIFF(SECOND, StartedAt, @Now)
      WHERE Id = @Id;

  SELECT
    wl.Id, wl.TaskId, wl.UserId, u.Name AS UserName, u.AvatarUrl,
    wl.TimeSpentSeconds, wl.StartedAt, wl.EndedAt, wl.Billable, wl.Source,
    wl.Description, wl.CreatedAt
  FROM dbo.WorkLogs wl
  JOIN dbo.Users    u ON u.Id = wl.UserId
  WHERE wl.Id = @Id;
END;
GO
```

- [ ] Write `usp_WorkLog_GetActiveTimer.sql` — return the user's open entry (zero or one row):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_WorkLog_GetActiveTimer
  @UserId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP 1
    wl.Id, wl.TaskId, wl.UserId, u.Name AS UserName, u.AvatarUrl,
    wl.TimeSpentSeconds, wl.StartedAt, wl.EndedAt, wl.Billable, wl.Source,
    wl.Description, wl.CreatedAt
  FROM dbo.WorkLogs wl
  JOIN dbo.Users    u ON u.Id = wl.UserId
  WHERE wl.UserId = @UserId AND wl.EndedAt IS NULL;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test` (local DB env only). Expected: all three procedures created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_WorkLog_StartTimer.sql infra/sql/procedures/usp_WorkLog_StopTimer.sql infra/sql/procedures/usp_WorkLog_GetActiveTimer.sql
git commit -m "feat(8a): timer SPs — StartTimer (auto-stop), StopTimer (DATEDIFF), GetActiveTimer"
```

---

### Task 3: Extend create/update + tag SP (`WorkLogTag_Set`) + `ListByTask`

**Files:**
- Modify: `infra/sql/procedures/usp_WorkLog_Create.sql`
- Modify: `infra/sql/procedures/usp_WorkLog_Update.sql`
- Modify: `infra/sql/procedures/usp_WorkLog_ListByTask.sql`
- Create: `infra/sql/procedures/usp_WorkLogTag_Set.sql`
- Test: covered by `timer.integration.test.ts` (Task 6); deploy via `scripts/db-deploy-sps.ts`.

Steps:

- [ ] Modify `usp_WorkLog_Create.sql` — add `@Billable`, `@Source`, `@EndedAt` params and include the new columns in INSERT + SELECT:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_WorkLog_Create
  @TaskId           UNIQUEIDENTIFIER,
  @UserId           UNIQUEIDENTIFIER,
  @TimeSpentSeconds INT,
  @StartedAt        DATETIME2,
  @Description      NVARCHAR(500) = NULL,
  @Billable         BIT           = 0,
  @Source           NVARCHAR(10)  = 'manual',
  @EndedAt          DATETIME2     = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

  INSERT INTO dbo.WorkLogs (Id, TaskId, UserId, TimeSpentSeconds, StartedAt, EndedAt, Description, Billable, Source)
  VALUES (@NewId, @TaskId, @UserId, @TimeSpentSeconds, @StartedAt, @EndedAt, @Description, @Billable, @Source);

  SELECT
    wl.Id, wl.TaskId, wl.UserId, u.Name AS UserName, u.AvatarUrl,
    wl.TimeSpentSeconds, wl.StartedAt, wl.EndedAt, wl.Billable, wl.Source,
    wl.Description, wl.CreatedAt
  FROM dbo.WorkLogs wl
  JOIN dbo.Users    u ON u.Id = wl.UserId
  WHERE wl.Id = @NewId;
END;
GO
```

- [ ] Modify `usp_WorkLog_Update.sql` — add `@Billable`/`@EndedAt` (ISNULL-coalesced) and include new columns in SELECT:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_WorkLog_Update
  @Id               UNIQUEIDENTIFIER,
  @UserId           UNIQUEIDENTIFIER,
  @TimeSpentSeconds INT           = NULL,
  @StartedAt        DATETIME2     = NULL,
  @Description      NVARCHAR(500) = NULL,
  @Billable         BIT           = NULL,
  @EndedAt          DATETIME2     = NULL
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.WorkLogs SET
    TimeSpentSeconds = ISNULL(@TimeSpentSeconds, TimeSpentSeconds),
    StartedAt        = ISNULL(@StartedAt,        StartedAt),
    Description      = ISNULL(@Description,      Description),
    Billable         = ISNULL(@Billable,         Billable),
    EndedAt          = ISNULL(@EndedAt,          EndedAt)
  WHERE Id = @Id AND UserId = @UserId;

  SELECT
    wl.Id, wl.TaskId, wl.UserId, u.Name AS UserName, u.AvatarUrl,
    wl.TimeSpentSeconds, wl.StartedAt, wl.EndedAt, wl.Billable, wl.Source,
    wl.Description, wl.CreatedAt
  FROM dbo.WorkLogs wl
  JOIN dbo.Users    u ON u.Id = wl.UserId
  WHERE wl.Id = @Id;
END;
GO
```

- [ ] Modify `usp_WorkLog_ListByTask.sql` — add `EndedAt`, `Billable`, `Source` to the per-entry SELECT (totals set unchanged):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_WorkLog_ListByTask
  @TaskId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    wl.Id, wl.TaskId, wl.UserId, u.Name AS UserName, u.AvatarUrl,
    wl.TimeSpentSeconds, wl.StartedAt, wl.EndedAt, wl.Billable, wl.Source,
    wl.Description, wl.CreatedAt
  FROM dbo.WorkLogs wl
  JOIN dbo.Users    u ON u.Id = wl.UserId
  WHERE wl.TaskId = @TaskId
  ORDER BY wl.StartedAt DESC;

  SELECT
    wl.UserId, u.Name AS UserName, u.AvatarUrl,
    SUM(wl.TimeSpentSeconds) AS TotalSeconds
  FROM dbo.WorkLogs wl
  JOIN dbo.Users    u ON u.Id = wl.UserId
  WHERE wl.TaskId = @TaskId
  GROUP BY wl.UserId, u.Name, u.AvatarUrl
  ORDER BY TotalSeconds DESC;
END;
GO
```

- [ ] Write `usp_WorkLogTag_Set.sql` — replace a worklog's tag set from a comma-delimited id list (no TVP, matching the flat-string transport used elsewhere), then return the linked tags:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_WorkLogTag_Set
  @WorkLogId UNIQUEIDENTIFIER,
  @TagIds    NVARCHAR(MAX) = NULL   -- comma-delimited GUID list; NULL/'' clears all
AS
BEGIN
  SET NOCOUNT ON;

  BEGIN TRY
    BEGIN TRANSACTION;

    DELETE FROM dbo.WorkLogTags WHERE WorkLogId = @WorkLogId;

    IF @TagIds IS NOT NULL AND LEN(@TagIds) > 0
      INSERT INTO dbo.WorkLogTags (WorkLogId, TagId)
      SELECT DISTINCT @WorkLogId, TRY_CONVERT(UNIQUEIDENTIFIER, LTRIM(RTRIM(value)))
      FROM STRING_SPLIT(@TagIds, ',')
      WHERE TRY_CONVERT(UNIQUEIDENTIFIER, LTRIM(RTRIM(value))) IS NOT NULL
        AND EXISTS (SELECT 1 FROM dbo.Tags tg WHERE tg.Id = TRY_CONVERT(UNIQUEIDENTIFIER, LTRIM(RTRIM(value))));

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;

  SELECT t.Id, t.Name, t.Color
  FROM dbo.WorkLogTags wt
  JOIN dbo.Tags        t ON t.Id = wt.TagId
  WHERE wt.WorkLogId = @WorkLogId
  ORDER BY t.Name;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`. Expected: all four procedures (re)created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_WorkLog_Create.sql infra/sql/procedures/usp_WorkLog_Update.sql infra/sql/procedures/usp_WorkLog_ListByTask.sql infra/sql/procedures/usp_WorkLogTag_Set.sql
git commit -m "feat(8a): worklog SPs — billable/source/endedAt on create/update/list + WorkLogTag_Set"
```

---

### Task 4: Estimate + rollup SPs (`Task_SetEstimate`, `Task_GetTimeRollup`)

**Files:**
- Create: `infra/sql/procedures/usp_Task_SetEstimate.sql`
- Create: `infra/sql/procedures/usp_Task_GetTimeRollup.sql`
- Test: rollup *math* is unit-tested pure in Task 5 (`rollup.unit.test.ts`); the SP path is covered by `timer.integration.test.ts` (Task 6).

Steps:

- [ ] Write `usp_Task_SetEstimate.sql` — set the task-level estimate and/or upsert a per-user `TaskEstimates` row, returning the task's current estimate state:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Task_SetEstimate
  @TaskId          UNIQUEIDENTIFIER,
  @UserId          UNIQUEIDENTIFIER = NULL,   -- when set, upserts a per-assignee estimate
  @EstimateSeconds INT              = NULL    -- NULL clears the targeted estimate
AS
BEGIN
  SET NOCOUNT ON;

  BEGIN TRY
    BEGIN TRANSACTION;

    IF @UserId IS NULL
    BEGIN
      UPDATE dbo.Tasks SET TimeEstimateSeconds = @EstimateSeconds WHERE Id = @TaskId;
    END
    ELSE IF @EstimateSeconds IS NULL
    BEGIN
      DELETE FROM dbo.TaskEstimates WHERE TaskId = @TaskId AND UserId = @UserId;
    END
    ELSE
    BEGIN
      MERGE dbo.TaskEstimates AS tgt
      USING (SELECT @TaskId AS TaskId, @UserId AS UserId) AS src
        ON tgt.TaskId = src.TaskId AND tgt.UserId = src.UserId
      WHEN MATCHED THEN
        UPDATE SET EstimateSeconds = @EstimateSeconds, UpdatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (TaskId, UserId, EstimateSeconds) VALUES (@TaskId, @UserId, @EstimateSeconds);
    END

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;

  SELECT
    t.Id AS TaskId,
    t.TimeEstimateSeconds,
    (SELECT ISNULL(SUM(te.EstimateSeconds), 0) FROM dbo.TaskEstimates te WHERE te.TaskId = t.Id) AS PerAssigneeTotalSeconds
  FROM dbo.Tasks t
  WHERE t.Id = @TaskId;
END;
GO
```

- [ ] Write `usp_Task_GetTimeRollup.sql` — recursive CTE down `ParentTaskId` (the column the Phase 2 subtree/`progress_auto` queries walk), returning own-only and subtree totals for logged time + estimate:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Task_GetTimeRollup
  @TaskId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  ;WITH Subtree AS (
    SELECT Id, ParentTaskId, TimeEstimateSeconds
      FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL
    UNION ALL
    SELECT c.Id, c.ParentTaskId, c.TimeEstimateSeconds
      FROM dbo.Tasks c
      JOIN Subtree s ON c.ParentTaskId = s.Id
      WHERE c.DeletedAt IS NULL
  )
  SELECT
    @TaskId AS TaskId,
    -- own-only
    (SELECT ISNULL(SUM(wl.TimeSpentSeconds), 0) FROM dbo.WorkLogs wl WHERE wl.TaskId = @TaskId) AS OwnLoggedSeconds,
    (SELECT TimeEstimateSeconds FROM dbo.Tasks WHERE Id = @TaskId)                              AS OwnEstimateSeconds,
    -- subtree (own + descendants)
    (SELECT ISNULL(SUM(wl.TimeSpentSeconds), 0)
       FROM dbo.WorkLogs wl WHERE wl.TaskId IN (SELECT Id FROM Subtree))                        AS RollupLoggedSeconds,
    (SELECT ISNULL(SUM(s.TimeEstimateSeconds), 0) FROM Subtree s)                               AS RollupEstimateSeconds
  OPTION (MAXRECURSION 0);
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`. Expected: both procedures created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_Task_SetEstimate.sql infra/sql/procedures/usp_Task_GetTimeRollup.sql
git commit -m "feat(8a): estimate + rollup SPs — Task_SetEstimate + Task_GetTimeRollup (ParentTaskId subtree)"
```

---

### Task 5: Types + repository + service + pure unit tests

**Files:**
- Modify: `packages/types/index.ts` (lines 453–492, the Work Logs block)
- Modify: `apps/api/src/modules/worklogs/worklog.repository.ts`
- Modify: `apps/api/src/modules/worklogs/worklog.service.ts`
- Create: `apps/api/src/modules/worklogs/rollup.ts` (pure helpers)
- Create: `apps/api/src/modules/worklogs/__tests__/rollup.unit.test.ts`
- Create: `apps/api/src/modules/worklogs/__tests__/duration.unit.test.ts`

Steps:

- [ ] Write the failing unit tests first. `rollup.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { estimateVsActual, type RollupRow } from '../rollup.js';

describe('estimateVsActual', () => {
  it('computes ratio and remaining from a rollup row', () => {
    const row: RollupRow = {
      taskId: 't1',
      ownLoggedSeconds: 3600, ownEstimateSeconds: 7200,
      rollupLoggedSeconds: 10800, rollupEstimateSeconds: 14400,
    };
    const r = estimateVsActual(row);
    expect(r.loggedSeconds).toBe(10800);
    expect(r.estimateSeconds).toBe(14400);
    expect(r.ratio).toBeCloseTo(0.75, 5);          // 10800 / 14400
    expect(r.remainingSeconds).toBe(3600);          // 14400 - 10800
    expect(r.overBudget).toBe(false);
  });

  it('flags over-budget and clamps remaining at zero', () => {
    const row: RollupRow = {
      taskId: 't2',
      ownLoggedSeconds: 0, ownEstimateSeconds: 0,
      rollupLoggedSeconds: 20000, rollupEstimateSeconds: 10000,
    };
    const r = estimateVsActual(row);
    expect(r.ratio).toBeCloseTo(2, 5);
    expect(r.remainingSeconds).toBe(0);
    expect(r.overBudget).toBe(true);
  });

  it('returns null ratio when there is no estimate', () => {
    const row: RollupRow = {
      taskId: 't3',
      ownLoggedSeconds: 500, ownEstimateSeconds: null,
      rollupLoggedSeconds: 500, rollupEstimateSeconds: 0,
    };
    const r = estimateVsActual(row);
    expect(r.ratio).toBeNull();
    expect(r.remainingSeconds).toBeNull();
    expect(r.overBudget).toBe(false);
  });
});
```

`duration.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { elapsedSeconds } from '../rollup.js';

describe('elapsedSeconds', () => {
  it('computes whole seconds between start and end', () => {
    expect(elapsedSeconds('2026-06-07T09:00:00.000Z', '2026-06-07T09:30:00.000Z')).toBe(1800);
  });
  it('floors sub-second remainders', () => {
    expect(elapsedSeconds('2026-06-07T09:00:00.000Z', '2026-06-07T09:00:01.900Z')).toBe(1);
  });
  it('never returns negative for an end before start', () => {
    expect(elapsedSeconds('2026-06-07T09:30:00.000Z', '2026-06-07T09:00:00.000Z')).toBe(0);
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- rollup duration` (i.e. `vitest run --project unit` filtered). Expected: FAIL — `Cannot find module '../rollup.js'`.

- [ ] Write `apps/api/src/modules/worklogs/rollup.ts`:

```ts
export interface RollupRow {
  taskId:                string;
  ownLoggedSeconds:      number;
  ownEstimateSeconds:    number | null;
  rollupLoggedSeconds:   number;
  rollupEstimateSeconds: number;
}

export interface EstimateVsActual {
  taskId:           string;
  loggedSeconds:    number;
  estimateSeconds:  number;
  ratio:            number | null;   // logged / estimate; null when no estimate
  remainingSeconds: number | null;   // estimate - logged, clamped >= 0; null when no estimate
  overBudget:       boolean;
}

/** Whole-second elapsed between two ISO timestamps; never negative. */
export function elapsedSeconds(startIso: string, endIso: string): number {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return ms > 0 ? Math.floor(ms / 1000) : 0;
}

/** Derive estimate-vs-actual from a subtree rollup row. */
export function estimateVsActual(row: RollupRow): EstimateVsActual {
  const logged   = row.rollupLoggedSeconds;
  const estimate = row.rollupEstimateSeconds;
  const hasEstimate = estimate > 0;
  return {
    taskId:           row.taskId,
    loggedSeconds:    logged,
    estimateSeconds:  estimate,
    ratio:            hasEstimate ? logged / estimate : null,
    remainingSeconds: hasEstimate ? Math.max(0, estimate - logged) : null,
    overBudget:       hasEstimate && logged > estimate,
  };
}
```

- [ ] Run: `npm test --workspace apps/api -- rollup duration`. Expected: PASS (6 tests).

- [ ] Extend `packages/types/index.ts` — replace the Work Logs block's interfaces:

```ts
// ── Time Tracking / Work Logs ─────────────────────────────────────────────────

export interface WorkLogUser {
  id:        string;
  name:      string;
  avatarUrl: string | null;
}

export type WorkLogSource = 'manual' | 'range' | 'timer';

export interface WorkLogTag {
  id:    string;
  name:  string;
  color: string | null;
}

export interface WorkLog {
  id:               string;
  taskId:           string;
  user:             WorkLogUser;
  timeSpentSeconds: number;
  startedAt:        string;
  endedAt:          string | null;   // null = running timer
  billable:         boolean;
  source:           WorkLogSource;
  description:      string | null;
  tags?:            WorkLogTag[];
  createdAt:        string;
}

export interface WorkLogTotals {
  user:         WorkLogUser;
  totalSeconds: number;
}

export interface WorkLogListResult {
  logs:   WorkLog[];
  totals: WorkLogTotals[];
}

export interface ActiveTimer {
  log: WorkLog | null;
}

export interface TaskTimeRollup {
  taskId:                string;
  ownLoggedSeconds:      number;
  ownEstimateSeconds:    number | null;
  rollupLoggedSeconds:   number;
  rollupEstimateSeconds: number;
}

export interface CreateWorkLogInput {
  taskId:           string;
  timeSpentSeconds: number;
  startedAt:        string;
  endedAt?:         string;
  description?:     string;
  billable?:        boolean;
  source?:          WorkLogSource;
  tagIds?:          string[];
}

export interface UpdateWorkLogInput {
  timeSpentSeconds?: number;
  startedAt?:        string;
  endedAt?:          string;
  description?:      string;
  billable?:         boolean;
  tagIds?:           string[];
}
```

- [ ] Extend `worklog.repository.ts` — add the new columns to `WorkLogRow`/`rowToLog`, thread billable+source through `create`/`update`, and add timer/tag/estimate/rollup methods. Replace `WorkLogRow`, `rowToLog`, and add to the class:

```ts
interface WorkLogRow {
  Id:               string;
  TaskId:           string;
  UserId:           string;
  UserName:         string;
  AvatarUrl:        string | null;
  TimeSpentSeconds: number;
  StartedAt:        Date;
  EndedAt:          Date | null;
  Billable:         boolean;
  Source:           string;
  Description:      string | null;
  CreatedAt:        Date;
}

function rowToLog(row: WorkLogRow): WorkLog {
  return {
    id:               row.Id,
    taskId:           row.TaskId,
    user:             { id: row.UserId, name: row.UserName, avatarUrl: row.AvatarUrl },
    timeSpentSeconds: row.TimeSpentSeconds,
    startedAt:        row.StartedAt instanceof Date ? row.StartedAt.toISOString() : String(row.StartedAt),
    endedAt:          row.EndedAt ? (row.EndedAt instanceof Date ? row.EndedAt.toISOString() : String(row.EndedAt)) : null,
    billable:         Boolean(row.Billable),
    source:           (row.Source as WorkLog['source']) ?? 'manual',
    description:      row.Description,
    createdAt:        row.CreatedAt instanceof Date ? row.CreatedAt.toISOString() : String(row.CreatedAt),
  };
}
```

Add these methods to `WorkLogRepository` (and import `TaskTimeRollup`, `WorkLogTag` from `@projectflow/types`):

```ts
  async startTimer(taskId: string, userId: string): Promise<WorkLog> {
    const rows = await execSpOne<WorkLogRow>('usp_WorkLog_StartTimer', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    ]);
    return rowToLog(rows[0]);
  }

  async stopTimer(userId: string): Promise<WorkLog | null> {
    const rows = await execSpOne<WorkLogRow>('usp_WorkLog_StopTimer', [
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    ]);
    return rows[0] ? rowToLog(rows[0]) : null;
  }

  async getActiveTimer(userId: string): Promise<WorkLog | null> {
    const rows = await execSpOne<WorkLogRow>('usp_WorkLog_GetActiveTimer', [
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    ]);
    return rows[0] ? rowToLog(rows[0]) : null;
  }

  async setTags(workLogId: string, tagIds: string[]): Promise<WorkLogTag[]> {
    const rows = await execSpOne<{ Id: string; Name: string; Color: string | null }>('usp_WorkLogTag_Set', [
      { name: 'WorkLogId', type: sql.UniqueIdentifier, value: workLogId },
      { name: 'TagIds',    type: sql.NVarChar(sql.MAX), value: tagIds.length ? tagIds.join(',') : null },
    ]);
    return rows.map((r) => ({ id: r.Id, name: r.Name, color: r.Color }));
  }

  async setEstimate(taskId: string, userId: string | null, estimateSeconds: number | null): Promise<void> {
    await execSpOne('usp_Task_SetEstimate', [
      { name: 'TaskId',          type: sql.UniqueIdentifier, value: taskId },
      { name: 'UserId',          type: sql.UniqueIdentifier, value: userId },
      { name: 'EstimateSeconds', type: sql.Int,              value: estimateSeconds },
    ]);
  }

  async getTimeRollup(taskId: string): Promise<TaskTimeRollup> {
    const rows = await execSpOne<{
      TaskId: string; OwnLoggedSeconds: number; OwnEstimateSeconds: number | null;
      RollupLoggedSeconds: number; RollupEstimateSeconds: number;
    }>('usp_Task_GetTimeRollup', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
    ]);
    const r = rows[0];
    return {
      taskId:                r.TaskId,
      ownLoggedSeconds:      r.OwnLoggedSeconds,
      ownEstimateSeconds:    r.OwnEstimateSeconds,
      rollupLoggedSeconds:   r.RollupLoggedSeconds,
      rollupEstimateSeconds: r.RollupEstimateSeconds,
    };
  }
```

Update the existing `create`/`update` signatures to pass billable/source/endedAt:

```ts
  async create(
    taskId: string, userId: string, timeSpentSeconds: number, startedAt: string,
    opts: { description?: string; billable?: boolean; source?: WorkLog['source']; endedAt?: string } = {},
  ): Promise<WorkLog> {
    const rows = await execSpOne<WorkLogRow>('usp_WorkLog_Create', [
      { name: 'TaskId',           type: sql.UniqueIdentifier, value: taskId },
      { name: 'UserId',           type: sql.UniqueIdentifier, value: userId },
      { name: 'TimeSpentSeconds', type: sql.Int,              value: timeSpentSeconds },
      { name: 'StartedAt',        type: sql.DateTime2,        value: new Date(startedAt) },
      { name: 'Description',      type: sql.NVarChar(500),    value: opts.description ?? null },
      { name: 'Billable',         type: sql.Bit,              value: opts.billable ?? false },
      { name: 'Source',           type: sql.NVarChar(10),     value: opts.source ?? 'manual' },
      { name: 'EndedAt',          type: sql.DateTime2,        value: opts.endedAt ? new Date(opts.endedAt) : null },
    ]);
    return rowToLog(rows[0]);
  }

  async update(
    id: string, userId: string,
    patch: { timeSpentSeconds?: number; startedAt?: string; description?: string; billable?: boolean; endedAt?: string },
  ): Promise<WorkLog | null> {
    const rows = await execSpOne<WorkLogRow>('usp_WorkLog_Update', [
      { name: 'Id',               type: sql.UniqueIdentifier, value: id },
      { name: 'UserId',           type: sql.UniqueIdentifier, value: userId },
      { name: 'TimeSpentSeconds', type: sql.Int,              value: patch.timeSpentSeconds ?? null },
      { name: 'StartedAt',        type: sql.DateTime2,        value: patch.startedAt ? new Date(patch.startedAt) : null },
      { name: 'Description',      type: sql.NVarChar(500),    value: patch.description ?? null },
      { name: 'Billable',         type: sql.Bit,              value: patch.billable ?? null },
      { name: 'EndedAt',          type: sql.DateTime2,        value: patch.endedAt ? new Date(patch.endedAt) : null },
    ]);
    return rows[0] ? rowToLog(rows[0]) : null;
  }
```

- [ ] Rewrite `worklog.service.ts` to expose the new operations (importing the new types + `estimateVsActual`):

```ts
import { WorkLogRepository } from './worklog.repository.js';
import { estimateVsActual, type EstimateVsActual } from './rollup.js';
import type { WorkLog, WorkLogListResult, WorkLogSource, TaskTimeRollup } from '@projectflow/types';

const repo = new WorkLogRepository();

export class WorkLogService {
  listByTask(taskId: string): Promise<WorkLogListResult> {
    return repo.listByTask(taskId);
  }

  async create(
    taskId: string, userId: string, timeSpentSeconds: number, startedAt: string,
    opts: { description?: string; billable?: boolean; source?: WorkLogSource; endedAt?: string; tagIds?: string[] } = {},
  ): Promise<WorkLog> {
    const log = await repo.create(taskId, userId, timeSpentSeconds, startedAt, opts);
    if (opts.tagIds) log.tags = await repo.setTags(log.id, opts.tagIds);
    return log;
  }

  async update(
    id: string, userId: string,
    patch: { timeSpentSeconds?: number; startedAt?: string; description?: string; billable?: boolean; endedAt?: string; tagIds?: string[] },
  ): Promise<WorkLog | null> {
    const log = await repo.update(id, userId, patch);
    if (log && patch.tagIds) log.tags = await repo.setTags(log.id, patch.tagIds);
    return log;
  }

  delete(id: string, userId: string): Promise<void> {
    return repo.delete(id, userId);
  }

  startTimer(taskId: string, userId: string): Promise<WorkLog> {
    return repo.startTimer(taskId, userId);
  }

  stopTimer(userId: string): Promise<WorkLog | null> {
    return repo.stopTimer(userId);
  }

  getActiveTimer(userId: string): Promise<WorkLog | null> {
    return repo.getActiveTimer(userId);
  }

  setEstimate(taskId: string, userId: string | null, estimateSeconds: number | null): Promise<void> {
    return repo.setEstimate(taskId, userId, estimateSeconds);
  }

  async getRollup(taskId: string): Promise<TaskTimeRollup & { estimateVsActual: EstimateVsActual }> {
    const rollup = await repo.getTimeRollup(taskId);
    return { ...rollup, estimateVsActual: estimateVsActual(rollup) };
  }
}
```

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS — no type errors (the route still compiles because Task 6 updates its `svc.create` call; if executing strictly task-by-task, also confirm `npm test --workspace apps/api -- rollup duration` still PASS).

- [ ] Commit:
```
git add packages/types/index.ts apps/api/src/modules/worklogs/rollup.ts apps/api/src/modules/worklogs/worklog.repository.ts apps/api/src/modules/worklogs/worklog.service.ts apps/api/src/modules/worklogs/__tests__/rollup.unit.test.ts apps/api/src/modules/worklogs/__tests__/duration.unit.test.ts
git commit -m "feat(8a): worklog types + repo/service for timer/billable/tags/estimate/rollup + pure unit tests"
```

---

### Task 6: REST routes + integration test

**Files:**
- Modify: `apps/api/src/modules/worklogs/worklog.routes.ts`
- Create: `apps/api/src/modules/worklogs/__tests__/timer.integration.test.ts`

Steps:

- [ ] Write the failing integration test first (copy the harness imports from `recurrence.integration.test.ts`: `testServer.js`, `truncate.js`, `factories.js`):

```ts
/**
 * Phase 8a — Time Tracking integration coverage.
 * Exercises the timer SPs + REST surface against the REAL SQL stack.
 * DB SAFETY: must target local Docker ProjectFlow_Test (see e2e/README).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function seedTask() {
  const owner = await createTestUser({ email: `wl-${Date.now()}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'WL Space', key: `WL${Date.now() % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'L', position: 0 },
  }), 201)).data;
  const task = (await json<{ task: any }>(await request('/tasks', {
    method: 'POST', token, json: { projectId: space.Id, workspaceId: ws.Id, title: 'T', listId: list.id },
  }), 201)).task;
  return { token, userId: owner.id, taskId: task.id, projectId: space.Id, workspaceId: ws.Id };
}

describe('worklog timer', () => {
  it('start then stop produces a closed entry with a non-null endedAt', async () => {
    const { token, taskId } = await seedTask();
    const started = (await json<{ log: any }>(await request('/worklogs/timer/start', {
      method: 'POST', token, json: { taskId },
    }), 201)).log;
    expect(started.endedAt).toBeNull();
    expect(started.source).toBe('timer');

    const stopped = (await json<{ log: any }>(await request('/worklogs/timer/stop', {
      method: 'POST', token, json: {},
    }))).log;
    expect(stopped.id).toBe(started.id);
    expect(stopped.endedAt).not.toBeNull();
    expect(stopped.timeSpentSeconds).toBeGreaterThanOrEqual(0);
  });

  it('a second start auto-stops the first (one active timer per user)', async () => {
    const { token, taskId } = await seedTask();
    const first  = (await json<{ log: any }>(await request('/worklogs/timer/start', { method: 'POST', token, json: { taskId } }), 201)).log;
    const second = (await json<{ log: any }>(await request('/worklogs/timer/start', { method: 'POST', token, json: { taskId } }), 201)).log;
    expect(second.id).not.toBe(first.id);

    const active = (await json<{ log: any }>(await request('/worklogs/timer/active', { token }))).log;
    expect(active.id).toBe(second.id);

    const list = (await json<{ logs: any[] }>(await request(`/worklogs?taskId=${taskId}`, { token }))).logs;
    const firstRow = list.find((l) => l.id === first.id);
    expect(firstRow.endedAt).not.toBeNull();    // the first was auto-closed
  });

  it('billable + tags persist on a manual entry', async () => {
    const { token, taskId, workspaceId, projectId } = await seedTask();
    // A Space-scoped tag (Phase 2 Tags).
    const tag = (await json<{ tag: any }>(await request('/tags', {
      method: 'POST', token, json: { spaceId: projectId, workspaceId, name: 'deep-work', color: '#0ea5e9' },
    }), 201)).tag;
    const log = (await json<{ log: any }>(await request('/worklogs', {
      method: 'POST', token,
      json: { taskId, timeSpentSeconds: 1800, startedAt: new Date().toISOString(), billable: true, tagIds: [tag.id] },
    }), 201)).log;
    expect(log.billable).toBe(true);
    expect(log.tags.map((t: any) => t.id)).toContain(tag.id);
  });

  it('rollup sums a subtask into the parent', async () => {
    const { token, taskId, projectId, workspaceId } = await seedTask();
    const child = (await json<{ task: any }>(await request('/tasks', {
      method: 'POST', token, json: { projectId, workspaceId, title: 'child', parentTaskId: taskId },
    }), 201)).task;
    await request('/worklogs', { method: 'POST', token, json: { taskId, timeSpentSeconds: 600, startedAt: new Date().toISOString() } });
    await request('/worklogs', { method: 'POST', token, json: { taskId: child.id, timeSpentSeconds: 900, startedAt: new Date().toISOString() } });
    await request(`/worklogs/tasks/${taskId}/estimate`, { method: 'PUT', token, json: { estimateSeconds: 3000 } });

    const rollup = (await json<{ rollup: any }>(await request(`/worklogs/tasks/${taskId}/rollup`, { token }))).rollup;
    expect(rollup.rollupLoggedSeconds).toBe(1500);    // 600 + 900
    expect(rollup.ownLoggedSeconds).toBe(600);
    expect(rollup.estimateVsActual.estimateSeconds).toBe(3000);
    expect(rollup.estimateVsActual.overBudget).toBe(false);
  });
});
```

- [ ] Run: `npm run test:integration --workspace apps/api -- timer` against `ProjectFlow_Test`. Expected: FAIL — the new routes 404 (not yet defined).

- [ ] Extend `worklog.routes.ts` — widen the create/update schemas and add the timer/estimate/rollup routes. The list/create/update/delete handlers keep their existing `requirePermission` gates; the timer + estimate routes are owner-scoped to the authed user. Add to the schemas and route file:

```ts
const createSchema = z.object({
  taskId:           z.string().uuid(),
  timeSpentSeconds: z.number().int().nonnegative(),
  startedAt:        z.string().datetime(),
  endedAt:          z.string().datetime().optional(),
  description:      z.string().max(500).optional(),
  billable:         z.boolean().optional(),
  source:           z.enum(['manual', 'range', 'timer']).optional(),
  tagIds:           z.array(z.string().uuid()).optional(),
});

const updateSchema = z.object({
  timeSpentSeconds: z.number().int().nonnegative().optional(),
  startedAt:        z.string().datetime().optional(),
  endedAt:          z.string().datetime().optional(),
  description:      z.string().max(500).optional(),
  billable:         z.boolean().optional(),
  tagIds:           z.array(z.string().uuid()).optional(),
});

const startTimerSchema = z.object({ taskId: z.string().uuid() });
const estimateSchema   = z.object({ estimateSeconds: z.number().int().nonnegative().nullable(), perAssignee: z.boolean().optional() });
```

Update the create handler body to pass options, then add the new routes (place the timer/estimate/rollup routes BEFORE the `/:id` patch/delete so static segments win):

```ts
// POST /worklogs  (create handler — pass the new options through)
//   const log = await svc.create(taskId, userId, timeSpentSeconds, startedAt,
//     { description, billable, source, endedAt, tagIds });

// POST /worklogs/timer/start — start a timer on a task (owner = authed user)
worklogRoutes.post(
  '/timer/start',
  zValidator('json', startTimerSchema),
  requirePermission('worklog.create', { resolveWorkspace: resolveTaskWorkspaceFromBody }),
  async (c) => {
    const userId = ((c as any).get('user') as any).userId as string;
    const { taskId } = c.req.valid('json');
    const log = await svc.startTimer(taskId, userId);
    return c.json({ log }, 201);
  },
);

// POST /worklogs/timer/stop — stop the authed user's running timer
worklogRoutes.post('/timer/stop', async (c) => {
  const userId = ((c as any).get('user') as any).userId as string;
  const log = await svc.stopTimer(userId);
  return c.json({ log });
});

// GET /worklogs/timer/active — the authed user's running timer (or null)
worklogRoutes.get('/timer/active', async (c) => {
  const userId = ((c as any).get('user') as any).userId as string;
  const log = await svc.getActiveTimer(userId);
  return c.json({ log });
});

// PUT /worklogs/tasks/:taskId/estimate — set the task (or per-assignee) estimate
worklogRoutes.put(
  '/tasks/:taskId/estimate',
  requirePermission('worklog.create', {
    resolveWorkspace: async (c: any) => taskRepoForLookup.getWorkspaceId(c.req.param('taskId')),
  }),
  zValidator('json', estimateSchema),
  async (c) => {
    const userId = ((c as any).get('user') as any).userId as string;
    const taskId = c.req.param('taskId');
    const { estimateSeconds, perAssignee } = c.req.valid('json');
    await svc.setEstimate(taskId, perAssignee ? userId : null, estimateSeconds);
    const rollup = await svc.getRollup(taskId);
    return c.json({ rollup });
  },
);

// GET /worklogs/tasks/:taskId/rollup — logged/estimate rollup + estimate-vs-actual
worklogRoutes.get('/tasks/:taskId/rollup', async (c) => {
  const taskId = c.req.param('taskId');
  const rollup = await svc.getRollup(taskId);
  return c.json({ rollup });
});
```

Also update the existing `POST /worklogs` handler call to:
```ts
const log = await svc.create(taskId, userId, timeSpentSeconds, startedAt,
  { description, billable, source, endedAt, tagIds });
```
and the `PATCH /worklogs/:id` handler to pass the validated `patch` (now including `billable`/`endedAt`/`tagIds`) unchanged into `svc.update`.

- [ ] Run: `npm run test:integration --workspace apps/api -- timer` against `ProjectFlow_Test`. Expected: PASS (4 tests). Then full unit: `npm test --workspace apps/api`. Expected: PASS.

- [ ] Commit:
```
git add apps/api/src/modules/worklogs/worklog.routes.ts apps/api/src/modules/worklogs/__tests__/timer.integration.test.ts
git commit -m "feat(8a): worklog REST — timer start/stop/active + estimate + rollup routes + integration test"
```

---

### Task 7: GraphQL mirror (`worklog.schema.ts`)

**Files:**
- Create: `apps/api/src/graphql/worklog.schema.ts`
- Modify: `apps/api/src/graphql/schema.ts` (import + call near the other `register*Graphql()` calls, ~line 761)

Steps:

- [ ] Write `worklog.schema.ts`, mirroring `recurrence.schema.ts`'s structure (typed `objectRef`, `notFound`/`requireObjectLevel`/`requireWorkspacePermission` from `./authz.js`, delegating to one shared `WorkLogService`):

```ts
import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { WorkLogService } from '../modules/worklogs/worklog.service.js';
import { TaskRepository } from '../modules/tasks/task.repository.js';
import { notFound, requireObjectLevel, requireWorkspacePermission } from './authz.js';
import type { WorkLog, TaskTimeRollup } from '@projectflow/types';

const svc = new WorkLogService();
const taskRepo = new TaskRepository();
async function taskListId(taskId: string): Promise<string | null> {
  const t = await taskRepo.getById(taskId);
  return (t as any)?.listId ?? (t as any)?.ListId ?? null;
}

export function registerWorkLogGraphql(): void {
  const WorkLogType = builder.objectRef<WorkLog>('WorkLog');
  WorkLogType.implement({ fields: (t) => ({
    id:               t.exposeString('id'),
    taskId:           t.exposeString('taskId'),
    timeSpentSeconds: t.exposeInt('timeSpentSeconds'),
    startedAt:        t.field({ type: 'Date', resolve: (w) => new Date(w.startedAt) }),
    endedAt:          t.field({ type: 'Date', nullable: true, resolve: (w) => (w.endedAt ? new Date(w.endedAt) : null) }),
    billable:         t.boolean({ resolve: (w) => w.billable }),
    source:           t.exposeString('source'),
    description:      t.string({ nullable: true, resolve: (w) => w.description ?? null }),
    createdAt:        t.field({ type: 'Date', resolve: (w) => new Date(w.createdAt) }),
  }) });

  const RollupType = builder.objectRef<TaskTimeRollup>('TaskTimeRollup');
  RollupType.implement({ fields: (t) => ({
    taskId:                t.exposeString('taskId'),
    ownLoggedSeconds:      t.exposeInt('ownLoggedSeconds'),
    ownEstimateSeconds:    t.int({ nullable: true, resolve: (r) => r.ownEstimateSeconds ?? null }),
    rollupLoggedSeconds:   t.exposeInt('rollupLoggedSeconds'),
    rollupEstimateSeconds: t.exposeInt('rollupEstimateSeconds'),
  }) });

  builder.queryFields((t) => ({
    taskWorkLogs: t.field({
      type: [WorkLogType],
      args: { taskId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const workspaceId = await taskRepo.getWorkspaceId(a.taskId);
        if (!workspaceId) notFound('Task not found');
        await requireObjectLevel(ctx, 'LIST', await taskListId(a.taskId), 'VIEW');
        return (await svc.listByTask(a.taskId)).logs;
      },
    }),
    activeTimer: t.field({
      type: WorkLogType,
      nullable: true,
      resolve: async (_, __, ctx) => {
        if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
        return svc.getActiveTimer((ctx.user as any).userId);
      },
    }),
    taskTimeRollup: t.field({
      type: RollupType,
      args: { taskId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const workspaceId = await taskRepo.getWorkspaceId(a.taskId);
        if (!workspaceId) notFound('Task not found');
        await requireObjectLevel(ctx, 'LIST', await taskListId(a.taskId), 'VIEW');
        return svc.getRollup(a.taskId);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    startTimer: t.field({
      type: WorkLogType,
      args: { taskId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const workspaceId = await taskRepo.getWorkspaceId(a.taskId);
        if (!workspaceId) notFound('Task not found');
        await requireWorkspacePermission(ctx, workspaceId, 'worklog.create');
        return svc.startTimer(a.taskId, (ctx.user as any).userId);
      },
    }),
    stopTimer: t.field({
      type: WorkLogType,
      nullable: true,
      resolve: async (_, __, ctx) => {
        if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
        return svc.stopTimer((ctx.user as any).userId);
      },
    }),
    createWorkLog: t.field({
      type: WorkLogType,
      args: {
        taskId:           t.arg.string({ required: true }),
        timeSpentSeconds: t.arg.int({ required: true }),
        startedAt:        t.arg.string({ required: true }),
        endedAt:          t.arg.string({ required: false }),
        description:      t.arg.string({ required: false }),
        billable:         t.arg.boolean({ required: false }),
        source:           t.arg.string({ required: false }),
        tagIds:           t.arg.stringList({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        const workspaceId = await taskRepo.getWorkspaceId(a.taskId);
        if (!workspaceId) notFound('Task not found');
        await requireWorkspacePermission(ctx, workspaceId, 'worklog.create');
        return svc.create(a.taskId, (ctx.user as any).userId, a.timeSpentSeconds, a.startedAt, {
          endedAt: a.endedAt ?? undefined, description: a.description ?? undefined,
          billable: a.billable ?? undefined, source: (a.source as any) ?? undefined,
          tagIds: a.tagIds ?? undefined,
        });
      },
    }),
    updateWorkLog: t.field({
      type: WorkLogType,
      nullable: true,
      args: {
        id:               t.arg.string({ required: true }),
        timeSpentSeconds: t.arg.int({ required: false }),
        startedAt:        t.arg.string({ required: false }),
        description:      t.arg.string({ required: false }),
        billable:         t.arg.boolean({ required: false }),
        tagIds:           t.arg.stringList({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
        return svc.update(a.id, (ctx.user as any).userId, {
          timeSpentSeconds: a.timeSpentSeconds ?? undefined, startedAt: a.startedAt ?? undefined,
          description: a.description ?? undefined, billable: a.billable ?? undefined,
          tagIds: a.tagIds ?? undefined,
        });
      },
    }),
    deleteWorkLog: t.field({
      type: 'Boolean',
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
        await svc.delete(a.id, (ctx.user as any).userId);
        return true;
      },
    }),
  }));
}
```

- [ ] Wire it into `schema.ts` — add the import alongside the others and call it near the other `register*Graphql()` calls:

```ts
import { registerWorkLogGraphql } from './worklog.schema.js';
```
```ts
// ─────────────────────────────────────────
// Work Logs (Phase 8a) — WorkLog/TaskTimeRollup types + taskWorkLogs/activeTimer/
// taskTimeRollup queries + startTimer/stopTimer/create/update/deleteWorkLog.
// ─────────────────────────────────────────
registerWorkLogGraphql();
```

- [ ] Run: `npm run build --workspace apps/api` (tsc — compiles the Pothos schema). Expected: PASS — no type errors; schema builds. Then `npm test --workspace apps/api`. Expected: PASS (existing GraphQL authz tests still green).

- [ ] Commit:
```
git add apps/api/src/graphql/worklog.schema.ts apps/api/src/graphql/schema.ts
git commit -m "feat(8a): GraphQL worklog mirror — taskWorkLogs/activeTimer/rollup + timer/CRUD mutations"
```

---

### Task 8: Global timer widget + server actions + unit test

**Files:**
- Modify: `apps/next-web/src/server/actions/worklogs.ts`
- Create: `apps/next-web/src/components/GlobalTimerWidget.tsx`
- Create: `apps/next-web/src/components/GlobalTimerWidget.module.css`
- Create: `apps/next-web/src/components/__tests__/GlobalTimerWidget.unit.test.tsx`
- Note: read `node_modules/next/dist/docs/` per `apps/next-web/AGENTS.md` before writing web code (this Next.js has breaking changes).

Steps:

- [ ] Add server actions to `worklogs.ts` — mirror the existing `addWorkLog`/`loadWorkLogs` shape (same `{ ok, error }` result envelope they already return), calling the new REST endpoints:

```ts
export async function startTimer(taskId: string) {
  return apiAction('/worklogs/timer/start', { method: 'POST', body: { taskId } });
}
export async function stopTimer() {
  return apiAction('/worklogs/timer/stop', { method: 'POST', body: {} });
}
export async function getActiveTimer() {
  return apiAction('/worklogs/timer/active', { method: 'GET' });
}
export async function setEstimate(taskId: string, estimateSeconds: number | null, perAssignee = false) {
  return apiAction(`/worklogs/tasks/${taskId}/estimate`, { method: 'PUT', body: { estimateSeconds, perAssignee } });
}
export async function getRollup(taskId: string) {
  return apiAction(`/worklogs/tasks/${taskId}/rollup`, { method: 'GET' });
}
```
(Use whatever the file's existing fetch wrapper is — match `addWorkLog`'s implementation exactly; `apiAction` above is a placeholder name for that existing helper, adapt to the real one in the file.)

- [ ] Write the failing widget unit test (extract the live-elapsed formatter so it is testable without timers):

```tsx
import { describe, it, expect } from 'vitest';
import { formatElapsed } from '../GlobalTimerWidget';

describe('formatElapsed', () => {
  it('formats h:mm:ss', () => {
    expect(formatElapsed(3661)).toBe('1:01:01');
  });
  it('formats m:ss under an hour', () => {
    expect(formatElapsed(125)).toBe('2:05');
  });
  it('shows 0:00 at zero', () => {
    expect(formatElapsed(0)).toBe('0:00');
  });
});
```

- [ ] Run: `npm test --workspace apps/next-web -- GlobalTimerWidget`. Expected: FAIL — module not found / `formatElapsed` undefined.

- [ ] Write `GlobalTimerWidget.tsx` — a client component that loads the active timer, ticks a live elapsed counter once per second, and exposes start/stop. It is mounted in the app shell layout:

```tsx
'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { startTimer, stopTimer, getActiveTimer } from '@/server/actions/worklogs';
import { notifyActionError } from '@/lib/apiErrorToast';
import { useTranslations } from 'next-intl';
import styles from './GlobalTimerWidget.module.css';
import type { WorkLog } from '@projectflow/types';

/** Format elapsed seconds → "1:01:01" (with hours) or "2:05" (under an hour). */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function GlobalTimerWidget() {
  const t = useTranslations('Timer');
  const [active, setActive] = useState<WorkLog | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pending, start] = useTransition();
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getActiveTimer().then((r: any) => { if (r.ok) setActive(r.data?.log ?? null); });
  }, []);

  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (!active) { setElapsed(0); return; }
    const startedMs = new Date(active.startedAt).getTime();
    const update = () => setElapsed(Math.floor((Date.now() - startedMs) / 1000));
    update();
    tickRef.current = setInterval(update, 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [active]);

  const onStop = () => start(async () => {
    const r: any = await stopTimer();
    if (!r.ok) return notifyActionError(r);
    setActive(null);
  });

  if (!active) return null; // hidden when idle; tasks start it via WorkLogSection

  return (
    <div className={styles.root} aria-label={t('running')}>
      <span className={styles.dot} aria-hidden />
      <span className={styles.elapsed}>{formatElapsed(elapsed)}</span>
      <button className={styles.stopBtn} onClick={onStop} disabled={pending}>
        {pending ? t('stopping') : t('stop')}
      </button>
    </div>
  );
}
```

Expose a `startTimerForTask(taskId)` helper used by `WorkLogSection` (Task 9) by re-exporting the `startTimer` action; the widget re-reads active state after a task starts it (cross-component refresh via the existing app refresh path / a re-fetch on focus).

- [ ] Write `GlobalTimerWidget.module.css` (minimal, theme-token based):

```css
.root { display: inline-flex; align-items: center; gap: 8px; padding: 4px 10px; border-radius: 8px; background: var(--surface-2, #1f2937); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #ef4444; animation: pulse 1.2s infinite; }
.elapsed { font-variant-numeric: tabular-nums; font-weight: 600; }
.stopBtn { border: none; border-radius: 6px; padding: 2px 10px; cursor: pointer; background: #ef4444; color: #fff; }
.stopBtn:disabled { opacity: .6; cursor: default; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
```

- [ ] Mount `<GlobalTimerWidget />` in the app-shell layout (the authenticated layout that already renders the top bar / `NotificationBell`). Add the import + place it in the header region.

- [ ] Run: `npm test --workspace apps/next-web -- GlobalTimerWidget`. Expected: PASS (3 tests).

- [ ] Commit:
```
git add apps/next-web/src/server/actions/worklogs.ts apps/next-web/src/components/GlobalTimerWidget.tsx apps/next-web/src/components/GlobalTimerWidget.module.css apps/next-web/src/components/__tests__/GlobalTimerWidget.unit.test.tsx
git commit -m "feat(8a): global timer widget — live elapsed tick + start/stop + server actions"
```

---

### Task 9: Upgrade `WorkLogSection.tsx` (billable, tags, range, start-timer) + i18n

**Files:**
- Modify: `apps/next-web/src/components/WorkLogSection.tsx`
- Modify: `apps/next-web/src/messages/en.json`
- Modify: `apps/next-web/src/messages/id.json`

Steps:

- [ ] Extend the create form in `WorkLogSection.tsx`: add a billable checkbox, a tag picker (reuse the existing Space-tag picker component if present, else a multi-select bound to `spaceTags`), a manual/range mode toggle (range shows start + end datetime inputs and submits `source: 'range'` with both timestamps), and a "Start timer here" button that calls the `startTimer(taskId)` action. Keep the existing `parseDuration`/`formatDuration` helpers. Update `onCreate` to pass the new fields:

```tsx
const onCreate = () => {
  if (mode === 'manual') {
    const secs = parseDuration(timeInput);
    if (!secs) { setError(t('invalidTimeFormat')); return; }
    start(async () => {
      const r = await addWorkLog(taskId, {
        timeSpentSeconds: secs,
        startedAt:        new Date(dateInput).toISOString(),
        description:      descInput.trim() || undefined,
        billable,
        source:           'manual',
        tagIds:           selectedTagIds.length ? selectedTagIds : undefined,
      });
      if (!r.ok) { setError(r.error); notifyActionError(r); return; }
      resetForm(); await refetch();
    });
  } else {
    // range mode: explicit start/end
    const startIso = new Date(rangeStart).toISOString();
    const endIso   = new Date(rangeEnd).toISOString();
    const secs = Math.max(0, Math.floor((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000));
    if (secs <= 0) { setError(t('invalidRange')); return; }
    start(async () => {
      const r = await addWorkLog(taskId, {
        timeSpentSeconds: secs, startedAt: startIso, endedAt: endIso,
        description: descInput.trim() || undefined, billable, source: 'range',
        tagIds: selectedTagIds.length ? selectedTagIds : undefined,
      });
      if (!r.ok) { setError(r.error); notifyActionError(r); return; }
      resetForm(); await refetch();
    });
  }
};

const onStartTimerHere = () => start(async () => {
  const r = await startTimer(taskId);
  if (!r.ok) return notifyActionError(r);
});
```

Render the billable toggle, tag picker, and the mode toggle + range inputs inside the existing `{showForm && (...)}` block; render an entry's `log.billable` badge and `log.tags` chips in the log list. Show a "running" indicator for entries where `log.endedAt === null`.

- [ ] Add i18n keys. In `en.json` add a `Timer` namespace and extend `WorkLog`:

```json
"Timer": {
  "running": "Timer running",
  "stop": "Stop",
  "stopping": "Stopping…",
  "startHere": "Start timer"
},
"WorkLog": {
  "billable": "Billable",
  "modeManual": "Duration",
  "modeRange": "Start / end",
  "rangeStart": "Start",
  "rangeEnd": "End",
  "invalidRange": "End must be after start",
  "tags": "Tags",
  "running": "Running"
}
```
(merge these keys into the existing `WorkLog` block; do not drop existing keys).

- [ ] Add the same keys to `id.json` with real Indonesian, e.g.:

```json
"Timer": {
  "running": "Pengatur waktu berjalan",
  "stop": "Hentikan",
  "stopping": "Menghentikan…",
  "startHere": "Mulai pengatur waktu"
},
"WorkLog": {
  "billable": "Dapat ditagih",
  "modeManual": "Durasi",
  "modeRange": "Mulai / selesai",
  "rangeStart": "Mulai",
  "rangeEnd": "Selesai",
  "invalidRange": "Selesai harus setelah mulai",
  "tags": "Tag",
  "running": "Berjalan"
}
```

- [ ] Run: `npm test --workspace apps/next-web` (includes the `messages.unit` i18n parity test). Expected: PASS — en/id key parity green; existing WorkLog tests green.

- [ ] Commit:
```
git add apps/next-web/src/components/WorkLogSection.tsx apps/next-web/src/messages/en.json apps/next-web/src/messages/id.json
git commit -m "feat(8a): WorkLogSection — billable toggle, tag picker, manual/range entry, start-timer + i18n"
```

---

### Task 10: Estimate field + estimate-vs-actual bar + rollup total (task panel)

**Files:**
- Create: `apps/next-web/src/components/TaskEstimateBar.tsx`
- Create: `apps/next-web/src/components/TaskEstimateBar.module.css`
- Modify: the task detail panel that already renders `<WorkLogSection />` (mount `<TaskEstimateBar />` adjacent to it)
- Modify: `apps/next-web/src/messages/en.json` + `id.json` (add an `Estimate` namespace)

Steps:

- [ ] Write `TaskEstimateBar.tsx` — loads the rollup, lets the user set the task estimate (reusing `parseDuration`/`formatDuration` from `WorkLogSection` — extract them to a shared `lib/duration.ts` so both import it), renders a logged/estimate progress bar (over-budget styled red) and the subtree rollup total:

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { setEstimate, getRollup } from '@/server/actions/worklogs';
import { notifyActionError } from '@/lib/apiErrorToast';
import { useTranslations } from 'next-intl';
import { formatDuration, parseDuration } from '@/lib/duration';
import styles from './TaskEstimateBar.module.css';

interface Rollup {
  ownLoggedSeconds: number; ownEstimateSeconds: number | null;
  rollupLoggedSeconds: number; rollupEstimateSeconds: number;
  estimateVsActual: { ratio: number | null; remainingSeconds: number | null; overBudget: boolean; loggedSeconds: number; estimateSeconds: number };
}

export function TaskEstimateBar({ taskId }: { taskId: string }) {
  const t = useTranslations('Estimate');
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [input, setInput] = useState('');
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();

  const refetch = () => getRollup(taskId).then((r: any) => { if (r.ok) setRollup(r.data.rollup); });
  useEffect(() => { if (taskId) refetch(); /* eslint-disable-line */ }, [taskId]);

  const onSave = () => start(async () => {
    const secs = parseDuration(input);
    const r: any = await setEstimate(taskId, secs);
    if (!r.ok) return notifyActionError(r);
    setEditing(false); setInput(''); await refetch();
  });

  if (!rollup) return null;
  const eva = rollup.estimateVsActual;
  const pct = eva.ratio === null ? 0 : Math.min(100, Math.round(eva.ratio * 100));

  return (
    <div className={styles.root}>
      <div className={styles.headerRow}>
        <span className={styles.label}>{t('estimate')}</span>
        {editing ? (
          <span className={styles.editRow}>
            <input className={styles.input} value={input} onChange={(e) => setInput(e.target.value)} placeholder="2h 30m" />
            <button className={styles.saveBtn} onClick={onSave} disabled={pending}>{t('save')}</button>
          </span>
        ) : (
          <button className={styles.editBtn} onClick={() => { setEditing(true); setInput(rollup.ownEstimateSeconds ? formatDuration(rollup.ownEstimateSeconds) : ''); }}>
            {rollup.ownEstimateSeconds ? formatDuration(rollup.ownEstimateSeconds) : t('setEstimate')}
          </button>
        )}
      </div>
      <div className={styles.barTrack}>
        <div className={`${styles.barFill} ${eva.overBudget ? styles.over : ''}`} style={{ width: `${pct}%` }} />
      </div>
      <div className={styles.legend}>
        <span>{t('logged', { duration: formatDuration(eva.loggedSeconds) })}</span>
        <span>{t('rollup', { duration: formatDuration(rollup.rollupLoggedSeconds) })}</span>
        {eva.remainingSeconds !== null && !eva.overBudget && <span>{t('remaining', { duration: formatDuration(eva.remainingSeconds) })}</span>}
        {eva.overBudget && <span className={styles.overText}>{t('overBudget')}</span>}
      </div>
    </div>
  );
}
```

- [ ] Write `TaskEstimateBar.module.css`:

```css
.root { display: flex; flex-direction: column; gap: 6px; }
.headerRow { display: flex; align-items: center; justify-content: space-between; }
.label { font-weight: 600; }
.editRow { display: inline-flex; gap: 6px; }
.input { width: 100px; padding: 2px 6px; }
.barTrack { height: 8px; border-radius: 4px; background: var(--surface-2, #e5e7eb); overflow: hidden; }
.barFill { height: 100%; background: #22c55e; transition: width .2s; }
.barFill.over { background: #ef4444; }
.legend { display: flex; gap: 12px; font-size: 12px; color: var(--text-2, #6b7280); }
.overText { color: #ef4444; font-weight: 600; }
```

- [ ] Extract `formatDuration`/`parseDuration` from `WorkLogSection.tsx` into `apps/next-web/src/lib/duration.ts` (verbatim bodies) and import them in both `WorkLogSection.tsx` and `TaskEstimateBar.tsx`. Mount `<TaskEstimateBar taskId={taskId} />` above `<WorkLogSection />` in the task detail panel.

- [ ] Add `Estimate` namespace to `en.json` and `id.json`:

en.json:
```json
"Estimate": {
  "estimate": "Estimate",
  "setEstimate": "Set estimate",
  "save": "Save",
  "logged": "Logged {duration}",
  "rollup": "Subtotal {duration}",
  "remaining": "{duration} left",
  "overBudget": "Over estimate"
}
```
id.json:
```json
"Estimate": {
  "estimate": "Estimasi",
  "setEstimate": "Atur estimasi",
  "save": "Simpan",
  "logged": "Tercatat {duration}",
  "rollup": "Subtotal {duration}",
  "remaining": "Sisa {duration}",
  "overBudget": "Melebihi estimasi"
}
```

- [ ] Run: `npm test --workspace apps/next-web` (i18n parity + unit). Expected: PASS. Then `npm run build --workspace apps/next-web`. Expected: PASS (Next build clean).

- [ ] Commit:
```
git add apps/next-web/src/components/TaskEstimateBar.tsx apps/next-web/src/components/TaskEstimateBar.module.css apps/next-web/src/lib/duration.ts apps/next-web/src/components/WorkLogSection.tsx apps/next-web/src/messages/en.json apps/next-web/src/messages/id.json
git commit -m "feat(8a): task estimate field + estimate-vs-actual bar + subtree rollup total + i18n"
```

---

### Task 11: Playwright e2e (headline flow)

**Files:**
- Create: `apps/next-web/e2e/time-tracking.spec.ts`
- Note: e2e runs against local Docker `ProjectFlow_Test` only (use the project's existing e2e env/setup, same as the views/realtime specs).

Steps:

- [ ] Write the e2e spec covering the BUILD_PLAN acceptance flow — start the global timer on a task, stop it, see the entry; set an estimate and see the estimate-vs-actual bar. Follow the existing spec harness (login helper, seeded project/task) used by the views/presence specs:

```ts
import { test, expect } from '@playwright/test';
import { loginAndSeedTask } from './helpers'; // existing helper used by other specs

test.describe('Phase 8a — time tracking', () => {
  test('global timer tracks a task, stop produces an entry, estimate-vs-actual renders', async ({ page }) => {
    const { taskUrl } = await loginAndSeedTask(page);
    await page.goto(taskUrl);

    // Start a timer from the worklog section.
    await page.getByRole('button', { name: /log work/i }).click();
    await page.getByRole('button', { name: /start timer/i }).click();

    // Global timer widget appears and is running.
    const widget = page.getByLabel(/timer running/i);
    await expect(widget).toBeVisible();
    await expect(widget.getByText(/^\d+:\d{2}/)).toBeVisible();

    // Stop it.
    await widget.getByRole('button', { name: /^stop$/i }).click();
    await expect(widget).toBeHidden();

    // The stopped entry now shows in the list (a timer-sourced log).
    await expect(page.getByText(/running/i)).toHaveCount(0);
    await expect(page.locator('[data-worklog-source="timer"]').first()).toBeVisible();

    // Set an estimate and see the estimate-vs-actual bar.
    await page.getByRole('button', { name: /set estimate/i }).click();
    await page.getByPlaceholder('2h 30m').fill('1h');
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByText(/logged/i)).toBeVisible();
  });
});
```

(Add `data-worklog-source={log.source}` to the log item element in `WorkLogSection.tsx` so the e2e can target timer-sourced entries deterministically.)

- [ ] Run: the project's e2e command for a single spec against `ProjectFlow_Test` (the same invocation the views/realtime specs use, e.g. `npx playwright test e2e/time-tracking.spec.ts`). Expected: PASS (1 test) — timer starts/stops, entry visible, estimate bar renders.

- [ ] Commit:
```
git add apps/next-web/e2e/time-tracking.spec.ts apps/next-web/src/components/WorkLogSection.tsx
git commit -m "test(8a): e2e — global timer start/stop on a task + estimate-vs-actual render"
```

---

### Task 12: Slice verification + DECISIONS.md

**Files:**
- Modify: `DECISIONS.md` (append a Phase 8a entry)

Steps:

- [ ] Run the full slice verification on local Docker `ProjectFlow_Test`:
  - `npm test --workspace apps/api` — Expected: PASS (existing suite + new `rollup`/`duration` unit tests).
  - `npm run test:integration --workspace apps/api` — Expected: PASS (existing + `timer.integration.test.ts`).
  - `npm test --workspace apps/next-web` — Expected: PASS (unit + `messages.unit` parity).
  - `npm run build --workspace apps/api` and `npm run build --workspace apps/next-web` — Expected: both PASS.
  - The time-tracking e2e — Expected: PASS.

- [ ] Append a `DECISIONS.md` entry logging: the in-place `WorkLogs` evolution (no `TimeEntries` table), the filtered-unique-index + auto-stop-in-SP one-timer mechanism, `Source` derivation semantics, the comma-delimited `@TagIds` transport in `usp_WorkLogTag_Set`, the `MAXRECURSION 0` subtree rollup, the new GraphQL mirror, and any deviation found during implementation. DB-execution-policy note: all DB work ran ONLY against local Docker `ProjectFlow_Test`.

- [ ] Commit:
```
git add DECISIONS.md
git commit -m "docs(8a): DECISIONS entry — time-tracking timer/estimate/rollup + GraphQL mirror"
```

---

## Definition of Done

Per-slice DoD (spec §3) + BUILD_PLAN acceptance (spec §4.5):

- [ ] **BUILD_PLAN acceptance:** Global timer tracks across tasks; **only one active timer per user** (enforced by `UQ_WorkLog_ActiveTimer` + `usp_WorkLog_StartTimer` auto-stop); **rollup to parent works** (`usp_Task_GetTimeRollup` sums the `ParentTaskId` subtree).
- [ ] Migration `0043_time_tracking.sql` is idempotent, GO-batched, and **reversible** via `rollback/0043_time_tracking.down.sql` (apply→rollback→re-apply verified clean).
- [ ] SP-per-op for every new operation (`usp_WorkLog_StartTimer`/`StopTimer`/`GetActiveTimer`, `usp_WorkLogTag_Set`, `usp_Task_SetEstimate`, `usp_Task_GetTimeRollup`); create/update/list SPs extended for billable/source/endedAt.
- [ ] REST is the primary surface; the **GraphQL mirror** (`taskWorkLogs`, `activeTimer`, `taskTimeRollup`, `startTimer`, `stopTimer`, `createWorkLog`, `updateWorkLog`, `deleteWorkLog`) delegates to the **one shared `WorkLogService`**.
- [ ] Authorization fail-closed via `requirePermission` using the **existing** slugs (`worklog.create`, `worklog.update.own`, `worklog.delete.own`/`.any`) + `requireObjectLevel`/`requireWorkspacePermission` on the GraphQL side.
- [ ] Unit tests (duration, rollup/estimate-vs-actual) + integration tests (start→stop duration, second-start auto-stop, billable+tags persist, subtree rollup) + ≥1 Playwright e2e for the headline flow — all green.
- [ ] `@projectflow/types` updated (`WorkLog` evolved + `WorkLogSource`/`WorkLogTag`/`ActiveTimer`/`TaskTimeRollup` + extended inputs).
- [ ] i18n: new `Timer`/`WorkLog`/`Estimate` keys in **en.json + id.json** (real Indonesian); `messages.unit` parity green.
- [ ] All DB work (migrations, SP deploy, integration, e2e) ran **ONLY against local Docker `ProjectFlow_Test`** — never the prod-pointing `apps/api/.env`.
- [ ] `DECISIONS.md` entry logs the mechanism choices + any deviations. **Stop for review/merge before Slice 8b.**
