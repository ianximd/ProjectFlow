# Phase 8b — Timesheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a timesheet submit/approve envelope over the existing (8a-evolved) `WorkLogs` so each user's logged time for a `[PeriodStart, PeriodEnd]` window aggregates by user/date/task (with a billable split), can be submitted, and approved or rejected — locking worklog writes inside an approved/submitted period.

**Architecture:** A new `Timesheets` table is the status envelope (`draft|submitted|approved|rejected`); its line data is the existing `WorkLogs` aggregated within the period via `usp_Timesheet_Aggregate`. A new `timesheets` API module (SP-per-op repository → shared service → Hono REST routes primary + a graphql-yoga/Pothos mirror) follows the established `worklogs`/`sprints` module shape. A new `usp_WorkLog_PeriodLocked` check is wired into the 8a worklog write path so writes inside a submitted/approved period return HTTP 422. The frontend renders a TanStack Table timesheet grid (rows = day×task, period totals + billable split) with a submit button and a reviewer approve/reject view with status badges.

**Tech Stack:** SQL Server stored procedures (`CREATE OR ALTER`, `SET NOCOUNT ON`, TRY/CATCH/TRANSACTION); Hono + `@hono/zod-validator`; graphql-yoga + Pothos; `mssql`; Next.js App Router (SSR) + `@tanstack/react-table` + `next-intl`; Vitest (api unit/integration, web unit); Playwright e2e.

**Prerequisite:** Phases 1–7 + Slice 8a (evolved WorkLogs — `EndedAt`/`Billable`/`Source`, `0043_time_tracking.sql`, worklog GraphQL mirror) merged.

---

## File Structure

- `infra/sql/migrations/0044_timesheets.sql` — **Create.** Idempotent, GO-batched `Timesheets` table + `UQ_Timesheet_Period` unique index + workspace/user index.
- `infra/sql/migrations/rollback/0044_timesheets.down.sql` — **Create.** Drops `Timesheets`.
- `infra/sql/procedures/usp_Timesheet_GetOrCreate.sql` — **Create.** Get-or-insert the draft envelope for `(UserId, PeriodStart, PeriodEnd)`; returns the row.
- `infra/sql/procedures/usp_Timesheet_Aggregate.sql` — **Create.** Worklogs grouped by user/date/task within the period, billable split; plus a period totals row.
- `infra/sql/procedures/usp_Timesheet_Submit.sql` — **Create.** `draft|rejected → submitted` (throws 51810 otherwise).
- `infra/sql/procedures/usp_Timesheet_Review.sql` — **Create.** `submitted → approved|rejected` (throws 51811 otherwise).
- `infra/sql/procedures/usp_Timesheet_GetById.sql` — **Create.** Single-row read (envelope + WorkspaceId/UserId context).
- `infra/sql/procedures/usp_Timesheet_List.sql` — **Create.** List a user's timesheets in a workspace.
- `infra/sql/procedures/usp_WorkLog_PeriodLocked.sql` — **Create.** Returns 1 when a submitted/approved timesheet covers a worklog's task date for that user.
- `apps/api/src/modules/timesheets/timesheet.repository.ts` — **Create.** `mssql` calls to the SPs; row→DTO mappers.
- `apps/api/src/modules/timesheets/timesheet.service.ts` — **Create.** Shared service (REST + GraphQL delegate here): getOrCreate, getById, list, aggregate, submit, review.
- `apps/api/src/modules/timesheets/timesheet.routes.ts` — **Create.** Hono routes: `GET /timesheets`, `GET /timesheets/:id`, `POST /timesheets/:id/submit`, `POST /timesheets/:id/review`.
- `apps/api/src/graphql/timesheets.schema.ts` — **Create.** Pothos `registerTimesheetsGraphql()` mirror over `timesheetService`.
- `apps/api/src/modules/timesheets/__tests__/timesheet.aggregate.unit.test.ts` — **Create.** Pure aggregation/total-math unit tests.
- `apps/api/src/modules/timesheets/__tests__/timesheet.transition.unit.test.ts` — **Create.** Pure status-transition guard unit tests.
- `apps/api/src/modules/timesheets/__tests__/timesheet.routes.integration.test.ts` — **Create.** Route-boundary integration tests (aggregate, submit→approve, locked-period 422).
- `apps/api/src/modules/worklogs/worklog.service.ts` — **Modify.** Add a pre-write period-lock check (calls `usp_WorkLog_PeriodLocked`) raising `PeriodLockedError`.
- `apps/api/src/modules/worklogs/worklog.repository.ts` — **Modify.** Add `isPeriodLocked(taskId, userId, atDate)`.
- `apps/api/src/modules/worklogs/worklog.routes.ts` — **Modify.** Map `PeriodLockedError` → HTTP 422.
- `apps/api/src/server.ts` — **Modify.** Import + mount `timesheetRoutes` under `/timesheets` with `authMiddleware`.
- `apps/api/src/graphql/schema.ts` — **Modify.** Call `registerTimesheetsGraphql()`.
- `packages/types/index.ts` — **Modify.** Add `TimesheetStatus`, `Timesheet`, `TimesheetAggregateRow`, `TimesheetAggregate` exports.
- `apps/next-web/src/components/timesheets/timesheet-grid.tsx` — **Create.** TanStack Table grid (rows = day×task, totals + billable split) + submit button.
- `apps/next-web/src/components/timesheets/timesheet-review.tsx` — **Create.** Reviewer approve/reject view with status badges.
- `apps/next-web/src/components/timesheets/__tests__/timesheet-grid.unit.test.tsx` — **Create.** Grid render unit test.
- `apps/next-web/messages/en.json` — **Modify.** `Timesheets.*` namespace.
- `apps/next-web/messages/id.json` — **Modify.** `Timesheets.*` namespace (real Indonesian).
- `e2e/timesheets.spec.ts` — **Create.** Log time → submit → approve headline flow.

---

## Tasks

### Task 1: Migration + rollback for the `Timesheets` table

**Files:** `infra/sql/migrations/0044_timesheets.sql`, `infra/sql/migrations/rollback/0044_timesheets.down.sql`

- [ ] Write `infra/sql/migrations/0044_timesheets.sql` (idempotent, GO-batched, sys-catalog guards mirroring `0036_recurrences.sql`):
  ```sql
  -- =============================================================================
  -- Migration 0044: Timesheets (Phase 8b)
  -- New table: Timesheets — the submit/approve envelope over WorkLogs. Line data
  --   is the existing WorkLogs aggregated within [PeriodStart, PeriodEnd]; this
  --   table only carries Status + review metadata. One envelope per
  --   (UserId, PeriodStart, PeriodEnd) — enforced by UQ_Timesheet_Period.
  -- Idempotent (sys-catalog guards), GO-batched.
  -- Rollback in rollback/0044_timesheets.down.sql.
  -- =============================================================================

  IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Timesheets')
  BEGIN
      CREATE TABLE dbo.Timesheets (
          Id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Timesheets PRIMARY KEY DEFAULT NEWID(),
          WorkspaceId   UNIQUEIDENTIFIER NOT NULL,
          UserId        UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_Timesheets_User REFERENCES dbo.Users(Id),
          PeriodStart   DATE             NOT NULL,
          PeriodEnd     DATE             NOT NULL,
          Status        NVARCHAR(12)     NOT NULL CONSTRAINT DF_Timesheets_Status DEFAULT 'draft',
          SubmittedAt   DATETIME2        NULL,
          ReviewedById  UNIQUEIDENTIFIER NULL CONSTRAINT FK_Timesheets_Reviewer REFERENCES dbo.Users(Id),
          ReviewedAt    DATETIME2        NULL,
          Note          NVARCHAR(500)    NULL,
          CreatedAt     DATETIME2        NOT NULL CONSTRAINT DF_Timesheets_CreatedAt DEFAULT SYSUTCDATETIME(),
          UpdatedAt     DATETIME2        NOT NULL CONSTRAINT DF_Timesheets_UpdatedAt DEFAULT SYSUTCDATETIME(),
          CONSTRAINT CK_Timesheets_Status CHECK (Status IN ('draft','submitted','approved','rejected'))
      );
  END
  GO

  -- One envelope per user + period window.
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Timesheet_Period' AND object_id = OBJECT_ID('dbo.Timesheets'))
      CREATE UNIQUE NONCLUSTERED INDEX UQ_Timesheet_Period
          ON dbo.Timesheets (UserId, PeriodStart, PeriodEnd);
  GO

  -- Workspace + status scan cover for the list/review surfaces.
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Timesheet_Workspace' AND object_id = OBJECT_ID('dbo.Timesheets'))
      CREATE NONCLUSTERED INDEX IX_Timesheet_Workspace
          ON dbo.Timesheets (WorkspaceId, Status)
          INCLUDE (UserId, PeriodStart, PeriodEnd);
  GO
  ```
- [ ] Write `infra/sql/migrations/rollback/0044_timesheets.down.sql` (mirrors `rollback/0036_recurrences.down.sql`):
  ```sql
  -- Rollback 0044: timesheets.
  -- Drops the Timesheets table (and its indexes/constraints, which go with it).

  IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Timesheets')
      DROP TABLE dbo.Timesheets;
  GO
  ```
- [ ] **Run (forward):** apply against the local Docker `ProjectFlow_Test` DB only — never `apps/api/.env`.
  ```
  DB_SERVER=localhost DB_PORT=1433 DB_USER=sa DB_PASSWORD=YourStrong@Passw0rd DB_NAME=ProjectFlow_Test DB_ENCRYPT=false npx tsx scripts/db-migrate.ts
  ```
  Expected output: a line `Applied 0044_timesheets.sql` (or `Skipped 0044_timesheets.sql (already applied)` on re-run), and the script exits 0.
- [ ] **Run (idempotency proof):** run the same migrate command a second time. Expected: `Skipped 0044_timesheets.sql (already applied)` and exit 0 (no error).
- [ ] **Run (rollback proof):** apply the down script against `ProjectFlow_Test`, confirm the table drops, then re-run the forward migration to leave the DB ready for later tasks:
  ```
  sqlcmd -S localhost -U sa -P YourStrong@Passw0rd -d ProjectFlow_Test -C -i infra/sql/migrations/rollback/0044_timesheets.down.sql
  ```
  Expected: command completes with no error; a follow-up `SELECT OBJECT_ID('dbo.Timesheets')` returns NULL. Re-run the Task 1 forward migrate command afterward.
- [ ] **Commit:**
  ```
  git add infra/sql/migrations/0044_timesheets.sql infra/sql/migrations/rollback/0044_timesheets.down.sql
  git commit -m "feat(8b): 0044 Timesheets table + rollback (idempotent, GO-batched)"
  ```

