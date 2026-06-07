# Phase 9b — Analytics & Sprint/Portfolio Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift reporting from REST-only to a full GraphQL mirror, add the three advanced sprint-analytics report SPs (`usp_Report_Burnup`, `usp_Report_CumulativeFlow`, `usp_Report_LeadCycleTime`) plus a cross-location `usp_Report_Portfolio` rollup, and extend the Phase-9a `card.service` dispatcher with the analytics/entity card catalog (`burndown`, `velocity`, `burnup`, `cumulative_flow`, `lead_cycle_time`, `sprint_summary`, `portfolio`, `timesheet`, `battery`) — each mapping to a report SP / Phase-8 service and a Recharts renderer. Acceptance (spec §5.5): **sprint burndown + velocity compute correctly against real sprint data.**

**Architecture:** The four new report SPs are SP-per-op (`CREATE OR ALTER`, `SET NOCOUNT ON`) in `infra/sql/procedures/`, deployed by `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`. They read the same `dbo.Tasks` / `dbo.Sprints` / `dbo.AuditLog` columns the existing reports use (`SprintId`, `StoryPoints`, `Status`, `ResolvedAt`, `CreatedAt`, `DeletedAt`, `StartDate`/`DueDate`, plus `AuditLog.Resource/Action/NewValues/CreatedAt` for status-transition history). They surface through `reports.repository.ts` → `reports.service.ts` exactly like the existing five (multi-resultset SPs via `execSp`; single-set SPs via `execSpOne`). A **new `graphql/reports.schema.ts`** (`registerReportsGraphql()`) mirrors **all nine** report queries (the existing five + four new) over the same `ReportsService`, registered in `graphql/schema.ts` beside the other `register*Graphql()` calls — the reports module is REST-only today, so this is the first GraphQL surface it gets. The math that is not trivially expressible in SQL (cumulative-flow band assignment, lead/cycle derivation from status history, portfolio on-track rollup across scopes) is factored into **pure TS helpers** in `apps/api/src/modules/reports/analytics.ts`, unit-tested in isolation, and reused by the service so the SP stays a thin projection. The Phase-9a `card.service` gains one branch per new card type; report cards call `ReportsService`, entity cards (`timesheet`) call the Phase-8 worklog/timesheet service, and `battery` aggregates progress via the same service path 9a uses for its `calculation` card. New Recharts components (`BurnupChart`, `CumulativeFlowChart`, `LeadCycleTimeChart`, `PortfolioCard`, `BatteryCard`, `TimesheetCard`) register into the 9a card renderer registry; card-config editors expose each card's params (sprint, scope set, range).

**Tech Stack:** SQL Server stored procedures (`CREATE OR ALTER`, `SET NOCOUNT ON`, recursive CTE with `OPTION (MAXRECURSION …)`); `mssql` via `execSp`/`execSpOne`; Hono REST (existing) + graphql-yoga + Pothos (`@pothos/core`, `objectRef`) mirror delegating to one shared `ReportsService`; vitest (`--project unit` / `--project integration`); Next.js App Router (SSR) + `next-intl`; Recharts v3.8.1; Playwright e2e. DB work runs ONLY against local Docker `ProjectFlow_Test`.

**Prerequisite:** Phase 9a merged (dashboards + `card.service` + card renderer registry); Phase 8 sprint/time/goal services exist. (Phases 1–8 merged; the existing five report SPs + types + REST routes are on disk; `Sprints`/`Tasks`/`AuditLog` schema is from migrations `0001`/`0015`/`0029`.)

---

## File Structure

**9b adds NO migration.** Per spec §3 and §5.1, 9b is purely new report SPs + types + a GraphQL mirror + `card.service`/renderer additions. No table is created or altered; the four SPs read existing columns (`dbo.Tasks`, `dbo.Sprints`, `dbo.AuditLog`, `dbo.Folders`, `dbo.Lists`). (If lead/cycle-time history is thin, it falls back to `AuditLog` status-change events per spec §11.6 — no schema change.)

