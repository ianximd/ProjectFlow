# Phase 9c — Scheduled Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a dashboard (or a single report) deliverable on a recurring cadence. A `ScheduledReports` row binds a dashboard/report to an RRULE-ish cadence + a recipient set; a BullMQ repeatable **`scheduled-report.worker.ts`** sweeps due schedules, **snapshots** the dashboard (resolving every card via the Phase 9a `card.service` into a frozen payload), records a `ScheduledReportRuns` audit row that is **idempotent per `(ScheduledReportId, PeriodKey)`**, and **delivers via the Phase 3.5 notification/inbox path** (an in-app "your report is ready" notification linking the frozen snapshot). The email adapter is an explicit **no-op stub** behind `DeliveryChannel='email'` (deferred to Phase 12). A schedule editor + run-history list + read-only snapshot viewer complete the surface.

**Architecture:** Copies the Phase 5c repeatable-sweep pattern wholesale (`apps/api/src/modules/recurrence/recurrence.worker.ts`): an idempotent `start*Worker()` gated on Redis, a fixed sweep interval via `upsertJobScheduler`, and a pure `runScheduledReportSweep(now?)` helper so unit/integration tests drive the work without Redis or a Worker. Next-run computation **reuses the Phase 5 recurrence-rule evaluator** (`computeNextOccurrence`/`validateRule` from `apps/api/src/modules/recurrence/recurrence.ts`) — the same `{freq,interval,byWeekday,byMonthday,endsAt,count}` shape. The `PeriodKey` (a stable per-occurrence string, e.g. `2026-06-08T09:00:00.000Z`) plus a `UNIQUE(ScheduledReportId, PeriodKey)` constraint makes a re-run of the same period a no-op INSERT — so a worker restart mid-period never double-delivers. `snapshot(schedule)` resolves every card on the bound dashboard through `card.service.resolve(card, scope)` (the Phase 9a §4.2 dispatcher) under the schedule owner's object-level filter and freezes the result into `SnapshotRef`. Delivery fans a notification out to each recipient via `notificationService.notify(...)`. SP-per-op in `infra/sql/procedures/`, surfaced through `scheduled-report.repository` → `scheduled-report.service`, exposed as Hono REST (primary) + a graphql-yoga/Pothos mirror, both delegating to the one shared service.

**Tech Stack:** SQL Server stored procedures (`CREATE OR ALTER`, `SET NOCOUNT ON`, TRY/CATCH/TRANSACTION, `SELECT *` of affected rows); BullMQ repeatable Worker + Queue (`bullmq`, Redis-gated, mirrors `recurrence.worker.ts`); Hono REST + `@hono/zod-validator`; graphql-yoga + Pothos (`@pothos/core`) in `graphql/schema.ts`; `mssql` via `execSp`/`execSpOne`; vitest (`--project unit` / `--project integration`); Next.js App Router (SSR) + `next-intl` (en + id parity); Playwright e2e. DB work runs ONLY against local Docker `ProjectFlow_Test`.

**Prerequisite:** Phase 9a merged (`card.service` + dashboards); Phase 5 recurrence evaluator + Phase 3.5 notification/inbox exist. (9c reads the Phase 9a `Dashboards`/`DashboardCards` tables + the `card.service.resolve(card, scope)` dispatcher; reuses `computeNextOccurrence`/`validateRule` from `recurrence.ts`; delivers through `notificationService.notify`.) Phase 9c adds **no view-type / dashboard schema** of its own — only `0048_scheduled_reports.sql`.

> **9a contract this slice depends on (spec §4.2 — source of truth).** `card.service` exposes `resolve(card, scope)` where `card` is a `DashboardCard` row (`{ id, dashboardId, type, title, config, layout }`) and `scope` is `{ scopeType: 'workspace'|'space'|'folder'|'list', scopeId, requesterId }`; it returns the card's resolved data payload (generic cards → Phase 3 query compiler; report cards → `usp_Report_*`; entity cards → Phase 8 services). `dashboard.service` exposes `getById(id)` → `Dashboard` (`{ id, workspaceId, scopeType, scopeId, name, ownerId, ... }`) and a card-list accessor (e.g. `listCards(dashboardId)` → `DashboardCard[]`). **If a 9a accessor name differs at implementation time, adapt the call but keep the snapshot semantics (resolve every card under the owner's object-level filter, freeze the payload).** This is noted inline at every call site below.

---

## File Structure

**Migration** (`infra/sql/migrations/`)
- `0048_scheduled_reports.sql` — **Create.** Idempotent, GO-batched: `ScheduledReports` (DashboardId/ReportKind/ReportParams/Cadence/DeliveryChannel/Recipients/Enabled/NextRunAt/OwnerId + audit cols) and `ScheduledReportRuns` (PeriodKey + `UNIQUE(ScheduledReportId, PeriodKey)` idempotency constraint).
- `rollback/0048_scheduled_reports.down.sql` — **Create.** Reverse: drop `ScheduledReportRuns` then `ScheduledReports` (child first), with default-constraint guards.

**Stored procedures** (`infra/sql/procedures/`)
- `usp_ScheduledReport_Create.sql` — **Create.** Insert a schedule; return the new row.
- `usp_ScheduledReport_Update.sql` — **Modify/Create.** ISNULL-coalesced patch of cadence/recipients/channel/enabled/nextRunAt; return the row.
- `usp_ScheduledReport_Delete.sql` — **Create.** Soft-delete (`DeletedAt`); return rows-affected.
- `usp_ScheduledReport_GetById.sql` — **Create.** Return one live schedule by id.
- `usp_ScheduledReport_ListByWorkspace.sql` — **Create.** Live schedules in a workspace (editor list).
- `usp_ScheduledReport_ListDue.sql` — **Create.** Enabled, non-deleted schedules with `NextRunAt <= @Now` (the sweep cover; mirrors `usp_TaskRecurrence_ListDue`).
- `usp_ScheduledReport_Advance.sql` — **Create.** Set `NextRunAt` (and optionally `Enabled=0` when the cadence ended) after a run.
- `usp_ScheduledReportRun_Record.sql` — **Create.** Idempotent INSERT of a run keyed on `(ScheduledReportId, PeriodKey)`; returns `{ Inserted BIT, Run row }` (a duplicate PeriodKey returns `Inserted=0` + the existing row — no error).
- `usp_ScheduledReportRun_ListBySchedule.sql` — **Create.** Run history for a schedule (newest first), paginated.

**API** (`apps/api/src/`)
- `modules/scheduled-reports/scheduled-report.repository.ts` — **Create.** SP wrappers (CRUD, ListDue, Advance, run record/list) mapping PascalCase rows → camelCase.
- `modules/scheduled-reports/scheduled-report.service.ts` — **Create.** CRUD + `computeNextRun(cadence, from)` (reuses the recurrence evaluator), `periodKeyFor(occurrence)`, `snapshot(schedule)` (resolves cards via `card.service`), `runDue(schedule, now)` (record run + deliver + advance), and `deliver(schedule, run)`.
- `modules/scheduled-reports/scheduled-report.worker.ts` — **Create.** BullMQ repeatable sweep mirroring `recurrence.worker.ts`: pure `runScheduledReportSweep(now?)` + idempotent `startScheduledReportWorker()`.
- `modules/scheduled-reports/delivery.ts` — **Create.** `DeliveryChannel` adapter map: `inbox` → `notificationService.notify`; `email` → no-op stub (logs + returns).
- `modules/scheduled-reports/scheduled-report.routes.ts` — **Create.** REST: list/create/update/delete schedules + run history + snapshot fetch.
- `graphql/scheduled-report.schema.ts` — **Create.** `registerScheduledReportGraphql()`: `ScheduledReport`/`ScheduledReportRun` types + queries + create/update/delete mutations.
- `graphql/schema.ts` — **Modify.** Import + call `registerScheduledReportGraphql()` (beside `registerRecurrenceGraphql()` ~line 761).
- `server.ts` — **Modify.** Mount `/scheduled-reports` routes + `authMiddleware`; bootstrap `startScheduledReportWorker()` beside `startRecurrenceWorker()` (Redis-gated).

**Types** (`packages/types/`)
- `index.ts` — **Modify.** Add `ScheduledReport`, `ScheduledReportRun`, `DeliveryChannel`, `ScheduledReportStatus`, `CreateScheduledReportInput`, `UpdateScheduledReportInput`, `ReportSnapshot`.

**Frontend** (`apps/next-web/src/`)
- `server/actions/scheduled-reports.ts` — **Create.** Server actions: list/create/update/delete, list runs, get snapshot.
- `components/ScheduleReportDialog.tsx` — **Create.** Schedule editor (cadence builder reusing the recurrence rule shape + recipient picker + channel).
- `components/ScheduleReportDialog.module.css` — **Create.** Dialog styles.
- `components/ScheduledRunHistory.tsx` — **Create.** Run-history list (status + ran-at + "open snapshot").
- `components/ScheduledRunHistory.module.css` — **Create.** List styles.
- `app/(app)/reports/snapshot/[runId]/page.tsx` — **Create.** Read-only snapshot viewer (SSR; renders the frozen payload).
- `app/(app)/dashboard/dashboard-view.tsx` — **Modify.** Add a "Schedule delivery" button opening `ScheduleReportDialog` + a run-history panel.
- `messages/en.json` — **Modify.** New `ScheduledReport` namespace.
- `messages/id.json` — **Modify.** Same keys, real Indonesian.

**Tests**
- `apps/api/src/modules/scheduled-reports/__tests__/next-run.unit.test.ts` — **Create.** Pure `computeNextRun` + `periodKeyFor` + cadence-end termination.
- `apps/api/src/modules/scheduled-reports/__tests__/snapshot.unit.test.ts` — **Create.** `snapshot` freezes card data (a stubbed `card.service` whose value changes AFTER snapshot does not change the frozen payload).
- `apps/api/src/modules/scheduled-reports/__tests__/idempotency.unit.test.ts` — **Create.** Pure per-period idempotency: a second `runDue` for the same PeriodKey is a no-op (one run, one delivery).
- `apps/api/src/modules/scheduled-reports/__tests__/scheduled-report.integration.test.ts` — **Create.** A due schedule produces exactly one run + one inbox notification per period; a worker restart (second sweep, same period) does not double-deliver; advancing past the cadence end disables the schedule.
- `e2e/scheduled-reports.spec.ts` — **Create.** Schedule a dashboard, advance the sweep helper, see the run recorded + an inbox notification.

---

## Tasks

### Task 1: Migration + rollback (`0048_scheduled_reports.sql`)

**Files:**
- Create: `infra/sql/migrations/0048_scheduled_reports.sql`
- Create: `infra/sql/migrations/rollback/0048_scheduled_reports.down.sql`
- Test: manual deploy against local Docker `ProjectFlow_Test` (migrations have no unit harness; verified via the integration suite in Task 7).

Steps:

- [ ] Write the migration. Idempotent (`sys.tables`/`sys.indexes` guards), GO-batched, matching the `0037` style. Both tables + the exact columns from spec §6.1, including the `UNIQUE(ScheduledReportId, PeriodKey)` idempotency constraint:

```sql
-- =============================================================================
-- Migration 0048: Scheduled Reports (Phase 9c)
-- New tables:
--   ScheduledReports    — binds a Dashboard (or a single report) to a recurring
--     cadence (RRULE-ish, reusing the Phase 5 recurrence rule shape) + a recipient
--     set + a delivery channel ('inbox' now; 'email' deferred to Phase 12). The
--     sweep reads NextRunAt to decide what is due.
--   ScheduledReportRuns — an audit row per delivered period. UNIQUE(ScheduledReportId,
--     PeriodKey) makes delivery IDEMPOTENT PER PERIOD: a worker restart mid-period
--     re-attempts the same PeriodKey and the INSERT is a no-op, so a report is never
--     double-delivered.
-- Idempotent (sys-catalog guards), GO-batched.
-- Rollback in rollback/0048_scheduled_reports.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ScheduledReports')
BEGIN
    CREATE TABLE dbo.ScheduledReports (
        Id              UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId     UNIQUEIDENTIFIER NOT NULL,
        DashboardId     UNIQUEIDENTIFIER NULL,        -- FK to Dashboards (Phase 9a); NULL when scheduling a single report
        ReportKind      NVARCHAR(24)     NULL,        -- when scheduling a single report instead of a dashboard
        ReportParams    NVARCHAR(MAX)    NULL,        -- JSON params for the single-report path
        Cadence         NVARCHAR(MAX)    NOT NULL,    -- RRULE-ish JSON (reuse the Phase 5 recurrence rule shape)
        DeliveryChannel NVARCHAR(10)     NOT NULL
            CONSTRAINT DF_ScheduledReports_Channel DEFAULT 'inbox',  -- 'inbox' | 'email' (email deferred)
        Recipients      NVARCHAR(MAX)    NOT NULL,    -- JSON array of user ids (+ external emails once email lands)
        Enabled         BIT              NOT NULL
            CONSTRAINT DF_ScheduledReports_Enabled DEFAULT 1,
        NextRunAt       DATETIME2        NULL,
        OwnerId         UNIQUEIDENTIFIER NOT NULL,
        CreatedAt       DATETIME2        NOT NULL CONSTRAINT DF_ScheduledReports_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt       DATETIME2        NOT NULL CONSTRAINT DF_ScheduledReports_UpdatedAt DEFAULT SYSUTCDATETIME(),
        DeletedAt       DATETIME2        NULL,
        CONSTRAINT CK_ScheduledReports_Channel CHECK (DeliveryChannel IN ('inbox','email'))
    );
END
GO

-- The sweep cover: enabled, live schedules ordered by NextRunAt.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ScheduledReports_Due' AND object_id = OBJECT_ID('dbo.ScheduledReports'))
    CREATE NONCLUSTERED INDEX IX_ScheduledReports_Due
        ON dbo.ScheduledReports (NextRunAt)
        WHERE Enabled = 1 AND DeletedAt IS NULL;
GO

-- Editor list cover: a workspace's live schedules.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ScheduledReports_Workspace' AND object_id = OBJECT_ID('dbo.ScheduledReports'))
    CREATE NONCLUSTERED INDEX IX_ScheduledReports_Workspace
        ON dbo.ScheduledReports (WorkspaceId)
        WHERE DeletedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ScheduledReportRuns')
BEGIN
    CREATE TABLE dbo.ScheduledReportRuns (
        Id                UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        ScheduledReportId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_ScheduledReportRuns_Schedule REFERENCES dbo.ScheduledReports(Id) ON DELETE CASCADE,
        PeriodKey         NVARCHAR(40)     NOT NULL,   -- stable per-occurrence key (the occurrence ISO timestamp)
        RanAt             DATETIME2        NOT NULL CONSTRAINT DF_ScheduledReportRuns_RanAt DEFAULT SYSUTCDATETIME(),
        Status            NVARCHAR(12)     NOT NULL CONSTRAINT DF_ScheduledReportRuns_Status DEFAULT 'delivered', -- 'delivered'|'failed'|'skipped'
        SnapshotRef       NVARCHAR(MAX)    NULL,       -- frozen render payload (JSON) or an external ref
        Error             NVARCHAR(MAX)    NULL,
        -- Idempotency: at most ONE run per (schedule, period). A re-attempt of the
        -- same period (worker restart) hits this constraint → no double-delivery.
        CONSTRAINT UQ_ScheduledReportRuns_Period UNIQUE (ScheduledReportId, PeriodKey)
    );
END
GO
```