### Task 2: Aggregate + get-or-create + list SPs

**Files:** `infra/sql/procedures/usp_Timesheet_GetOrCreate.sql`, `infra/sql/procedures/usp_Timesheet_GetById.sql`, `infra/sql/procedures/usp_Timesheet_List.sql`, `infra/sql/procedures/usp_Timesheet_Aggregate.sql`

- [ ] Write `usp_Timesheet_GetOrCreate.sql` (insert-if-missing then select; mirrors `usp_WorkLog_Create` house style):
  ```sql
  CREATE OR ALTER PROCEDURE dbo.usp_Timesheet_GetOrCreate
    @WorkspaceId UNIQUEIDENTIFIER,
    @UserId      UNIQUEIDENTIFIER,
    @PeriodStart DATE,
    @PeriodEnd   DATE
  AS
  BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (
      SELECT 1 FROM dbo.Timesheets
      WHERE UserId = @UserId AND PeriodStart = @PeriodStart AND PeriodEnd = @PeriodEnd
    )
    BEGIN
      INSERT INTO dbo.Timesheets (WorkspaceId, UserId, PeriodStart, PeriodEnd)
      VALUES (@WorkspaceId, @UserId, @PeriodStart, @PeriodEnd);
    END

    SELECT Id, WorkspaceId, UserId, PeriodStart, PeriodEnd, Status,
           SubmittedAt, ReviewedById, ReviewedAt, Note, CreatedAt, UpdatedAt
    FROM dbo.Timesheets
    WHERE UserId = @UserId AND PeriodStart = @PeriodStart AND PeriodEnd = @PeriodEnd;
  END;
  GO
  ```
- [ ] Write `usp_Timesheet_GetById.sql`:
  ```sql
  CREATE OR ALTER PROCEDURE dbo.usp_Timesheet_GetById
    @Id UNIQUEIDENTIFIER
  AS
  BEGIN
    SET NOCOUNT ON;
    SELECT Id, WorkspaceId, UserId, PeriodStart, PeriodEnd, Status,
           SubmittedAt, ReviewedById, ReviewedAt, Note, CreatedAt, UpdatedAt
    FROM dbo.Timesheets
    WHERE Id = @Id;
  END;
  GO
  ```
- [ ] Write `usp_Timesheet_List.sql`:
  ```sql
  CREATE OR ALTER PROCEDURE dbo.usp_Timesheet_List
    @WorkspaceId UNIQUEIDENTIFIER,
    @UserId      UNIQUEIDENTIFIER
  AS
  BEGIN
    SET NOCOUNT ON;
    SELECT Id, WorkspaceId, UserId, PeriodStart, PeriodEnd, Status,
           SubmittedAt, ReviewedById, ReviewedAt, Note, CreatedAt, UpdatedAt
    FROM dbo.Timesheets
    WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId
    ORDER BY PeriodStart DESC;
  END;
  GO
  ```
- [ ] Write `usp_Timesheet_Aggregate.sql` — group WorkLogs by user/date/task within the envelope's period; billable split; plus a period totals row as a second result set. Reads the 8a `Billable` column and derives the work date from `StartedAt`:
  ```sql
  CREATE OR ALTER PROCEDURE dbo.usp_Timesheet_Aggregate
    @TimesheetId UNIQUEIDENTIFIER
  AS
  BEGIN
    SET NOCOUNT ON;

    DECLARE @UserId UNIQUEIDENTIFIER, @PeriodStart DATE, @PeriodEnd DATE;
    SELECT @UserId = UserId, @PeriodStart = PeriodStart, @PeriodEnd = PeriodEnd
    FROM dbo.Timesheets WHERE Id = @TimesheetId;

    IF @UserId IS NULL
    BEGIN
      ;THROW 51820, 'Timesheet not found', 1;
    END

    -- Result set 1: one row per (work date, task), billable split.
    SELECT
      CAST(wl.StartedAt AS DATE)                                            AS WorkDate,
      wl.TaskId                                                             AS TaskId,
      tk.Title                                                             AS TaskTitle,
      SUM(wl.TimeSpentSeconds)                                             AS TotalSeconds,
      SUM(CASE WHEN wl.Billable = 1 THEN wl.TimeSpentSeconds ELSE 0 END)   AS BillableSeconds,
      SUM(CASE WHEN wl.Billable = 0 THEN wl.TimeSpentSeconds ELSE 0 END)   AS NonBillableSeconds
    FROM dbo.WorkLogs wl
    JOIN dbo.Tasks    tk ON tk.Id = wl.TaskId
    WHERE wl.UserId = @UserId
      AND wl.EndedAt IS NOT NULL                       -- closed entries only (no running timer)
      AND CAST(wl.StartedAt AS DATE) BETWEEN @PeriodStart AND @PeriodEnd
    GROUP BY CAST(wl.StartedAt AS DATE), wl.TaskId, tk.Title
    ORDER BY WorkDate ASC, TaskTitle ASC;

    -- Result set 2: period grand totals.
    SELECT
      SUM(wl.TimeSpentSeconds)                                             AS TotalSeconds,
      SUM(CASE WHEN wl.Billable = 1 THEN wl.TimeSpentSeconds ELSE 0 END)   AS BillableSeconds,
      SUM(CASE WHEN wl.Billable = 0 THEN wl.TimeSpentSeconds ELSE 0 END)   AS NonBillableSeconds
    FROM dbo.WorkLogs wl
    WHERE wl.UserId = @UserId
      AND wl.EndedAt IS NOT NULL
      AND CAST(wl.StartedAt AS DATE) BETWEEN @PeriodStart AND @PeriodEnd;
  END;
  GO
  ```
- [ ] **Run (deploy SPs):** deploy against `ProjectFlow_Test` only.
  ```
  DB_SERVER=localhost DB_PORT=1433 DB_USER=sa DB_PASSWORD=YourStrong@Passw0rd DB_NAME=ProjectFlow_Test DB_ENCRYPT=false npx tsx scripts/db-deploy-sps.ts
  ```
  Expected: the deploy log lists `usp_Timesheet_GetOrCreate`, `usp_Timesheet_GetById`, `usp_Timesheet_List`, `usp_Timesheet_Aggregate` among deployed procedures; exit 0, no SQL errors.
- [ ] **Commit:**
  ```
  git add infra/sql/procedures/usp_Timesheet_GetOrCreate.sql infra/sql/procedures/usp_Timesheet_GetById.sql infra/sql/procedures/usp_Timesheet_List.sql infra/sql/procedures/usp_Timesheet_Aggregate.sql
  git commit -m "feat(8b): timesheet get-or-create/list/get + aggregate SPs (billable split)"
  ```

### Task 3: Submit + review status-transition SPs

**Files:** `infra/sql/procedures/usp_Timesheet_Submit.sql`, `infra/sql/procedures/usp_Timesheet_Review.sql`

- [ ] Write `usp_Timesheet_Submit.sql` — `draft|rejected → submitted`; TRY/CATCH/TRANSACTION; throw 51810 on an illegal source state (mirrors the `usp_Sprint_Start` 409-throw convention):
  ```sql
  CREATE OR ALTER PROCEDURE dbo.usp_Timesheet_Submit
    @Id     UNIQUEIDENTIFIER,
    @UserId UNIQUEIDENTIFIER,
    @Note   NVARCHAR(500) = NULL
  AS
  BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
      BEGIN TRANSACTION;

      DECLARE @Status NVARCHAR(12);
      SELECT @Status = Status FROM dbo.Timesheets WITH (UPDLOCK, ROWLOCK) WHERE Id = @Id;

      IF @Status IS NULL
      BEGIN
        ROLLBACK TRANSACTION;
        ;THROW 51812, 'Timesheet not found', 1;
      END
      IF @Status NOT IN ('draft','rejected')
      BEGIN
        ROLLBACK TRANSACTION;
        ;THROW 51810, 'Only a draft or rejected timesheet can be submitted', 1;
      END

      UPDATE dbo.Timesheets
      SET Status      = 'submitted',
          SubmittedAt = SYSUTCDATETIME(),
          ReviewedById = NULL,
          ReviewedAt   = NULL,
          Note        = COALESCE(@Note, Note),
          UpdatedAt   = SYSUTCDATETIME()
      WHERE Id = @Id;

      COMMIT TRANSACTION;

      SELECT Id, WorkspaceId, UserId, PeriodStart, PeriodEnd, Status,
             SubmittedAt, ReviewedById, ReviewedAt, Note, CreatedAt, UpdatedAt
      FROM dbo.Timesheets WHERE Id = @Id;
    END TRY
    BEGIN CATCH
      IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
      THROW;
    END CATCH
  END;
  GO
  ```
- [ ] Write `usp_Timesheet_Review.sql` — `submitted → approved|rejected`; throw 51811 on an illegal source state, 51813 on an invalid decision:
  ```sql
  CREATE OR ALTER PROCEDURE dbo.usp_Timesheet_Review
    @Id           UNIQUEIDENTIFIER,
    @ReviewerId   UNIQUEIDENTIFIER,
    @Decision     NVARCHAR(12),    -- 'approved' | 'rejected'
    @Note         NVARCHAR(500) = NULL
  AS
  BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
      IF @Decision NOT IN ('approved','rejected')
      BEGIN
        ;THROW 51813, 'Decision must be approved or rejected', 1;
      END

      BEGIN TRANSACTION;

      DECLARE @Status NVARCHAR(12);
      SELECT @Status = Status FROM dbo.Timesheets WITH (UPDLOCK, ROWLOCK) WHERE Id = @Id;

      IF @Status IS NULL
      BEGIN
        ROLLBACK TRANSACTION;
        ;THROW 51812, 'Timesheet not found', 1;
      END
      IF @Status <> 'submitted'
      BEGIN
        ROLLBACK TRANSACTION;
        ;THROW 51811, 'Only a submitted timesheet can be reviewed', 1;
      END

      UPDATE dbo.Timesheets
      SET Status       = @Decision,
          ReviewedById = @ReviewerId,
          ReviewedAt   = SYSUTCDATETIME(),
          Note         = COALESCE(@Note, Note),
          UpdatedAt    = SYSUTCDATETIME()
      WHERE Id = @Id;

      COMMIT TRANSACTION;

      SELECT Id, WorkspaceId, UserId, PeriodStart, PeriodEnd, Status,
             SubmittedAt, ReviewedById, ReviewedAt, Note, CreatedAt, UpdatedAt
      FROM dbo.Timesheets WHERE Id = @Id;
    END TRY
    BEGIN CATCH
      IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
      THROW;
    END CATCH
  END;
  GO
  ```