**Stored procedures** (`infra/sql/procedures/`) — 4 new, all `CREATE OR ALTER`
- `usp_Report_Burnup.sql` — **Create.** Per-day completed-vs-scope for a sprint (scope line + completed line). Two-resultset (meta + per-day), mirroring `usp_Report_Burndown`.
- `usp_Report_CumulativeFlow.sql` — **Create.** Per-day status-band issue counts over a scope+range (a row per day, a column-ish long form per status band). Single resultset of `(Date, Status, IssueCount)`.
- `usp_Report_LeadCycleTime.sql` — **Create.** Per-task lead time (created→resolved) and cycle time (first in-progress→resolved, from `AuditLog` status-transition history) for a scope+range. Single resultset of per-task rows.
- `usp_Report_Portfolio.sql` — **Create.** Rollup across a set of folders/lists (comma-delimited scope-id list, like `usp_WorkLogTag_Set`'s `@TagIds`): per-scope counts, completed, progress %, on-track flag. Single resultset of per-scope rows.

**API** (`apps/api/src/`)
- `modules/reports/reports.repository.ts` — **Modify.** Add row interfaces + `burnup`/`cumulativeFlow`/`leadCycleTime`/`portfolio` methods (same `execSp`/`execSpOne` shape as the existing five).
- `modules/reports/analytics.ts` — **Create.** Pure helpers: `cumulativeFlowSeries`, `leadCycleSummary`, `portfolioRollup` (unit-tested) — used by the service to derive aggregate fields the SP doesn't compute.
- `modules/reports/reports.service.ts` — **Modify.** Add `burnup`/`cumulativeFlow`/`leadCycleTime`/`portfolio` returning the new camelCase report types; reuse `analytics.ts` helpers.
- `modules/reports/reports.routes.ts` — **Modify.** Add `GET /reports/burnup?sprintId=`, `/reports/cumulative-flow?scopeType=&scopeId=&weeks=`, `/reports/lead-cycle-time?scopeType=&scopeId=&weeks=`, `/reports/portfolio?scopeType=&scopeIds=` (mirrors the existing REST style; the GraphQL mirror reuses the same service).
- `graphql/reports.schema.ts` — **Create.** `registerReportsGraphql()`: report object refs + the **nine** queries `burndown`/`velocity`/`sprintSummary`/`workload`/`createdVsResolved` (mirror of REST) + `burnup`/`cumulativeFlow`/`leadCycleTime`/`portfolio`.
- `graphql/schema.ts` — **Modify.** Import + call `registerReportsGraphql()` beside the other `register*Graphql()` calls.

**API** — `card.service` (created by 9a; extended here)
- `modules/dashboards/card.service.ts` — **Modify.** Add a dispatcher branch per new card type: `burndown`, `velocity`, `burnup`, `cumulative_flow`, `lead_cycle_time`, `sprint_summary`, `portfolio`, `timesheet`, `battery`.
- `modules/dashboards/__tests__/card.analytics.unit.test.ts` — **Create.** Card-type → data-source dispatch routing for the new branches (pure, mocked service).

**Types** (`packages/types/`)
- `index.ts` — **Modify.** Add `BurnupPoint`/`BurnupReport`, `CumulativeFlowEntry`, `LeadCycleTimeEntry`/`LeadCycleTimeReport`, `PortfolioEntry`; extend the `CardType` union (defined by 9a) with the new tokens.

**Frontend** (`apps/next-web/src/`)
- `components/charts/BurnupChart.tsx` — **Create.** Area/line: completed vs scope over the sprint.
- `components/charts/CumulativeFlowChart.tsx` — **Create.** Stacked area of status-band counts over time.
- `components/charts/LeadCycleTimeChart.tsx` — **Create.** Scatter/bar of per-task lead & cycle time.
- `components/charts/PortfolioCard.tsx` — **Create.** Per-scope rollup table/bars with on-track badges.
- `components/charts/BatteryCard.tsx` — **Create.** A progress "battery" (aggregate progress vs target).
- `components/charts/TimesheetCard.tsx` — **Create.** A logged-time-by-day/user grid (Phase-8 worklog data).
- `components/dashboards/card-config/` — **Modify/Create.** Card-config editors for the new params (sprint picker, scope-set picker, range) registered into the 9a card editor registry.
- `messages/en.json` (`apps/next-web/messages/en.json`) — **Modify.** Extend the `Charts` namespace + add a `Cards` namespace for the new card-type names/params.
- `messages/id.json` (`apps/next-web/messages/id.json`) — **Modify.** Same keys, real Indonesian.

**Tests**
- `apps/api/src/modules/reports/__tests__/analytics.unit.test.ts` — **Create.** Pure burnup/cumulative-flow/lead-cycle math + portfolio rollup across multiple scopes.
- `apps/api/src/modules/reports/__tests__/reports.integration.test.ts` — **Create.** GraphQL report queries return the same computed values as REST; sprint burndown + velocity compute correctly against seeded sprint data (spec §5.5).
- `apps/next-web/e2e/dashboard-analytics.spec.ts` — **Create.** Add a burndown + velocity + portfolio card to a dashboard; values reflect real seeded data.

---

## Tasks

### Task 1: New report types (`packages/types/index.ts`)

**Files:**
- Modify: `packages/types/index.ts` (the `// ── Reports ──` block, lines ~318–376; and the `CardType` union added by 9a)
- Test: type-checked via `npm run build --workspace apps/api` at the end of Task 4/6 (no runtime unit harness for pure type decls).

Steps:

- [ ] Append the four new report shapes to the Reports block in `packages/types/index.ts`, directly after `CreatedVsResolvedEntry` (line ~376). Use the EXACT names from spec §3/§5.2 — `BurnupReport`, `CumulativeFlowEntry`, `LeadCycleTimeReport`, `PortfolioEntry`:

```ts
// ── Reports: advanced analytics (Phase 9b) ─────────────────────────────────────

export interface BurnupPoint {
  date: string | null;
  completedPoints: number;   // cumulative completed story points by this day
  scopePoints: number;       // total scope (committed) story points as of this day
}

export interface BurnupReport {
  sprintId: string;
  sprintName: string;
  startDate: string | null;
  endDate: string | null;
  totalScopePoints: number;
  completedPoints: number;
  points: BurnupPoint[];
}

export interface CumulativeFlowEntry {
  date: string | null;
  status: string;            // workflow status name (the band)
  issueCount: number;        // open issues sitting in this status on this day
}

export interface LeadCycleTimeEntry {
  taskId: string;
  issueKey: string;
  title: string;
  createdAt: string | null;
  startedAt: string | null;  // first IN_PROGRESS transition (from AuditLog), null if never started
  resolvedAt: string | null;
  leadTimeSeconds: number | null;   // created → resolved; null when unresolved
  cycleTimeSeconds: number | null;  // startedAt → resolved; null when never started/unresolved
}

export interface LeadCycleTimeReport {
  scopeType: string;         // 'space' | 'folder' | 'list'
  scopeId: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  avgLeadTimeSeconds: number | null;
  avgCycleTimeSeconds: number | null;
  tasks: LeadCycleTimeEntry[];
}

export interface PortfolioEntry {
  scopeType: string;         // 'folder' | 'list'
  scopeId: string;
  scopeName: string;
  totalIssues: number;
  completedIssues: number;
  totalPoints: number;
  completedPoints: number;
  progressPct: number;       // 0–100 (completed / total issues)
  onTrack: boolean;          // progressPct >= expected progress for the time window
}
```

- [ ] Extend the `CardType` union (added by 9a in this same file) with the nine 9b card-type tokens (spec §5.2). Locate the 9a union (`export type CardType = 'task_list' | 'calculation' | 'bar' | 'line' | 'pie' | 'time_tracked' | 'goal';`) and add the new members:

```ts
export type CardType =
  | 'task_list' | 'calculation' | 'bar' | 'line' | 'pie' | 'time_tracked' | 'goal'  // wave-1 (9a)
  | 'burndown' | 'velocity' | 'burnup' | 'cumulative_flow' | 'lead_cycle_time'
  | 'sprint_summary' | 'portfolio' | 'timesheet' | 'battery';                        // 9b
```

(If 9a's union lives in a different exact form, add the nine 9b tokens to it verbatim without dropping any 9a members.)

- [ ] Run: `npm run build --workspace packages/types` (or the repo's `tsc -b` for the types package). Expected: PASS — pure declarations compile.

- [ ] Commit:
```
git add packages/types/index.ts
git commit -m "feat(9b): report types — BurnupReport/CumulativeFlowEntry/LeadCycleTimeReport/PortfolioEntry + CardType additions"
```

---

### Task 2: `usp_Report_Burnup` SP

**Files:**
- Create: `infra/sql/procedures/usp_Report_Burnup.sql`
- Test: covered by `reports.integration.test.ts` (Task 7); deploy via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`.

Steps:

- [ ] Write `usp_Report_Burnup.sql` — a burnup is the complement of the existing burndown: instead of *remaining* points falling to zero, it tracks **cumulative completed** points rising toward the **scope** line. Mirror `usp_Report_Burndown`'s structure (sprint meta from `dbo.Sprints`, a recursive date series, `OPTION (MAXRECURSION 366)`), reading the same `dbo.Tasks` columns (`SprintId`, `StoryPoints`, `ResolvedAt`, `DeletedAt`). Two resultsets: meta, then per-day:

```sql
-- usp_Report_Burnup
-- Burnup for a sprint: cumulative COMPLETED story points vs total SCOPE per day.
-- ResultSet 1: sprint meta (SprintId, SprintName, StartDate, EndDate, TotalScopePoints, CompletedPoints)
-- ResultSet 2: per-day (Date, CompletedPoints, ScopePoints)
CREATE OR ALTER PROCEDURE dbo.usp_Report_Burnup
  @SprintId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE
    @StartDate DATE,
    @EndDate   DATE,
    @ScopePts  FLOAT,
    @DonePts   FLOAT,
    @Name      NVARCHAR(255);

  SELECT
    @Name      = s.Name,
    @StartDate = CAST(s.StartDate AS DATE),
    @EndDate   = CAST(ISNULL(s.CompletedAt, ISNULL(s.EndDate, GETUTCDATE())) AS DATE)
  FROM dbo.Sprints s
  WHERE s.Id = @SprintId;

  -- Cap the end date at today (no future days).
  IF @EndDate > CAST(GETUTCDATE() AS DATE)
    SET @EndDate = CAST(GETUTCDATE() AS DATE);

  -- Total scope = all (non-deleted) story points in the sprint.
  SELECT @ScopePts = ISNULL(SUM(ISNULL(StoryPoints, 0)), 0)
  FROM dbo.Tasks
  WHERE SprintId = @SprintId AND DeletedAt IS NULL;

  -- Completed = resolved story points.
  SELECT @DonePts = ISNULL(SUM(CASE WHEN ResolvedAt IS NOT NULL THEN ISNULL(StoryPoints, 0) ELSE 0 END), 0)
  FROM dbo.Tasks
  WHERE SprintId = @SprintId AND DeletedAt IS NULL;

  -- ResultSet 1: meta.
  SELECT
    @SprintId AS SprintId,
    @Name     AS SprintName,
    @StartDate AS StartDate,
    @EndDate   AS EndDate,
    @ScopePts  AS TotalScopePoints,
    @DonePts   AS CompletedPoints;

  -- ResultSet 2: per-day cumulative completed vs scope.
  DECLARE @Days INT = DATEDIFF(DAY, @StartDate, @EndDate);

  WITH DateSeries AS (
    SELECT @StartDate AS [Date], 0 AS DayNum
    UNION ALL
    SELECT DATEADD(DAY, 1, [Date]), DayNum + 1
    FROM DateSeries
    WHERE DayNum < @Days
  )
  SELECT
    ds.[Date],
    -- Cumulative completed: story points resolved on or before this day.
    ISNULL(SUM(
      CASE WHEN t.ResolvedAt IS NOT NULL AND CAST(t.ResolvedAt AS DATE) <= ds.[Date]
           THEN ISNULL(t.StoryPoints, 0)
           ELSE 0
      END
    ), 0) AS CompletedPoints,
    -- Scope is flat at the total committed points (scope changes mid-sprint are
    -- not tracked per-day in v1; the line is the committed total).
    @ScopePts AS ScopePoints
  FROM DateSeries ds
  CROSS JOIN (
    SELECT StoryPoints, ResolvedAt
    FROM dbo.Tasks
    WHERE SprintId = @SprintId AND DeletedAt IS NULL
  ) t
  GROUP BY ds.[Date]
  ORDER BY ds.[Date]
  OPTION (MAXRECURSION 366);
END;
GO
```

- [ ] Run: deploy via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test` (local DB env only, never `apps/api/.env`). Expected: procedure created, no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_Report_Burnup.sql
git commit -m "feat(9b): usp_Report_Burnup — cumulative completed vs scope per day"
```

---

### Task 3: `usp_Report_CumulativeFlow` SP

**Files:**
- Create: `infra/sql/procedures/usp_Report_CumulativeFlow.sql`
- Test: covered by `analytics.unit.test.ts` (math, Task 5) + `reports.integration.test.ts` (Task 7); deploy via `scripts/db-deploy-sps.ts`.

Steps:

- [ ] Write `usp_Report_CumulativeFlow.sql` — for a hierarchy scope (`@ScopeType` = `space`/`folder`/`list` + `@ScopeId`) over the last `@Weeks` weeks, return the count of issues sitting in each status band on each day. v1 derives the per-day band from `ResolvedAt` (resolved → DONE band) vs not (its current `Status`); a richer per-status history (from `AuditLog`) is a documented follow-up (spec §11.6), so the long-form `(Date, Status, IssueCount)` shape is stable either way. Scope resolution mirrors how a List/Folder/Space filters tasks: `Tasks.ListId` (list), the Folder's Lists (folder), or `Tasks.ProjectId` (space):

```sql
-- usp_Report_CumulativeFlow
-- Status-band issue counts over time for a hierarchy scope.
-- @ScopeType: 'space' | 'folder' | 'list' ; @ScopeId: the node id.
-- ResultSet: (Date, Status, IssueCount) — long form, one row per (day, status).
CREATE OR ALTER PROCEDURE dbo.usp_Report_CumulativeFlow
  @ScopeType NVARCHAR(8),
  @ScopeId   UNIQUEIDENTIFIER,
  @Weeks     INT = 8
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @StartDate DATE = DATEADD(WEEK, -@Weeks, CAST(GETUTCDATE() AS DATE));
  DECLARE @EndDate   DATE = CAST(GETUTCDATE() AS DATE);
  DECLARE @Days INT = DATEDIFF(DAY, @StartDate, @EndDate);

  -- Scoped, non-deleted tasks. A task is "in scope" by list / folder-of-lists /
  -- space (ProjectId), matching the Phase 1 hierarchy filter.
  ;WITH ScopeTasks AS (
    SELECT t.Id, t.Status, t.CreatedAt, t.ResolvedAt
    FROM dbo.Tasks t
    WHERE t.DeletedAt IS NULL
      AND (
        (@ScopeType = 'list'   AND t.ListId = @ScopeId) OR
        (@ScopeType = 'folder' AND t.ListId IN (SELECT l.Id FROM dbo.Lists l WHERE l.FolderId = @ScopeId AND l.DeletedAt IS NULL)) OR
        (@ScopeType = 'space'  AND t.ProjectId = @ScopeId)
      )
  ),
  DateSeries AS (
    SELECT @StartDate AS [Date], 0 AS DayNum
    UNION ALL
    SELECT DATEADD(DAY, 1, [Date]), DayNum + 1
    FROM DateSeries
    WHERE DayNum < @Days
  )
  SELECT
    ds.[Date],
    -- Band: a task resolved on/before this day counts as 'DONE'; otherwise it
    -- carries its current Status (v1 — see AuditLog follow-up for true history).
    CASE WHEN st.ResolvedAt IS NOT NULL AND CAST(st.ResolvedAt AS DATE) <= ds.[Date]
         THEN 'DONE' ELSE st.Status END AS Status,
    COUNT(st.Id) AS IssueCount
  FROM DateSeries ds
  JOIN ScopeTasks st
    ON CAST(st.CreatedAt AS DATE) <= ds.[Date]               -- existed by this day
  GROUP BY
    ds.[Date],
    CASE WHEN st.ResolvedAt IS NOT NULL AND CAST(st.ResolvedAt AS DATE) <= ds.[Date]
         THEN 'DONE' ELSE st.Status END
  ORDER BY ds.[Date], Status
  OPTION (MAXRECURSION 366);
END;
GO
```

- [ ] Run: deploy via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`. Expected: procedure created, no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_Report_CumulativeFlow.sql
git commit -m "feat(9b): usp_Report_CumulativeFlow — per-day status-band counts over a scope"
```

---

### Task 4: `usp_Report_LeadCycleTime` + `usp_Report_Portfolio` SPs

**Files:**
- Create: `infra/sql/procedures/usp_Report_LeadCycleTime.sql`
- Create: `infra/sql/procedures/usp_Report_Portfolio.sql`
- Test: covered by `analytics.unit.test.ts` (math, Task 5) + `reports.integration.test.ts` (Task 7); deploy via `scripts/db-deploy-sps.ts`.

Steps:

- [ ] Write `usp_Report_LeadCycleTime.sql` — per-task lead time (`CreatedAt` → `ResolvedAt`) and cycle time (first IN_PROGRESS transition → `ResolvedAt`). The "started" timestamp comes from `dbo.AuditLog` status-transition events (`Resource='Task'`, `Action='UPDATE'`, `NewValues` JSON carries the new status); v1 reads the earliest audit row for the task whose `NewValues` mentions an in-progress status, falling back to `CreatedAt` when no transition is recorded (spec §11.6). Scope resolution matches Task 3:

```sql
-- usp_Report_LeadCycleTime
-- Per-task lead time (created->resolved) and cycle time (first in-progress->resolved).
-- The in-progress transition is sourced from dbo.AuditLog status changes.
-- @ScopeType: 'space' | 'folder' | 'list' ; @ScopeId: the node id.
-- ResultSet: per-task rows (TaskId, IssueKey, Title, CreatedAt, StartedAt,
--            ResolvedAt, LeadTimeSeconds, CycleTimeSeconds).
CREATE OR ALTER PROCEDURE dbo.usp_Report_LeadCycleTime
  @ScopeType NVARCHAR(8),
  @ScopeId   UNIQUEIDENTIFIER,
  @Weeks     INT = 12
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @StartDate DATE = DATEADD(WEEK, -@Weeks, CAST(GETUTCDATE() AS DATE));

  ;WITH ScopeTasks AS (
    SELECT t.Id, t.IssueKey, t.Title, t.CreatedAt, t.ResolvedAt
    FROM dbo.Tasks t
    WHERE t.DeletedAt IS NULL
      AND t.CreatedAt >= DATEADD(WEEK, -@Weeks, GETUTCDATE())
      AND (
        (@ScopeType = 'list'   AND t.ListId = @ScopeId) OR
        (@ScopeType = 'folder' AND t.ListId IN (SELECT l.Id FROM dbo.Lists l WHERE l.FolderId = @ScopeId AND l.DeletedAt IS NULL)) OR
        (@ScopeType = 'space'  AND t.ProjectId = @ScopeId)
      )
  ),
  -- Earliest recorded transition into an "in progress"-style status for each task.
  -- AuditLog stores the new status inside the NewValues JSON; we match common
  -- in-progress tokens. Tasks with no such row fall back to CreatedAt downstream.
  FirstStart AS (
    SELECT
      a.ResourceId,
      MIN(a.CreatedAt) AS StartedAt
    FROM dbo.AuditLog a
    WHERE a.Resource = 'Task'
      AND a.Action   = 'UPDATE'
      AND a.NewValues IS NOT NULL
      AND (
        a.NewValues LIKE '%IN_PROGRESS%' OR
        a.NewValues LIKE '%In Progress%' OR
        a.NewValues LIKE '%"status":"IN PROGRESS"%'
      )
    GROUP BY a.ResourceId
  )
  SELECT
    st.Id        AS TaskId,
    st.IssueKey,
    st.Title,
    st.CreatedAt,
    fs.StartedAt,
    st.ResolvedAt,
    CASE WHEN st.ResolvedAt IS NOT NULL
         THEN DATEDIFF(SECOND, st.CreatedAt, st.ResolvedAt) END AS LeadTimeSeconds,
    CASE WHEN st.ResolvedAt IS NOT NULL AND fs.StartedAt IS NOT NULL
         THEN DATEDIFF(SECOND, fs.StartedAt, st.ResolvedAt) END AS CycleTimeSeconds
  FROM ScopeTasks st
  LEFT JOIN FirstStart fs
    ON TRY_CONVERT(UNIQUEIDENTIFIER, fs.ResourceId) = st.Id
  ORDER BY st.CreatedAt DESC;
END;
GO
```

- [ ] Write `usp_Report_Portfolio.sql` — a cross-location rollup across a **set** of folders/lists. The scope-id set is transported as a comma-delimited GUID list (`@ScopeIds`), parsed with `STRING_SPLIT` + `TRY_CONVERT` exactly like `usp_WorkLogTag_Set`'s `@TagIds` (spec §2.1: "a portfolio card spans multiple folders/lists by taking a set of scope nodes"). Each row is one scope (folder or list) with its counts, completed, progress %, and an on-track flag. On-track v1: `progressPct >= expected` where expected is elapsed-time-share of the scope's open work window (here simplified to "progress ≥ 50%" as a stable v1 heuristic; the time-aware refinement is computed in the pure helper, see Task 5):

```sql
-- usp_Report_Portfolio
-- Rollup across a SET of folders or lists (comma-delimited @ScopeIds).
-- @ScopeType: 'folder' | 'list'.
-- ResultSet: per-scope rows (ScopeType, ScopeId, ScopeName, TotalIssues,
--            CompletedIssues, TotalPoints, CompletedPoints).
-- The progressPct + onTrack derivation happens in the service (portfolioRollup).
CREATE OR ALTER PROCEDURE dbo.usp_Report_Portfolio
  @ScopeType NVARCHAR(8),
  @ScopeIds  NVARCHAR(MAX)        -- comma-delimited GUID list
AS
BEGIN
  SET NOCOUNT ON;

  -- Parse the scope-id set (same flat-string transport as usp_WorkLogTag_Set).
  DECLARE @Ids TABLE (Id UNIQUEIDENTIFIER PRIMARY KEY);
  INSERT INTO @Ids (Id)
  SELECT DISTINCT TRY_CONVERT(UNIQUEIDENTIFIER, LTRIM(RTRIM(value)))
  FROM STRING_SPLIT(ISNULL(@ScopeIds, ''), ',')
  WHERE TRY_CONVERT(UNIQUEIDENTIFIER, LTRIM(RTRIM(value))) IS NOT NULL;

  IF @ScopeType = 'list'
  BEGIN
    SELECT
      'list'        AS ScopeType,
      l.Id          AS ScopeId,
      l.Name        AS ScopeName,
      COUNT(t.Id)   AS TotalIssues,
      ISNULL(SUM(CASE WHEN t.ResolvedAt IS NOT NULL THEN 1 ELSE 0 END), 0) AS CompletedIssues,
      ISNULL(SUM(ISNULL(t.StoryPoints, 0)), 0) AS TotalPoints,
      ISNULL(SUM(CASE WHEN t.ResolvedAt IS NOT NULL THEN ISNULL(t.StoryPoints, 0) ELSE 0 END), 0) AS CompletedPoints
    FROM dbo.Lists l
    JOIN @Ids i ON i.Id = l.Id
    LEFT JOIN dbo.Tasks t ON t.ListId = l.Id AND t.DeletedAt IS NULL
    WHERE l.DeletedAt IS NULL
    GROUP BY l.Id, l.Name
    ORDER BY l.Name;
  END
  ELSE  -- folder: aggregate all (non-deleted) lists under each folder
  BEGIN
    SELECT
      'folder'      AS ScopeType,
      f.Id          AS ScopeId,
      f.Name        AS ScopeName,
      COUNT(t.Id)   AS TotalIssues,
      ISNULL(SUM(CASE WHEN t.ResolvedAt IS NOT NULL THEN 1 ELSE 0 END), 0) AS CompletedIssues,
      ISNULL(SUM(ISNULL(t.StoryPoints, 0)), 0) AS TotalPoints,
      ISNULL(SUM(CASE WHEN t.ResolvedAt IS NOT NULL THEN ISNULL(t.StoryPoints, 0) ELSE 0 END), 0) AS CompletedPoints
    FROM dbo.Folders f
    JOIN @Ids i ON i.Id = f.Id
    LEFT JOIN dbo.Lists l ON l.FolderId = f.Id AND l.DeletedAt IS NULL
    LEFT JOIN dbo.Tasks t ON t.ListId = l.Id AND t.DeletedAt IS NULL
    WHERE f.DeletedAt IS NULL
    GROUP BY f.Id, f.Name
    ORDER BY f.Name;
  END
END;
GO
```

- [ ] Run: deploy both via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`. Expected: both procedures created, no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_Report_LeadCycleTime.sql infra/sql/procedures/usp_Report_Portfolio.sql
git commit -m "feat(9b): lead/cycle-time (AuditLog history) + portfolio rollup (scope-set) SPs"
```

---

### Task 5: Pure analytics helpers + unit tests

**Files:**
- Create: `apps/api/src/modules/reports/analytics.ts`
- Create: `apps/api/src/modules/reports/__tests__/analytics.unit.test.ts`
- Test: `npm test --workspace apps/api -- analytics` (vitest `--project unit`).

Steps:

- [ ] Write the failing unit tests first. `analytics.unit.test.ts` exercises the three derivations the SPs hand off to TS — burnup completion %, cumulative-flow long→wide pivot, lead/cycle averages, and the portfolio on-track rollup across multiple scopes:

```ts
import { describe, it, expect } from 'vitest';
import {
  cumulativeFlowSeries,
  leadCycleSummary,
  portfolioRollup,
  burnupCompletionPct,
  type CumulativeFlowRow,
  type LeadCycleRow,
  type PortfolioRow,
} from '../analytics.js';

describe('burnupCompletionPct', () => {
  it('is completed / scope as a percentage', () => {
    expect(burnupCompletionPct(30, 120)).toBe(25);
  });
  it('is 0 when scope is 0 (no divide-by-zero)', () => {
    expect(burnupCompletionPct(0, 0)).toBe(0);
  });
});

describe('cumulativeFlowSeries', () => {
  it('pivots long (date,status,count) rows into per-date band maps preserving status order', () => {
    const rows: CumulativeFlowRow[] = [
      { date: '2026-06-01', status: 'TODO', issueCount: 5 },
      { date: '2026-06-01', status: 'DONE', issueCount: 2 },
      { date: '2026-06-02', status: 'TODO', issueCount: 3 },
      { date: '2026-06-02', status: 'DONE', issueCount: 4 },
    ];
    const series = cumulativeFlowSeries(rows);
    expect(series.statuses).toEqual(['TODO', 'DONE']);
    expect(series.points).toEqual([
      { date: '2026-06-01', TODO: 5, DONE: 2 },
      { date: '2026-06-02', TODO: 3, DONE: 4 },
    ]);
  });
  it('fills a missing band on a date with 0', () => {
    const rows: CumulativeFlowRow[] = [
      { date: '2026-06-01', status: 'TODO', issueCount: 5 },
      { date: '2026-06-02', status: 'DONE', issueCount: 4 },
    ];
    const series = cumulativeFlowSeries(rows);
    expect(series.statuses).toEqual(['TODO', 'DONE']);
    expect(series.points).toEqual([
      { date: '2026-06-01', TODO: 5, DONE: 0 },
      { date: '2026-06-02', TODO: 0, DONE: 4 },
    ]);
  });
});

describe('leadCycleSummary', () => {
  it('averages only the non-null lead/cycle times', () => {
    const rows: LeadCycleRow[] = [
      { taskId: 't1', leadTimeSeconds: 100, cycleTimeSeconds: 40 },
      { taskId: 't2', leadTimeSeconds: 300, cycleTimeSeconds: null },
      { taskId: 't3', leadTimeSeconds: null, cycleTimeSeconds: null },
    ];
    const s = leadCycleSummary(rows);
    expect(s.avgLeadTimeSeconds).toBe(200);   // (100 + 300) / 2
    expect(s.avgCycleTimeSeconds).toBe(40);    // only t1 has cycle time
  });
  it('returns null averages when no task has a measured time', () => {
    const s = leadCycleSummary([{ taskId: 't1', leadTimeSeconds: null, cycleTimeSeconds: null }]);
    expect(s.avgLeadTimeSeconds).toBeNull();
    expect(s.avgCycleTimeSeconds).toBeNull();
  });
});

describe('portfolioRollup', () => {
  it('derives progressPct + onTrack per scope across multiple scopes', () => {
    const rows: PortfolioRow[] = [
      { scopeType: 'folder', scopeId: 'f1', scopeName: 'Alpha', totalIssues: 10, completedIssues: 7, totalPoints: 20, completedPoints: 14 },
      { scopeType: 'folder', scopeId: 'f2', scopeName: 'Beta',  totalIssues: 10, completedIssues: 2, totalPoints: 20, completedPoints: 4 },
      { scopeType: 'folder', scopeId: 'f3', scopeName: 'Gamma', totalIssues: 0,  completedIssues: 0, totalPoints: 0,  completedPoints: 0 },
    ];
    const out = portfolioRollup(rows);
    expect(out[0]).toMatchObject({ scopeId: 'f1', progressPct: 70, onTrack: true });
    expect(out[1]).toMatchObject({ scopeId: 'f2', progressPct: 20, onTrack: false });
    // empty scope: 0% but not "behind" — onTrack true (nothing to do).
    expect(out[2]).toMatchObject({ scopeId: 'f3', progressPct: 0, onTrack: true });
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- analytics`. Expected: FAIL — `Cannot find module '../analytics.js'`.

- [ ] Write `apps/api/src/modules/reports/analytics.ts`:

```ts
import type { CumulativeFlowEntry, PortfolioEntry } from '@projectflow/types';

// ── Burnup ─────────────────────────────────────────────────────────────────
/** Completed / scope as a 0–100 percentage; 0 when scope is 0. */
export function burnupCompletionPct(completedPoints: number, scopePoints: number): number {
  if (scopePoints <= 0) return 0;
  return Math.round((completedPoints / scopePoints) * 100);
}

// ── Cumulative flow ──────────────────────────────────────────────────────────
export interface CumulativeFlowRow {
  date: string;
  status: string;
  issueCount: number;
}

export interface CumulativeFlowSeries {
  statuses: string[];                          // bands in first-seen order
  points: Array<Record<string, number | string>>; // { date, [status]: count } per day, every band filled
}

/** Pivot long (date,status,count) report rows into a per-date wide series with
 *  every status band present (missing → 0), preserving first-seen status order. */
export function cumulativeFlowSeries(rows: CumulativeFlowRow[]): CumulativeFlowSeries {
  const statuses: string[] = [];
  const byDate = new Map<string, Record<string, number | string>>();
  for (const r of rows) {
    if (!statuses.includes(r.status)) statuses.push(r.status);
    let point = byDate.get(r.date);
    if (!point) { point = { date: r.date }; byDate.set(r.date, point); }
    point[r.status] = r.issueCount;
  }
  const points = [...byDate.values()].map((p) => {
    for (const s of statuses) if (p[s] === undefined) p[s] = 0;
    return p;
  });
  return { statuses, points };
}

/** Map raw SP cumulative-flow rows to the camelCase report entry shape. */
export function toCumulativeFlowEntries(
  rows: Array<{ Date: Date | string | null; Status: string; IssueCount: number }>,
): CumulativeFlowEntry[] {
  return rows.map((r) => ({
    date: r.Date ? new Date(r.Date).toISOString().split('T')[0] : null,
    status: r.Status,
    issueCount: r.IssueCount,
  }));
}

// ── Lead / cycle time ────────────────────────────────────────────────────────
export interface LeadCycleRow {
  taskId: string;
  leadTimeSeconds: number | null;
  cycleTimeSeconds: number | null;
}

export interface LeadCycleSummary {
  avgLeadTimeSeconds: number | null;
  avgCycleTimeSeconds: number | null;
}

function avg(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return Math.round(present.reduce((a, b) => a + b, 0) / present.length);
}

/** Average lead/cycle time across tasks, ignoring nulls (unresolved/never-started). */
export function leadCycleSummary(rows: LeadCycleRow[]): LeadCycleSummary {
  return {
    avgLeadTimeSeconds:  avg(rows.map((r) => r.leadTimeSeconds)),
    avgCycleTimeSeconds: avg(rows.map((r) => r.cycleTimeSeconds)),
  };
}

// ── Portfolio ────────────────────────────────────────────────────────────────
export interface PortfolioRow {
  scopeType: string;
  scopeId: string;
  scopeName: string;
  totalIssues: number;
  completedIssues: number;
  totalPoints: number;
  completedPoints: number;
}

/** Derive progressPct + onTrack per scope. v1 on-track heuristic: a scope is on
 *  track if it has completed ≥ half its issues, or has nothing to do. */
export function portfolioRollup(rows: PortfolioRow[]): PortfolioEntry[] {
  return rows.map((r) => {
    const progressPct = r.totalIssues > 0
      ? Math.round((r.completedIssues / r.totalIssues) * 100)
      : 0;
    const onTrack = r.totalIssues === 0 ? true : progressPct >= 50;
    return {
      scopeType: r.scopeType,
      scopeId: r.scopeId,
      scopeName: r.scopeName,
      totalIssues: r.totalIssues,
      completedIssues: r.completedIssues,
      totalPoints: r.totalPoints,
      completedPoints: r.completedPoints,
      progressPct,
      onTrack,
    };
  });
}
```

- [ ] Run: `npm test --workspace apps/api -- analytics`. Expected: PASS (8 tests).

- [ ] Commit:
```
git add apps/api/src/modules/reports/analytics.ts apps/api/src/modules/reports/__tests__/analytics.unit.test.ts
git commit -m "feat(9b): pure analytics helpers (cumulative-flow pivot, lead/cycle avg, portfolio rollup) + unit tests"
```

---

### Task 6: Repository + service + REST routes for the new reports

**Files:**
- Modify: `apps/api/src/modules/reports/reports.repository.ts`
- Modify: `apps/api/src/modules/reports/reports.service.ts`
- Modify: `apps/api/src/modules/reports/reports.routes.ts`
- Test: REST surface covered by `reports.integration.test.ts` (Task 7).

Steps:

- [ ] Extend `reports.repository.ts` — add row interfaces + four methods, matching the existing `execSp` (multi-set: burnup) / `execSpOne` (single-set: cumulativeFlow/leadCycleTime/portfolio) usage. Append after `createdVsResolved`:

```ts
export interface BurnupMeta {
  SprintId:         string;
  SprintName:       string;
  StartDate:        Date;
  EndDate:          Date;
  TotalScopePoints: number;
  CompletedPoints:  number;
}

export interface BurnupPointRow {
  Date:            Date;
  CompletedPoints: number;
  ScopePoints:     number;
}

export interface CumulativeFlowRowDb {
  Date:       Date;
  Status:     string;
  IssueCount: number;
}

export interface LeadCycleTimeRowDb {
  TaskId:           string;
  IssueKey:         string;
  Title:            string;
  CreatedAt:        Date;
  StartedAt:        Date | null;
  ResolvedAt:       Date | null;
  LeadTimeSeconds:  number | null;
  CycleTimeSeconds: number | null;
}

export interface PortfolioRowDb {
  ScopeType:       string;
  ScopeId:         string;
  ScopeName:       string;
  TotalIssues:     number;
  CompletedIssues: number;
  TotalPoints:     number;
  CompletedPoints: number;
}
```

Add to `ReportsRepository`:

```ts
  async burnup(sprintId: string) {
    const sets = await execSp('usp_Report_Burnup', [
      { name: 'SprintId', type: sql.UniqueIdentifier, value: sprintId },
    ]);
    return {
      meta:   (sets[0]?.[0] ?? null) as BurnupMeta | null,
      points: (sets[1] ?? []) as BurnupPointRow[],
    };
  }

  async cumulativeFlow(scopeType: string, scopeId: string, weeks = 8) {
    const rows = await execSpOne<CumulativeFlowRowDb>('usp_Report_CumulativeFlow', [
      { name: 'ScopeType', type: sql.NVarChar(8),       value: scopeType },
      { name: 'ScopeId',   type: sql.UniqueIdentifier,  value: scopeId },
      { name: 'Weeks',     type: sql.Int,               value: weeks },
    ]);
    return rows as CumulativeFlowRowDb[];
  }

  async leadCycleTime(scopeType: string, scopeId: string, weeks = 12) {
    const rows = await execSpOne<LeadCycleTimeRowDb>('usp_Report_LeadCycleTime', [
      { name: 'ScopeType', type: sql.NVarChar(8),       value: scopeType },
      { name: 'ScopeId',   type: sql.UniqueIdentifier,  value: scopeId },
      { name: 'Weeks',     type: sql.Int,               value: weeks },
    ]);
    return rows as LeadCycleTimeRowDb[];
  }

  async portfolio(scopeType: string, scopeIds: string[]) {
    const rows = await execSpOne<PortfolioRowDb>('usp_Report_Portfolio', [
      { name: 'ScopeType', type: sql.NVarChar(8),    value: scopeType },
      { name: 'ScopeIds',  type: sql.NVarChar(sql.MAX), value: scopeIds.length ? scopeIds.join(',') : '' },
    ]);
    return rows as PortfolioRowDb[];
  }
```

- [ ] Extend `reports.service.ts` — add four methods returning the new camelCase report types, reusing `analytics.ts` helpers for the derived fields. Import the helpers + types at the top:

```ts
import { ReportsRepository } from './reports.repository.js';
import { leadCycleSummary, portfolioRollup } from './analytics.js';
import type {
  BurnupReport, CumulativeFlowEntry, LeadCycleTimeReport, PortfolioEntry,
} from '@projectflow/types';
```

Append to `ReportsService` (the existing `toISO` helper is in scope):

```ts
  async burnup(sprintId: string): Promise<BurnupReport | null> {
    const { meta, points } = await repo.burnup(sprintId);
    if (!meta) return null;
    return {
      sprintId:         meta.SprintId,
      sprintName:       meta.SprintName,
      startDate:        toISO(meta.StartDate),
      endDate:          toISO(meta.EndDate),
      totalScopePoints: meta.TotalScopePoints,
      completedPoints:  meta.CompletedPoints,
      points: points.map(p => ({
        date:            toISO(p.Date),
        completedPoints: p.CompletedPoints,
        scopePoints:     p.ScopePoints,
      })),
    };
  }

  async cumulativeFlow(scopeType: string, scopeId: string, weeks = 8): Promise<CumulativeFlowEntry[]> {
    const rows = await repo.cumulativeFlow(scopeType, scopeId, weeks);
    return rows.map(r => ({
      date:       toISO(r.Date),
      status:     r.Status,
      issueCount: r.IssueCount,
    }));
  }

  async leadCycleTime(scopeType: string, scopeId: string, weeks = 12): Promise<LeadCycleTimeReport> {
    const rows = await repo.leadCycleTime(scopeType, scopeId, weeks);
    const tasks = rows.map(r => ({
      taskId:           r.TaskId,
      issueKey:         r.IssueKey,
      title:            r.Title,
      createdAt:        toISO(r.CreatedAt),
      startedAt:        toISO(r.StartedAt),
      resolvedAt:       toISO(r.ResolvedAt),
      leadTimeSeconds:  r.LeadTimeSeconds,
      cycleTimeSeconds: r.CycleTimeSeconds,
    }));
    const summary = leadCycleSummary(tasks);
    return {
      scopeType,
      scopeId,
      rangeStart: tasks.length ? tasks[tasks.length - 1].createdAt : null,
      rangeEnd:   tasks.length ? tasks[0].createdAt : null,
      avgLeadTimeSeconds:  summary.avgLeadTimeSeconds,
      avgCycleTimeSeconds: summary.avgCycleTimeSeconds,
      tasks,
    };
  }

  async portfolio(scopeType: string, scopeIds: string[]): Promise<PortfolioEntry[]> {
    const rows = await repo.portfolio(scopeType, scopeIds);
    return portfolioRollup(rows.map(r => ({
      scopeType:       r.ScopeType,
      scopeId:         r.ScopeId,
      scopeName:       r.ScopeName,
      totalIssues:     r.TotalIssues,
      completedIssues: r.CompletedIssues,
      totalPoints:     r.TotalPoints,
      completedPoints: r.CompletedPoints,
    })));
  }
```

- [ ] Add the four REST routes to `reports.routes.ts`, matching the existing query-param style (the SSR web client uses REST; per spec §3 the GraphQL mirror reuses the same service):

```ts
// GET /reports/burnup?sprintId=
reportsRoutes.get('/burnup', async (c) => {
  const sprintId = c.req.query('sprintId');
  if (!sprintId) return c.json({ error: 'sprintId is required' }, 400);
  try {
    const data = await svc.burnup(sprintId);
    if (!data) return c.json({ error: 'Sprint not found' }, 404);
    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// GET /reports/cumulative-flow?scopeType=&scopeId=&weeks=8
reportsRoutes.get('/cumulative-flow', async (c) => {
  const scopeType = c.req.query('scopeType');
  const scopeId   = c.req.query('scopeId');
  const weeks     = parseInt(c.req.query('weeks') ?? '8', 10);
  if (!scopeType || !scopeId) return c.json({ error: 'scopeType and scopeId are required' }, 400);
  try {
    const data = await svc.cumulativeFlow(scopeType, scopeId, weeks);
    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// GET /reports/lead-cycle-time?scopeType=&scopeId=&weeks=12
reportsRoutes.get('/lead-cycle-time', async (c) => {
  const scopeType = c.req.query('scopeType');
  const scopeId   = c.req.query('scopeId');
  const weeks     = parseInt(c.req.query('weeks') ?? '12', 10);
  if (!scopeType || !scopeId) return c.json({ error: 'scopeType and scopeId are required' }, 400);
  try {
    const data = await svc.leadCycleTime(scopeType, scopeId, weeks);
    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// GET /reports/portfolio?scopeType=&scopeIds=id1,id2
reportsRoutes.get('/portfolio', async (c) => {
  const scopeType = c.req.query('scopeType');
  const scopeIds  = (c.req.query('scopeIds') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!scopeType || scopeIds.length === 0) return c.json({ error: 'scopeType and scopeIds are required' }, 400);
  try {
    const data = await svc.portfolio(scopeType, scopeIds);
    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
```

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS — service/repo/routes compile against the new types.

- [ ] Commit:
```
git add apps/api/src/modules/reports/reports.repository.ts apps/api/src/modules/reports/reports.service.ts apps/api/src/modules/reports/reports.routes.ts
git commit -m "feat(9b): reports repo/service/REST — burnup/cumulative-flow/lead-cycle-time/portfolio"
```

---

### Task 7: GraphQL reports mirror (all nine queries) + integration test

**Files:**
- Create: `apps/api/src/graphql/reports.schema.ts`
- Modify: `apps/api/src/graphql/schema.ts` (import + call `registerReportsGraphql()`)
- Create: `apps/api/src/modules/reports/__tests__/reports.integration.test.ts`

Steps:

- [ ] Write the failing integration test first (copy the harness imports + `gql()` helper from `graphql/__tests__/authz.integration.test.ts`; seed a sprint with tasks via the REST factories). It asserts (a) GraphQL `burndown`/`velocity` match their REST counterparts, (b) sprint burndown + velocity compute correctly against seeded sprint data (spec §5.5), (c) the four new GraphQL queries resolve:

```ts
/**
 * Phase 9b — Reports GraphQL mirror + analytics coverage.
 * Verifies GraphQL report queries match their REST counterparts and that
 * sprint burndown + velocity compute correctly against seeded sprint data.
 * DB SAFETY: must target local Docker ProjectFlow_Test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

interface GqlResult { data?: Record<string, any> | null; errors?: { message: string; extensions?: { code?: string } }[] }
async function gql(query: string, variables: Record<string, unknown>, token?: string): Promise<GqlResult> {
  const res = await request('/graphql', { method: 'POST', token, json: { query, variables } });
  return (await res.json()) as GqlResult;
}

// Seed a project with a sprint of tasks: 3 done (8 pts) of 5 total (14 pts).
async function seedSprint() {
  const owner = await createTestUser({ email: `rep-${Date.now()}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'Rep Space', key: `RP${Date.now() % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'L', position: 0 },
  }), 201)).data;
  const listId = list.id ?? list.Id;
  const sprint = (await json<{ data: any }>(await request('/sprints', {
    method: 'POST', token,
    json: { projectId: space.Id, name: 'S1', startDate: '2026-05-01', endDate: '2026-05-14' },
  }), 201)).data;
  const sprintId = sprint.id ?? sprint.Id;
  // 5 tasks; 3 resolved.
  for (let i = 0; i < 5; i += 1) {
    const t = (await json<{ data: any }>(await request('/tasks', {
      method: 'POST', token,
      json: { workspaceId: ws.Id, projectId: space.Id, listId, title: `T${i}`, sprintId, storyPoints: i < 3 ? 4 : 1 },
    }), 201)).data;
    if (i < 3) await request(`/tasks/${t.id ?? t.Id}/transition`, { method: 'POST', token, json: { status: 'DONE' } });
  }
  return { token, projectId: space.Id, sprintId, scopeType: 'space', scopeId: space.Id };
}

describe('reports GraphQL mirror', () => {
  it('GraphQL burndown matches REST burndown for the same sprint', async () => {
    const { token, sprintId } = await seedSprint();
    const rest = (await json<{ data: any }>(await request(`/reports/burndown?sprintId=${sprintId}`, { token }))).data;
    const g = await gql(
      'query($s:String!){ burndown(sprintId:$s){ totalPoints points{ date remainingPoints idealPoints } } }',
      { s: sprintId }, token,
    );
    expect(g.errors, JSON.stringify(g)).toBeUndefined();
    expect(g.data?.burndown.totalPoints).toBe(rest.totalPoints);
    expect(g.data?.burndown.points.length).toBe(rest.points.length);
  });

  it('velocity computes committed vs completed correctly against seeded sprint data', async () => {
    const { token, projectId, sprintId } = await seedSprint();
    const g = await gql(
      'query($p:String!){ velocity(projectId:$p,numSprints:5){ sprintId committedPoints completedPoints } }',
      { p: projectId }, token,
    );
    expect(g.errors, JSON.stringify(g)).toBeUndefined();
    const entry = g.data?.velocity.find((v: any) => v.sprintId === sprintId);
    expect(entry.committedPoints).toBe(14);   // 3*4 + 2*1
    expect(entry.completedPoints).toBe(12);   // 3*4 resolved
  });

  it('burnup completed line never exceeds scope and ends at completed points', async () => {
    const { token, sprintId } = await seedSprint();
    const g = await gql(
      'query($s:String!){ burnup(sprintId:$s){ totalScopePoints completedPoints points{ completedPoints scopePoints } } }',
      { s: sprintId }, token,
    );
    expect(g.errors, JSON.stringify(g)).toBeUndefined();
    expect(g.data?.burnup.totalScopePoints).toBe(14);
    expect(g.data?.burnup.completedPoints).toBe(12);
    for (const p of g.data?.burnup.points) expect(p.completedPoints).toBeLessThanOrEqual(p.scopePoints);
  });

  it('cumulativeFlow / leadCycleTime / portfolio resolve over the seeded scope', async () => {
    const { token, scopeType, scopeId } = await seedSprint();
    const cf = await gql('query($t:String!,$i:String!){ cumulativeFlow(scopeType:$t,scopeId:$i,weeks:8){ date status issueCount } }', { t: scopeType, i: scopeId }, token);
    expect(cf.errors, JSON.stringify(cf)).toBeUndefined();
    expect(Array.isArray(cf.data?.cumulativeFlow)).toBe(true);

    const lc = await gql('query($t:String!,$i:String!){ leadCycleTime(scopeType:$t,scopeId:$i){ avgLeadTimeSeconds tasks{ taskId leadTimeSeconds } } }', { t: scopeType, i: scopeId }, token);
    expect(lc.errors, JSON.stringify(lc)).toBeUndefined();
    expect(lc.data?.leadCycleTime.tasks.length).toBe(5);

    const pf = await gql('query($t:String!,$ids:[String!]!){ portfolio(scopeType:$t,scopeIds:$ids){ scopeId progressPct onTrack } }', { t: 'space', ids: [scopeId] }, token);
    expect(pf.errors, JSON.stringify(pf)).toBeUndefined();
  });
});
```

- [ ] Run: `npm run test:integration --workspace apps/api -- reports` against `ProjectFlow_Test`. Expected: FAIL — the GraphQL report fields are unknown (mirror not registered).

- [ ] Write `apps/api/src/graphql/reports.schema.ts` — mirror ALL NINE report queries over the shared `ReportsService`, following the `recurrence.schema.ts` pattern (typed `objectRef` for each report shape, `builder.queryFields`). Reports are workspace-scoped reads; gate each on the resolved workspace via `requireWorkspacePermission(ctx, workspaceId, 'report.read')` (spec §3 lists `report.read`). The sprint/project queries resolve the workspace from the project; the scope queries resolve it from the hierarchy node:

```ts
import { builder } from './builder.js';
import { ReportsService } from '../modules/reports/reports.service.js';
import { projectService } from '../modules/projects/project.service.js';
import { sprintService } from '../modules/sprints/sprint.service.js';
import { HierarchyRepository } from '../modules/hierarchy/hierarchy.repository.js';
import { requireWorkspacePermission, notFound } from './authz.js';
import type {
  BurndownReport, BurndownPoint, VelocityEntry, SprintSummaryReport, SprintStatusBreakdown,
  WorkloadEntry, CreatedVsResolvedEntry, BurnupReport, BurnupPoint, CumulativeFlowEntry,
  LeadCycleTimeReport, LeadCycleTimeEntry, PortfolioEntry,
} from '@projectflow/types';

const svc = new ReportsService();
const hierarchyRepo = new HierarchyRepository();

// Resolve a sprint → its project → its workspace (for the report.read gate).
async function workspaceForSprint(sprintId: string): Promise<string | null> {
  const sprint = await sprintService.getById(sprintId);
  if (!sprint) return null;
  const project = await projectService.getById((sprint as any).projectId);
  return (project as any)?.workspaceId ?? null;
}
async function workspaceForProject(projectId: string): Promise<string | null> {
  const project = await projectService.getById(projectId);
  return (project as any)?.workspaceId ?? null;
}
// Resolve a hierarchy scope node → its workspace.
async function workspaceForScope(scopeType: string, scopeId: string): Promise<string | null> {
  const node = await hierarchyRepo.getNode(scopeType.toUpperCase() as any, scopeId);
  return (node as any)?.workspaceId ?? (node as any)?.WorkspaceId ?? null;
}

export function registerReportsGraphql(): void {
  // ── Object refs ──
  const BurndownPointType = builder.objectRef<BurndownPoint>('BurndownPoint');
  BurndownPointType.implement({ fields: (t) => ({
    date:            t.string({ nullable: true, resolve: (p) => p.date ?? null }),
    remainingPoints: t.float({ resolve: (p) => p.remainingPoints }),
    idealPoints:     t.float({ resolve: (p) => p.idealPoints }),
  }) });
  const BurndownType = builder.objectRef<BurndownReport>('BurndownReport');
  BurndownType.implement({ fields: (t) => ({
    totalPoints: t.float({ resolve: (r) => r.totalPoints }),
    startDate:   t.string({ nullable: true, resolve: (r) => r.startDate ?? null }),
    endDate:     t.string({ nullable: true, resolve: (r) => r.endDate ?? null }),
    points:      t.field({ type: [BurndownPointType], resolve: (r) => r.points }),
  }) });

  const VelocityType = builder.objectRef<VelocityEntry>('VelocityEntry');
  VelocityType.implement({ fields: (t) => ({
    sprintId:        t.exposeString('sprintId'),
    sprintName:      t.exposeString('sprintName'),
    startDate:       t.string({ nullable: true, resolve: (r) => r.startDate ?? null }),
    endDate:         t.string({ nullable: true, resolve: (r) => r.endDate ?? null }),
    committedPoints: t.float({ resolve: (r) => r.committedPoints }),
    completedPoints: t.float({ resolve: (r) => r.completedPoints }),
  }) });

  const SprintStatusType = builder.objectRef<SprintStatusBreakdown>('SprintStatusBreakdown');
  SprintStatusType.implement({ fields: (t) => ({
    status:      t.exposeString('status'),
    issueCount:  t.exposeInt('issueCount'),
    storyPoints: t.float({ resolve: (r) => r.storyPoints }),
  }) });
  const SprintSummaryType = builder.objectRef<SprintSummaryReport>('SprintSummaryReport');
  SprintSummaryType.implement({ fields: (t) => ({
    sprintId:         t.exposeString('sprintId'),
    sprintName:       t.exposeString('sprintName'),
    startDate:        t.string({ nullable: true, resolve: (r) => r.startDate ?? null }),
    endDate:          t.string({ nullable: true, resolve: (r) => r.endDate ?? null }),
    totalIssues:      t.exposeInt('totalIssues'),
    completedIssues:  t.exposeInt('completedIssues'),
    incompleteIssues: t.exposeInt('incompleteIssues'),
    totalPoints:      t.float({ resolve: (r) => r.totalPoints }),
    completedPoints:  t.float({ resolve: (r) => r.completedPoints }),
    statusBreakdown:  t.field({ type: [SprintStatusType], resolve: (r) => r.statusBreakdown }),
  }) });

  const WorkloadType = builder.objectRef<WorkloadEntry>('WorkloadEntry');
  WorkloadType.implement({ fields: (t) => ({
    assigneeId:   t.exposeString('assigneeId'),
    assigneeName: t.exposeString('assigneeName'),
    totalIssues:  t.exposeInt('totalIssues'),
    openIssues:   t.exposeInt('openIssues'),
    doneIssues:   t.exposeInt('doneIssues'),
    totalPoints:  t.float({ resolve: (r) => r.totalPoints }),
    openPoints:   t.float({ resolve: (r) => r.openPoints }),
  }) });

  const CreatedVsResolvedType = builder.objectRef<CreatedVsResolvedEntry>('CreatedVsResolvedEntry');
  CreatedVsResolvedType.implement({ fields: (t) => ({
    weekStart: t.string({ nullable: true, resolve: (r) => r.weekStart ?? null }),
    weekEnd:   t.string({ nullable: true, resolve: (r) => r.weekEnd ?? null }),
    created:   t.exposeInt('created'),
    resolved:  t.exposeInt('resolved'),
  }) });

  const BurnupPointType = builder.objectRef<BurnupPoint>('BurnupPoint');
  BurnupPointType.implement({ fields: (t) => ({
    date:            t.string({ nullable: true, resolve: (p) => p.date ?? null }),
    completedPoints: t.float({ resolve: (p) => p.completedPoints }),
    scopePoints:     t.float({ resolve: (p) => p.scopePoints }),
  }) });
  const BurnupType = builder.objectRef<BurnupReport>('BurnupReport');
  BurnupType.implement({ fields: (t) => ({
    sprintId:         t.exposeString('sprintId'),
    sprintName:       t.exposeString('sprintName'),
    startDate:        t.string({ nullable: true, resolve: (r) => r.startDate ?? null }),
    endDate:          t.string({ nullable: true, resolve: (r) => r.endDate ?? null }),
    totalScopePoints: t.float({ resolve: (r) => r.totalScopePoints }),
    completedPoints:  t.float({ resolve: (r) => r.completedPoints }),
    points:           t.field({ type: [BurnupPointType], resolve: (r) => r.points }),
  }) });

  const CumulativeFlowType = builder.objectRef<CumulativeFlowEntry>('CumulativeFlowEntry');
  CumulativeFlowType.implement({ fields: (t) => ({
    date:       t.string({ nullable: true, resolve: (r) => r.date ?? null }),
    status:     t.exposeString('status'),
    issueCount: t.exposeInt('issueCount'),
  }) });

  const LeadCycleTaskType = builder.objectRef<LeadCycleTimeEntry>('LeadCycleTimeEntry');
  LeadCycleTaskType.implement({ fields: (t) => ({
    taskId:           t.exposeString('taskId'),
    issueKey:         t.exposeString('issueKey'),
    title:            t.exposeString('title'),
    createdAt:        t.string({ nullable: true, resolve: (r) => r.createdAt ?? null }),
    startedAt:        t.string({ nullable: true, resolve: (r) => r.startedAt ?? null }),
    resolvedAt:       t.string({ nullable: true, resolve: (r) => r.resolvedAt ?? null }),
    leadTimeSeconds:  t.int({ nullable: true, resolve: (r) => r.leadTimeSeconds ?? null }),
    cycleTimeSeconds: t.int({ nullable: true, resolve: (r) => r.cycleTimeSeconds ?? null }),
  }) });
  const LeadCycleType = builder.objectRef<LeadCycleTimeReport>('LeadCycleTimeReport');
  LeadCycleType.implement({ fields: (t) => ({
    scopeType:           t.exposeString('scopeType'),
    scopeId:             t.exposeString('scopeId'),
    rangeStart:          t.string({ nullable: true, resolve: (r) => r.rangeStart ?? null }),
    rangeEnd:            t.string({ nullable: true, resolve: (r) => r.rangeEnd ?? null }),
    avgLeadTimeSeconds:  t.int({ nullable: true, resolve: (r) => r.avgLeadTimeSeconds ?? null }),
    avgCycleTimeSeconds: t.int({ nullable: true, resolve: (r) => r.avgCycleTimeSeconds ?? null }),
    tasks:               t.field({ type: [LeadCycleTaskType], resolve: (r) => r.tasks }),
  }) });

  const PortfolioType = builder.objectRef<PortfolioEntry>('PortfolioEntry');
  PortfolioType.implement({ fields: (t) => ({
    scopeType:       t.exposeString('scopeType'),
    scopeId:         t.exposeString('scopeId'),
    scopeName:       t.exposeString('scopeName'),
    totalIssues:     t.exposeInt('totalIssues'),
    completedIssues: t.exposeInt('completedIssues'),
    totalPoints:     t.float({ resolve: (r) => r.totalPoints }),
    completedPoints: t.float({ resolve: (r) => r.completedPoints }),
    progressPct:     t.exposeInt('progressPct'),
    onTrack:         t.boolean({ resolve: (r) => r.onTrack }),
  }) });

  // ── Queries (all nine) ──
  builder.queryFields((t) => ({
    burndown: t.field({
      type: BurndownType, nullable: true,
      args: { sprintId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const ws = await workspaceForSprint(a.sprintId);
        if (!ws) notFound('Sprint not found');
        await requireWorkspacePermission(ctx, ws, 'report.read');
        return svc.burndown(a.sprintId);
      },
    }),
    velocity: t.field({
      type: [VelocityType],
      args: { projectId: t.arg.string({ required: true }), numSprints: t.arg.int({ required: false }) },
      resolve: async (_, a, ctx) => {
        const ws = await workspaceForProject(a.projectId);
        if (!ws) notFound('Project not found');
        await requireWorkspacePermission(ctx, ws, 'report.read');
        return svc.velocity(a.projectId, a.numSprints ?? 5);
      },
    }),
    sprintSummary: t.field({
      type: SprintSummaryType, nullable: true,
      args: { sprintId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const ws = await workspaceForSprint(a.sprintId);
        if (!ws) notFound('Sprint not found');
        await requireWorkspacePermission(ctx, ws, 'report.read');
        return svc.sprintSummary(a.sprintId);
      },
    }),
    workload: t.field({
      type: [WorkloadType],
      args: { projectId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const ws = await workspaceForProject(a.projectId);
        if (!ws) notFound('Project not found');
        await requireWorkspacePermission(ctx, ws, 'report.read');
        return svc.workload(a.projectId);
      },
    }),
    createdVsResolved: t.field({
      type: [CreatedVsResolvedType],
      args: { projectId: t.arg.string({ required: true }), weeks: t.arg.int({ required: false }) },
      resolve: async (_, a, ctx) => {
        const ws = await workspaceForProject(a.projectId);
        if (!ws) notFound('Project not found');
        await requireWorkspacePermission(ctx, ws, 'report.read');
        return svc.createdVsResolved(a.projectId, a.weeks ?? 8);
      },
    }),
    burnup: t.field({
      type: BurnupType, nullable: true,
      args: { sprintId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const ws = await workspaceForSprint(a.sprintId);
        if (!ws) notFound('Sprint not found');
        await requireWorkspacePermission(ctx, ws, 'report.read');
        return svc.burnup(a.sprintId);
      },
    }),
    cumulativeFlow: t.field({
      type: [CumulativeFlowType],
      args: { scopeType: t.arg.string({ required: true }), scopeId: t.arg.string({ required: true }), weeks: t.arg.int({ required: false }) },
      resolve: async (_, a, ctx) => {
        const ws = await workspaceForScope(a.scopeType, a.scopeId);
        if (!ws) notFound('Scope not found');
        await requireWorkspacePermission(ctx, ws, 'report.read');
        return svc.cumulativeFlow(a.scopeType, a.scopeId, a.weeks ?? 8);
      },
    }),
    leadCycleTime: t.field({
      type: LeadCycleType,
      args: { scopeType: t.arg.string({ required: true }), scopeId: t.arg.string({ required: true }), weeks: t.arg.int({ required: false }) },
      resolve: async (_, a, ctx) => {
        const ws = await workspaceForScope(a.scopeType, a.scopeId);
        if (!ws) notFound('Scope not found');
        await requireWorkspacePermission(ctx, ws, 'report.read');
        return svc.leadCycleTime(a.scopeType, a.scopeId, a.weeks ?? 12);
      },
    }),
    portfolio: t.field({
      type: [PortfolioType],
      args: { scopeType: t.arg.string({ required: true }), scopeIds: t.arg.stringList({ required: true }) },
      resolve: async (_, a, ctx) => {
        // Every scope in the set must resolve to the SAME workspace the caller can
        // read; gate on the first and assert the rest share it (fail-closed).
        const ids = a.scopeIds;
        if (!ids.length) notFound('scopeIds required');
        const ws = await workspaceForScope(a.scopeType, ids[0]);
        if (!ws) notFound('Scope not found');
        await requireWorkspacePermission(ctx, ws, 'report.read');
        for (const id of ids.slice(1)) {
          const w = await workspaceForScope(a.scopeType, id);
          if (w !== ws) notFound('Scope not found');
        }
        return svc.portfolio(a.scopeType, ids);
      },
    }),
  }));
}
```

(If `hierarchyRepo.getNode` / `sprintService.getById` / `projectService.getById` have slightly different method names in the repo, adapt to the real ones — the pattern is: resolve the scope/sprint/project to its `workspaceId`, then `requireWorkspacePermission(ctx, ws, 'report.read')`. Note inline if a referenced method does not exist and use the closest existing lookup.)

- [ ] Wire it into `schema.ts` — add the import alongside the others and call it near the other `register*Graphql()` calls (after `registerPresenceGraphql();`):

```ts
import { registerReportsGraphql } from './reports.schema.js';
```
```ts
// ─────────────────────────────────────────
// Reports (Phase 9b) — burndown/velocity/sprintSummary/workload/createdVsResolved
// + burnup/cumulativeFlow/leadCycleTime/portfolio queries. REST-mirrored over the
// one shared ReportsService; all gated on report.read.
// ─────────────────────────────────────────
registerReportsGraphql();
```

- [ ] Run: `npm run build --workspace apps/api` (compiles the Pothos schema). Expected: PASS. Then `npm run test:integration --workspace apps/api -- reports` against `ProjectFlow_Test`. Expected: PASS (4 tests). Then `npm test --workspace apps/api`. Expected: PASS (existing GraphQL authz suite still green).

- [ ] Commit:
```
git add apps/api/src/graphql/reports.schema.ts apps/api/src/graphql/schema.ts apps/api/src/modules/reports/__tests__/reports.integration.test.ts
git commit -m "feat(9b): GraphQL reports mirror — all 9 report queries (report.read-gated) + integration test"
```

---

### Task 8: `card.service` — new analytics/entity card branches + dispatch test

**Files:**
- Modify: `apps/api/src/modules/dashboards/card.service.ts` (the 9a dispatcher)
- Create: `apps/api/src/modules/dashboards/__tests__/card.analytics.unit.test.ts`

Steps:

- [ ] Read the 9a `card.service.ts` to learn the EXACT `resolve(card, scope)` signature + the wave-1 branch shape (per spec §2.1/§4.2: generic cards → Phase-3 query compiler, report cards → `usp_Report_*`, entity cards → Phase-8 services; the resolver returns a `{ type, data }`-style payload the renderer reads). 9b extends this dispatcher — stay consistent with whatever exact return contract 9a established. (If the file does not exist, the 9a prerequisite is unmet — STOP and flag.)

- [ ] Write the failing dispatch unit test. `card.analytics.unit.test.ts` mocks `ReportsService` + the Phase-8 timesheet service and asserts each new card type routes to the right source with the card's `config` params. Match the actual `resolve` signature read in the previous step (the test below assumes `resolveCard(card, scope, deps)` where `deps` injects the services — adapt to the real seam, e.g. module mock via `vi.mock`):

```ts
import { describe, it, expect, vi } from 'vitest';

const burndown = vi.fn(async () => ({ totalPoints: 14, points: [] }));
const velocity = vi.fn(async () => [{ sprintId: 's1', committedPoints: 14, completedPoints: 12 }]);
const burnup = vi.fn(async () => ({ totalScopePoints: 14, completedPoints: 12, points: [] }));
const cumulativeFlow = vi.fn(async () => [{ date: '2026-06-01', status: 'TODO', issueCount: 3 }]);
const leadCycleTime = vi.fn(async () => ({ tasks: [], avgLeadTimeSeconds: 100 }));
const sprintSummary = vi.fn(async () => ({ sprintId: 's1', totalIssues: 5 }));
const portfolio = vi.fn(async () => [{ scopeId: 'f1', progressPct: 70, onTrack: true }]);
vi.mock('../../reports/reports.service.js', () => ({
  ReportsService: class { burndown = burndown; velocity = velocity; burnup = burnup;
    cumulativeFlow = cumulativeFlow; leadCycleTime = leadCycleTime; sprintSummary = sprintSummary; portfolio = portfolio; },
}));

const getRollup = vi.fn(async () => ({ rollupLoggedSeconds: 3600 }));
vi.mock('../../worklogs/worklog.service.js', () => ({
  WorkLogService: class { getRollup = getRollup; },
}));

import { CardService } from '../card.service.js';

const scope = { scopeType: 'space', scopeId: 'sp1', workspaceId: 'ws1', userId: 'u1' } as any;
const svc = new CardService();

describe('card.service — 9b analytics/entity card dispatch', () => {
  it('burndown card calls ReportsService.burndown with the configured sprintId', async () => {
    await svc.resolve({ type: 'burndown', config: { sprintId: 's1' } } as any, scope);
    expect(burndown).toHaveBeenCalledWith('s1');
  });
  it('velocity card calls velocity(projectId, numSprints)', async () => {
    await svc.resolve({ type: 'velocity', config: { projectId: 'p1', numSprints: 6 } } as any, scope);
    expect(velocity).toHaveBeenCalledWith('p1', 6);
  });
  it('burnup card calls burnup(sprintId)', async () => {
    await svc.resolve({ type: 'burnup', config: { sprintId: 's1' } } as any, scope);
    expect(burnup).toHaveBeenCalledWith('s1');
  });
  it('cumulative_flow card calls cumulativeFlow(scopeType, scopeId, weeks)', async () => {
    await svc.resolve({ type: 'cumulative_flow', config: { scopeType: 'space', scopeId: 'sp1', weeks: 8 } } as any, scope);
    expect(cumulativeFlow).toHaveBeenCalledWith('space', 'sp1', 8);
  });
  it('lead_cycle_time card calls leadCycleTime(scopeType, scopeId, weeks)', async () => {
    await svc.resolve({ type: 'lead_cycle_time', config: { scopeType: 'space', scopeId: 'sp1', weeks: 12 } } as any, scope);
    expect(leadCycleTime).toHaveBeenCalledWith('space', 'sp1', 12);
  });
  it('sprint_summary card calls sprintSummary(sprintId)', async () => {
    await svc.resolve({ type: 'sprint_summary', config: { sprintId: 's1' } } as any, scope);
    expect(sprintSummary).toHaveBeenCalledWith('s1');
  });
  it('portfolio card calls portfolio(scopeType, scopeIds)', async () => {
    await svc.resolve({ type: 'portfolio', config: { scopeType: 'folder', scopeIds: ['f1', 'f2'] } } as any, scope);
    expect(portfolio).toHaveBeenCalledWith('folder', ['f1', 'f2']);
  });
  it('timesheet card calls the Phase-8 worklog rollup', async () => {
    await svc.resolve({ type: 'timesheet', config: { taskId: 't1' } } as any, scope);
    expect(getRollup).toHaveBeenCalled();
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- card.analytics`. Expected: FAIL — the new card types are unhandled (default branch / throw).

- [ ] Add the nine card-type branches to `card.service.ts`'s dispatcher. Insert these into the existing `resolve(...)` switch/dispatch (alongside the 9a `task_list`/`calculation`/`bar`/`line`/`pie`/`time_tracked`/`goal` branches). The exact wrapper (`{ type, data }`) must match 9a's; the source calls are:

```ts
      case 'burndown':
        return { type: card.type, data: await this.reports.burndown(card.config.sprintId) };

      case 'velocity':
        return { type: card.type, data: await this.reports.velocity(card.config.projectId, card.config.numSprints ?? 5) };

      case 'burnup':
        return { type: card.type, data: await this.reports.burnup(card.config.sprintId) };

      case 'cumulative_flow':
        return { type: card.type, data: await this.reports.cumulativeFlow(card.config.scopeType, card.config.scopeId, card.config.weeks ?? 8) };

      case 'lead_cycle_time':
        return { type: card.type, data: await this.reports.leadCycleTime(card.config.scopeType, card.config.scopeId, card.config.weeks ?? 12) };

      case 'sprint_summary':
        return { type: card.type, data: await this.reports.sprintSummary(card.config.sprintId) };

      case 'portfolio':
        return { type: card.type, data: await this.reports.portfolio(card.config.scopeType, card.config.scopeIds ?? []) };

      case 'timesheet':
        // Entity card → Phase-8 worklog rollup for the configured task (or scope).
        return { type: card.type, data: await this.worklogs.getRollup(card.config.taskId) };

      case 'battery':
        // A progress "battery": aggregate progress vs target. Reuses the same
        // generic-card aggregation path 9a's `calculation` card uses (count/sum
        // of a progress field over the compiled query), surfaced as { value, target }.
        return { type: card.type, data: await this.resolveBattery(card, scope) };
```

Add the service handles to the class (mirroring how 9a wires its report/worklog dependencies) and a small `resolveBattery` helper that reuses the 9a generic aggregation:

```ts
  private readonly reports = new ReportsService();
  private readonly worklogs = new WorkLogService();

  /** Battery card: aggregate progress (0–100) vs target via the generic
   *  calculation path, returning { value, target } the BatteryCard renders. */
  private async resolveBattery(card: any, scope: any): Promise<{ value: number; target: number }> {
    const value = await this.calculateAggregate(card.config, scope);  // 9a helper
    const target = card.config.target ?? 100;
    return { value: Math.round(value), target };
  }
```

(Import `ReportsService` from `../reports/reports.service.js` and `WorkLogService` from `../worklogs/worklog.service.js`. `calculateAggregate` is the 9a generic-aggregation helper — reuse it by its real name; if the 9a aggregation entry point differs, call that instead. Note inline if a referenced 9a helper does not exist.)

- [ ] Run: `npm test --workspace apps/api -- card.analytics`. Expected: PASS (8 tests). Then `npm run build --workspace apps/api`. Expected: PASS.

- [ ] Commit:
```
git add apps/api/src/modules/dashboards/card.service.ts apps/api/src/modules/dashboards/__tests__/card.analytics.unit.test.ts
git commit -m "feat(9b): card.service — burndown/velocity/burnup/cumulative_flow/lead_cycle_time/sprint_summary/portfolio/timesheet/battery branches"
```

---

### Task 9: New chart components (BurnupChart, CumulativeFlowChart, LeadCycleTimeChart)

**Files:**
- Create: `apps/next-web/src/components/charts/BurnupChart.tsx`
- Create: `apps/next-web/src/components/charts/CumulativeFlowChart.tsx`
- Create: `apps/next-web/src/components/charts/LeadCycleTimeChart.tsx`
- Note: read `node_modules/next/dist/docs/` per `apps/next-web/AGENTS.md` before writing web code (this Next.js has breaking changes).

Steps:

- [ ] Write `BurnupChart.tsx` — mirror `BurndownChart.tsx`'s structure (`'use client'`, `useTranslations('Charts')`, Recharts `LineChart`, dark-theme tokens), but plot completed vs scope:

```tsx
'use client';

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useTranslations } from 'next-intl';
import type { BurnupReport } from '@projectflow/types';

interface Props {
  data: BurnupReport;
}

export function BurnupChart({ data }: Props) {
  const t = useTranslations('Charts');

  const chartData = data.points.map(p => ({
    date:      p.date ?? '',
    completed: p.completedPoints,
    scope:     p.scopePoints,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8892b0' }} tickFormatter={d => d.slice(5)} />
        <YAxis tick={{ fontSize: 11, fill: '#8892b0' }} />
        <Tooltip
          contentStyle={{ background: '#1e2030', border: '1px solid #2d3250', borderRadius: 8 }}
          labelStyle={{ color: '#cdd6f4', fontWeight: 600 }}
          itemStyle={{ color: '#cdd6f4' }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: '#8892b0' }} />
        <Line type="monotone" dataKey="scope"     name={t('scope')}     stroke="#3b4261" strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
        <Line type="monotone" dataKey="completed" name={t('completed')} stroke="#6c63ff" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

- [ ] Write `CumulativeFlowChart.tsx` — a stacked area of status-band counts over time. It pivots the long `CumulativeFlowEntry[]` into the wide per-date series client-side (reusing the same logic as the API helper, kept inline here so the client bundle has no server import):

```tsx
'use client';

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useTranslations } from 'next-intl';
import type { CumulativeFlowEntry } from '@projectflow/types';

interface Props {
  data: CumulativeFlowEntry[];
}

const COLORS = ['#6c63ff', '#89b4fa', '#a6e3a1', '#f9e2af', '#f38ba8', '#cba6f7'];

/** Pivot long (date,status,count) entries into a wide per-date series, every band filled. */
function pivot(entries: CumulativeFlowEntry[]): { statuses: string[]; rows: Array<Record<string, number | string>> } {
  const statuses: string[] = [];
  const byDate = new Map<string, Record<string, number | string>>();
  for (const e of entries) {
    if (!statuses.includes(e.status)) statuses.push(e.status);
    const key = e.date ?? '';
    let row = byDate.get(key);
    if (!row) { row = { date: key }; byDate.set(key, row); }
    row[e.status] = e.issueCount;
  }
  const rows = [...byDate.values()].map(r => {
    for (const s of statuses) if (r[s] === undefined) r[s] = 0;
    return r;
  });
  return { statuses, rows };
}

export function CumulativeFlowChart({ data }: Props) {
  const t = useTranslations('Charts');
  const { statuses, rows } = pivot(data);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8892b0' }} tickFormatter={d => String(d).slice(5)} />
        <YAxis tick={{ fontSize: 11, fill: '#8892b0' }} />
        <Tooltip
          contentStyle={{ background: '#1e2030', border: '1px solid #2d3250', borderRadius: 8 }}
          labelStyle={{ color: '#cdd6f4', fontWeight: 600 }}
          itemStyle={{ color: '#cdd6f4' }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: '#8892b0' }} />
        {statuses.map((s, i) => (
          <Area key={s} type="monotone" dataKey={s} name={s} stackId="1"
                stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.5} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

(The unused `t` import keeps the file consistent with the other charts; if the linter flags it, drop the `useTranslations` line — the band names here are raw statuses, not i18n keys.)

- [ ] Write `LeadCycleTimeChart.tsx` — a horizontal bar per task of lead vs cycle time, in hours (seconds → hours client-side):

```tsx
'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useTranslations } from 'next-intl';
import type { LeadCycleTimeReport } from '@projectflow/types';

interface Props {
  data: LeadCycleTimeReport;
}

const toHours = (s: number | null) => (s === null ? 0 : Math.round((s / 3600) * 10) / 10);

export function LeadCycleTimeChart({ data }: Props) {
  const t = useTranslations('Charts');

  const chartData = data.tasks.map(task => ({
    issue: task.issueKey,
    lead:  toHours(task.leadTimeSeconds),
    cycle: toHours(task.cycleTimeSeconds),
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 16, left: 24, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis type="number" tick={{ fontSize: 11, fill: '#8892b0' }} />
        <YAxis type="category" dataKey="issue" tick={{ fontSize: 11, fill: '#8892b0' }} width={80} />
        <Tooltip
          contentStyle={{ background: '#1e2030', border: '1px solid #2d3250', borderRadius: 8 }}
          labelStyle={{ color: '#cdd6f4', fontWeight: 600 }}
          itemStyle={{ color: '#cdd6f4' }}
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: '#8892b0' }} />
        <Bar dataKey="lead"  name={t('leadTime')}  fill="#3b4261" radius={[0, 3, 3, 0]} />
        <Bar dataKey="cycle" name={t('cycleTime')} fill="#6c63ff" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] Run: `npm run build --workspace apps/next-web` (Next build / tsc). Expected: PASS — the three components compile against the new types.

- [ ] Commit:
```
git add apps/next-web/src/components/charts/BurnupChart.tsx apps/next-web/src/components/charts/CumulativeFlowChart.tsx apps/next-web/src/components/charts/LeadCycleTimeChart.tsx
git commit -m "feat(9b): chart components — BurnupChart, CumulativeFlowChart, LeadCycleTimeChart"
```

---

### Task 10: New card renderers (PortfolioCard, BatteryCard, TimesheetCard) + registry + i18n

**Files:**
- Create: `apps/next-web/src/components/charts/PortfolioCard.tsx`
- Create: `apps/next-web/src/components/charts/BatteryCard.tsx`
- Create: `apps/next-web/src/components/charts/TimesheetCard.tsx`
- Modify: the 9a card renderer registry (e.g. `apps/next-web/src/components/dashboards/card-renderers.tsx` — adapt to the real 9a filename) to register all six new renderers + the three Task-9 charts
- Modify: `apps/next-web/messages/en.json` (extend `Charts`, add `Cards`)
- Modify: `apps/next-web/messages/id.json` (same keys, real Indonesian)

Steps:

- [ ] Write `PortfolioCard.tsx` — a per-scope rollup table with progress bars + on-track badges (no Recharts needed; a compact grid):

```tsx
'use client';

import { useTranslations } from 'next-intl';
import type { PortfolioEntry } from '@projectflow/types';

interface Props {
  data: PortfolioEntry[];
}

export function PortfolioCard({ data }: Props) {
  const t = useTranslations('Cards');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.map(s => (
        <div key={s.scopeId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: '0 0 120px', fontSize: 13, color: '#cdd6f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {s.scopeName}
          </span>
          <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#1e2030', overflow: 'hidden' }}>
            <div style={{ width: `${s.progressPct}%`, height: '100%', background: s.onTrack ? '#a6e3a1' : '#f38ba8' }} />
          </div>
          <span style={{ flex: '0 0 40px', fontSize: 12, color: '#8892b0', textAlign: 'right' }}>{s.progressPct}%</span>
          <span style={{
            flex: '0 0 auto', fontSize: 11, padding: '2px 8px', borderRadius: 6,
            background: s.onTrack ? 'rgba(166,227,161,0.15)' : 'rgba(243,139,168,0.15)',
            color: s.onTrack ? '#a6e3a1' : '#f38ba8',
          }}>
            {s.onTrack ? t('onTrack') : t('behind')}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] Write `BatteryCard.tsx` — a progress "battery" (value vs target):

```tsx
'use client';

import { useTranslations } from 'next-intl';

interface Props {
  data: { value: number; target: number };
}

export function BatteryCard({ data }: Props) {
  const t = useTranslations('Cards');
  const pct = data.target > 0 ? Math.min(100, Math.round((data.value / data.target) * 100)) : 0;
  const color = pct >= 100 ? '#a6e3a1' : pct >= 50 ? '#f9e2af' : '#f38ba8';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div style={{ position: 'relative', width: 120, height: 56, border: '3px solid #3b4261', borderRadius: 8, padding: 4 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width .3s' }} />
        <div style={{ position: 'absolute', right: -8, top: 18, width: 5, height: 20, background: '#3b4261', borderRadius: 2 }} />
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#cdd6f4' }}>{pct}%</div>
      <div style={{ fontSize: 11, color: '#8892b0' }}>{t('ofTarget', { value: data.value, target: data.target })}</div>
    </div>
  );
}
```

- [ ] Write `TimesheetCard.tsx` — a compact logged-time summary from the Phase-8 worklog rollup (`rollupLoggedSeconds`):

```tsx
'use client';

import { useTranslations } from 'next-intl';

interface Props {
  data: { ownLoggedSeconds?: number; rollupLoggedSeconds: number; rollupEstimateSeconds?: number };
}

const fmtHrs = (s: number) => `${Math.round((s / 3600) * 10) / 10}h`;

export function TimesheetCard({ data }: Props) {
  const t = useTranslations('Cards');
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', height: '100%' }}>
      <div>
        <div style={{ fontSize: 11, color: '#8892b0' }}>{t('logged')}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#cdd6f4' }}>{fmtHrs(data.rollupLoggedSeconds)}</div>
      </div>
      {data.rollupEstimateSeconds !== undefined && (
        <div>
          <div style={{ fontSize: 11, color: '#8892b0' }}>{t('estimate')}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#cdd6f4' }}>{fmtHrs(data.rollupEstimateSeconds)}</div>
        </div>
      )}
    </div>
  );
}
```

- [ ] Register all renderers in the 9a card renderer registry. Read the 9a registry file first to learn its exact shape (a `Record<CardType, (data) => JSX>` map or a `switch`), then add the nine 9b card types. Conceptually:

```tsx
import { BurndownChart } from '@/components/charts/BurndownChart';
import { VelocityChart } from '@/components/charts/VelocityChart';
import { SprintSummaryWidget } from '@/components/charts/SprintSummaryWidget';
import { BurnupChart } from '@/components/charts/BurnupChart';
import { CumulativeFlowChart } from '@/components/charts/CumulativeFlowChart';
import { LeadCycleTimeChart } from '@/components/charts/LeadCycleTimeChart';
import { PortfolioCard } from '@/components/charts/PortfolioCard';
import { BatteryCard } from '@/components/charts/BatteryCard';
import { TimesheetCard } from '@/components/charts/TimesheetCard';

// add to the 9a registry map:
//   burndown:        (d) => <BurndownChart data={d} />,
//   velocity:        (d) => <VelocityChart data={d} />,
//   sprint_summary:  (d) => <SprintSummaryWidget data={d} />,
//   burnup:          (d) => <BurnupChart data={d} />,
//   cumulative_flow: (d) => <CumulativeFlowChart data={d} />,
//   lead_cycle_time: (d) => <LeadCycleTimeChart data={d} />,
//   portfolio:       (d) => <PortfolioCard data={d} />,
//   battery:         (d) => <BatteryCard data={d} />,
//   timesheet:       (d) => <TimesheetCard data={d} />,
```

(Use the EXACT registry seam 9a established — match its key style and prop contract. Note inline if the 9a registry file/shape differs.)

- [ ] Add the card-config editors for the new params. Read the 9a card-config editor seam and add editors exposing: a **sprint picker** (burndown/velocity/burnup/sprint_summary), a **scope-set picker** (portfolio: multi-select folders/lists; cumulative_flow/lead_cycle_time: single scope + week range), and a **target field** (battery). Reuse the 9a filter-builder/scope-picker components where present.

- [ ] Extend i18n. In `apps/next-web/messages/en.json`, add the new `Charts` keys and a new `Cards` namespace (merge into the existing `Charts` block at line ~1291; do not drop existing keys):

```json
"Charts": {
  "scope": "Scope",
  "leadTime": "Lead time (h)",
  "cycleTime": "Cycle time (h)"
},
"Cards": {
  "burndown": "Burndown",
  "velocity": "Velocity",
  "burnup": "Burnup",
  "cumulativeFlow": "Cumulative flow",
  "leadCycleTime": "Lead / cycle time",
  "sprintSummary": "Sprint summary",
  "portfolio": "Portfolio",
  "timesheet": "Timesheet",
  "battery": "Progress battery",
  "onTrack": "On track",
  "behind": "Behind",
  "ofTarget": "{value} of {target}",
  "logged": "Logged",
  "estimate": "Estimate",
  "configSprint": "Sprint",
  "configScope": "Scope",
  "configWeeks": "Weeks",
  "configTarget": "Target"
}
```

(The three `Charts` keys above are *additions* — merge them into the existing `Charts` object, keeping `remaining`/`ideal`/`committed`/`completed`/etc.)

- [ ] Add the same keys to `apps/next-web/messages/id.json` with real Indonesian:

```json
"Charts": {
  "scope": "Cakupan",
  "leadTime": "Waktu tunggu (j)",
  "cycleTime": "Waktu siklus (j)"
},
"Cards": {
  "burndown": "Burndown",
  "velocity": "Kecepatan",
  "burnup": "Burnup",
  "cumulativeFlow": "Aliran kumulatif",
  "leadCycleTime": "Waktu tunggu / siklus",
  "sprintSummary": "Ringkasan sprint",
  "portfolio": "Portofolio",
  "timesheet": "Lembar waktu",
  "battery": "Baterai progres",
  "onTrack": "Sesuai rencana",
  "behind": "Tertinggal",
  "ofTarget": "{value} dari {target}",
  "logged": "Tercatat",
  "estimate": "Estimasi",
  "configSprint": "Sprint",
  "configScope": "Cakupan",
  "configWeeks": "Minggu",
  "configTarget": "Target"
}
```

- [ ] Run: `npm test --workspace apps/next-web` (includes the `messages.unit` i18n parity test at `apps/next-web/src/i18n/__tests__/messages.unit.test.ts`). Expected: PASS — en/id key parity green. Then `npm run build --workspace apps/next-web`. Expected: PASS.

- [ ] Commit:
```
git add apps/next-web/src/components/charts/PortfolioCard.tsx apps/next-web/src/components/charts/BatteryCard.tsx apps/next-web/src/components/charts/TimesheetCard.tsx apps/next-web/src/components/dashboards apps/next-web/messages/en.json apps/next-web/messages/id.json
git commit -m "feat(9b): card renderers (Portfolio/Battery/Timesheet) + registry/config editors + i18n"
```

---

### Task 11: Playwright e2e (burndown + velocity + portfolio cards on a dashboard)

**Files:**
- Create: `apps/next-web/e2e/dashboard-analytics.spec.ts`
- Note: e2e runs against local Docker `ProjectFlow_Test` only (same env/setup as the views/realtime specs).

Steps:

- [ ] Write the e2e spec covering the §5.4/§5.5 acceptance flow — on a dashboard (the 9a-created object), add a **burndown**, a **velocity**, and a **portfolio** card, and assert each renders values reflecting real seeded sprint data. Follow the existing spec harness (login + seed helpers used by the dashboard/views specs; seed a sprint with resolved tasks so burndown/velocity have data):

```ts
import { test, expect } from '@playwright/test';
import { loginAndSeedSprintDashboard } from './helpers'; // existing/9a helper — seeds a sprint + a dashboard

test.describe('Phase 9b — analytics cards', () => {
  test('burndown, velocity, and portfolio cards render real sprint data on a dashboard', async ({ page }) => {
    const { dashboardUrl } = await loginAndSeedSprintDashboard(page);
    await page.goto(dashboardUrl);

    // Add a burndown card.
    await page.getByRole('button', { name: /add card/i }).click();
    await page.getByRole('option', { name: /burndown/i }).click();
    // configure: pick the seeded sprint
    await page.getByLabel(/sprint/i).selectOption({ label: 'S1' });
    await page.getByRole('button', { name: /save|add/i }).click();
    await expect(page.locator('[data-card-type="burndown"]')).toBeVisible();
    // Recharts renders an SVG line for the burndown series.
    await expect(page.locator('[data-card-type="burndown"] svg .recharts-line').first()).toBeVisible();

    // Add a velocity card.
    await page.getByRole('button', { name: /add card/i }).click();
    await page.getByRole('option', { name: /velocity/i }).click();
    await page.getByRole('button', { name: /save|add/i }).click();
    await expect(page.locator('[data-card-type="velocity"]')).toBeVisible();
    // velocity bars reflect committed vs completed (two series → ≥2 bars).
    await expect(page.locator('[data-card-type="velocity"] svg .recharts-bar-rectangle').first()).toBeVisible();

    // Add a portfolio card across the seeded scopes.
    await page.getByRole('button', { name: /add card/i }).click();
    await page.getByRole('option', { name: /portfolio/i }).click();
    await page.getByRole('button', { name: /save|add/i }).click();
    await expect(page.locator('[data-card-type="portfolio"]')).toBeVisible();
    // The portfolio shows an on-track / behind badge per scope.
    await expect(page.locator('[data-card-type="portfolio"]').getByText(/on track|behind/i).first()).toBeVisible();
  });
});
```

(Ensure each rendered card root carries `data-card-type={card.type}` — add it in the 9a card frame/renderer wrapper if 9a doesn't already, so the e2e can target cards deterministically. Note inline if 9a already provides this hook.)

- [ ] Run: the project's single-spec e2e command against `ProjectFlow_Test` (same invocation the views/realtime specs use, e.g. `npx playwright test e2e/dashboard-analytics.spec.ts`). Expected: PASS (1 test) — three cards added, each rendering real data.

- [ ] Commit:
```
git add apps/next-web/e2e/dashboard-analytics.spec.ts apps/next-web/src/components/dashboards
git commit -m "test(9b): e2e — burndown + velocity + portfolio cards render real sprint data on a dashboard"
```

---

### Task 12: Slice verification + DECISIONS.md

**Files:**
- Modify: `DECISIONS.md` (append a Phase 9b entry)

Steps:

- [ ] Run the full slice verification on local Docker `ProjectFlow_Test`:
  - `npm test --workspace apps/api` — Expected: PASS (existing suite + new `analytics`/`card.analytics` unit tests).
  - `npm run test:integration --workspace apps/api` — Expected: PASS (existing + `reports.integration.test.ts`).
  - `npm test --workspace apps/next-web` — Expected: PASS (unit + `messages.unit` parity).
  - `npm run build --workspace apps/api` and `npm run build --workspace apps/next-web` — Expected: both PASS.
  - The `dashboard-analytics` e2e — Expected: PASS.

- [ ] Append a `DECISIONS.md` entry logging: the four new report SPs (and that 9b adds **no migration** — they read existing columns); the burnup-as-complement-of-burndown formulation; the cumulative-flow v1 band derivation (`ResolvedAt` → DONE, else current `Status`) with the `AuditLog` per-status-history follow-up deferred (spec §11.6); the lead/cycle-time `AuditLog`-sourced "started" timestamp + `CreatedAt` fallback; the portfolio scope-set comma-delimited `@ScopeIds` transport (same as `usp_WorkLogTag_Set`) + the v1 on-track heuristic (progress ≥ 50%, empty scope = on-track) computed in `analytics.ts`; the new GraphQL reports mirror (all nine queries, `report.read`-gated, portfolio cross-workspace fail-closed); the nine `card.service` branches; and any deviation found wiring into the 9a `card.service`/registry seams. DB-execution-policy note: all DB work ran ONLY against local Docker `ProjectFlow_Test`.

- [ ] Commit:
```
git add DECISIONS.md
git commit -m "docs(9b): DECISIONS entry — analytics SPs + reports GraphQL mirror + analytics/portfolio cards"
```

---

## Definition of Done

Per-slice DoD (spec §3) + BUILD_PLAN acceptance (spec §5.5):

- [ ] **BUILD_PLAN acceptance (§5.5):** Sprint **burndown + velocity compute correctly against real sprint data** — verified by `reports.integration.test.ts` (velocity committed=14/completed=12 on seeded data; GraphQL burndown matches REST) and the `dashboard-analytics` e2e (cards render real values).
- [ ] **No migration** added (spec §3/§5.1) — the four new report SPs read existing `dbo.Tasks`/`dbo.Sprints`/`dbo.AuditLog`/`dbo.Folders`/`dbo.Lists` columns only.
- [ ] Four new report SPs (`usp_Report_Burnup`, `usp_Report_CumulativeFlow`, `usp_Report_LeadCycleTime`, `usp_Report_Portfolio`) are `CREATE OR ALTER`, `SET NOCOUNT ON`, deployed via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`.
- [ ] REST routes added for all four; the reports module gains its **GraphQL mirror** (`registerReportsGraphql()`) with **all nine** queries (`burndown`/`velocity`/`sprintSummary`/`workload`/`createdVsResolved` + `burnup`/`cumulativeFlow`/`leadCycleTime`/`portfolio`) delegating to the **one shared `ReportsService`**, registered in `graphql/schema.ts`, gated on `report.read` (fail-closed; portfolio asserts a single workspace across the scope set).
- [ ] `card.service` extended with nine card-type branches (`burndown`, `velocity`, `burnup`, `cumulative_flow`, `lead_cycle_time`, `sprint_summary`, `portfolio`, `timesheet`, `battery`), each mapping to a report SP / Phase-8 service, consistent with the 9a dispatcher contract.
- [ ] New chart components (`BurnupChart`, `CumulativeFlowChart`, `LeadCycleTimeChart`, `PortfolioCard`, `BatteryCard`, `TimesheetCard`) registered into the 9a renderer registry; card-config editors expose sprint / scope-set / range / target params.
- [ ] Unit tests (burnup %, cumulative-flow pivot, lead/cycle averages, **portfolio rollup across multiple scopes**, card dispatch) + integration tests (GraphQL == REST; burndown/velocity vs seeded data) + ≥1 Playwright e2e (burndown + velocity + portfolio cards) — all green.
- [ ] `@projectflow/types` updated (`BurnupReport`/`BurnupPoint`, `CumulativeFlowEntry`, `LeadCycleTimeReport`/`LeadCycleTimeEntry`, `PortfolioEntry`, `CardType` additions).
- [ ] i18n: new `Charts` + `Cards` keys in **en.json + id.json** (real Indonesian); `messages.unit` parity green.
- [ ] All DB work (SP deploy, integration, e2e) ran **ONLY against local Docker `ProjectFlow_Test`** — never the prod-pointing `apps/api/.env`.
- [ ] `DECISIONS.md` entry logs the mechanism choices + any deviations. **Stop for review/merge before Slice 9c.**

---

## Self-Review

**Spec coverage (§5):**
- §5.1 (no new tables; four new report SPs) → File Structure states "9b adds NO migration"; Tasks 2–4 create `usp_Report_Burnup`/`_CumulativeFlow`/`_LeadCycleTime`/`_Portfolio` with full SQL.
- §5.2 (extend reports module + types; GraphQL mirror for ALL reports; new card types) → Task 1 adds `BurnupReport`/`CumulativeFlowEntry`/`LeadCycleTimeReport`/`PortfolioEntry`; Task 6 extends repo/service/REST; Task 7 mirrors all nine GraphQL queries (`burndown`/`velocity`/`sprintSummary`/`workload`/`createdVsResolved` + `burnup`/`cumulativeFlow`/`leadCycleTime`/`portfolio`); Task 8 adds the nine `card.service` branches (`burndown`/`velocity`/`burnup`/`cumulative_flow`/`lead_cycle_time`/`sprint_summary`/`portfolio`/`timesheet`/`battery`).
- §5.3 (new chart components + card-config editors) → Tasks 9–10 create `BurnupChart`/`CumulativeFlowChart`/`LeadCycleTimeChart`/`PortfolioCard`/`BatteryCard`/`TimesheetCard`, register them, and add config editors.
- §5.4 (unit: burnup/cumulative-flow/lead-cycle math + portfolio rollup across scopes; integration: GraphQL == REST + burndown/velocity vs seeded; e2e: burndown+velocity+portfolio cards) → Tasks 5, 7, 11 cover each exactly.
- §5.5 acceptance (sprint burndown + velocity compute correctly against real sprint data) → covered explicitly by the velocity (committed=14/completed=12) + burndown-matches-REST integration assertions and the e2e, called out in the DoD.
- §2.1/§4 (card.service dispatcher: generic → query compiler, report → SP, entity → Phase-8; portfolio spans multiple scopes; per-card filter AND dashboard scope) → Task 8 extends the 9a dispatcher with report-card and entity-card (`timesheet`) branches and the generic `battery` aggregation, keeping 9a's contract.
- §3 conventions (SP-per-op; dual REST+GraphQL over one service; `report.read` authz fail-closed; i18n en+id parity; DB only on `ProjectFlow_Test`) → reflected in every task and the DoD.

**Placeholder scan:** Full SQL is written for all four SPs (Tasks 2–4); the complete set of nine GraphQL report resolvers is written (Task 7, not "the rest similarly"); every new `card.service` branch is written (Task 8); all new report types are written (Task 1); each new chart/card component is written in full (Tasks 9–10). The only deliberately abstracted points are the **9a-owned seams** (`card.service.resolve` exact return wrapper, the renderer/config-editor registry filenames, and the `calculateAggregate` helper name) — each is flagged inline with "adapt to the real 9a seam / note inline if it differs," because 9a's plan isn't yet written and the spec defines only the contract, not the filenames. No "TODO"/"similarly"/"etc." stands in for required code.

**Type/name consistency:** SP names (`usp_Report_Burnup`/`_CumulativeFlow`/`_LeadCycleTime`/`_Portfolio`), GraphQL field names (`burnup`/`cumulativeFlow`/`leadCycleTime`/`portfolio` + the five existing), card-type tokens (`burndown`/`velocity`/`burnup`/`cumulative_flow`/`lead_cycle_time`/`sprint_summary`/`portfolio`/`timesheet`/`battery`), and new type names (`BurnupReport`/`CumulativeFlowEntry`/`LeadCycleTimeReport`/`PortfolioEntry`) match spec §5.2 verbatim. The new SPs reuse the existing report SPs' exact data sources and column casing (`Sprints.Id/Name/StartDate/EndDate/CompletedAt`, `Tasks.SprintId/StoryPoints/Status/ResolvedAt/CreatedAt/ListId/ProjectId/DeletedAt`, `AuditLog.Resource/Action/NewValues/CreatedAt`, `Folders.Id/Name/FolderId`, `Lists.Id/Name/FolderId/DeletedAt`) verified against migrations `0001`/`0015`/`0029`. The repository/service mirror the existing `execSp` (multi-set) / `execSpOne` (single-set) usage; the GraphQL mirror follows the `recurrence.schema.ts` `objectRef`+`builder.queryFields` pattern and `authz.ts` (`requireWorkspacePermission`/`notFound`); charts follow the existing Recharts components' `useTranslations('Charts')` + dark-theme tokens; i18n targets the real message path `apps/next-web/messages/{en,id}.json` and the `Charts` namespace at line ~1291.