- [ ] Write the rollback `rollback/0048_scheduled_reports.down.sql` (child table first, then parent; drop default constraints before dropping the table is unnecessary when dropping the whole table — `DROP TABLE` removes them — so just drop tables in FK order):

```sql
-- Rollback 0048: Scheduled Reports.
-- Drop the child run table first (its FK references ScheduledReports), then the
-- parent. DROP TABLE removes the table's own default/check constraints with it.

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ScheduledReportRuns') DROP TABLE dbo.ScheduledReportRuns;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ScheduledReports')    DROP TABLE dbo.ScheduledReports;
GO
```

- [ ] Run against local Docker `ProjectFlow_Test` only (explicit local DB env, never `apps/api/.env`). Run: apply `0048_scheduled_reports.sql`, then immediately the `.down.sql`, then re-apply `0048` to prove idempotency + reversibility. Expected: all three runs succeed with no errors; the second `0048` apply is a clean no-op (guards skip everything).

- [ ] Commit:
```
git add infra/sql/migrations/0048_scheduled_reports.sql infra/sql/migrations/rollback/0048_scheduled_reports.down.sql
git commit -m "feat(9c): scheduled-reports migration — ScheduledReports + ScheduledReportRuns (UNIQUE PeriodKey idempotency)"
```

---

### Task 2: Schedule CRUD + ListDue + Advance SPs

**Files:**
- Create: `infra/sql/procedures/usp_ScheduledReport_Create.sql`
- Create: `infra/sql/procedures/usp_ScheduledReport_Update.sql`
- Create: `infra/sql/procedures/usp_ScheduledReport_Delete.sql`
- Create: `infra/sql/procedures/usp_ScheduledReport_GetById.sql`
- Create: `infra/sql/procedures/usp_ScheduledReport_ListByWorkspace.sql`
- Create: `infra/sql/procedures/usp_ScheduledReport_ListDue.sql`
- Create: `infra/sql/procedures/usp_ScheduledReport_Advance.sql`
- Test: covered by the integration test (Task 7); deploy via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`.

Steps:

- [ ] Write `usp_ScheduledReport_Create.sql`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_ScheduledReport_Create
  @WorkspaceId     UNIQUEIDENTIFIER,
  @DashboardId     UNIQUEIDENTIFIER = NULL,
  @ReportKind      NVARCHAR(24)     = NULL,
  @ReportParams    NVARCHAR(MAX)    = NULL,
  @Cadence         NVARCHAR(MAX),
  @DeliveryChannel NVARCHAR(10)     = 'inbox',
  @Recipients      NVARCHAR(MAX),
  @NextRunAt       DATETIME2        = NULL,
  @OwnerId         UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

  INSERT INTO dbo.ScheduledReports
    (Id, WorkspaceId, DashboardId, ReportKind, ReportParams, Cadence, DeliveryChannel, Recipients, Enabled, NextRunAt, OwnerId)
  VALUES
    (@NewId, @WorkspaceId, @DashboardId, @ReportKind, @ReportParams, @Cadence, @DeliveryChannel, @Recipients, 1, @NextRunAt, @OwnerId);

  SELECT * FROM dbo.ScheduledReports WHERE Id = @NewId;
END;
GO
```

- [ ] Write `usp_ScheduledReport_Update.sql` (ISNULL-coalesced patch; bump `UpdatedAt`):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_ScheduledReport_Update
  @Id              UNIQUEIDENTIFIER,
  @Cadence         NVARCHAR(MAX) = NULL,
  @DeliveryChannel NVARCHAR(10)  = NULL,
  @Recipients      NVARCHAR(MAX) = NULL,
  @Enabled         BIT           = NULL,
  @NextRunAt       DATETIME2     = NULL
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.ScheduledReports SET
    Cadence         = ISNULL(@Cadence,         Cadence),
    DeliveryChannel = ISNULL(@DeliveryChannel, DeliveryChannel),
    Recipients      = ISNULL(@Recipients,      Recipients),
    Enabled         = ISNULL(@Enabled,         Enabled),
    NextRunAt       = ISNULL(@NextRunAt,        NextRunAt),
    UpdatedAt       = SYSUTCDATETIME()
  WHERE Id = @Id AND DeletedAt IS NULL;

  SELECT * FROM dbo.ScheduledReports WHERE Id = @Id;
END;
GO
```

- [ ] Write `usp_ScheduledReport_Delete.sql` (soft-delete):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_ScheduledReport_Delete
  @Id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.ScheduledReports SET DeletedAt = SYSUTCDATETIME(), Enabled = 0
    WHERE Id = @Id AND DeletedAt IS NULL;
  SELECT @@ROWCOUNT AS Deleted;
END;
GO
```

- [ ] Write `usp_ScheduledReport_GetById.sql`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_ScheduledReport_GetById
  @Id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM dbo.ScheduledReports WHERE Id = @Id AND DeletedAt IS NULL;
END;
GO
```

- [ ] Write `usp_ScheduledReport_ListByWorkspace.sql`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_ScheduledReport_ListByWorkspace
  @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM dbo.ScheduledReports
    WHERE WorkspaceId = @WorkspaceId AND DeletedAt IS NULL
    ORDER BY CreatedAt DESC;
END;
GO
```

- [ ] Write `usp_ScheduledReport_ListDue.sql` — the sweep cover (mirrors `usp_TaskRecurrence_ListDue`: enabled, non-deleted, `NextRunAt` arrived):

```sql
-- Phase 9c: schedules the sweep should deliver — enabled, live schedules whose
-- NextRunAt has arrived. Disabled / soft-deleted / future-dated schedules are
-- excluded. Mirrors usp_TaskRecurrence_ListDue.
CREATE OR ALTER PROCEDURE dbo.usp_ScheduledReport_ListDue
  @Now DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  BEGIN TRY
    SELECT *
    FROM   dbo.ScheduledReports
    WHERE  Enabled = 1
      AND  DeletedAt IS NULL
      AND  NextRunAt IS NOT NULL
      AND  NextRunAt <= @Now
    ORDER  BY NextRunAt;
  END TRY
  BEGIN CATCH
    THROW;
  END CATCH
END;
GO
```

- [ ] Write `usp_ScheduledReport_Advance.sql` — set `NextRunAt` (and disable when the cadence ended, i.e. `@NextRunAt IS NULL`) after a run:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_ScheduledReport_Advance
  @Id        UNIQUEIDENTIFIER,
  @NextRunAt DATETIME2 = NULL,   -- NULL → cadence ended → disable
  @Enabled   BIT       = NULL    -- explicit override; defaults to (@NextRunAt IS NOT NULL)
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.ScheduledReports SET
    NextRunAt = @NextRunAt,
    Enabled   = ISNULL(@Enabled, CASE WHEN @NextRunAt IS NULL THEN 0 ELSE 1 END),
    UpdatedAt = SYSUTCDATETIME()
  WHERE Id = @Id AND DeletedAt IS NULL;

  SELECT * FROM dbo.ScheduledReports WHERE Id = @Id;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test` (local DB env only). Expected: all seven procedures created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_ScheduledReport_Create.sql infra/sql/procedures/usp_ScheduledReport_Update.sql infra/sql/procedures/usp_ScheduledReport_Delete.sql infra/sql/procedures/usp_ScheduledReport_GetById.sql infra/sql/procedures/usp_ScheduledReport_ListByWorkspace.sql infra/sql/procedures/usp_ScheduledReport_ListDue.sql infra/sql/procedures/usp_ScheduledReport_Advance.sql
git commit -m "feat(9c): scheduled-report CRUD + ListDue + Advance SPs"
```

---

### Task 3: Run-record (idempotent) + run-list SPs

**Files:**
- Create: `infra/sql/procedures/usp_ScheduledReportRun_Record.sql`
- Create: `infra/sql/procedures/usp_ScheduledReportRun_ListBySchedule.sql`
- Test: idempotency *math* is unit-tested pure in Task 5; the SP path is covered by the integration test (Task 7).

Steps:

- [ ] Write `usp_ScheduledReportRun_Record.sql` — the idempotency keystone. An INSERT keyed on `(ScheduledReportId, PeriodKey)`; a duplicate period returns the existing row with `Inserted = 0` (no error, no second delivery). Guard the unique-violation inside the same SP so the caller branches on `Inserted` rather than catching a SQL error:

```sql
-- Idempotent run record. The first call for a (ScheduledReportId, PeriodKey)
-- INSERTs and returns Inserted=1. Any later call for the SAME period (a worker
-- restart re-attempting the occurrence) is a NO-OP: it returns Inserted=0 + the
-- EXISTING run row, so the caller skips delivery → a report is never double-sent.
-- The IF NOT EXISTS pre-check + the UNIQUE constraint together make this safe
-- even under a concurrent double-sweep (the loser's INSERT hits the constraint,
-- caught and folded into the Inserted=0 path).
CREATE OR ALTER PROCEDURE dbo.usp_ScheduledReportRun_Record
  @ScheduledReportId UNIQUEIDENTIFIER,
  @PeriodKey         NVARCHAR(40),
  @Status            NVARCHAR(12)  = 'delivered',
  @SnapshotRef       NVARCHAR(MAX) = NULL,
  @Error             NVARCHAR(MAX) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @Inserted BIT = 0;
  DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

  BEGIN TRY
    BEGIN TRANSACTION;

    IF NOT EXISTS (
      SELECT 1 FROM dbo.ScheduledReportRuns WITH (UPDLOCK, HOLDLOCK)
      WHERE ScheduledReportId = @ScheduledReportId AND PeriodKey = @PeriodKey
    )
    BEGIN
      INSERT INTO dbo.ScheduledReportRuns (Id, ScheduledReportId, PeriodKey, Status, SnapshotRef, Error)
      VALUES (@NewId, @ScheduledReportId, @PeriodKey, @Status, @SnapshotRef, @Error);
      SET @Inserted = 1;
    END

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    -- A concurrent INSERT won the race (unique-violation 2627/2601) → treat as a
    -- no-op duplicate, not an error.
    IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
    SET @Inserted = 0;
  END CATCH;

  SELECT @Inserted AS Inserted;
  SELECT * FROM dbo.ScheduledReportRuns
    WHERE ScheduledReportId = @ScheduledReportId AND PeriodKey = @PeriodKey;
END;
GO
```

- [ ] Write `usp_ScheduledReportRun_ListBySchedule.sql` — paginated run history, newest first:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_ScheduledReportRun_ListBySchedule
  @ScheduledReportId UNIQUEIDENTIFIER,
  @Page              INT = 1,
  @PageSize          INT = 20
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @Offset INT = (@Page - 1) * @PageSize;

  SELECT *
  FROM   dbo.ScheduledReportRuns
  WHERE  ScheduledReportId = @ScheduledReportId
  ORDER  BY RanAt DESC
  OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;

  SELECT COUNT(*) AS TotalCount
  FROM   dbo.ScheduledReportRuns
  WHERE  ScheduledReportId = @ScheduledReportId;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`. Expected: both procedures created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_ScheduledReportRun_Record.sql infra/sql/procedures/usp_ScheduledReportRun_ListBySchedule.sql
git commit -m "feat(9c): run SPs — idempotent ScheduledReportRun_Record (UNIQUE PeriodKey) + ListBySchedule"
```

---

### Task 4: Types + repository

**Files:**
- Modify: `packages/types/index.ts` (append a Scheduled Reports block)
- Create: `apps/api/src/modules/scheduled-reports/scheduled-report.repository.ts`

Steps:

- [ ] Add the Scheduled Reports block to `packages/types/index.ts` (hand-written types — match the existing camelCase contract style, e.g. `TaskRecurrence`):

```ts
// ── Scheduled Reports (Phase 9c) ──────────────────────────────────────────────

export type DeliveryChannel = 'inbox' | 'email';
export type ScheduledReportStatus = 'delivered' | 'failed' | 'skipped';

export interface ScheduledReport {
  id:              string;
  workspaceId:     string;
  dashboardId:     string | null;   // null when scheduling a single report
  reportKind:      string | null;
  reportParams:    Record<string, unknown> | null;
  cadence:         RecurrenceRule;  // reuses the Phase 5 recurrence rule shape
  deliveryChannel: DeliveryChannel;
  recipients:      string[];        // user ids (+ external emails once email lands)
  enabled:         boolean;
  nextRunAt:       string | null;
  ownerId:         string;
  createdAt:       string;
  updatedAt:       string;
}

export interface ScheduledReportRun {
  id:                string;
  scheduledReportId: string;
  periodKey:         string;
  ranAt:             string;
  status:            ScheduledReportStatus;
  snapshotRef:       string | null;  // frozen render payload (JSON) or external ref
  error:             string | null;
}

/** Frozen snapshot payload produced by scheduled-report.service.snapshot(). */
export interface ReportSnapshot {
  scheduleId:  string;
  dashboardId: string | null;
  periodKey:   string;
  generatedAt: string;
  cards: Array<{ cardId: string; type: string; title: string | null; data: unknown }>;
}

export interface CreateScheduledReportInput {
  workspaceId:      string;
  dashboardId?:     string | null;
  reportKind?:      string | null;
  reportParams?:    Record<string, unknown> | null;
  cadence:          RecurrenceRule;
  deliveryChannel?: DeliveryChannel;
  recipients:       string[];
}

export interface UpdateScheduledReportInput {
  cadence?:         RecurrenceRule;
  deliveryChannel?: DeliveryChannel;
  recipients?:      string[];
  enabled?:         boolean;
}
```