- [ ] **Run (deploy SPs):**
  ```
  DB_SERVER=localhost DB_PORT=1433 DB_USER=sa DB_PASSWORD=YourStrong@Passw0rd DB_NAME=ProjectFlow_Test DB_ENCRYPT=false npx tsx scripts/db-deploy-sps.ts
  ```
  Expected: deploy log lists `usp_Timesheet_Submit` and `usp_Timesheet_Review`; exit 0, no SQL errors.
- [ ] **Commit:**
  ```
  git add infra/sql/procedures/usp_Timesheet_Submit.sql infra/sql/procedures/usp_Timesheet_Review.sql
  git commit -m "feat(8b): timesheet submit/review status-transition SPs (51810/51811 guards)"
  ```

### Task 4: Shared types

**Files:** `packages/types/index.ts`

- [ ] **Failing test:** add `apps/api/src/modules/timesheets/__tests__/timesheet.types.unit.test.ts` proving the new exports compile and the status union is correct (TDD anchor; deleted at end of task is not needed — keep it, it is cheap):
  ```ts
  import { describe, it, expect } from 'vitest';
  import type { Timesheet, TimesheetStatus, TimesheetAggregate } from '@projectflow/types';

  describe('timesheet types', () => {
    it('a draft timesheet object satisfies the Timesheet shape', () => {
      const ts: Timesheet = {
        id: 't1', workspaceId: 'w1', userId: 'u1',
        periodStart: '2026-06-01', periodEnd: '2026-06-07',
        status: 'draft' as TimesheetStatus,
        submittedAt: null, reviewedById: null, reviewedAt: null, note: null,
        createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
      };
      expect(ts.status).toBe('draft');
    });

    it('an aggregate carries rows and totals', () => {
      const agg: TimesheetAggregate = {
        rows: [{ workDate: '2026-06-02', taskId: 'k1', taskTitle: 'A',
                 totalSeconds: 3600, billableSeconds: 3600, nonBillableSeconds: 0 }],
        totals: { totalSeconds: 3600, billableSeconds: 3600, nonBillableSeconds: 0 },
      };
      expect(agg.rows[0].billableSeconds).toBe(3600);
    });
  });
  ```
- [ ] **Run (expected fail):**
  ```
  npm --workspace api run test:unit -- timesheet.types
  ```
  Expected: FAIL — `Cannot find module '@projectflow/types'` exports `Timesheet`/`TimesheetStatus`/`TimesheetAggregate` (TS2305 "has no exported member").
- [ ] **Minimal impl:** append to `packages/types/index.ts` after the `// ── Time Tracking / Work Logs ──` block (copy the existing export style):
  ```ts
  // ── Timesheets (Phase 8b) ─────────────────────────────────────────────────────

  export type TimesheetStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

  export interface Timesheet {
    id:           string;
    workspaceId:  string;
    userId:       string;
    periodStart:  string;   // ISO date (YYYY-MM-DD)
    periodEnd:    string;   // ISO date (YYYY-MM-DD)
    status:       TimesheetStatus;
    submittedAt:  string | null;
    reviewedById: string | null;
    reviewedAt:   string | null;
    note:         string | null;
    createdAt:    string;
    updatedAt:    string;
  }

  export interface TimesheetAggregateRow {
    workDate:           string;   // ISO date
    taskId:             string;
    taskTitle:          string;
    totalSeconds:       number;
    billableSeconds:    number;
    nonBillableSeconds: number;
  }

  export interface TimesheetAggregateTotals {
    totalSeconds:       number;
    billableSeconds:    number;
    nonBillableSeconds: number;
  }

  export interface TimesheetAggregate {
    rows:   TimesheetAggregateRow[];
    totals: TimesheetAggregateTotals;
  }
  ```
- [ ] **Run (expected pass):**
  ```
  npm --workspace api run test:unit -- timesheet.types
  ```
  Expected: PASS (2 tests).
- [ ] **Commit:**
  ```
  git add packages/types/index.ts apps/api/src/modules/timesheets/__tests__/timesheet.types.unit.test.ts
  git commit -m "feat(8b): Timesheet shared types (Timesheet/TimesheetStatus/TimesheetAggregate)"
  ```

### Task 5: Repository

**Files:** `apps/api/src/modules/timesheets/timesheet.repository.ts`