> `RecurrenceRule` already exists in `packages/types/index.ts` (Phase 5). If its exported name differs, import/alias it; do not duplicate the shape.

- [ ] Write `scheduled-report.repository.ts` — SP wrappers mapping PascalCase rows → the camelCase contract (mirrors `recurrence.repository.ts`'s `mapRecurrenceRow`):

```ts
import sql from 'mssql';
import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';
import type {
  ScheduledReport, ScheduledReportRun, ScheduledReportStatus, DeliveryChannel,
} from '@projectflow/types';

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  try { return JSON.parse(String(raw)) as T; } catch { return fallback; }
}

/** Map a ScheduledReports SP row (PascalCase, SELECT *) to the camelCase contract. */
export function mapScheduleRow(r: any): ScheduledReport {
  return {
    id:              r.Id,
    workspaceId:     r.WorkspaceId,
    dashboardId:     r.DashboardId ?? null,
    reportKind:      r.ReportKind ?? null,
    reportParams:    parseJson<Record<string, unknown> | null>(r.ReportParams, null),
    cadence:         parseJson<any>(r.Cadence, { freq: 'daily', interval: 1 }),
    deliveryChannel: (r.DeliveryChannel as DeliveryChannel) ?? 'inbox',
    recipients:      parseJson<string[]>(r.Recipients, []),
    enabled:         !!r.Enabled,
    nextRunAt:       r.NextRunAt ? new Date(r.NextRunAt).toISOString() : null,
    ownerId:         r.OwnerId,
    createdAt:       String(r.CreatedAt),
    updatedAt:       String(r.UpdatedAt),
  };
}

export function mapRunRow(r: any): ScheduledReportRun {
  return {
    id:                r.Id,
    scheduledReportId: r.ScheduledReportId,
    periodKey:         r.PeriodKey,
    ranAt:             String(r.RanAt),
    status:            (r.Status as ScheduledReportStatus) ?? 'delivered',
    snapshotRef:       r.SnapshotRef ?? null,
    error:             r.Error ?? null,
  };
}

export class ScheduledReportRepository {
  async create(p: {
    workspaceId: string; dashboardId: string | null; reportKind: string | null;
    reportParams: string | null; cadence: string; deliveryChannel: DeliveryChannel;
    recipients: string; nextRunAt: Date | null; ownerId: string;
  }): Promise<ScheduledReport> {
    const rows = await execSpOne('usp_ScheduledReport_Create', [
      { name: 'WorkspaceId',     type: sql.UniqueIdentifier,  value: p.workspaceId },
      { name: 'DashboardId',     type: sql.UniqueIdentifier,  value: p.dashboardId },
      { name: 'ReportKind',      type: sql.NVarChar(24),      value: p.reportKind },
      { name: 'ReportParams',    type: sql.NVarChar(sql.MAX), value: p.reportParams },
      { name: 'Cadence',         type: sql.NVarChar(sql.MAX), value: p.cadence },
      { name: 'DeliveryChannel', type: sql.NVarChar(10),      value: p.deliveryChannel },
      { name: 'Recipients',      type: sql.NVarChar(sql.MAX), value: p.recipients },
      { name: 'NextRunAt',       type: sql.DateTime2,         value: p.nextRunAt },
      { name: 'OwnerId',         type: sql.UniqueIdentifier,  value: p.ownerId },
    ]);
    return mapScheduleRow(rows[0]);
  }

  async update(id: string, p: {
    cadence?: string | null; deliveryChannel?: DeliveryChannel | null;
    recipients?: string | null; enabled?: boolean | null; nextRunAt?: Date | null;
  }): Promise<ScheduledReport | null> {
    const rows = await execSpOne('usp_ScheduledReport_Update', [
      { name: 'Id',              type: sql.UniqueIdentifier,  value: id },
      { name: 'Cadence',         type: sql.NVarChar(sql.MAX), value: p.cadence ?? null },
      { name: 'DeliveryChannel', type: sql.NVarChar(10),      value: p.deliveryChannel ?? null },
      { name: 'Recipients',      type: sql.NVarChar(sql.MAX), value: p.recipients ?? null },
      { name: 'Enabled',         type: sql.Bit,               value: p.enabled == null ? null : (p.enabled ? 1 : 0) },
      { name: 'NextRunAt',       type: sql.DateTime2,         value: p.nextRunAt ?? null },
    ]);
    return rows[0] ? mapScheduleRow(rows[0]) : null;
  }

  async delete(id: string): Promise<number> {
    const rows = await execSpOne<{ Deleted: number }>('usp_ScheduledReport_Delete', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0]?.Deleted ?? 0;
  }

  async getById(id: string): Promise<ScheduledReport | null> {
    const rows = await execSpOne('usp_ScheduledReport_GetById', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ? mapScheduleRow(rows[0]) : null;
  }

  async listByWorkspace(workspaceId: string): Promise<ScheduledReport[]> {
    const rows = await execSpOne('usp_ScheduledReport_ListByWorkspace', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    ]);
    return (rows as any[]).map(mapScheduleRow);
  }

  async listDue(now: Date): Promise<ScheduledReport[]> {
    const rows = await execSpOne('usp_ScheduledReport_ListDue', [
      { name: 'Now', type: sql.DateTime2, value: now },
    ]);
    return (rows as any[]).map(mapScheduleRow);
  }

  async advance(id: string, nextRunAt: Date | null): Promise<ScheduledReport | null> {
    const rows = await execSpOne('usp_ScheduledReport_Advance', [
      { name: 'Id',        type: sql.UniqueIdentifier, value: id },
      { name: 'NextRunAt', type: sql.DateTime2,        value: nextRunAt },
      { name: 'Enabled',   type: sql.Bit,              value: null },
    ]);
    return rows[0] ? mapScheduleRow(rows[0]) : null;
  }

  /** Idempotent run record. Returns { inserted, run }: inserted=false on a
   *  duplicate (ScheduledReportId, PeriodKey) — the caller skips delivery. */
  async recordRun(p: {
    scheduledReportId: string; periodKey: string; status: ScheduledReportStatus;
    snapshotRef: string | null; error: string | null;
  }): Promise<{ inserted: boolean; run: ScheduledReportRun | null }> {
    const sets = await execSp('usp_ScheduledReportRun_Record', [
      { name: 'ScheduledReportId', type: sql.UniqueIdentifier,  value: p.scheduledReportId },
      { name: 'PeriodKey',         type: sql.NVarChar(40),      value: p.periodKey },
      { name: 'Status',            type: sql.NVarChar(12),      value: p.status },
      { name: 'SnapshotRef',       type: sql.NVarChar(sql.MAX), value: p.snapshotRef },
      { name: 'Error',             type: sql.NVarChar(sql.MAX), value: p.error },
    ]);
    const inserted = Number((sets[0]?.[0] as any)?.Inserted ?? 0) === 1;
    const runRow   = sets[1]?.[0] as any | undefined;
    return { inserted, run: runRow ? mapRunRow(runRow) : null };
  }

  async listRuns(scheduledReportId: string, page = 1, pageSize = 20): Promise<{ runs: ScheduledReportRun[]; totalCount: number }> {
    const sets = await execSp('usp_ScheduledReportRun_ListBySchedule', [
      { name: 'ScheduledReportId', type: sql.UniqueIdentifier, value: scheduledReportId },
      { name: 'Page',              type: sql.Int,              value: page },
      { name: 'PageSize',          type: sql.Int,              value: pageSize },
    ]);
    const runs = (sets[0] as any[]).map(mapRunRow);
    const totalCount = Number((sets[1]?.[0] as any)?.TotalCount ?? 0);
    return { runs, totalCount };
  }
}

export const scheduledReportRepository = new ScheduledReportRepository();
```

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS — no type errors (the service in Task 5 consumes these; if executing strictly task-by-task, the repository compiles standalone against the new types).

- [ ] Commit:
```
git add packages/types/index.ts apps/api/src/modules/scheduled-reports/scheduled-report.repository.ts
git commit -m "feat(9c): scheduled-report types + repository (CRUD/ListDue/Advance/run record+list)"
```

---

### Task 5: Service (next-run + period key + snapshot + runDue) + delivery adapter + pure unit tests

**Files:**
- Create: `apps/api/src/modules/scheduled-reports/delivery.ts`
- Create: `apps/api/src/modules/scheduled-reports/scheduled-report.service.ts`
- Create: `apps/api/src/modules/scheduled-reports/__tests__/next-run.unit.test.ts`
- Create: `apps/api/src/modules/scheduled-reports/__tests__/snapshot.unit.test.ts`
- Create: `apps/api/src/modules/scheduled-reports/__tests__/idempotency.unit.test.ts`

Steps:

- [ ] Write the failing unit tests first. `next-run.unit.test.ts` (next-run + period-key + cadence-end termination — pure, reusing the recurrence evaluator):

```ts
import { describe, it, expect } from 'vitest';
import { computeNextRun, periodKeyFor } from '../scheduled-report.service.js';

describe('computeNextRun', () => {
  it('advances a daily cadence by interval from the given instant', () => {
    const next = computeNextRun({ freq: 'daily', interval: 1 }, new Date('2026-06-07T09:00:00.000Z'));
    expect(next?.toISOString()).toBe('2026-06-08T09:00:00.000Z');
  });

  it('returns null once the cadence endsAt has passed', () => {
    const next = computeNextRun(
      { freq: 'daily', interval: 1, endsAt: '2026-06-07T12:00:00.000Z' },
      new Date('2026-06-07T09:00:00.000Z'),
    );
    expect(next).toBeNull();
  });
});

describe('periodKeyFor', () => {
  it('is the occurrence ISO timestamp — stable for the same occurrence', () => {
    const occ = new Date('2026-06-08T09:00:00.000Z');
    expect(periodKeyFor(occ)).toBe('2026-06-08T09:00:00.000Z');
    expect(periodKeyFor(occ)).toBe(periodKeyFor(new Date('2026-06-08T09:00:00.000Z')));
  });
});
```

`snapshot.unit.test.ts` (snapshot FREEZES card data — a later card-service value change does not mutate the frozen payload):

```ts
import { describe, it, expect, vi } from 'vitest';
import { snapshotWith } from '../scheduled-report.service.js';

describe('snapshotWith (snapshot freezes card data)', () => {
  it('resolves every card once and freezes the result', async () => {
    let liveValue = 10;
    const cards = [
      { id: 'c1', dashboardId: 'd1', type: 'calculation', title: 'Open', config: {}, layout: {} },
      { id: 'c2', dashboardId: 'd1', type: 'bar',         title: 'By status', config: {}, layout: {} },
    ];
    const deps = {
      getDashboard: vi.fn(async () => ({ id: 'd1', workspaceId: 'w1', scopeType: 'workspace', scopeId: null, ownerId: 'u1' })),
      listCards:    vi.fn(async () => cards),
      resolveCard:  vi.fn(async (card: any) => ({ cardId: card.id, value: liveValue })),
    };
    const schedule = { id: 's1', dashboardId: 'd1', ownerId: 'u1', cadence: { freq: 'daily', interval: 1 } } as any;

    const snap = await snapshotWith(schedule, '2026-06-08T09:00:00.000Z', deps as any);

    // Two cards resolved, each exactly once.
    expect(deps.resolveCard).toHaveBeenCalledTimes(2);
    expect(snap.cards).toHaveLength(2);
    expect((snap.cards[0].data as any).value).toBe(10);

    // Mutating the live source AFTER the snapshot must not change the frozen payload.
    liveValue = 999;
    expect((snap.cards[0].data as any).value).toBe(10);
    expect(snap.periodKey).toBe('2026-06-08T09:00:00.000Z');
  });
});
```

`idempotency.unit.test.ts` (a second `runDueWith` for the same PeriodKey is a no-op — one run, one delivery):

```ts
import { describe, it, expect, vi } from 'vitest';
import { runDueWith } from '../scheduled-report.service.js';

function makeDeps(insertedSequence: boolean[]) {
  let call = 0;
  return {
    snapshot:  vi.fn(async () => ({ scheduleId: 's1', dashboardId: 'd1', periodKey: 'p', generatedAt: 'now', cards: [] })),
    recordRun: vi.fn(async () => ({ inserted: insertedSequence[call++] ?? false, run: { id: 'r1' } as any })),
    deliver:   vi.fn(async () => undefined),
    advance:   vi.fn(async () => null),
  };
}

describe('runDueWith (per-period idempotency)', () => {
  const schedule = {
    id: 's1', dashboardId: 'd1', ownerId: 'u1', enabled: true,
    cadence: { freq: 'daily', interval: 1 }, deliveryChannel: 'inbox', recipients: ['u2'],
    nextRunAt: '2026-06-08T09:00:00.000Z',
  } as any;

  it('delivers exactly once on the first run for a period', async () => {
    const deps = makeDeps([true]);
    await runDueWith(schedule, new Date('2026-06-08T09:00:00.000Z'), deps as any);
    expect(deps.recordRun).toHaveBeenCalledTimes(1);
    expect(deps.deliver).toHaveBeenCalledTimes(1);   // delivered (inserted=true)
    expect(deps.advance).toHaveBeenCalledTimes(1);   // schedule advanced
  });

  it('does NOT re-deliver when the same period was already recorded (worker restart)', async () => {
    const deps = makeDeps([false]);   // recordRun reports the period already exists
    await runDueWith(schedule, new Date('2026-06-08T09:00:00.000Z'), deps as any);
    expect(deps.recordRun).toHaveBeenCalledTimes(1);
    expect(deps.deliver).not.toHaveBeenCalled();     // inserted=false → skip delivery
    expect(deps.advance).toHaveBeenCalledTimes(1);   // still advances so the sweep moves past this period
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- scheduled-report` (i.e. `vitest run --project unit` filtered). Expected: FAIL — `Cannot find module '../scheduled-report.service.js'`.

- [ ] Write `delivery.ts` — the `DeliveryChannel` adapter map. `inbox` fans out via `notificationService.notify`; `email` is an explicit no-op stub (deferred to Phase 12):

```ts
import { notificationService } from '../notifications/notification.service.js';
import { subLogger } from '../../shared/lib/logger.js';
import type { DeliveryChannel, ScheduledReport, ScheduledReportRun } from '@projectflow/types';

const log = subLogger('scheduled-report-delivery');

export interface DeliveryAdapter {
  deliver(schedule: ScheduledReport, run: ScheduledReportRun): Promise<void>;
}

/**
 * Inbox channel — the only LIVE channel in Phase 9. Creates one in-app
 * "report ready" notification per recipient via the Phase 3.5 fan-out, carrying
 * the schedule + run + snapshot link in the payload. Self-notification of the
 * owner is filtered by notificationService.notify (actorId === recipient skip),
 * so we pass a sentinel actorId that is never a recipient.
 */
const inboxAdapter: DeliveryAdapter = {
  async deliver(schedule, run) {
    await notificationService.notify({
      recipientIds: schedule.recipients,
      actorId:      schedule.ownerId,      // owner-driven; not filtered unless owner is also a recipient
      type:         'SCHEDULED_REPORT_READY',
      payload: {
        scheduledReportId: schedule.id,
        runId:             run.id,
        dashboardId:       schedule.dashboardId,
        periodKey:         run.periodKey,
        snapshotRef:       run.snapshotRef,
      },
    });
  },
};

/**
 * Email channel — DEFERRED to Phase 12 (no SMTP infra yet). This is an explicit
 * no-op STUB behind DeliveryChannel='email': it logs and returns so a schedule
 * configured for email still records a run without throwing. Phase 12 replaces
 * the body with real SMTP send; the column + this seam already exist.
 */
const emailAdapter: DeliveryAdapter = {
  async deliver(schedule, run) {
    log.info(
      { scheduledReportId: schedule.id, runId: run.id, recipients: schedule.recipients.length },
      'email delivery is a no-op stub (deferred to Phase 12) — recording the run only',
    );
    /* no-op: Phase 12 wires SMTP here */
  },
};

const ADAPTERS: Record<DeliveryChannel, DeliveryAdapter> = {
  inbox: inboxAdapter,
  email: emailAdapter,
};

export function deliverFor(schedule: ScheduledReport, run: ScheduledReportRun): Promise<void> {
  return ADAPTERS[schedule.deliveryChannel].deliver(schedule, run);
}
```

- [ ] Write `scheduled-report.service.ts` — CRUD + pure `computeNextRun`/`periodKeyFor`, the injectable `snapshotWith`/`runDueWith` (tested above) + thin instance methods binding the real deps. Reuses `computeNextOccurrence`/`validateRule` from the recurrence module:

```ts
import { ScheduledReportRepository, scheduledReportRepository } from './scheduled-report.repository.js';
import { computeNextOccurrence, validateRule, type RecurrenceRuleShape } from '../recurrence/recurrence.js';
import { deliverFor } from './delivery.js';
// 9a services — adapt the import paths/names if the 9a module exports differ.
import { dashboardService } from '../dashboards/dashboard.service.js';
import { cardService } from '../dashboards/card.service.js';
import { subLogger } from '../../shared/lib/logger.js';
import type {
  ScheduledReport, ScheduledReportRun, ReportSnapshot, DeliveryChannel,
  CreateScheduledReportInput, UpdateScheduledReportInput,
} from '@projectflow/types';

const log = subLogger('scheduled-report');

/** Thrown on a malformed cadence (reuses the recurrence rule validator). */
export class InvalidCadenceError extends Error {
  code = 'INVALID_CADENCE';
  constructor(message: string) { super(message); this.name = 'InvalidCadenceError'; }
}

/**
 * Next run STRICTLY after `from`, or null when the cadence has ended. Pure —
 * reuses the Phase 5 recurrence evaluator (same {freq,interval,byWeekday,
 * byMonthday,endsAt} shape). No `count` semantics here: a schedule runs until
 * disabled or until endsAt.
 */
export function computeNextRun(cadence: RecurrenceRuleShape, from: Date): Date | null {
  return computeNextOccurrence(cadence, from);
}

/** Stable per-occurrence key: the occurrence's ISO timestamp. Two computations
 *  of the same occurrence yield the same key → the idempotency anchor. */
export function periodKeyFor(occurrence: Date): string {
  return occurrence.toISOString();
}

// ── Injectable cores (unit-tested without DB) ────────────────────────────────

export interface SnapshotDeps {
  getDashboard: (id: string) => Promise<any>;
  listCards:    (dashboardId: string) => Promise<any[]>;
  resolveCard:  (card: any, scope: any) => Promise<unknown>;
}

/**
 * Resolve every card on the bound dashboard through card.service under the
 * schedule OWNER's object-level filter, and FREEZE the result. JSON round-trip
 * deep-clones the resolved data so a later mutation of the live source can't
 * change the snapshot (the freeze test asserts this).
 */
export async function snapshotWith(
  schedule: ScheduledReport,
  periodKey: string,
  deps: SnapshotDeps,
): Promise<ReportSnapshot> {
  const dashboardId = schedule.dashboardId;
  const cardsOut: ReportSnapshot['cards'] = [];

  if (dashboardId) {
    const dash = await deps.getDashboard(dashboardId);
    const scope = {
      scopeType:   dash.scopeType,
      scopeId:     dash.scopeId ?? null,
      requesterId: schedule.ownerId,   // resolve under the owner's access — never leaks rows they can't read
    };
    const cards = await deps.listCards(dashboardId);
    for (const card of cards) {
      const data = await deps.resolveCard(card, scope);
      cardsOut.push({
        cardId: card.id,
        type:   card.type,
        title:  card.title ?? null,
        data:   JSON.parse(JSON.stringify(data ?? null)),   // deep-freeze via clone
      });
    }
  }

  return {
    scheduleId:  schedule.id,
    dashboardId: dashboardId,
    periodKey,
    generatedAt: new Date().toISOString(),
    cards: cardsOut,
  };
}

export interface RunDueDeps {
  snapshot:  (schedule: ScheduledReport, periodKey: string) => Promise<ReportSnapshot>;
  recordRun: (p: { scheduledReportId: string; periodKey: string; status: 'delivered' | 'failed' | 'skipped'; snapshotRef: string | null; error: string | null }) => Promise<{ inserted: boolean; run: ScheduledReportRun | null }>;
  deliver:   (schedule: ScheduledReport, run: ScheduledReportRun) => Promise<void>;
  advance:   (id: string, nextRunAt: Date | null) => Promise<unknown>;
}

/**
 * Run ONE due occurrence of a schedule:
 *  1. snapshot the dashboard for this period,
 *  2. recordRun keyed on (schedule, periodKey) — IDEMPOTENT: inserted=false means
 *     this period was already delivered (worker restart) → SKIP delivery,
 *  3. deliver via the channel adapter ONLY when inserted=true,
 *  4. advance NextRunAt to the next occurrence (or null → disabled at cadence end).
 * Returns whether a delivery happened this call.
 */
export async function runDueWith(schedule: ScheduledReport, now: Date, deps: RunDueDeps): Promise<{ delivered: boolean }> {
  const occurrence = schedule.nextRunAt ? new Date(schedule.nextRunAt) : now;
  const periodKey  = periodKeyFor(occurrence);

  let delivered = false;
  try {
    const snap = await deps.snapshot(schedule, periodKey);
    const { inserted, run } = await deps.recordRun({
      scheduledReportId: schedule.id,
      periodKey,
      status:      'delivered',
      snapshotRef: JSON.stringify(snap),
      error:       null,
    });
    // Only the FIRST recorder for this period delivers. A duplicate (inserted=false)
    // is a worker-restart re-attempt → no second notification.
    if (inserted && run) {
      await deps.deliver(schedule, run);
      delivered = true;
    }
  } catch (err: any) {
    log.error({ err: err?.message, scheduledReportId: schedule.id, periodKey }, 'runDue failed — recording a failed run');
    await deps.recordRun({ scheduledReportId: schedule.id, periodKey, status: 'failed', snapshotRef: null, error: String(err?.message ?? err) }).catch(() => {});
  }

  // Advance the schedule regardless so the sweep moves past this period (a failed
  // period is logged, not retried forever).
  const next = computeNextRun(schedule.cadence as RecurrenceRuleShape, occurrence);
  await deps.advance(schedule.id, next);
  return { delivered };
}

// ── Service (binds the cores to the real repository + 9a services) ───────────

export class ScheduledReportService {
  constructor(private repo: ScheduledReportRepository = scheduledReportRepository) {}

  getById(id: string): Promise<ScheduledReport | null> { return this.repo.getById(id); }
  listByWorkspace(workspaceId: string): Promise<ScheduledReport[]> { return this.repo.listByWorkspace(workspaceId); }
  listRuns(id: string, page = 1, pageSize = 20) { return this.repo.listRuns(id, page, pageSize); }
  listDue(now: Date): Promise<ScheduledReport[]> { return this.repo.listDue(now); }

  async create(input: CreateScheduledReportInput, ownerId: string): Promise<ScheduledReport> {
    const cadence = this.validateCadence(input.cadence);
    const firstRun = computeNextRun(cadence, new Date());
    return this.repo.create({
      workspaceId:     input.workspaceId,
      dashboardId:     input.dashboardId ?? null,
      reportKind:      input.reportKind ?? null,
      reportParams:    input.reportParams ? JSON.stringify(input.reportParams) : null,
      cadence:         JSON.stringify(cadence),
      deliveryChannel: input.deliveryChannel ?? 'inbox',
      recipients:      JSON.stringify(input.recipients ?? []),
      nextRunAt:       firstRun,
      ownerId,
    });
  }

  async update(id: string, input: UpdateScheduledReportInput): Promise<ScheduledReport | null> {
    let nextRunAt: Date | null | undefined;
    let cadenceJson: string | null = null;
    if (input.cadence) {
      const cadence = this.validateCadence(input.cadence);
      cadenceJson = JSON.stringify(cadence);
      nextRunAt = computeNextRun(cadence, new Date());   // re-seed on a cadence change
    }
    return this.repo.update(id, {
      cadence:         cadenceJson,
      deliveryChannel: input.deliveryChannel ?? null,
      recipients:      input.recipients ? JSON.stringify(input.recipients) : null,
      enabled:         input.enabled ?? null,
      nextRunAt:       nextRunAt ?? null,
    });
  }

  delete(id: string): Promise<number> { return this.repo.delete(id); }

  /** Snapshot bound to the real 9a services. */
  snapshot(schedule: ScheduledReport, periodKey: string): Promise<ReportSnapshot> {
    return snapshotWith(schedule, periodKey, {
      getDashboard: (dashId) => dashboardService.getById(dashId),
      listCards:    (dashId) => dashboardService.listCards(dashId),
      resolveCard:  (card, scope) => cardService.resolve(card, scope),
    });
  }

  /** Run one due schedule bound to the real repository + delivery adapter. */
  runDue(schedule: ScheduledReport, now: Date): Promise<{ delivered: boolean }> {
    return runDueWith(schedule, now, {
      snapshot:  (s, pk) => this.snapshot(s, pk),
      recordRun: (p) => this.repo.recordRun(p),
      deliver:   (s, run) => deliverFor(s, run),
      advance:   (id, next) => this.repo.advance(id, next),
    });
  }

  private validateCadence(raw: unknown): RecurrenceRuleShape {
    try { return validateRule(raw); }
    catch (err: any) { throw new InvalidCadenceError(err?.message ?? 'invalid cadence'); }
  }
}

export const scheduledReportService = new ScheduledReportService();
```

> **9a coupling note (inline):** `dashboardService.getById` / `dashboardService.listCards` / `cardService.resolve(card, scope)` are the Phase 9a §4.2 contract. If a 9a accessor name differs at implementation time, adapt the three lambdas in `snapshot()` only — the pure `snapshotWith`/`runDueWith`/`computeNextRun` cores and their tests stay unchanged.

- [ ] Run: `npm test --workspace apps/api -- scheduled-report`. Expected: PASS (the three pure suites — `next-run`, `snapshot`, `idempotency` — 6 tests). The service file imports the 9a services; if 9a is not yet merged in the workspace, the unit tests still pass because they exercise the injectable cores, but `npm run build` will fail on the unresolved 9a import — that is expected until the Prerequisite lands and is the signal that 9a must be merged first.

- [ ] Run: `npm run build --workspace apps/api`. Expected: PASS once Phase 9a's `dashboard.service`/`card.service` exist (the Prerequisite). If 9a is present, no type errors.

- [ ] Commit:
```
git add apps/api/src/modules/scheduled-reports/delivery.ts apps/api/src/modules/scheduled-reports/scheduled-report.service.ts apps/api/src/modules/scheduled-reports/__tests__/next-run.unit.test.ts apps/api/src/modules/scheduled-reports/__tests__/snapshot.unit.test.ts apps/api/src/modules/scheduled-reports/__tests__/idempotency.unit.test.ts
git commit -m "feat(9c): scheduled-report service — next-run/period-key/snapshot/runDue + inbox+email-stub delivery + pure unit tests"
```

---

### Task 6: Worker (`scheduled-report.worker.ts`) + server.ts registration

**Files:**
- Create: `apps/api/src/modules/scheduled-reports/scheduled-report.worker.ts`
- Modify: `apps/api/src/server.ts` (import + Redis-gated bootstrap beside `startRecurrenceWorker`)

Steps:

- [ ] Write `scheduled-report.worker.ts` — a verbatim structural copy of `recurrence.worker.ts`: a pure `runScheduledReportSweep(now?)` over `listDue` + per-schedule `runDue`, and an idempotent Redis-gated `startScheduledReportWorker()` via `upsertJobScheduler`:

```ts
/**
 * BullMQ wiring for the scheduled-report sweep (Phase 9c).
 *
 * A single JobScheduler-driven repeatable job (`scheduled-report-sweep`) ticks
 * every 5 min. The Worker calls scheduledReportService.listDue(now) and runs each
 * due schedule: snapshot → record a run (idempotent per PeriodKey) → deliver via
 * the channel adapter → advance NextRunAt. Mirrors `recurrence.worker.ts` exactly:
 * connection, removeOnComplete/Fail, upsertJobScheduler (idempotent across
 * restarts), registerCloser for graceful shutdown.
 *
 * The actual work lives in scheduledReportService.runDue so unit/integration
 * tests can drive it (via runScheduledReportSweep) without Redis or a Worker.
 * Per-PeriodKey idempotency in usp_ScheduledReportRun_Record guarantees a worker
 * restart mid-period never double-delivers.
 */

import { Queue, Worker } from 'bullmq';
import { scheduledReportService } from './scheduled-report.service.js';
import { subLogger } from '../../shared/lib/logger.js';
import { registerCloser } from '../../shared/lib/shutdown.js';

const log = subLogger('scheduled-report-sweep');

const QUEUE_NAME = 'scheduled-report-sweep';

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

type JobName = 'scheduled-report-sweep';

interface JobData {
  /* No payload — the sweep reads fresh due rows from SQL each run. */
}

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

let started = false;

/**
 * Run one sweep: deliver every due schedule. Exported for tests / manual runs.
 * Errors on an individual schedule are logged and skipped so one bad row doesn't
 * stall the rest of the batch (runDue itself records a 'failed' run and advances).
 */
export async function runScheduledReportSweep(now: Date = new Date()): Promise<{ scanned: number; delivered: number }> {
  const due = await scheduledReportService.listDue(now);
  let delivered = 0;
  for (const schedule of due) {
    try {
      const { delivered: didDeliver } = await scheduledReportService.runDue(schedule, now);
      if (didDeliver) delivered++;
    } catch (err: any) {
      log.error({ err: err?.message, scheduledReportId: schedule.id }, 'sweep runDue failed');
    }
  }
  return { scanned: due.length, delivered };
}

export async function startScheduledReportWorker(): Promise<{ queue: Queue<JobData>; worker: Worker<JobData> } | null> {
  if (started) {
    throw new Error('startScheduledReportWorker called twice');
  }
  started = true;

  const queue = new Queue<JobData>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { count: 50 },
      removeOnFail:     { count: 50 },
    },
  });

  // Idempotent across restarts — leaves an existing scheduler entry alone.
  await queue.upsertJobScheduler(
    'scheduled-report-sweep-every-5m',
    { every: SWEEP_INTERVAL_MS },
    { name: 'scheduled-report-sweep' },
  );

  const worker = new Worker<JobData>(
    QUEUE_NAME,
    async (job) => {
      const name = job.name as JobName;
      if (name === 'scheduled-report-sweep') {
        const result = await runScheduledReportSweep();
        if (result.delivered > 0) {
          log.info(result, 'scheduled-report sweep');
        }
        return result;
      }
      throw new Error(`unknown scheduled-report job: ${name}`);
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobName: job?.name, jobId: job?.id, err: err?.message }, 'job failed');
  });
  worker.on('error', (err) => {
    log.error({ err: err?.message }, 'worker error');
  });

  registerCloser('scheduled-report-sweep-worker', () => worker.close());
  registerCloser('scheduled-report-sweep-queue',  () => queue.close());
  log.info({ sweepEveryMs: SWEEP_INTERVAL_MS }, 'worker started');
  return { queue, worker };
}
```

- [ ] Wire the bootstrap into `server.ts`. Add the import beside `startRecurrenceWorker` (~line 39):

```ts
import { startScheduledReportWorker } from './modules/scheduled-reports/scheduled-report.worker.js';
```

and start it inside the same Redis-gated block as the recurrence worker (~line 311), so it only runs when Redis is configured and never in test:

```ts
  // Start the scheduled-report sweep (Phase 9c). Same Redis gate as the
  // recurrence worker — the BullMQ queue/worker need Redis; the pure
  // runScheduledReportSweep helper drives delivery in tests without it.
  if (process.env.REDIS_URL || process.env.REDIS_HOST) {
    startScheduledReportWorker().catch((err) =>
      logger.warn({ err: err?.message }, 'scheduled-report worker failed to start'),
    );
  }
```

(If you prefer one gate, place this line inside the existing `if (process.env.REDIS_URL || process.env.REDIS_HOST)` block right after `startRecurrenceWorker(...)`.)

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS — worker + server compile. Then `npm test --workspace apps/api -- scheduled-report`. Expected: PASS (pure suites unaffected).

- [ ] Commit:
```
git add apps/api/src/modules/scheduled-reports/scheduled-report.worker.ts apps/api/src/server.ts
git commit -m "feat(9c): scheduled-report worker — repeatable sweep (pure runScheduledReportSweep) + server.ts registration"
```

---

### Task 7: REST routes + integration test

**Files:**
- Create: `apps/api/src/modules/scheduled-reports/scheduled-report.routes.ts`
- Modify: `apps/api/src/server.ts` (mount `/scheduled-reports` + `authMiddleware`)
- Create: `apps/api/src/modules/scheduled-reports/__tests__/scheduled-report.integration.test.ts`

Steps:

- [ ] Write the failing integration test first (copy the harness imports from `recurrence.integration.test.ts`: `testServer.js`, `truncate.js`, `factories.js`). It seeds a dashboard via the 9a routes, schedules it, forces `NextRunAt` into the past, runs the sweep helper, and asserts exactly one run + one inbox notification — then runs the sweep AGAIN for the same period and asserts NO second notification:

```ts
/**
 * Phase 9c — Scheduled reports integration coverage.
 * Exercises the schedule SPs + sweep + idempotent run record + inbox delivery
 * against the REAL SQL stack.
 *   - a due schedule produces exactly ONE run + ONE inbox notification per period,
 *   - a worker restart (a SECOND sweep over the same period) does NOT double-deliver,
 *   - advancing past the cadence endsAt disables the schedule.
 * DB SAFETY: must target local Docker ProjectFlow_Test (see e2e/README).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool, getPool } from '../../../shared/lib/db.js';
import { scheduledReportService } from '../scheduled-report.service.js';
import { scheduledReportRepository } from '../scheduled-report.repository.js';
import { runScheduledReportSweep } from '../scheduled-report.worker.js';
import { notificationService } from '../../notifications/notification.service.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

let seq = 0;

/** Seed user + workspace + a dashboard (via the Phase 9a routes) with ≥1 card. */
async function seedDashboard() {
  seq += 1;
  const owner = await createTestUser({ email: `sr-${Date.now()}-${seq}@projectflow.test` });
  const recipient = await createTestUser({ email: `sr-rcpt-${Date.now()}-${seq}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'SR Space', key: `SR${(Date.now() + seq) % 100000}` });

  // Create a workspace-scoped dashboard + one card via the 9a REST surface.
  // (Adapt the body/route to the real 9a contract if it differs.)
  const dash = (await json<{ data: any }>(await request('/dashboards', {
    method: 'POST', token, json: { workspaceId: ws.Id, scopeType: 'workspace', scopeId: null, name: 'Weekly status' },
  }), 201)).data;
  await request(`/dashboards/${dash.id}/cards`, {
    method: 'POST', token,
    json: { type: 'calculation', title: 'Open tasks', config: { aggregate: 'count' }, layout: { x: 0, y: 0, w: 4, h: 2 } },
  });

  return { owner, recipientId: recipient.user.Id, token, ws, space, dashboardId: String(dash.id) };
}

/** Force a schedule's NextRunAt (e.g. into the past so ListDue picks it up). */
async function forceNextRunAt(scheduleId: string, when: Date | null): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input('Id', sql.UniqueIdentifier, scheduleId)
    .input('When', sql.DateTime2, when)
    .query('UPDATE dbo.ScheduledReports SET NextRunAt = @When WHERE Id = @Id');
}

describe('Phase 9c — scheduled reports (integration)', () => {
  it('a due schedule produces exactly one run + one inbox notification per period', async () => {
    const ctx = await seedDashboard();
    const schedule = await scheduledReportService.create({
      workspaceId: ctx.ws.Id, dashboardId: ctx.dashboardId,
      cadence: { freq: 'daily', interval: 1 }, deliveryChannel: 'inbox', recipients: [ctx.recipientId],
    }, ctx.owner.user.Id);

    await forceNextRunAt(schedule.id, new Date(Date.now() - 60_000));

    const result = await runScheduledReportSweep(new Date());
    expect(result.delivered).toBe(1);

    // Exactly ONE run recorded for the period.
    const { runs } = await scheduledReportRepository.listRuns(schedule.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('delivered');
    expect(runs[0].snapshotRef).not.toBeNull();      // snapshot frozen

    // Exactly ONE inbox notification to the recipient.
    const { notifications } = await notificationService.list(ctx.recipientId, 1, 50, false, ['SCHEDULED_REPORT_READY']);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].payload.scheduledReportId.toUpperCase()).toBe(schedule.id.toUpperCase());

    // The schedule advanced to a future NextRunAt and stays enabled.
    const after = await scheduledReportService.getById(schedule.id);
    expect(after!.enabled).toBe(true);
    expect(new Date(after!.nextRunAt as any).getTime()).toBeGreaterThan(Date.now());
  });

  it('a worker restart (second sweep over the same period) does not double-deliver', async () => {
    const ctx = await seedDashboard();
    const schedule = await scheduledReportService.create({
      workspaceId: ctx.ws.Id, dashboardId: ctx.dashboardId,
      cadence: { freq: 'daily', interval: 1 }, deliveryChannel: 'inbox', recipients: [ctx.recipientId],
    }, ctx.owner.user.Id);
    await forceNextRunAt(schedule.id, new Date(Date.now() - 60_000));

    // First sweep delivers.
    await runScheduledReportSweep(new Date());
    // Simulate a worker restart that re-reads the SAME (already-delivered) period
    // by forcing NextRunAt back to the same past instant and sweeping again.
    await forceNextRunAt(schedule.id, new Date(Date.now() - 60_000));
    await runScheduledReportSweep(new Date());

    // Still exactly ONE run for that PeriodKey (UNIQUE constraint) and ONE notification.
    const { runs } = await scheduledReportRepository.listRuns(schedule.id);
    const deliveredForPeriod = runs.filter((r) => r.status === 'delivered');
    expect(deliveredForPeriod).toHaveLength(1);

    const { notifications } = await notificationService.list(ctx.recipientId, 1, 50, false, ['SCHEDULED_REPORT_READY']);
    expect(notifications).toHaveLength(1);
  });

  it('advancing past the cadence endsAt disables the schedule', async () => {
    const ctx = await seedDashboard();
    const past = new Date(Date.now() - 60_000).toISOString();
    const schedule = await scheduledReportService.create({
      workspaceId: ctx.ws.Id, dashboardId: ctx.dashboardId,
      cadence: { freq: 'daily', interval: 1, endsAt: past }, deliveryChannel: 'inbox', recipients: [ctx.recipientId],
    }, ctx.owner.user.Id);
    await forceNextRunAt(schedule.id, new Date(Date.now() - 60_000));

    await runScheduledReportSweep(new Date());

    // computeNextRun returns null (endsAt passed) → advance disables the schedule.
    const after = await scheduledReportService.getById(schedule.id);
    expect(after!.enabled).toBe(false);
    expect(after!.nextRunAt).toBeNull();
  });
});
```

- [ ] Run: `npm run test:integration --workspace apps/api -- scheduled-report` against `ProjectFlow_Test`. Expected: FAIL — `/scheduled-reports` (and possibly `/dashboards`) routes not yet mounted / 404.

- [ ] Write `scheduled-report.routes.ts` — REST, gated with `requirePermission('scheduled_report.manage', { resolveWorkspace })` for writes and `requireObjectLevel`-equivalent read scoping via the workspace permission. Mirror the worklog routes' `resolveWorkspace`-from-body pattern:

```ts
import { Hono }       from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z }          from 'zod';
import { scheduledReportService } from './scheduled-report.service.js';
import { scheduledReportRepository } from './scheduled-report.repository.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';