- [ ] **Failing test:** add `apps/api/src/modules/timesheets/__tests__/timesheet.repository.unit.test.ts` asserting the repo maps SP rows to DTOs (mock `execSp`/`execSpOne`):
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest';

  const execSpOne = vi.fn();
  const execSp    = vi.fn();
  vi.mock('../../../shared/lib/sqlClient.js', () => ({ execSpOne, execSp }));

  import { TimesheetRepository } from '../timesheet.repository.js';

  beforeEach(() => { execSpOne.mockReset(); execSp.mockReset(); });

  describe('TimesheetRepository.aggregate', () => {
    it('maps the two SP result sets to { rows, totals }', async () => {
      execSp.mockResolvedValue([
        [{ WorkDate: new Date('2026-06-02'), TaskId: 'k1', TaskTitle: 'A',
           TotalSeconds: 3600, BillableSeconds: 3600, NonBillableSeconds: 0 }],
        [{ TotalSeconds: 3600, BillableSeconds: 3600, NonBillableSeconds: 0 }],
      ]);
      const repo = new TimesheetRepository();
      const agg = await repo.aggregate('t1');
      expect(agg.rows).toHaveLength(1);
      expect(agg.rows[0].taskTitle).toBe('A');
      expect(agg.totals.billableSeconds).toBe(3600);
    });
  });
  ```
- [ ] **Run (expected fail):**
  ```
  npm --workspace api run test:unit -- timesheet.repository
  ```
  Expected: FAIL — `Cannot find module '../timesheet.repository.js'`.
- [ ] **Minimal impl:** create `apps/api/src/modules/timesheets/timesheet.repository.ts` (mirror `worklog.repository.ts` row-mapping + param style):
  ```ts
  import sql from 'mssql';
  import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';
  import type { Timesheet, TimesheetAggregate, TimesheetAggregateRow, TimesheetAggregateTotals } from '@projectflow/types';

  interface TimesheetRow {
    Id: string; WorkspaceId: string; UserId: string;
    PeriodStart: Date | string; PeriodEnd: Date | string; Status: string;
    SubmittedAt: Date | null; ReviewedById: string | null; ReviewedAt: Date | null;
    Note: string | null; CreatedAt: Date; UpdatedAt: Date;
  }
  interface AggRow {
    WorkDate: Date | string; TaskId: string; TaskTitle: string;
    TotalSeconds: number; BillableSeconds: number; NonBillableSeconds: number;
  }
  interface AggTotalsRow { TotalSeconds: number | null; BillableSeconds: number | null; NonBillableSeconds: number | null; }

  const iso     = (v: Date | string) => (v instanceof Date ? v.toISOString() : String(v));
  const isoDate = (v: Date | string) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

  function rowToTimesheet(r: TimesheetRow): Timesheet {
    return {
      id: r.Id, workspaceId: r.WorkspaceId, userId: r.UserId,
      periodStart: isoDate(r.PeriodStart), periodEnd: isoDate(r.PeriodEnd),
      status: r.Status as Timesheet['status'],
      submittedAt: r.SubmittedAt ? iso(r.SubmittedAt) : null,
      reviewedById: r.ReviewedById, reviewedAt: r.ReviewedAt ? iso(r.ReviewedAt) : null,
      note: r.Note, createdAt: iso(r.CreatedAt), updatedAt: iso(r.UpdatedAt),
    };
  }

  export class TimesheetRepository {
    async getOrCreate(workspaceId: string, userId: string, periodStart: string, periodEnd: string): Promise<Timesheet> {
      const rows = await execSpOne<TimesheetRow>('usp_Timesheet_GetOrCreate', [
        { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
        { name: 'UserId',      type: sql.UniqueIdentifier, value: userId },
        { name: 'PeriodStart', type: sql.Date,             value: periodStart },
        { name: 'PeriodEnd',   type: sql.Date,             value: periodEnd },
      ]);
      return rowToTimesheet(rows[0]);
    }

    async getById(id: string): Promise<Timesheet | null> {
      const rows = await execSpOne<TimesheetRow>('usp_Timesheet_GetById', [
        { name: 'Id', type: sql.UniqueIdentifier, value: id },
      ]);
      return rows[0] ? rowToTimesheet(rows[0]) : null;
    }

    async list(workspaceId: string, userId: string): Promise<Timesheet[]> {
      const rows = await execSpOne<TimesheetRow>('usp_Timesheet_List', [
        { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
        { name: 'UserId',      type: sql.UniqueIdentifier, value: userId },
      ]);
      return rows.map(rowToTimesheet);
    }

    async aggregate(timesheetId: string): Promise<TimesheetAggregate> {
      const sets = await execSp<AggRow | AggTotalsRow>('usp_Timesheet_Aggregate', [
        { name: 'TimesheetId', type: sql.UniqueIdentifier, value: timesheetId },
      ]);
      const rows = (sets[0] as AggRow[]).map((r): TimesheetAggregateRow => ({
        workDate: isoDate(r.WorkDate), taskId: r.TaskId, taskTitle: r.TaskTitle,
        totalSeconds: r.TotalSeconds, billableSeconds: r.BillableSeconds, nonBillableSeconds: r.NonBillableSeconds,
      }));
      const t = ((sets[1] ?? [])[0] ?? {}) as AggTotalsRow;
      const totals: TimesheetAggregateTotals = {
        totalSeconds: t.TotalSeconds ?? 0, billableSeconds: t.BillableSeconds ?? 0, nonBillableSeconds: t.NonBillableSeconds ?? 0,
      };
      return { rows, totals };
    }

    async submit(id: string, userId: string, note: string | null): Promise<Timesheet | null> {
      const rows = await execSpOne<TimesheetRow>('usp_Timesheet_Submit', [
        { name: 'Id',     type: sql.UniqueIdentifier, value: id },
        { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
        { name: 'Note',   type: sql.NVarChar(500),    value: note },
      ]);
      return rows[0] ? rowToTimesheet(rows[0]) : null;
    }

    async review(id: string, reviewerId: string, decision: 'approved' | 'rejected', note: string | null): Promise<Timesheet | null> {
      const rows = await execSpOne<TimesheetRow>('usp_Timesheet_Review', [
        { name: 'Id',         type: sql.UniqueIdentifier, value: id },
        { name: 'ReviewerId', type: sql.UniqueIdentifier, value: reviewerId },
        { name: 'Decision',   type: sql.NVarChar(12),     value: decision },
        { name: 'Note',       type: sql.NVarChar(500),    value: note },
      ]);
      return rows[0] ? rowToTimesheet(rows[0]) : null;
    }
  }
  ```
- [ ] **Run (expected pass):**
  ```
  npm --workspace api run test:unit -- timesheet.repository
  ```
  Expected: PASS (1 test).
- [ ] **Commit:**
  ```
  git add apps/api/src/modules/timesheets/timesheet.repository.ts apps/api/src/modules/timesheets/__tests__/timesheet.repository.unit.test.ts
  git commit -m "feat(8b): timesheet repository (get-or-create/list/aggregate/submit/review)"
  ```

### Task 6: Service with status-transition guards

**Files:** `apps/api/src/modules/timesheets/timesheet.service.ts`, `apps/api/src/modules/timesheets/__tests__/timesheet.transition.unit.test.ts`

- [ ] **Failing test:** write `timesheet.transition.unit.test.ts` for a PURE transition-guard helper the service exports:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { canTransition, TimesheetTransitionError } from '../timesheet.service.js';

  describe('canTransition', () => {
    it('draft → submitted is allowed', () => { expect(canTransition('draft', 'submitted')).toBe(true); });
    it('rejected → submitted is allowed (re-submit)', () => { expect(canTransition('rejected', 'submitted')).toBe(true); });
    it('submitted → approved is allowed', () => { expect(canTransition('submitted', 'approved')).toBe(true); });
    it('submitted → rejected is allowed', () => { expect(canTransition('submitted', 'rejected')).toBe(true); });
    it('approved → submitted is NOT allowed', () => { expect(canTransition('approved', 'submitted')).toBe(false); });
    it('draft → approved is NOT allowed', () => { expect(canTransition('draft', 'approved')).toBe(false); });

    it('assertTransition throws TimesheetTransitionError on an illegal move', () => {
      expect(() => assertTransitionThrows()).toThrow(TimesheetTransitionError);
    });
  });

  function assertTransitionThrows() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { assertTransition } = require('../timesheet.service.js');
    assertTransition('approved', 'submitted');
  }
  ```
- [ ] **Run (expected fail):**
  ```
  npm --workspace api run test:unit -- timesheet.transition
  ```
  Expected: FAIL — `Cannot find module '../timesheet.service.js'`.
- [ ] **Minimal impl:** create `apps/api/src/modules/timesheets/timesheet.service.ts` (singleton-object export style like `sprintService`; pure guard exported for tests):
  ```ts
  import { TimesheetRepository } from './timesheet.repository.js';
  import type { Timesheet, TimesheetAggregate, TimesheetStatus } from '@projectflow/types';

  const repo = new TimesheetRepository();

  /** Legal status transitions for the submit/approve workflow. */
  const ALLOWED: Record<TimesheetStatus, TimesheetStatus[]> = {
    draft:     ['submitted'],
    rejected:  ['submitted'],
    submitted: ['approved', 'rejected'],
    approved:  [],
  };

  export class TimesheetTransitionError extends Error {
    constructor(public from: TimesheetStatus, public to: TimesheetStatus) {
      super(`Illegal timesheet transition ${from} → ${to}`);
      this.name = 'TimesheetTransitionError';
    }
  }

  export function canTransition(from: TimesheetStatus, to: TimesheetStatus): boolean {
    return (ALLOWED[from] ?? []).includes(to);
  }

  export function assertTransition(from: TimesheetStatus, to: TimesheetStatus): void {
    if (!canTransition(from, to)) throw new TimesheetTransitionError(from, to);
  }

  export const timesheetService = {
    getOrCreate: (workspaceId: string, userId: string, periodStart: string, periodEnd: string): Promise<Timesheet> =>
      repo.getOrCreate(workspaceId, userId, periodStart, periodEnd),

    getById: (id: string): Promise<Timesheet | null> => repo.getById(id),

    list: (workspaceId: string, userId: string): Promise<Timesheet[]> => repo.list(workspaceId, userId),

    aggregate: (id: string): Promise<TimesheetAggregate> => repo.aggregate(id),

    submit: (id: string, userId: string, note: string | null): Promise<Timesheet | null> =>
      repo.submit(id, userId, note),

    review: (id: string, reviewerId: string, decision: 'approved' | 'rejected', note: string | null): Promise<Timesheet | null> =>
      repo.review(id, reviewerId, decision, note),
  };
  ```
- [ ] **Run (expected pass):**
  ```
  npm --workspace api run test:unit -- timesheet.transition
  ```
  Expected: PASS (7 tests).
- [ ] Write `apps/api/src/modules/timesheets/__tests__/timesheet.aggregate.unit.test.ts` (pure period totals math; the SP totals are trusted, so this asserts the `rows`→`totals` consistency a helper guarantees):
  ```ts
  import { describe, it, expect } from 'vitest';
  import { sumAggregateRows } from '../timesheet.service.js';

  describe('sumAggregateRows', () => {
    it('sums total/billable/non-billable across rows', () => {
      const totals = sumAggregateRows([
        { workDate: '2026-06-02', taskId: 'a', taskTitle: 'A', totalSeconds: 3600, billableSeconds: 3600, nonBillableSeconds: 0 },
        { workDate: '2026-06-03', taskId: 'b', taskTitle: 'B', totalSeconds: 1800, billableSeconds: 0,    nonBillableSeconds: 1800 },
      ]);
      expect(totals).toEqual({ totalSeconds: 5400, billableSeconds: 3600, nonBillableSeconds: 1800 });
    });
    it('empty rows → all zero', () => {
      expect(sumAggregateRows([])).toEqual({ totalSeconds: 0, billableSeconds: 0, nonBillableSeconds: 0 });
    });
  });
  ```
- [ ] **Run (expected fail):**
  ```
  npm --workspace api run test:unit -- timesheet.aggregate
  ```
  Expected: FAIL — `sumAggregateRows` is not exported.
- [ ] **Minimal impl:** add to `timesheet.service.ts` above the `timesheetService` export:
  ```ts
  import type { TimesheetAggregateRow, TimesheetAggregateTotals } from '@projectflow/types';

  /** Pure: total/billable/non-billable across aggregate rows. Used by the grid + tests. */
  export function sumAggregateRows(rows: TimesheetAggregateRow[]): TimesheetAggregateTotals {
    return rows.reduce<TimesheetAggregateTotals>(
      (acc, r) => ({
        totalSeconds:       acc.totalSeconds + r.totalSeconds,
        billableSeconds:    acc.billableSeconds + r.billableSeconds,
        nonBillableSeconds: acc.nonBillableSeconds + r.nonBillableSeconds,
      }),
      { totalSeconds: 0, billableSeconds: 0, nonBillableSeconds: 0 },
    );
  }
  ```
- [ ] **Run (expected pass):**
  ```
  npm --workspace api run test:unit -- timesheet.aggregate timesheet.transition
  ```
  Expected: PASS (9 tests).
- [ ] **Commit:**
  ```
  git add apps/api/src/modules/timesheets/timesheet.service.ts apps/api/src/modules/timesheets/__tests__/timesheet.transition.unit.test.ts apps/api/src/modules/timesheets/__tests__/timesheet.aggregate.unit.test.ts
  git commit -m "feat(8b): timesheet service + pure transition guard + row-sum helper"
  ```

### Task 7: REST routes + mount + integration tests

**Files:** `apps/api/src/modules/timesheets/timesheet.routes.ts`, `apps/api/src/server.ts`, `apps/api/src/modules/timesheets/__tests__/timesheet.routes.integration.test.ts`

- [ ] **Failing test:** write `timesheet.routes.integration.test.ts` (harness from `task-transition.integration.test.ts`: `request`/`json` from `__tests__/setup/testServer.js`, factories, `truncateAll`). Cover get-or-create, aggregate, submit→approve, and reviewer gate:
  ```ts
  import { afterAll, beforeEach, describe, expect, it } from 'vitest';
  import { request, json } from '../../../__tests__/setup/testServer.js';
  import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
  import {
    createTestUser, createTestWorkspace, createTestProject, createTestTask,
  } from '../../../__tests__/fixtures/factories.js';
  import { closePool } from '../../../shared/lib/db.js';
  import type { Timesheet, TimesheetAggregate } from '@projectflow/types';

  beforeEach(async () => { await truncateAll(); });
  afterAll  (async () => { await closePool();   });

  const PERIOD = { workspaceId: '', periodStart: '2026-06-01', periodEnd: '2026-06-07' };

  describe('Timesheets REST', () => {
    it('GET /timesheets get-or-creates a draft and aggregates logged time, then submit→approve', async () => {
      const owner   = await createTestUser({ email: 'ts-owner@projectflow.test' });
      const ws      = await createTestWorkspace(owner.accessToken);
      const project = await createTestProject(ws.Id, owner.accessToken);
      const task    = await createTestTask(project.Id, ws.Id, owner.accessToken);

      // 8a worklog write: a closed, billable 1h entry inside the period.
      await request('/worklogs', {
        method: 'POST', token: owner.accessToken,
        json: { taskId: task.Id, timeSpentSeconds: 3600,
                startedAt: '2026-06-02T09:00:00.000Z', billable: true, source: 'manual' },
      });

      const listed = await request(
        `/timesheets?workspaceId=${ws.Id}&periodStart=${PERIOD.periodStart}&periodEnd=${PERIOD.periodEnd}`,
        { token: owner.accessToken },
      );
      const { data } = await json<{ data: Timesheet }>(listed, 200);
      expect(data.status).toBe('draft');

      const agg = await request(`/timesheets/${data.id}/aggregate`, { token: owner.accessToken });
      const aggBody = await json<{ data: TimesheetAggregate }>(agg, 200);
      expect(aggBody.data.totals.totalSeconds).toBe(3600);
      expect(aggBody.data.totals.billableSeconds).toBe(3600);

      const submitted = await request(`/timesheets/${data.id}/submit`, { method: 'POST', token: owner.accessToken, json: {} });
      const subBody = await json<{ data: Timesheet }>(submitted, 200);
      expect(subBody.data.status).toBe('submitted');

      const reviewed = await request(`/timesheets/${data.id}/review`, {
        method: 'POST', token: owner.accessToken, json: { decision: 'approved' },
      });
      const revBody = await json<{ data: Timesheet }>(reviewed, 200);
      expect(revBody.data.status).toBe('approved');
    });

    it('locks worklog writes inside a submitted period → 422', async () => {
      const owner   = await createTestUser({ email: 'ts-lock@projectflow.test' });
      const ws      = await createTestWorkspace(owner.accessToken);
      const project = await createTestProject(ws.Id, owner.accessToken);
      const task    = await createTestTask(project.Id, ws.Id, owner.accessToken);

      await request('/worklogs', {
        method: 'POST', token: owner.accessToken,
        json: { taskId: task.Id, timeSpentSeconds: 3600, startedAt: '2026-06-02T09:00:00.000Z', source: 'manual' },
      });
      const listed = await request(
        `/timesheets?workspaceId=${ws.Id}&periodStart=${PERIOD.periodStart}&periodEnd=${PERIOD.periodEnd}`,
        { token: owner.accessToken },
      );
      const { data } = await json<{ data: Timesheet }>(listed, 200);
      await request(`/timesheets/${data.id}/submit`, { method: 'POST', token: owner.accessToken, json: {} });

      const blocked = await request('/worklogs', {
        method: 'POST', token: owner.accessToken,
        json: { taskId: task.Id, timeSpentSeconds: 600, startedAt: '2026-06-03T09:00:00.000Z', source: 'manual' },
      });
      expect(blocked.status).toBe(422);
    });

    it('rejects an illegal review (timesheet still draft) with 409', async () => {
      const owner   = await createTestUser({ email: 'ts-illegal@projectflow.test' });
      const ws      = await createTestWorkspace(owner.accessToken);
      const listed = await request(
        `/timesheets?workspaceId=${ws.Id}&periodStart=${PERIOD.periodStart}&periodEnd=${PERIOD.periodEnd}`,
        { token: owner.accessToken },
      );
      const { data } = await json<{ data: Timesheet }>(listed, 200);
      const res = await request(`/timesheets/${data.id}/review`, {
        method: 'POST', token: owner.accessToken, json: { decision: 'approved' },
      });
      expect(res.status).toBe(409);
    });
  });
  ```
- [ ] **Run (expected fail):**
  ```
  DB_SERVER=localhost DB_PORT=1433 DB_USER=sa DB_PASSWORD=YourStrong@Passw0rd DB_NAME=ProjectFlow_Test DB_ENCRYPT=false npm --workspace api run test:integration -- timesheet.routes
  ```
  Expected: FAIL — 404 on every `/timesheets` call (route not mounted). (The locked-period 422 case will also fail; it is satisfied by Task 9.)
- [ ] **Minimal impl:** create `apps/api/src/modules/timesheets/timesheet.routes.ts` (REST primary; `requirePermission` fail-closed; SP error-number→HTTP mapping like `sprint.routes.ts`):
  ```ts
  import { Hono }       from 'hono';
  import { zValidator } from '@hono/zod-validator';
  import { z }          from 'zod';
  import { timesheetService } from './timesheet.service.js';
  import { TimesheetRepository } from './timesheet.repository.js';
  import { requirePermission } from '../../shared/middleware/permissions.middleware.js';

  const repoForLookup = new TimesheetRepository();
  const resolveTimesheetWorkspace = async (c: any) =>
    (await repoForLookup.getById(c.req.param('id')!))?.workspaceId ?? null;

  const reviewSchema = z.object({
    decision: z.enum(['approved', 'rejected']),
    note:     z.string().max(500).optional(),
  });
  const submitSchema = z.object({ note: z.string().max(500).optional() });

  export const timesheetRoutes = new Hono();

  // GET /timesheets?workspaceId=&periodStart=&periodEnd=
  //   With period params → get-or-create that envelope. Without → list the user's.
  timesheetRoutes.get(
    '/',
    requirePermission('timesheet.read', { resolveWorkspace: (c) => c.req.query('workspaceId') ?? null }),
    async (c) => {
      const user        = (c as any).get('user') as any;
      const userId      = user.userId as string;
      const workspaceId = c.req.query('workspaceId');
      if (!workspaceId) return c.json({ error: { message: 'workspaceId is required' } }, 400);
      const periodStart = c.req.query('periodStart');
      const periodEnd   = c.req.query('periodEnd');
      if (periodStart && periodEnd) {
        const ts = await timesheetService.getOrCreate(workspaceId, userId, periodStart, periodEnd);
        return c.json({ data: ts });
      }
      const list = await timesheetService.list(workspaceId, userId);
      return c.json({ data: list });
    },
  );

  // GET /timesheets/:id
  timesheetRoutes.get(
    '/:id',
    requirePermission('timesheet.read', { resolveWorkspace: resolveTimesheetWorkspace }),
    async (c) => {
      const ts = await timesheetService.getById(c.req.param('id')!);
      if (!ts) return c.json({ error: { message: 'Not found' } }, 404);
      return c.json({ data: ts });
    },
  );

  // GET /timesheets/:id/aggregate
  timesheetRoutes.get(
    '/:id/aggregate',
    requirePermission('timesheet.read', { resolveWorkspace: resolveTimesheetWorkspace }),
    async (c) => {
      const agg = await timesheetService.aggregate(c.req.param('id')!);
      return c.json({ data: agg });
    },
  );

  // POST /timesheets/:id/submit
  timesheetRoutes.post(
    '/:id/submit',
    requirePermission('timesheet.submit', { resolveWorkspace: resolveTimesheetWorkspace }),
    zValidator('json', submitSchema),
    async (c) => {
      const user   = (c as any).get('user') as any;
      const userId = user.userId as string;
      const { note } = c.req.valid('json');
      try {
        const ts = await timesheetService.submit(c.req.param('id')!, userId, note ?? null);
        if (!ts) return c.json({ error: { message: 'Not found' } }, 404);
        return c.json({ data: ts });
      } catch (err: any) {
        if (err.number === 51810) return c.json({ error: { message: err.message } }, 409);
        if (err.number === 51812) return c.json({ error: { message: 'Not found' } }, 404);
        throw err;
      }
    },
  );

  // POST /timesheets/:id/review  — approve/reject
  timesheetRoutes.post(
    '/:id/review',
    requirePermission('timesheet.approve', { resolveWorkspace: resolveTimesheetWorkspace }),
    zValidator('json', reviewSchema),
    async (c) => {
      const user   = (c as any).get('user') as any;
      const userId = user.userId as string;
      const { decision, note } = c.req.valid('json');
      try {
        const ts = await timesheetService.review(c.req.param('id')!, userId, decision, note ?? null);
        if (!ts) return c.json({ error: { message: 'Not found' } }, 404);
        return c.json({ data: ts });
      } catch (err: any) {
        if (err.number === 51811 || err.number === 51813) return c.json({ error: { message: err.message } }, 409);
        if (err.number === 51812) return c.json({ error: { message: 'Not found' } }, 404);
        throw err;
      }
    },
  );
  ```
- [ ] **Minimal impl:** mount in `apps/api/src/server.ts`. Add the import beside the other module imports:
  ```ts
  import { timesheetRoutes } from './modules/timesheets/timesheet.routes.js';
  ```
  Add the auth gate beside `app.use('/worklogs/*', authMiddleware);`:
  ```ts
  app.use('/timesheets/*', authMiddleware);
  ```
  Add the route mount beside `app.route('/worklogs', worklogRoutes);`:
  ```ts
  app.route('/timesheets', timesheetRoutes);
  ```
- [ ] **Run (expected pass, minus the lock case):**
  ```
  DB_SERVER=localhost DB_PORT=1433 DB_USER=sa DB_PASSWORD=YourStrong@Passw0rd DB_NAME=ProjectFlow_Test DB_ENCRYPT=false npm --workspace api run test:integration -- timesheet.routes
  ```
  Expected: the get-or-create/aggregate/submit/approve test and the illegal-review-409 test PASS; the "locks worklog writes → 422" test still FAILS (returns 201). That failure is closed in Task 9.
- [ ] **Commit:**
  ```
  git add apps/api/src/modules/timesheets/timesheet.routes.ts apps/api/src/server.ts apps/api/src/modules/timesheets/__tests__/timesheet.routes.integration.test.ts
  git commit -m "feat(8b): timesheet REST routes (get-or-create/aggregate/submit/review) + mount"
  ```

### Task 8: GraphQL mirror

**Files:** `apps/api/src/graphql/timesheets.schema.ts`, `apps/api/src/graphql/schema.ts`

- [ ] **Failing test:** add `apps/api/src/graphql/__tests__/timesheets.schema.unit.test.ts` asserting the schema exposes the new fields (introspection over the built schema, mirroring how other schema registrations are verified):
  ```ts
  import { describe, it, expect } from 'vitest';
  import { schema } from '../schema.js';

  describe('timesheets GraphQL mirror', () => {
    it('registers the timesheet query + submit/review mutations and a Timesheet type', () => {
      const q = schema.getQueryType()!.getFields();
      const m = schema.getMutationType()!.getFields();
      expect(q.timesheet).toBeDefined();
      expect(m.submitTimesheet).toBeDefined();
      expect(m.reviewTimesheet).toBeDefined();
      expect(schema.getType('Timesheet')).toBeDefined();
      expect(schema.getType('TimesheetAggregate')).toBeDefined();
    });
  });
  ```
- [ ] **Run (expected fail):**
  ```
  npm --workspace api run test:unit -- timesheets.schema
  ```
  Expected: FAIL — `q.timesheet` / `m.submitTimesheet` are undefined.
- [ ] **Minimal impl:** create `apps/api/src/graphql/timesheets.schema.ts` (mirror `recurrence.schema.ts`: `objectRef`, `requireWorkspacePermission` fail-closed, delegate to `timesheetService`):
  ```ts
  import { GraphQLError } from 'graphql';
  import { builder } from './builder.js';
  import { timesheetService } from '../modules/timesheets/timesheet.service.js';
  import { requireWorkspacePermission, notFound } from './authz.js';
  import type { Timesheet, TimesheetAggregate, TimesheetAggregateRow, TimesheetAggregateTotals } from '@projectflow/types';

  export function registerTimesheetsGraphql(): void {
    const TimesheetType = builder.objectRef<Timesheet>('Timesheet');
    TimesheetType.implement({ fields: (t) => ({
      id:           t.exposeString('id'),
      workspaceId:  t.exposeString('workspaceId'),
      userId:       t.exposeString('userId'),
      periodStart:  t.exposeString('periodStart'),
      periodEnd:    t.exposeString('periodEnd'),
      status:       t.exposeString('status'),
      submittedAt:  t.string({ nullable: true, resolve: (r) => r.submittedAt ?? null }),
      reviewedById: t.string({ nullable: true, resolve: (r) => r.reviewedById ?? null }),
      reviewedAt:   t.string({ nullable: true, resolve: (r) => r.reviewedAt ?? null }),
      note:         t.string({ nullable: true, resolve: (r) => r.note ?? null }),
      createdAt:    t.exposeString('createdAt'),
      updatedAt:    t.exposeString('updatedAt'),
    }) });

    const TimesheetRowType = builder.objectRef<TimesheetAggregateRow>('TimesheetAggregateRow');
    TimesheetRowType.implement({ fields: (t) => ({
      workDate:           t.exposeString('workDate'),
      taskId:             t.exposeString('taskId'),
      taskTitle:          t.exposeString('taskTitle'),
      totalSeconds:       t.exposeInt('totalSeconds'),
      billableSeconds:    t.exposeInt('billableSeconds'),
      nonBillableSeconds: t.exposeInt('nonBillableSeconds'),
    }) });

    const TimesheetTotalsType = builder.objectRef<TimesheetAggregateTotals>('TimesheetAggregateTotals');
    TimesheetTotalsType.implement({ fields: (t) => ({
      totalSeconds:       t.exposeInt('totalSeconds'),
      billableSeconds:    t.exposeInt('billableSeconds'),
      nonBillableSeconds: t.exposeInt('nonBillableSeconds'),
    }) });

    const TimesheetAggregateType = builder.objectRef<TimesheetAggregate>('TimesheetAggregate');
    TimesheetAggregateType.implement({ fields: (t) => ({
      rows:   t.field({ type: [TimesheetRowType], resolve: (a) => a.rows }),
      totals: t.field({ type: TimesheetTotalsType, resolve: (a) => a.totals }),
    }) });

    builder.queryFields((t) => ({
      timesheet: t.field({
        type: TimesheetType,
        nullable: true,
        args: {
          workspaceId: t.arg.string({ required: true }),
          periodStart: t.arg.string({ required: true }),
          periodEnd:   t.arg.string({ required: true }),
        },
        resolve: async (_, a, ctx) => {
          await requireWorkspacePermission(ctx, a.workspaceId, 'timesheet.read');
          return timesheetService.getOrCreate(a.workspaceId, (ctx.user as any).userId, a.periodStart, a.periodEnd);
        },
      }),
      timesheetAggregate: t.field({
        type: TimesheetAggregateType,
        args: { id: t.arg.string({ required: true }) },
        resolve: async (_, a, ctx) => {
          const ts = await timesheetService.getById(a.id);
          if (!ts) notFound('Timesheet not found');
          await requireWorkspacePermission(ctx, ts!.workspaceId, 'timesheet.read');
          return timesheetService.aggregate(a.id);
        },
      }),
    }));

    builder.mutationFields((t) => ({
      submitTimesheet: t.field({
        type: TimesheetType,
        args: { id: t.arg.string({ required: true }), note: t.arg.string({ required: false }) },
        resolve: async (_, a, ctx) => {
          const ts = await timesheetService.getById(a.id);
          if (!ts) notFound('Timesheet not found');
          await requireWorkspacePermission(ctx, ts!.workspaceId, 'timesheet.submit');
          try {
            return await timesheetService.submit(a.id, (ctx.user as any).userId, a.note ?? null);
          } catch (err: any) {
            if (err?.number === 51810) throw new GraphQLError(err.message, { extensions: { code: 'ILLEGAL_TRANSITION' } });
            throw err;
          }
        },
      }),
      reviewTimesheet: t.field({
        type: TimesheetType,
        args: { id: t.arg.string({ required: true }), decision: t.arg.string({ required: true }), note: t.arg.string({ required: false }) },
        resolve: async (_, a, ctx) => {
          const ts = await timesheetService.getById(a.id);
          if (!ts) notFound('Timesheet not found');
          await requireWorkspacePermission(ctx, ts!.workspaceId, 'timesheet.approve');
          if (a.decision !== 'approved' && a.decision !== 'rejected')
            throw new GraphQLError('Decision must be approved or rejected', { extensions: { code: 'BAD_INPUT' } });
          try {
            return await timesheetService.review(a.id, (ctx.user as any).userId, a.decision, a.note ?? null);
          } catch (err: any) {
            if (err?.number === 51811) throw new GraphQLError(err.message, { extensions: { code: 'ILLEGAL_TRANSITION' } });
            throw err;
          }
        },
      }),
    }));
  }
  ```
- [ ] **Minimal impl:** wire into `apps/api/src/graphql/schema.ts`. Add the import beside `registerRecurrenceGraphql`:
  ```ts
  import { registerTimesheetsGraphql } from './timesheets.schema.js';
  ```
  Add the registration call beside `registerTemplatesGraphql();` (before `registerPresenceGraphql();`):
  ```ts
  registerTimesheetsGraphql();
  ```
- [ ] **Run (expected pass):**
  ```
  npm --workspace api run test:unit -- timesheets.schema
  ```
  Expected: PASS (1 test).
- [ ] **Commit:**
  ```
  git add apps/api/src/graphql/timesheets.schema.ts apps/api/src/graphql/schema.ts apps/api/src/graphql/__tests__/timesheets.schema.unit.test.ts
  git commit -m "feat(8b): timesheet GraphQL mirror (timesheet/aggregate queries + submit/review)"
  ```

### Task 9: Worklog period-lock hook (8a write path)

**Files:** `infra/sql/procedures/usp_WorkLog_PeriodLocked.sql`, `apps/api/src/modules/worklogs/worklog.repository.ts`, `apps/api/src/modules/worklogs/worklog.service.ts`, `apps/api/src/modules/worklogs/worklog.routes.ts`

> **Cross-slice note:** This closes the spec's period-lock requirement (§5.2 — "worklog writes in a submitted/approved period return 422 unless reopened"). It necessarily touches the 8a worklog write path: a new `usp_WorkLog_PeriodLocked` check is invoked before create/update so a write whose work date falls inside a `submitted`/`approved` `Timesheet` for that user is rejected. Reopening (a reviewer setting the timesheet back to `rejected`/`draft` via `/review` or a future reopen endpoint) lifts the lock because only `submitted`/`approved` rows count.

- [ ] Write `usp_WorkLog_PeriodLocked.sql` — returns `IsLocked BIT` for a `(UserId, work date)` pair:
  ```sql
  CREATE OR ALTER PROCEDURE dbo.usp_WorkLog_PeriodLocked
    @UserId   UNIQUEIDENTIFIER,
    @WorkDate DATE
  AS
  BEGIN
    SET NOCOUNT ON;
    SELECT CAST(
      CASE WHEN EXISTS (
        SELECT 1 FROM dbo.Timesheets
        WHERE UserId = @UserId
          AND Status IN ('submitted','approved')
          AND @WorkDate BETWEEN PeriodStart AND PeriodEnd
      ) THEN 1 ELSE 0 END
    AS BIT) AS IsLocked;
  END;
  GO
  ```
- [ ] **Run (deploy SP):**
  ```
  DB_SERVER=localhost DB_PORT=1433 DB_USER=sa DB_PASSWORD=YourStrong@Passw0rd DB_NAME=ProjectFlow_Test DB_ENCRYPT=false npx tsx scripts/db-deploy-sps.ts
  ```
  Expected: deploy log lists `usp_WorkLog_PeriodLocked`; exit 0.
- [ ] **Minimal impl (repository):** add `isPeriodLocked` to `apps/api/src/modules/worklogs/worklog.repository.ts` (inside `WorkLogRepository`, mirroring its existing `execSpOne` calls):
  ```ts
  async isPeriodLocked(userId: string, workDate: string): Promise<boolean> {
    const rows = await execSpOne<{ IsLocked: boolean }>('usp_WorkLog_PeriodLocked', [
      { name: 'UserId',   type: sql.UniqueIdentifier, value: userId },
      { name: 'WorkDate', type: sql.Date,             value: workDate.slice(0, 10) },
    ]);
    return Boolean(rows[0]?.IsLocked);
  }
  ```
- [ ] **Minimal impl (service):** in `apps/api/src/modules/worklogs/worklog.service.ts`, add a `PeriodLockedError` and a guard before `create`/`update` writes. Replace the file's body with the locked variant:
  ```ts
  import { WorkLogRepository } from './worklog.repository.js';
  import type { WorkLog, WorkLogListResult } from '@projectflow/types';

  const repo = new WorkLogRepository();

  export class PeriodLockedError extends Error {
    constructor() { super('Time period is locked by a submitted or approved timesheet'); this.name = 'PeriodLockedError'; }
  }

  export class WorkLogService {
    listByTask(taskId: string): Promise<WorkLogListResult> {
      return repo.listByTask(taskId);
    }

    async create(
      taskId: string, userId: string, timeSpentSeconds: number, startedAt: string, description?: string,
    ): Promise<WorkLog> {
      if (await repo.isPeriodLocked(userId, startedAt)) throw new PeriodLockedError();
      return repo.create(taskId, userId, timeSpentSeconds, startedAt, description);
    }

    async update(
      id: string, userId: string,
      patch: { timeSpentSeconds?: number; startedAt?: string; description?: string },
    ): Promise<WorkLog | null> {
      const existing = await repo.getById(id);
      const effectiveDate = patch.startedAt
        ?? (existing?.StartedAt as string | undefined)
        ?? (existing?.startedAt as string | undefined);
      if (effectiveDate && await repo.isPeriodLocked(userId, String(effectiveDate))) throw new PeriodLockedError();
      return repo.update(id, userId, patch);
    }

    delete(id: string, userId: string): Promise<void> {
      return repo.delete(id, userId);
    }
  }
  ```
- [ ] **Minimal impl (routes):** in `apps/api/src/modules/worklogs/worklog.routes.ts`, import the error and map it to 422 in both the POST and PATCH handlers. Add to the import block:
  ```ts
  import { WorkLogService, PeriodLockedError } from './worklog.service.js';
  ```
  Wrap the POST handler body:
  ```ts
    async (c) => {
      const user = (c as any).get('user') as any;
      const userId = user.userId as string;
      const { taskId, timeSpentSeconds, startedAt, description } = c.req.valid('json');
      try {
        const log = await svc.create(taskId, userId, timeSpentSeconds, startedAt, description);
        return c.json({ log }, 201);
      } catch (err) {
        if (err instanceof PeriodLockedError) return c.json({ error: err.message }, 422);
        throw err;
      }
    },
  ```
  Wrap the PATCH handler body:
  ```ts
    async (c) => {
      const id     = c.req.param('id');
      const user   = (c as any).get('user') as any;
      const userId = user.userId as string;
      const patch  = c.req.valid('json');
      try {
        const log = await svc.update(id, userId, patch);
        if (!log) return c.json({ error: 'Not found or forbidden' }, 404);
        return c.json({ log });
      } catch (err) {
        if (err instanceof PeriodLockedError) return c.json({ error: err.message }, 422);
        throw err;
      }
    },
  ```
- [ ] **Run (expected pass — full integration):**
  ```
  DB_SERVER=localhost DB_PORT=1433 DB_USER=sa DB_PASSWORD=YourStrong@Passw0rd DB_NAME=ProjectFlow_Test DB_ENCRYPT=false npm --workspace api run test:integration -- timesheet.routes
  ```
  Expected: all three tests in `timesheet.routes.integration.test.ts` PASS (the locked-period write now returns 422).
- [ ] **Run (regression — worklog suite unaffected):**
  ```
  DB_SERVER=localhost DB_PORT=1433 DB_USER=sa DB_PASSWORD=YourStrong@Passw0rd DB_NAME=ProjectFlow_Test DB_ENCRYPT=false npm --workspace api run test:integration -- worklog
  ```
  Expected: the existing worklog integration suite still PASSES (unlocked-period writes succeed as before).
- [ ] **Commit:**
  ```
  git add infra/sql/procedures/usp_WorkLog_PeriodLocked.sql apps/api/src/modules/worklogs/worklog.repository.ts apps/api/src/modules/worklogs/worklog.service.ts apps/api/src/modules/worklogs/worklog.routes.ts
  git commit -m "feat(8b): period-lock — worklog writes in a submitted/approved period return 422"
  ```

### Task 10: Frontend timesheet grid (TanStack Table) + i18n

**Files:** `apps/next-web/src/components/timesheets/timesheet-grid.tsx`, `apps/next-web/src/components/timesheets/__tests__/timesheet-grid.unit.test.tsx`, `apps/next-web/messages/en.json`, `apps/next-web/messages/id.json`

> Before writing web code, read `apps/next-web/node_modules/next/dist/docs/` per `apps/next-web/AGENTS.md` — this Next.js has breaking changes.

- [ ] **Failing test:** write `timesheet-grid.unit.test.tsx` (Testing Library + `NextIntlClientProvider`, matching existing web unit tests):
  ```tsx
  import { describe, it, expect } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import { NextIntlClientProvider } from 'next-intl';
  import en from '../../../../messages/en.json';
  import { TimesheetGrid } from '../timesheet-grid';
  import type { Timesheet, TimesheetAggregate } from '@projectflow/types';

  const ts: Timesheet = {
    id: 't1', workspaceId: 'w1', userId: 'u1', periodStart: '2026-06-01', periodEnd: '2026-06-07',
    status: 'draft', submittedAt: null, reviewedById: null, reviewedAt: null, note: null,
    createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
  };
  const agg: TimesheetAggregate = {
    rows: [{ workDate: '2026-06-02', taskId: 'k1', taskTitle: 'Build', totalSeconds: 3600, billableSeconds: 3600, nonBillableSeconds: 0 }],
    totals: { totalSeconds: 3600, billableSeconds: 3600, nonBillableSeconds: 0 },
  };

  function wrap(ui: React.ReactNode) {
    return render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);
  }

  describe('TimesheetGrid', () => {
    it('renders a row per aggregate entry and a period total', () => {
      wrap(<TimesheetGrid timesheet={ts} aggregate={agg} onSubmit={() => {}} />);
      expect(screen.getByText('Build')).toBeInTheDocument();
      expect(screen.getByTestId('timesheet-total')).toHaveTextContent('1h 0m');
    });
    it('shows the submit button for a draft timesheet', () => {
      wrap(<TimesheetGrid timesheet={ts} aggregate={agg} onSubmit={() => {}} />);
      expect(screen.getByTestId('timesheet-submit')).toBeEnabled();
    });
  });
  ```
- [ ] **Run (expected fail):**
  ```
  npm --workspace next-web run test:unit -- timesheet-grid
  ```
  Expected: FAIL — cannot resolve `../timesheet-grid`.
- [ ] **Minimal impl:** create `apps/next-web/src/components/timesheets/timesheet-grid.tsx` (TanStack Table per `@tanstack/react-table` 8.x, mirroring the `table-view.tsx` grid + `useTranslations` idiom):
  ```tsx
  'use client';

  import { useMemo } from 'react';
  import { useTranslations } from 'next-intl';
  import {
    useReactTable, getCoreRowModel, flexRender, createColumnHelper,
  } from '@tanstack/react-table';
  import type { Timesheet, TimesheetAggregate, TimesheetAggregateRow } from '@projectflow/types';

  /** Seconds → "Xh Ym". */
  function fmt(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }

  interface Props {
    timesheet: Timesheet;
    aggregate: TimesheetAggregate;
    onSubmit: () => void;
  }

  const col = createColumnHelper<TimesheetAggregateRow>();

  export function TimesheetGrid({ timesheet, aggregate, onSubmit }: Props) {
    const t = useTranslations('Timesheets');

    const columns = useMemo(() => [
      col.accessor('workDate',  { header: () => t('colDate') }),
      col.accessor('taskTitle', { header: () => t('colTask') }),
      col.accessor('totalSeconds',       { header: () => t('colTotal'),       cell: (c) => fmt(c.getValue()) }),
      col.accessor('billableSeconds',    { header: () => t('colBillable'),    cell: (c) => fmt(c.getValue()) }),
      col.accessor('nonBillableSeconds', { header: () => t('colNonBillable'), cell: (c) => fmt(c.getValue()) }),
    ], [t]);

    const table = useReactTable({ data: aggregate.rows, columns, getCoreRowModel: getCoreRowModel() });

    return (
      <div data-testid="timesheet-grid" className="flex h-full flex-col gap-3">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-muted/40">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border text-left text-muted-foreground">
                {hg.headers.map((h) => (
                  <th key={h.id} className="px-3 py-2 font-medium">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{t('noEntries')}</td></tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} data-testid="timesheet-row" className="border-b border-border/60">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-semibold">
              <td className="px-3 py-2" colSpan={2}>{t('total')}</td>
              <td className="px-3 py-2" data-testid="timesheet-total">{fmt(aggregate.totals.totalSeconds)}</td>
              <td className="px-3 py-2" data-testid="timesheet-billable">{fmt(aggregate.totals.billableSeconds)}</td>
              <td className="px-3 py-2" data-testid="timesheet-nonbillable">{fmt(aggregate.totals.nonBillableSeconds)}</td>
            </tr>
          </tfoot>
        </table>

        <div className="flex items-center gap-2">
          <span data-testid="timesheet-status" className="rounded bg-muted px-2 py-0.5 text-[11px] uppercase tracking-wide">
            {t(`status.${timesheet.status}`)}
          </span>
          <button
            type="button"
            data-testid="timesheet-submit"
            disabled={timesheet.status === 'submitted' || timesheet.status === 'approved'}
            onClick={onSubmit}
            className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50"
          >
            {t('submit')}
          </button>
        </div>
      </div>
    );
  }
  ```
- [ ] **Minimal impl (i18n):** add a `Timesheets` namespace to `apps/next-web/messages/en.json`:
  ```json
  "Timesheets": {
    "colDate": "Date",
    "colTask": "Task",
    "colTotal": "Total",
    "colBillable": "Billable",
    "colNonBillable": "Non-billable",
    "noEntries": "No time logged in this period",
    "total": "Period total",
    "submit": "Submit",
    "approve": "Approve",
    "reject": "Reject",
    "reviewTitle": "Review timesheet",
    "status": {
      "draft": "Draft",
      "submitted": "Submitted",
      "approved": "Approved",
      "rejected": "Rejected"
    }
  }
  ```
  And the parity-matched namespace to `apps/next-web/messages/id.json` (real Indonesian):
  ```json
  "Timesheets": {
    "colDate": "Tanggal",
    "colTask": "Tugas",
    "colTotal": "Total",
    "colBillable": "Dapat ditagih",
    "colNonBillable": "Tidak dapat ditagih",
    "noEntries": "Tidak ada waktu yang dicatat pada periode ini",
    "total": "Total periode",
    "submit": "Kirim",
    "approve": "Setujui",
    "reject": "Tolak",
    "reviewTitle": "Tinjau lembar waktu",
    "status": {
      "draft": "Draf",
      "submitted": "Terkirim",
      "approved": "Disetujui",
      "rejected": "Ditolak"
    }
  }
  ```
- [ ] **Run (expected pass + parity):**
  ```
  npm --workspace next-web run test:unit -- timesheet-grid messages
  ```
  Expected: PASS — the grid tests pass AND the `message catalogs` parity test stays green (en/id key sets identical, no empty values).
- [ ] **Commit:**
  ```
  git add apps/next-web/src/components/timesheets/timesheet-grid.tsx apps/next-web/src/components/timesheets/__tests__/timesheet-grid.unit.test.tsx apps/next-web/messages/en.json apps/next-web/messages/id.json
  git commit -m "feat(8b): timesheet grid (TanStack Table) + Timesheets i18n (en+id)"
  ```

### Task 11: Reviewer approve/reject view

**Files:** `apps/next-web/src/components/timesheets/timesheet-review.tsx`, `apps/next-web/src/components/timesheets/__tests__/timesheet-review.unit.test.tsx`

- [ ] **Failing test:** write `timesheet-review.unit.test.tsx`:
  ```tsx
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { NextIntlClientProvider } from 'next-intl';
  import en from '../../../../messages/en.json';
  import { TimesheetReview } from '../timesheet-review';
  import type { Timesheet } from '@projectflow/types';

  const submitted: Timesheet = {
    id: 't1', workspaceId: 'w1', userId: 'u1', periodStart: '2026-06-01', periodEnd: '2026-06-07',
    status: 'submitted', submittedAt: '2026-06-08T00:00:00.000Z', reviewedById: null, reviewedAt: null, note: null,
    createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-08T00:00:00.000Z',
  };

  function wrap(ui: React.ReactNode) {
    return render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);
  }

  describe('TimesheetReview', () => {
    it('shows the submitted status badge and enabled approve/reject for a submitted sheet', () => {
      wrap(<TimesheetReview timesheet={submitted} onReview={() => {}} />);
      expect(screen.getByTestId('review-status')).toHaveTextContent('Submitted');
      expect(screen.getByTestId('review-approve')).toBeEnabled();
      expect(screen.getByTestId('review-reject')).toBeEnabled();
    });

    it('fires onReview("approved") when approve is clicked', async () => {
      const onReview = vi.fn();
      wrap(<TimesheetReview timesheet={submitted} onReview={onReview} />);
      await userEvent.click(screen.getByTestId('review-approve'));
      expect(onReview).toHaveBeenCalledWith('approved');
    });

    it('disables approve/reject when not submitted', () => {
      wrap(<TimesheetReview timesheet={{ ...submitted, status: 'approved' }} onReview={() => {}} />);
      expect(screen.getByTestId('review-approve')).toBeDisabled();
    });
  });
  ```
- [ ] **Run (expected fail):**
  ```
  npm --workspace next-web run test:unit -- timesheet-review
  ```
  Expected: FAIL — cannot resolve `../timesheet-review`.
- [ ] **Minimal impl:** create `apps/next-web/src/components/timesheets/timesheet-review.tsx`:
  ```tsx
  'use client';

  import { useTranslations } from 'next-intl';
  import type { Timesheet } from '@projectflow/types';

  interface Props {
    timesheet: Timesheet;
    onReview: (decision: 'approved' | 'rejected') => void;
  }

  export function TimesheetReview({ timesheet, onReview }: Props) {
    const t = useTranslations('Timesheets');
    const reviewable = timesheet.status === 'submitted';

    return (
      <div data-testid="timesheet-review" className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t('reviewTitle')}</h3>
          <span data-testid="review-status" className="rounded bg-muted px-2 py-0.5 text-[11px] uppercase tracking-wide">
            {t(`status.${timesheet.status}`)}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="review-approve"
            disabled={!reviewable}
            onClick={() => onReview('approved')}
            className="rounded bg-green-600 px-3 py-1 text-xs text-white disabled:opacity-50"
          >
            {t('approve')}
          </button>
          <button
            type="button"
            data-testid="review-reject"
            disabled={!reviewable}
            onClick={() => onReview('rejected')}
            className="rounded bg-red-600 px-3 py-1 text-xs text-white disabled:opacity-50"
          >
            {t('reject')}
          </button>
        </div>
      </div>
    );
  }
  ```
- [ ] **Run (expected pass):**
  ```
  npm --workspace next-web run test:unit -- timesheet-review
  ```
  Expected: PASS (3 tests).
- [ ] **Commit:**
  ```
  git add apps/next-web/src/components/timesheets/timesheet-review.tsx apps/next-web/src/components/timesheets/__tests__/timesheet-review.unit.test.tsx
  git commit -m "feat(8b): reviewer approve/reject view with status badges"
  ```

### Task 12: e2e headline flow + full-slice verification

**Files:** `e2e/timesheets.spec.ts`

- [ ] **Failing test:** write `e2e/timesheets.spec.ts` (Playwright, REST-driven seeding then UI assertions, mirroring `e2e/recurring.spec.ts`):
  ```ts
  /**
   * E2E: Timesheets (Phase 8b).
   * Proves the headline acceptance: a user logs time, the timesheet aggregates it,
   * the user submits, and a reviewer approves.
   * DB SAFETY: run ONLY with the local Docker test DB env (see e2e/README.md).
   */
  import { test, expect, request as playwrightRequest } from '@playwright/test';

  const API_BASE = 'http://localhost:3001/api/v1';
  const PERIOD = { periodStart: '2026-06-01', periodEnd: '2026-06-07' };

  function uniq() { return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`; }

  test('log time, aggregate, submit, approve', async () => {
    const api = await playwrightRequest.newContext();
    const email = `ts-e2e-${uniq()}@projectflow.test`;
    const password = 'Passw0rd!23';

    // Register + login over REST to obtain a token + seed graph.
    const reg = await api.post(`${API_BASE}/auth/register`, { data: { email, password, name: 'TS E2E' } });
    expect(reg.ok()).toBeTruthy();
    const token = (await reg.json()).accessToken as string;
    const h = { Authorization: `Bearer ${token}` };

    const ws = await (await api.post(`${API_BASE}/workspaces`, { headers: h, data: { name: `WS ${uniq()}` } })).json();
    const wsId = ws.data?.Id ?? ws.Id ?? ws.data?.id;
    const proj = await (await api.post(`${API_BASE}/projects`, { headers: h, data: { workspaceId: wsId, name: `P ${uniq()}`, key: `PT${Math.floor(Math.random()*900+100)}`, type: 'KANBAN' } })).json();
    const projId = proj.data?.Id ?? proj.Id ?? proj.data?.id;
    const task = await (await api.post(`${API_BASE}/tasks`, { headers: h, data: { projectId: projId, workspaceId: wsId, title: 'Build' } })).json();
    const taskId = task.data?.Id ?? task.Id ?? task.data?.id;

    // Log a closed 1h billable entry inside the period.
    const wl = await api.post(`${API_BASE}/worklogs`, { headers: h, data: { taskId, timeSpentSeconds: 3600, startedAt: '2026-06-02T09:00:00.000Z', billable: true, source: 'manual' } });
    expect(wl.status()).toBe(201);

    // Get-or-create the envelope + aggregate.
    const tsRes = await api.get(`${API_BASE}/timesheets?workspaceId=${wsId}&periodStart=${PERIOD.periodStart}&periodEnd=${PERIOD.periodEnd}`, { headers: h });
    const tsBody = await tsRes.json();
    const timesheetId = tsBody.data.id;
    const agg = await (await api.get(`${API_BASE}/timesheets/${timesheetId}/aggregate`, { headers: h })).json();
    expect(agg.data.totals.totalSeconds).toBe(3600);
    expect(agg.data.totals.billableSeconds).toBe(3600);

    // Submit then approve.
    const submit = await api.post(`${API_BASE}/timesheets/${timesheetId}/submit`, { headers: h, data: {} });
    expect((await submit.json()).data.status).toBe('submitted');
    const approve = await api.post(`${API_BASE}/timesheets/${timesheetId}/review`, { headers: h, data: { decision: 'approved' } });
    expect((await approve.json()).data.status).toBe('approved');

    // Locked period: a new worklog in the approved period is rejected with 422.
    const blocked = await api.post(`${API_BASE}/worklogs`, { headers: h, data: { taskId, timeSpentSeconds: 600, startedAt: '2026-06-03T09:00:00.000Z', source: 'manual' } });
    expect(blocked.status()).toBe(422);

    await api.dispose();
  });
  ```
- [ ] **Run (expected pass):** with the local Docker `ProjectFlow_Test` DB env and the API + web dev servers running per `e2e/README.md`:
  ```
  npm run test:e2e -- timesheets
  ```
  Expected: 1 passed (`log time, aggregate, submit, approve`).
- [ ] **Run (full-slice verification — all green before merge):**
  ```
  npm --workspace api run test:unit
  DB_SERVER=localhost DB_PORT=1433 DB_USER=sa DB_PASSWORD=YourStrong@Passw0rd DB_NAME=ProjectFlow_Test DB_ENCRYPT=false npm --workspace api run test:integration
  npm --workspace next-web run test:unit
  npm run build
  ```
  Expected: API unit suite PASS (incl. the new timesheet unit + schema tests); API integration suite PASS (incl. `timesheet.routes` and the unaffected `worklog` suite); web unit suite PASS (incl. grid/review + the i18n parity test); `turbo run build` succeeds for `api`, `next-web`, and `types` (`tsc` clean).
- [ ] **Commit:**
  ```
  git add e2e/timesheets.spec.ts
  git commit -m "test(8b): e2e timesheet log→aggregate→submit→approve + period-lock 422"
  ```
- [ ] Record the slice in `DECISIONS.md` (deviations: SP error numbers 51810–51813/51820 for timesheet transitions; period-lock implemented as a pre-write `usp_WorkLog_PeriodLocked` check returning 422; aggregate excludes running timers via `EndedAt IS NOT NULL`; new permissions `timesheet.read`/`timesheet.submit`/`timesheet.approve`), then **stop for review / merge** before Slice 8c.

---

## Definition of Done

- [ ] **Acceptance (spec §5.5):** `Timesheet aggregates correctly and supports submit/approve.`
- [ ] `0044_timesheets.sql` applies idempotently on `ProjectFlow_Test` and is reversible via `rollback/0044_timesheets.down.sql` (forward → down → forward proven).
- [ ] SP-per-op: `usp_Timesheet_GetOrCreate`, `usp_Timesheet_GetById`, `usp_Timesheet_List`, `usp_Timesheet_Aggregate` (by user/date/task + billable split), `usp_Timesheet_Submit`, `usp_Timesheet_Review`, `usp_WorkLog_PeriodLocked` deployed (`CREATE OR ALTER`, `SET NOCOUNT ON`, TRY/CATCH/TRANSACTION where they mutate).
- [ ] REST primary (`GET /timesheets`, `GET /timesheets/:id`, `GET /timesheets/:id/aggregate`, `POST /timesheets/:id/submit`, `POST /timesheets/:id/review`) + a GraphQL mirror (`timesheet`, `timesheetAggregate`, `submitTimesheet`, `reviewTimesheet`) over the single shared `timesheetService`.
- [ ] Authorization is fail-closed: `timesheet.read` for reads, `timesheet.submit` for submit, `timesheet.approve` for review (REST `requirePermission` + GraphQL `requireWorkspacePermission`).
- [ ] Status transitions enforced (`draft|rejected→submitted`, `submitted→approved|rejected`); illegal transitions return 409 (REST) / `ILLEGAL_TRANSITION` (GraphQL).
- [ ] Period lock: worklog create/update whose work date falls in a `submitted`/`approved` timesheet returns HTTP 422; reopening lifts the lock.
- [ ] Frontend: TanStack Table timesheet grid (day×task rows, period totals, billable split) + submit button; reviewer approve/reject view with status badges.
- [ ] `@projectflow/types` updated (`Timesheet`, `TimesheetStatus`, `TimesheetAggregate*`).
- [ ] i18n: `Timesheets.*` in `en.json` + `id.json` (real Indonesian); the `messages.unit` parity test is green (identical key sets, no empty values).
- [ ] Unit + integration tests for new endpoints/behavior pass; ≥1 Playwright e2e (`e2e/timesheets.spec.ts`) covers log→aggregate→submit→approve.
- [ ] `npm --workspace api run test:unit`, `... test:integration` (local Docker `ProjectFlow_Test`), `npm --workspace next-web run test:unit`, and `npm run build` all pass.
- [ ] All DB work ran ONLY against local Docker `ProjectFlow_Test` (never the prod-pointing `apps/api/.env`).
- [ ] A `DECISIONS.md` entry logs the slice's deviations; **stop for review/merge** before Slice 8c.

> **Acceptance box (BUILD_PLAN / spec §5.5):**
> - [ ] Timesheet aggregates correctly and supports submit/approve.