export const scheduledReportRoutes = new Hono();

const cadenceSchema = z.object({
  freq:       z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval:   z.number().int().positive(),
  byWeekday:  z.array(z.number().int().min(0).max(6)).optional(),
  byMonthday: z.number().int().min(1).max(31).optional(),
  endsAt:     z.string().datetime().optional(),
});

const createSchema = z.object({
  workspaceId:     z.string().uuid(),
  dashboardId:     z.string().uuid().nullable().optional(),
  reportKind:      z.string().max(24).nullable().optional(),
  reportParams:    z.record(z.unknown()).nullable().optional(),
  cadence:         cadenceSchema,
  deliveryChannel: z.enum(['inbox', 'email']).optional(),
  recipients:      z.array(z.string().uuid()).min(1),
});

const updateSchema = z.object({
  cadence:         cadenceSchema.optional(),
  deliveryChannel: z.enum(['inbox', 'email']).optional(),
  recipients:      z.array(z.string().uuid()).min(1).optional(),
  enabled:         z.boolean().optional(),
});

// Resolve the workspace from the create body (mirrors worklog resolveTaskWorkspaceFromBody).
const resolveWorkspaceFromBody = async (c: any): Promise<string | null> => {
  try { const body = await c.req.json(); return body?.workspaceId ?? null; } catch { return null; }
};
// Resolve the workspace from an existing schedule id (for :id routes).
const resolveWorkspaceFromSchedule = async (c: any): Promise<string | null> => {
  const s = await scheduledReportRepository.getById(c.req.param('id'));
  return s?.workspaceId ?? null;
};

// GET /api/v1/scheduled-reports?workspaceId=
scheduledReportRoutes.get(
  '/',
  requirePermission('scheduled_report.manage', { resolveWorkspace: async (c: any) => c.req.query('workspaceId') ?? null }),
  async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) return c.json({ error: { message: 'workspaceId is required' } }, 400);
    const schedules = await scheduledReportService.listByWorkspace(workspaceId);
    return c.json({ data: schedules });
  },
);

// POST /api/v1/scheduled-reports
scheduledReportRoutes.post(
  '/',
  zValidator('json', createSchema),
  requirePermission('scheduled_report.manage', { resolveWorkspace: resolveWorkspaceFromBody }),
  async (c) => {
    const user = (c as any).get('user') as any;
    const input = c.req.valid('json');
    const schedule = await scheduledReportService.create(input as any, user.userId);
    return c.json({ data: schedule }, 201);
  },
);

// PATCH /api/v1/scheduled-reports/:id
scheduledReportRoutes.patch(
  '/:id',
  zValidator('json', updateSchema),
  requirePermission('scheduled_report.manage', { resolveWorkspace: resolveWorkspaceFromSchedule }),
  async (c) => {
    const updated = await scheduledReportService.update(c.req.param('id'), c.req.valid('json') as any);
    if (!updated) return c.json({ error: { message: 'Schedule not found' } }, 404);
    return c.json({ data: updated });
  },
);

// DELETE /api/v1/scheduled-reports/:id
scheduledReportRoutes.delete(
  '/:id',
  requirePermission('scheduled_report.manage', { resolveWorkspace: resolveWorkspaceFromSchedule }),
  async (c) => {
    const n = await scheduledReportService.delete(c.req.param('id'));
    if (n === 0) return c.json({ error: { message: 'Schedule not found' } }, 404);
    return c.body(null, 204);
  },
);

// GET /api/v1/scheduled-reports/:id/runs?page=&pageSize=
scheduledReportRoutes.get(
  '/:id/runs',
  requirePermission('scheduled_report.manage', { resolveWorkspace: resolveWorkspaceFromSchedule }),
  async (c) => {
    const page     = parseInt(c.req.query('page')     ?? '1',  10);
    const pageSize = parseInt(c.req.query('pageSize') ?? '20', 10);
    const { runs, totalCount } = await scheduledReportService.listRuns(c.req.param('id'), page, Math.min(pageSize, 50));
    return c.json({ data: runs, meta: { totalCount } });
  },
);

// GET /api/v1/scheduled-reports/:id/runs/:runId/snapshot — read-only frozen payload
scheduledReportRoutes.get(
  '/:id/runs/:runId/snapshot',
  requirePermission('scheduled_report.manage', { resolveWorkspace: resolveWorkspaceFromSchedule }),
  async (c) => {
    const { runs } = await scheduledReportService.listRuns(c.req.param('id'), 1, 50);
    const run = runs.find((r) => r.id.toUpperCase() === c.req.param('runId').toUpperCase());
    if (!run) return c.json({ error: { message: 'Run not found' } }, 404);
    return c.json({ data: { run, snapshot: run.snapshotRef ? JSON.parse(run.snapshotRef) : null } });
  },
);
```

> `scheduled_report.manage` is the spec §3 slug. If it is not yet seeded in the RBAC permission catalog, add it in the Phase 9a/permission-seed migration or alongside this slice's migration — note the addition in `DECISIONS.md`. Until seeded, only roles with the slug can manage schedules (fail-closed, as intended).

- [ ] Mount in `server.ts` — add the import, the `authMiddleware`, and the route beside the others:

```ts
import { scheduledReportRoutes } from './modules/scheduled-reports/scheduled-report.routes.js';
```
```ts
app.use('/scheduled-reports/*', authMiddleware);
```
```ts
app.route('/scheduled-reports', scheduledReportRoutes);
```

- [ ] Run: `npm run test:integration --workspace apps/api -- scheduled-report` against `ProjectFlow_Test`. Expected: PASS (3 tests). Then full unit: `npm test --workspace apps/api`. Expected: PASS.

- [ ] Commit:
```
git add apps/api/src/modules/scheduled-reports/scheduled-report.routes.ts apps/api/src/server.ts apps/api/src/modules/scheduled-reports/__tests__/scheduled-report.integration.test.ts
git commit -m "feat(9c): scheduled-report REST routes (CRUD + runs + snapshot) + integration test"
```

---

### Task 8: GraphQL mirror (`scheduled-report.schema.ts`)

**Files:**
- Create: `apps/api/src/graphql/scheduled-report.schema.ts`
- Modify: `apps/api/src/graphql/schema.ts` (import + call near `registerRecurrenceGraphql()`, ~line 761)

Steps:

- [ ] Write `scheduled-report.schema.ts`, mirroring `recurrence.schema.ts`'s structure (typed `objectRef`, `notFound`/`requireWorkspacePermission` from `./authz.js`, delegating to the one shared service; cadence transported as a JSON string like the recurrence rule):

```ts
import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { scheduledReportService, InvalidCadenceError } from '../modules/scheduled-reports/scheduled-report.service.js';
import { scheduledReportRepository } from '../modules/scheduled-reports/scheduled-report.repository.js';
import { notFound, requireWorkspacePermission } from './authz.js';
import type { ScheduledReport, ScheduledReportRun } from '@projectflow/types';

export function registerScheduledReportGraphql(): void {
  const ScheduledReportType = builder.objectRef<ScheduledReport>('ScheduledReport');
  ScheduledReportType.implement({ fields: (t) => ({
    id:              t.exposeString('id'),
    workspaceId:     t.exposeString('workspaceId'),
    dashboardId:     t.string({ nullable: true, resolve: (s) => s.dashboardId ?? null }),
    reportKind:      t.string({ nullable: true, resolve: (s) => s.reportKind ?? null }),
    cadence:         t.string({ resolve: (s) => JSON.stringify(s.cadence) }),
    deliveryChannel: t.exposeString('deliveryChannel'),
    recipients:      t.stringList({ resolve: (s) => s.recipients }),
    enabled:         t.boolean({ resolve: (s) => s.enabled }),
    nextRunAt:       t.field({ type: 'Date', nullable: true, resolve: (s) => (s.nextRunAt ? new Date(s.nextRunAt) : null) }),
    ownerId:         t.exposeString('ownerId'),
  }) });

  const RunType = builder.objectRef<ScheduledReportRun>('ScheduledReportRun');
  RunType.implement({ fields: (t) => ({
    id:                t.exposeString('id'),
    scheduledReportId: t.exposeString('scheduledReportId'),
    periodKey:         t.exposeString('periodKey'),
    ranAt:             t.field({ type: 'Date', resolve: (r) => new Date(r.ranAt) }),
    status:            t.exposeString('status'),
    snapshotRef:       t.string({ nullable: true, resolve: (r) => r.snapshotRef ?? null }),
    error:             t.string({ nullable: true, resolve: (r) => r.error ?? null }),
  }) });

  builder.queryFields((t) => ({
    scheduledReports: t.field({
      type: [ScheduledReportType],
      args: { workspaceId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'scheduled_report.manage');
        return scheduledReportService.listByWorkspace(a.workspaceId);
      },
    }),
    scheduledReportRuns: t.field({
      type: [RunType],
      args: { scheduledReportId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const s = await scheduledReportRepository.getById(a.scheduledReportId);
        if (!s) notFound('Schedule not found');
        await requireWorkspacePermission(ctx, s.workspaceId, 'scheduled_report.manage');
        return (await scheduledReportService.listRuns(a.scheduledReportId)).runs;
      },
    }),
  }));

  builder.mutationFields((t) => ({
    createScheduledReport: t.field({
      type: ScheduledReportType,
      args: {
        workspaceId:     t.arg.string({ required: true }),
        dashboardId:     t.arg.string({ required: false }),
        reportKind:      t.arg.string({ required: false }),
        cadence:         t.arg.string({ required: true }),   // JSON string
        deliveryChannel: t.arg.string({ required: false }),
        recipients:      t.arg.stringList({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        const workspaceId = await requireWorkspacePermission(ctx, a.workspaceId, 'scheduled_report.manage');
        let cadence: unknown;
        try { cadence = JSON.parse(a.cadence); }
        catch { throw new GraphQLError('cadence must be a JSON object string', { extensions: { code: 'INVALID_CADENCE' } }); }
        try {
          return await scheduledReportService.create({
            workspaceId,
            dashboardId:     a.dashboardId ?? null,
            reportKind:      a.reportKind ?? null,
            cadence:         cadence as any,
            deliveryChannel: (a.deliveryChannel as any) ?? undefined,
            recipients:      a.recipients,
          }, (ctx.user as any).userId);
        } catch (err: any) {
          if (err instanceof InvalidCadenceError) throw new GraphQLError(err.message, { extensions: { code: err.code } });
          throw err;
        }
      },
    }),
    updateScheduledReport: t.field({
      type: ScheduledReportType,
      nullable: true,
      args: {
        id:              t.arg.string({ required: true }),
        cadence:         t.arg.string({ required: false }),
        deliveryChannel: t.arg.string({ required: false }),
        recipients:      t.arg.stringList({ required: false }),
        enabled:         t.arg.boolean({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        const s = await scheduledReportRepository.getById(a.id);
        if (!s) notFound('Schedule not found');
        await requireWorkspacePermission(ctx, s.workspaceId, 'scheduled_report.manage');
        let cadence: any;
        if (a.cadence) { try { cadence = JSON.parse(a.cadence); } catch { throw new GraphQLError('cadence must be a JSON object string', { extensions: { code: 'INVALID_CADENCE' } }); } }
        return scheduledReportService.update(a.id, {
          cadence,
          deliveryChannel: (a.deliveryChannel as any) ?? undefined,
          recipients:      a.recipients ?? undefined,
          enabled:         a.enabled ?? undefined,
        });
      },
    }),
    deleteScheduledReport: t.field({
      type: 'Boolean',
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const s = await scheduledReportRepository.getById(a.id);
        if (!s) notFound('Schedule not found');
        await requireWorkspacePermission(ctx, s.workspaceId, 'scheduled_report.manage');
        await scheduledReportService.delete(a.id);
        return true;
      },
    }),
  }));
}
```

- [ ] Wire it into `schema.ts` — add the import alongside the others and call it near `registerRecurrenceGraphql()`:

```ts
import { registerScheduledReportGraphql } from './scheduled-report.schema.js';
```
```ts
// ─────────────────────────────────────────
// Scheduled Reports (Phase 9c) — ScheduledReport/ScheduledReportRun types +
// scheduledReports/scheduledReportRuns queries + create/update/delete mutations.
// ─────────────────────────────────────────
registerScheduledReportGraphql();
```

- [ ] Run: `npm run build --workspace apps/api` (tsc — compiles the Pothos schema). Expected: PASS — no type errors; schema builds. Then `npm test --workspace apps/api`. Expected: PASS (existing GraphQL authz tests still green).

- [ ] Commit:
```
git add apps/api/src/graphql/scheduled-report.schema.ts apps/api/src/graphql/schema.ts
git commit -m "feat(9c): GraphQL scheduled-report mirror — scheduledReports/runs queries + CRUD mutations"
```

---

### Task 9: Server actions + schedule editor dialog + i18n

**Files:**
- Create: `apps/next-web/src/server/actions/scheduled-reports.ts`
- Create: `apps/next-web/src/components/ScheduleReportDialog.tsx`
- Create: `apps/next-web/src/components/ScheduleReportDialog.module.css`
- Modify: `apps/next-web/src/messages/en.json`
- Modify: `apps/next-web/src/messages/id.json`
- Note: read `node_modules/next/dist/docs/` per `apps/next-web/AGENTS.md` before writing web code (this Next.js has breaking changes).

Steps:

- [ ] Add server actions to `scheduled-reports.ts` — mirror the existing action shape used elsewhere (`{ ok, data, error }`); use the file's existing fetch wrapper (adapt `apiAction` to the real helper, e.g. the one `worklogs.ts` uses):

```ts
'use server';

// Adapt `apiAction` to the project's existing server-action fetch helper.
import { apiAction } from './_client';

export async function listSchedules(workspaceId: string) {
  return apiAction(`/scheduled-reports?workspaceId=${workspaceId}`, { method: 'GET' });
}
export async function createSchedule(input: {
  workspaceId: string; dashboardId?: string | null; cadence: any;
  deliveryChannel?: 'inbox' | 'email'; recipients: string[];
}) {
  return apiAction('/scheduled-reports', { method: 'POST', body: input });
}
export async function updateSchedule(id: string, patch: {
  cadence?: any; deliveryChannel?: 'inbox' | 'email'; recipients?: string[]; enabled?: boolean;
}) {
  return apiAction(`/scheduled-reports/${id}`, { method: 'PATCH', body: patch });
}
export async function deleteSchedule(id: string) {
  return apiAction(`/scheduled-reports/${id}`, { method: 'DELETE' });
}
export async function listScheduleRuns(id: string, page = 1) {
  return apiAction(`/scheduled-reports/${id}/runs?page=${page}`, { method: 'GET' });
}
export async function getRunSnapshot(id: string, runId: string) {
  return apiAction(`/scheduled-reports/${id}/runs/${runId}/snapshot`, { method: 'GET' });
}
```

- [ ] Write `ScheduleReportDialog.tsx` — a client dialog that builds the cadence (freq + interval + optional byWeekday), picks recipients, selects the channel, and calls `createSchedule`/`updateSchedule`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { createSchedule } from '@/server/actions/scheduled-reports';
import { notifyActionError } from '@/lib/apiErrorToast';
import { useTranslations } from 'next-intl';
import styles from './ScheduleReportDialog.module.css';

type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export function ScheduleReportDialog({
  workspaceId, dashboardId, recipientOptions, onClose, onCreated,
}: {
  workspaceId: string;
  dashboardId: string;
  recipientOptions: Array<{ id: string; name: string }>;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const t = useTranslations('ScheduledReport');
  const [freq, setFreq] = useState<Freq>('weekly');
  const [interval, setInterval] = useState(1);
  const [byWeekday, setByWeekday] = useState<number[]>([1]); // Monday
  const [channel, setChannel] = useState<'inbox' | 'email'>('inbox');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const toggleWeekday = (d: number) =>
    setByWeekday((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  const toggleRecipient = (id: string) =>
    setRecipients((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const onSubmit = () => start(async () => {
    if (recipients.length === 0) return notifyActionError({ error: t('needRecipient') } as any);
    const cadence: any = { freq, interval };
    if (freq === 'weekly' && byWeekday.length) cadence.byWeekday = byWeekday;
    const r: any = await createSchedule({ workspaceId, dashboardId, cadence, deliveryChannel: channel, recipients });
    if (!r.ok) return notifyActionError(r);
    onCreated?.();
    onClose();
  });

  const weekdays = [t('sun'), t('mon'), t('tue'), t('wed'), t('thu'), t('fri'), t('sat')];

  return (
    <div className={styles.backdrop} role="dialog" aria-label={t('title')}>
      <div className={styles.dialog}>
        <h2 className={styles.heading}>{t('title')}</h2>

        <label className={styles.field}>
          <span>{t('frequency')}</span>
          <select value={freq} onChange={(e) => setFreq(e.target.value as Freq)}>
            <option value="daily">{t('daily')}</option>
            <option value="weekly">{t('weekly')}</option>
            <option value="monthly">{t('monthly')}</option>
            <option value="yearly">{t('yearly')}</option>
          </select>
        </label>

        <label className={styles.field}>
          <span>{t('everyN')}</span>
          <input type="number" min={1} value={interval} onChange={(e) => setInterval(Math.max(1, Number(e.target.value)))} />
        </label>

        {freq === 'weekly' && (
          <div className={styles.field}>
            <span>{t('onDays')}</span>
            <div className={styles.weekdays}>
              {weekdays.map((label, d) => (
                <button key={d} type="button"
                  className={`${styles.dayBtn} ${byWeekday.includes(d) ? styles.daySel : ''}`}
                  onClick={() => toggleWeekday(d)}>{label}</button>
              ))}
            </div>
          </div>
        )}

        <label className={styles.field}>
          <span>{t('channel')}</span>
          <select value={channel} onChange={(e) => setChannel(e.target.value as 'inbox' | 'email')}>
            <option value="inbox">{t('channelInbox')}</option>
            <option value="email" disabled>{t('channelEmailSoon')}</option>
          </select>
        </label>

        <div className={styles.field}>
          <span>{t('recipients')}</span>
          <div className={styles.recipients}>
            {recipientOptions.map((u) => (
              <label key={u.id} className={styles.recipient}>
                <input type="checkbox" checked={recipients.includes(u.id)} onChange={() => toggleRecipient(u.id)} />
                {u.name}
              </label>
            ))}
          </div>
        </div>

        <div className={styles.actions}>
          <button className={styles.cancel} onClick={onClose} disabled={pending}>{t('cancel')}</button>
          <button className={styles.save} onClick={onSubmit} disabled={pending}>{pending ? t('saving') : t('schedule')}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] Write `ScheduleReportDialog.module.css`:

```css
.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: grid; place-items: center; z-index: 50; }
.dialog { background: var(--surface-1, #fff); color: var(--text-1, #111); border-radius: 12px; padding: 20px; width: min(440px, 92vw); display: flex; flex-direction: column; gap: 12px; }
.heading { margin: 0; font-size: 18px; font-weight: 700; }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
.field > span { font-weight: 600; }
.weekdays, .recipients { display: flex; flex-wrap: wrap; gap: 6px; }
.dayBtn { border: 1px solid var(--border, #d1d5db); border-radius: 6px; padding: 4px 8px; cursor: pointer; background: transparent; }
.daySel { background: #6366f1; color: #fff; border-color: #6366f1; }
.recipient { display: inline-flex; align-items: center; gap: 6px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.cancel { background: transparent; border: 1px solid var(--border, #d1d5db); border-radius: 8px; padding: 6px 14px; cursor: pointer; }
.save { background: #6366f1; color: #fff; border: none; border-radius: 8px; padding: 6px 14px; cursor: pointer; }
.save:disabled, .cancel:disabled { opacity: .6; cursor: default; }
```

- [ ] Add the `ScheduledReport` namespace to `en.json`:

```json
"ScheduledReport": {
  "title": "Schedule delivery",
  "frequency": "Frequency",
  "daily": "Daily",
  "weekly": "Weekly",
  "monthly": "Monthly",
  "yearly": "Yearly",
  "everyN": "Every (interval)",
  "onDays": "On days",
  "channel": "Deliver to",
  "channelInbox": "Inbox",
  "channelEmailSoon": "Email (coming soon)",
  "recipients": "Recipients",
  "needRecipient": "Select at least one recipient",
  "schedule": "Schedule",
  "saving": "Saving…",
  "cancel": "Cancel",
  "runHistory": "Delivery history",
  "noRuns": "No deliveries yet",
  "openSnapshot": "Open snapshot",
  "statusDelivered": "Delivered",
  "statusFailed": "Failed",
  "statusSkipped": "Skipped",
  "deliveredOn": "Delivered {date}",
  "snapshotTitle": "Report snapshot",
  "readOnly": "Read-only snapshot",
  "sun": "Sun", "mon": "Mon", "tue": "Tue", "wed": "Wed", "thu": "Thu", "fri": "Fri", "sat": "Sat"
}
```

- [ ] Add the same keys to `id.json` with real Indonesian:

```json
"ScheduledReport": {
  "title": "Jadwalkan pengiriman",
  "frequency": "Frekuensi",
  "daily": "Harian",
  "weekly": "Mingguan",
  "monthly": "Bulanan",
  "yearly": "Tahunan",
  "everyN": "Setiap (interval)",
  "onDays": "Pada hari",
  "channel": "Kirim ke",
  "channelInbox": "Kotak masuk",
  "channelEmailSoon": "Email (segera hadir)",
  "recipients": "Penerima",
  "needRecipient": "Pilih setidaknya satu penerima",
  "schedule": "Jadwalkan",
  "saving": "Menyimpan…",
  "cancel": "Batal",
  "runHistory": "Riwayat pengiriman",
  "noRuns": "Belum ada pengiriman",
  "openSnapshot": "Buka snapshot",
  "statusDelivered": "Terkirim",
  "statusFailed": "Gagal",
  "statusSkipped": "Dilewati",
  "deliveredOn": "Terkirim {date}",
  "snapshotTitle": "Snapshot laporan",
  "readOnly": "Snapshot hanya-baca",
  "sun": "Min", "mon": "Sen", "tue": "Sel", "wed": "Rab", "thu": "Kam", "fri": "Jum", "sat": "Sab"
}
```

- [ ] Run: `npm test --workspace apps/next-web` (includes the `messages.unit` i18n parity test). Expected: PASS — en/id key parity green.

- [ ] Commit:
```
git add apps/next-web/src/server/actions/scheduled-reports.ts apps/next-web/src/components/ScheduleReportDialog.tsx apps/next-web/src/components/ScheduleReportDialog.module.css apps/next-web/src/messages/en.json apps/next-web/src/messages/id.json
git commit -m "feat(9c): schedule editor dialog + scheduled-report server actions + i18n"
```

---

### Task 10: Run-history list + read-only snapshot viewer + dashboard wiring

**Files:**
- Create: `apps/next-web/src/components/ScheduledRunHistory.tsx`
- Create: `apps/next-web/src/components/ScheduledRunHistory.module.css`
- Create: `apps/next-web/src/app/(app)/reports/snapshot/[runId]/page.tsx`
- Modify: `apps/next-web/src/app/(app)/dashboard/dashboard-view.tsx`

Steps:

- [ ] Write `ScheduledRunHistory.tsx` — loads the run list for a schedule and renders status + ran-at + an "open snapshot" link:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { listScheduleRuns } from '@/server/actions/scheduled-reports';
import { useTranslations, useFormatter } from 'next-intl';
import Link from 'next/link';
import styles from './ScheduledRunHistory.module.css';
import type { ScheduledReportRun } from '@projectflow/types';

export function ScheduledRunHistory({ scheduleId }: { scheduleId: string }) {
  const t = useTranslations('ScheduledReport');
  const format = useFormatter();
  const [runs, setRuns] = useState<ScheduledReportRun[]>([]);

  useEffect(() => {
    listScheduleRuns(scheduleId).then((r: any) => { if (r.ok) setRuns(r.data?.data ?? []); });
  }, [scheduleId]);

  const statusLabel = (s: string) =>
    s === 'failed' ? t('statusFailed') : s === 'skipped' ? t('statusSkipped') : t('statusDelivered');

  return (
    <div className={styles.root}>
      <h3 className={styles.heading}>{t('runHistory')}</h3>
      {runs.length === 0 ? (
        <p className={styles.empty}>{t('noRuns')}</p>
      ) : (
        <ul className={styles.list}>
          {runs.map((run) => (
            <li key={run.id} className={styles.row} data-run-status={run.status}>
              <span className={`${styles.badge} ${styles[run.status] ?? ''}`}>{statusLabel(run.status)}</span>
              <span className={styles.when}>{format.dateTime(new Date(run.ranAt), { dateStyle: 'medium', timeStyle: 'short' })}</span>
              {run.snapshotRef && (
                <Link className={styles.link} href={`/reports/snapshot/${run.id}?scheduleId=${scheduleId}`}>
                  {t('openSnapshot')}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] Write `ScheduledRunHistory.module.css`:

```css
.root { display: flex; flex-direction: column; gap: 8px; }
.heading { margin: 0; font-size: 15px; font-weight: 700; }
.empty { color: var(--text-2, #6b7280); font-size: 13px; }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; background: var(--surface-2, #f3f4f6); }
.badge { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: #e5e7eb; color: #374151; }
.delivered { background: #dcfce7; color: #166534; }
.failed { background: #fee2e2; color: #991b1b; }
.skipped { background: #fef9c3; color: #854d0e; }
.when { font-size: 13px; color: var(--text-2, #6b7280); }
.link { margin-left: auto; font-size: 13px; color: #6366f1; text-decoration: none; }
.link:hover { text-decoration: underline; }
```

- [ ] Write the read-only snapshot viewer `app/(app)/reports/snapshot/[runId]/page.tsx` — an SSR page that fetches the frozen snapshot via the server action and renders each card's frozen data read-only (the `?scheduleId=` query carries the parent schedule id needed by the snapshot route):

```tsx
import { getTranslations } from 'next-intl/server';
import { getRunSnapshot } from '@/server/actions/scheduled-reports';
import type { ReportSnapshot } from '@projectflow/types';

export default async function SnapshotPage({
  params, searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ scheduleId?: string }>;
}) {
  const { runId } = await params;
  const { scheduleId } = await searchParams;
  const t = await getTranslations('ScheduledReport');

  if (!scheduleId) {
    return <main style={{ padding: 24 }}><p>{t('readOnly')}</p></main>;
  }

  const r: any = await getRunSnapshot(scheduleId, runId);
  const snapshot: ReportSnapshot | null = r.ok ? r.data?.data?.snapshot ?? null : null;

  return (
    <main style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header>
        <h1 style={{ margin: 0 }}>{t('snapshotTitle')}</h1>
        <p style={{ color: 'var(--text-2, #6b7280)', fontSize: 13 }}>{t('readOnly')}</p>
      </header>
      {!snapshot ? (
        <p>{t('noRuns')}</p>
      ) : (
        <section style={{ display: 'grid', gap: 12 }}>
          {snapshot.cards.map((card) => (
            <article key={card.cardId} style={{ border: '1px solid var(--border, #e5e7eb)', borderRadius: 12, padding: 16 }}>
              <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>{card.title ?? card.type}</h2>
              {/* Frozen payload — rendered read-only. A richer per-type renderer can
                  reuse the 9a card renderer registry; for the snapshot view a labeled
                  JSON block is sufficient and never re-queries live data. */}
              <pre style={{ margin: 0, fontSize: 12, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(card.data, null, 2)}
              </pre>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
```

> The snapshot page intentionally renders the FROZEN payload (never re-resolves cards), so it always matches what was delivered. A follow-up can swap the `<pre>` for the 9a card renderer registry driven by `card.type` + `card.data`; the frozen-data contract stays the same.

- [ ] Wire into `dashboard-view.tsx` — add a "Schedule delivery" button that opens `ScheduleReportDialog` (passing the current dashboard id + workspace members as recipient options) and render `ScheduledRunHistory` for the dashboard's schedule(s). Mount the dialog state + button in the dashboard toolbar; render the history panel below the grid (a thin addition — do not disturb the existing grid/PDF-export controls from 9a):

```tsx
// (inside dashboard-view.tsx, within the toolbar render)
// const [scheduleOpen, setScheduleOpen] = useState(false);
// <button onClick={() => setScheduleOpen(true)}>{t('ScheduledReport.title')}</button>
// {scheduleOpen && (
//   <ScheduleReportDialog
//     workspaceId={workspaceId}
//     dashboardId={dashboard.id}
//     recipientOptions={members}
//     onClose={() => setScheduleOpen(false)}
//     onCreated={() => { /* refresh schedule list */ }}
//   />
// )}
```

(Adapt to the real 9a `dashboard-view.tsx` props — `workspaceId`, `dashboard.id`, and the member list are already available there. If the member list is not yet plumbed, pass the current user as the sole recipient option and note it in `DECISIONS.md`.)

- [ ] Run: `npm test --workspace apps/next-web` (i18n parity + unit). Expected: PASS. Then `npm run build --workspace apps/next-web`. Expected: PASS (Next build clean).

- [ ] Commit:
```
git add apps/next-web/src/components/ScheduledRunHistory.tsx apps/next-web/src/components/ScheduledRunHistory.module.css "apps/next-web/src/app/(app)/reports/snapshot/[runId]/page.tsx" "apps/next-web/src/app/(app)/dashboard/dashboard-view.tsx"
git commit -m "feat(9c): run-history list + read-only snapshot viewer + dashboard schedule wiring"
```

---

### Task 11: Playwright e2e (headline flow)

**Files:**
- Create: `e2e/scheduled-reports.spec.ts`
- Note: e2e specs live in the repo-root `e2e/` directory (alongside `recurring.spec.ts`/`views.spec.ts`) and run against local Docker `ProjectFlow_Test` only (use the project's existing e2e env/setup + `global-setup.ts`).

Steps:

- [ ] Write the e2e spec covering the §6.5 acceptance — schedule a dashboard, advance the sweep helper, see the run recorded + an inbox notification. Because the worker sweep is time-driven, the test seeds the schedule via the UI/API, then drives the **pure `runScheduledReportSweep` helper** (invoked through a test-only API trigger or directly in `global-setup`-style fixture) to advance time deterministically. Follow the existing spec harness (the login + seed helpers used by `recurring.spec.ts`/`views.spec.ts`):

```ts
import { test, expect } from '@playwright/test';
// Existing helpers used by other specs (recurring/views): login + seed a dashboard.
import { loginAndSeedDashboard, triggerScheduledReportSweep } from './helpers';

test.describe('Phase 9c — scheduled reports', () => {
  test('schedule a dashboard, advance the sweep, see a run + an inbox notification', async ({ page }) => {
    // loginAndSeedDashboard returns the authed page + a dashboard with one card,
    // and a second recipient user the schedule will deliver to (then logs IN as
    // that recipient at the end to read the inbox). Adapt to the repo's helper.
    const { dashboardUrl, scheduleId } = await loginAndSeedDashboard(page);
    await page.goto(dashboardUrl);

    // Open the schedule dialog and create a daily inbox schedule to the recipient.
    await page.getByRole('button', { name: /schedule delivery/i }).click();
    const dialog = page.getByRole('dialog', { name: /schedule delivery/i });
    await dialog.getByLabel(/frequency/i).selectOption('daily');
    // Pick the seeded recipient checkbox.
    await dialog.getByRole('checkbox').first().check();
    await dialog.getByRole('button', { name: /^schedule$/i }).click();
    await expect(dialog).toBeHidden();

    // Advance the schedule into the past + run the deterministic sweep helper
    // (a test-only endpoint/fixture that forces NextRunAt past and calls
    // runScheduledReportSweep). This stands in for the 5-min repeatable timer.
    await triggerScheduledReportSweep(scheduleId);

    // A run is recorded — the delivery-history panel shows a "Delivered" row.
    await page.reload();
    await expect(page.locator('[data-run-status="delivered"]').first()).toBeVisible();

    // The opened snapshot is read-only.
    await page.locator('[data-run-status="delivered"]').first().getByRole('link', { name: /open snapshot/i }).click();
    await expect(page.getByText(/read-only snapshot/i)).toBeVisible();

    // The recipient receives an in-app notification. (loginAndSeedDashboard exposes
    // a recipient session helper; switch to it and assert the bell/inbox.)
    await page.goto('/notifications');
    await expect(page.getByText(/report/i).first()).toBeVisible();
  });
});
```

(Add a small test-only helper — `triggerScheduledReportSweep` — to `e2e/helpers` that forces the schedule's `NextRunAt` into the past and invokes `runScheduledReportSweep(new Date())` against `ProjectFlow_Test`, mirroring how `recurring.spec.ts` exercises the recurrence sweep deterministically. Add `data-run-status={run.status}` to the run row in `ScheduledRunHistory.tsx` so the e2e can target delivered rows — already present from Task 10.)

- [ ] Run: the project's e2e command for a single spec against `ProjectFlow_Test` (the same invocation the views/recurring specs use, e.g. `npx playwright test e2e/scheduled-reports.spec.ts`). Expected: PASS (1 test) — schedule created, sweep records a run, snapshot is read-only, recipient gets a notification.

- [ ] Commit:
```
git add e2e/scheduled-reports.spec.ts e2e/helpers.ts
git commit -m "test(9c): e2e — schedule a dashboard, advance the sweep, run recorded + inbox notification"
```

---

### Task 12: Slice verification + DECISIONS.md

**Files:**
- Modify: `DECISIONS.md` (append a Phase 9c entry)

Steps:

- [ ] Run the full slice verification on local Docker `ProjectFlow_Test`:
  - `npm test --workspace apps/api` — Expected: PASS (existing suite + new `next-run`/`snapshot`/`idempotency` unit tests).
  - `npm run test:integration --workspace apps/api` — Expected: PASS (existing + `scheduled-report.integration.test.ts` — due-schedule single run + no double-deliver + cadence-end disable).
  - `npm test --workspace apps/next-web` — Expected: PASS (unit + `messages.unit` parity).
  - `npm run build --workspace apps/api` and `npm run build --workspace apps/next-web` — Expected: both PASS.
  - The scheduled-reports e2e — Expected: PASS.

- [ ] Append a `DECISIONS.md` entry logging: the `recurrence.worker.ts` copy (5-min sweep vs. 15-min recurrence; pure `runScheduledReportSweep(now?)`); the `PeriodKey = occurrence ISO timestamp` choice + the `UNIQUE(ScheduledReportId, PeriodKey)` + `usp_ScheduledReportRun_Record` `Inserted` flag as the idempotency keystone (worker-restart no-double-deliver); the cadence reusing the Phase 5 `validateRule`/`computeNextOccurrence` evaluator (no `count` semantics — schedules run until disabled/endsAt); the `snapshot` deep-clone freeze + resolving cards under the **owner's** object-level filter via `card.service.resolve`; the `DeliveryChannel` adapter map with `email` as an explicit Phase 12 no-op stub; the `scheduled_report.manage` RBAC slug (note if seeded here); and any 9a-contract adaptation made at implementation time. DB-execution-policy note: all DB work ran ONLY against local Docker `ProjectFlow_Test`.

- [ ] Commit:
```
git add DECISIONS.md
git commit -m "docs(9c): DECISIONS entry — scheduled-report worker/idempotency/snapshot-freeze/inbox delivery"
```

---

## Definition of Done

Per-slice DoD (spec §3) + BUILD_PLAN acceptance (spec §6.5):

- [ ] **BUILD_PLAN acceptance (§6.5):** a scheduled report is **delivered on its cadence** — a due schedule, swept, produces exactly one `ScheduledReportRuns` row + one inbox notification per period; the cadence advances via the Phase 5 evaluator; a worker restart mid-period (a second sweep over the same `PeriodKey`) does **not** double-deliver (the `UNIQUE(ScheduledReportId, PeriodKey)` + `Inserted` flag).
- [ ] Migration `0048_scheduled_reports.sql` is idempotent, GO-batched, and **reversible** via `rollback/0048_scheduled_reports.down.sql` (apply→rollback→re-apply verified clean); both tables + the exact spec §6.1 columns, incl. the `UNIQUE(ScheduledReportId, PeriodKey)` idempotency constraint.
- [ ] SP-per-op for every operation (`usp_ScheduledReport_Create|Update|Delete|GetById|ListByWorkspace|ListDue|Advance`, `usp_ScheduledReportRun_Record` [idempotent] + `usp_ScheduledReportRun_ListBySchedule`).
- [ ] The worker copies the Phase 5c pattern: idempotent Redis-gated `startScheduledReportWorker()` via `upsertJobScheduler`, a fixed sweep interval, a pure `runScheduledReportSweep(now?)` test helper; registered in `server.ts` beside the recurrence/oauth workers (same Redis gate, never in test).
- [ ] `snapshot(schedule)` resolves every card via the Phase 9a `card.service.resolve(card, scope)` under the **owner's** object-level filter and **freezes** the payload (a later live-source change does not mutate the snapshot — unit-asserted).
- [ ] Delivery goes through the Phase 3.5 notification path (`notificationService.notify` → `SCHEDULED_REPORT_READY`); the **email channel is an explicit no-op stub** behind `DeliveryChannel='email'` (Phase 12).
- [ ] REST is the primary surface; the **GraphQL mirror** (`scheduledReports`, `scheduledReportRuns` queries + `create/update/deleteScheduledReport`) delegates to the **one shared `ScheduledReportService`**.
- [ ] Authorization fail-closed via `requirePermission('scheduled_report.manage', { resolveWorkspace })` (REST) + `requireWorkspacePermission(ctx, …, 'scheduled_report.manage')` (GraphQL).
- [ ] Unit tests (next-run + period-key + cadence-end; snapshot-freeze; per-period idempotency) + integration tests (one run + one notification per period; no double-deliver on worker restart; cadence-end disables) + ≥1 Playwright e2e for the headline flow — all green.
- [ ] `@projectflow/types` updated (`ScheduledReport`, `ScheduledReportRun`, `DeliveryChannel`, `ScheduledReportStatus`, `ReportSnapshot`, create/update inputs).
- [ ] i18n: new `ScheduledReport` keys in **en.json + id.json** (real Indonesian); `messages.unit` parity green.
- [ ] All DB work (migrations, SP deploy, integration, e2e) ran **ONLY against local Docker `ProjectFlow_Test`** — never the prod-pointing `apps/api/.env`.
- [ ] `DECISIONS.md` entry logs the mechanism choices + any 9a-contract adaptation. **Stop for review/merge before Slice 9d.**

---

## Self-Review

**Spec coverage (§6).** Every §6 item is planned: §6.1 data model → Task 1 (both tables, exact columns, `UNIQUE(ScheduledReportId, PeriodKey)`); §6.2 backend → Tasks 2–8 (the five SP families `usp_ScheduledReport_Create|Update|Delete|ListDue` + `usp_ScheduledReportRun_Record` plus the GetById/ListByWorkspace/Advance/ListBySchedule helpers the service needs; `scheduled-report.service` with next-run via the reused Phase 5 evaluator + `snapshot(schedule)` resolving cards via `card.service`; `scheduled-report.worker.ts` copying the Phase 5c repeatable sweep → pure `runScheduledReportSweep(now?)`, idempotent per `PeriodKey`, delivering via the Phase 3.5 notification path, registered in `server.ts`); §6.3 frontend → Tasks 9–10 (schedule editor on a dashboard, run-history list, read-only snapshot viewer); §6.4 tests → Tasks 5/7/11 (unit: next-run/cadence + per-period idempotency no-op + snapshot-freezes; integration: one run + one inbox notification per period + worker-restart no-double-deliver; e2e: schedule → advance sweep → run recorded + inbox notification); §6.5 acceptance → Definition of Done first box + the integration/e2e tests. §2.3's three guarantees (recurrence.worker pattern, inbox delivery via notification, idempotent per `(schedule, period)`, email no-op stub behind `DeliveryChannel`) are each realized in Tasks 5/6/7. §4 (9a) `card.service.resolve` interface is used verbatim in `snapshotWith`/`snapshot()` and called out as the source-of-truth contract with an inline adaptation note (9a not yet built — Prerequisite).

**Placeholder scan.** No "deliver the other channels similarly" hand-waves: `email` is a fully-written explicit no-op stub in `delivery.ts`. Full code is given for the migration (both tables + the UNIQUE constraint), all nine SPs, `scheduled-report.repository`, `scheduled-report.service` (CRUD + `computeNextRun` + `periodKeyFor` + `snapshotWith`/`runDueWith` + `snapshot`/`runDue`), `scheduled-report.worker.ts` (pure sweep + idempotent start + the server.ts registration snippet), the REST routes, the GraphQL mirror, the schedule-editor dialog, the run-history list, and the snapshot viewer. The only deliberately-adaptive seams are the **Phase 9a accessor names** (`dashboardService.getById`/`listCards`, `cardService.resolve`) and the web `apiAction`/`members`/`dashboard-view.tsx` props — each flagged inline as "adapt to the real 9a/web contract," because 9a is an unbuilt Prerequisite (Glob confirmed `apps/api/src/**/*dashboard*` and `*card*` do not yet exist). The pure cores (`snapshotWith`/`runDueWith`/`computeNextRun`/`periodKeyFor`) are fully concrete and unit-tested via injected deps, so the tests do not depend on 9a being present.

**Type / name consistency.** Uses the exact spec names throughout: migration `0048`, tables `ScheduledReports`/`ScheduledReportRuns`, columns `DashboardId`/`ReportKind`/`ReportParams`/`Cadence`/`DeliveryChannel`/`Recipients`/`Enabled`/`NextRunAt`/`OwnerId` and `PeriodKey`/`RanAt`/`Status`/`SnapshotRef`/`Error` with `UNIQUE(ScheduledReportId, PeriodKey)`; SP names `usp_ScheduledReport_Create|Update|Delete|ListDue` + `usp_ScheduledReportRun_Record` (plus the GetById/ListByWorkspace/Advance/ListBySchedule the service requires — additive, named consistently); `DeliveryChannel` values `'inbox'|'email'`; TS types `ScheduledReport`/`ScheduledReportRun` (+ `DeliveryChannel`/`ScheduledReportStatus`/`ReportSnapshot`/inputs). Grounded against the real repo: the worker is a structural twin of `recurrence.worker.ts` (verified — `upsertJobScheduler`, `registerCloser`, pure `run*Sweep(now?)`, Redis-gated start, `started` guard); next-run reuses `computeNextOccurrence`/`validateRule` from `recurrence.ts` (verified exports); delivery calls `notificationService.notify({ recipientIds, actorId, type, payload })` (verified signature); `requirePermission`/`resolveWorkspace` (REST) and `requireWorkspacePermission`/`notFound` (GraphQL, verified in `authz.ts`) match the worklog/recurrence conventions; `execSp`/`execSpOne` + `SpParam` usage matches `sqlClient.ts`; the GraphQL registration slots beside `registerRecurrenceGraphql()` (verified ~line 761 in `schema.ts`); e2e lives in the repo-root `e2e/` dir (verified — not `apps/next-web/e2e/`). One spec ambiguity resolved: the spec lists only five SPs in §6.2 but the worker/service flow needs read/advance/run-list helpers — added `GetById`/`ListByWorkspace`/`Advance`/`ListBySchedule` as additive companions (documented in DECISIONS), keeping the five spec-named SPs verbatim.
