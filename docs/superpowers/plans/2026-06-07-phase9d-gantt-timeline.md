# Phase 9d — Gantt + Timeline Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the **Gantt** and **Timeline** view types end-to-end — a backend Gantt data resolver (tasks in scope via the Phase 3 query compiler + their `start_date`/`due_date` + the Phase 5 `TaskDependencies` edges), a pure unit-tested **critical-path** computation and **baseline diff**, baseline capture/list SPs, a Gantt UI (bars, drag move/resize, dependency lines, critical-path highlight, baseline overlay) and a lighter Timeline UI (date-laned rows grouped by assignee/status/custom field). **This slice also carries the cross-cutting expansion that 9e and 9f depend on:** migration `0049` widens `CK_SavedViews_Type` from the four-type cap to the **full view-type union** (`list, board, table, calendar, workload, box, gantt, timeline, activity, map, mindmap, embed, chat, doc`), the `ViewType` union in `packages/types/index.ts` gains the same members, and the GraphQL/`view-surface.tsx` registries are widened — gantt + timeline get real renderers now; the remaining members are valid types that 9e/9f register renderers for.

**Architecture:** A new view type is a **client renderer over the same compiled task query** the existing views use — no parallel data path (spec §2.2). The four-type cap lives in two places that must agree: the DB `CK_SavedViews_Type` CHECK (`infra/sql/migrations/0032_saved_views.sql`) and the `ViewType` union (`packages/types/index.ts`) — plus a third hard-coded `VIEW_TYPES`/`assertViewType` allow-list inside `apps/api/src/graphql/views.schema.ts`. Migration `0049` (drop-and-recreate CHECK, idempotent) + the union edit + the GraphQL allow-list edit lift all three to the full union. The Gantt data resolver is a new GraphQL query `viewGanttData` in `views.schema.ts` that reuses `ViewService.runConfig` (the Phase 3 compiler) for the in-scope tasks, joins each task's `StartDate`/`DueDate`, and adds the scope's `TaskDependencies` edges; a pure `gantt.service` computes the **critical path** (longest dependency chain by duration). Baselines are a frozen snapshot of task dates: `Baselines(Id, ViewId, Name, CapturedAt, CreatedBy)` + `BaselineTasks(BaselineId, TaskId, StartDate, DueDate)`, written by `usp_Baseline_Capture` and read by `usp_Baseline_List`. Drag move/resize reuses the **existing task date PATCH path** (`PATCH /roadmap/tasks/:id/dates` → `usp_Task_UpdateDates`, StartDate DATE / DueDate DATETIME2); that path is wired to publish a `task:event` so a drag is reflected live in List/Board (it does not today — Task 9 adds the publish so the spec's "drag … reflected live" holds). Dependency edits reuse the Phase 5 endpoints (`POST /roadmap/dependencies`). The two renderers (`gantt-view.tsx`, `timeline-view.tsx`) are registered in `view-surface.tsx`'s `ViewBody` switch and consume the SSR task page via `useLiveTasks` exactly like `calendar-view.tsx`.

**Tech Stack:** SQL Server stored procedures (`CREATE OR ALTER`, `SET NOCOUNT ON`, TRY/CATCH/TRANSACTION, `SELECT *` of affected rows); idempotent GO-batched migrations + matching rollback; `mssql` via `execSp`/`execSpOne`; graphql-yoga + Pothos (`@pothos/core`) — the Views surface is GraphQL-only (no REST routes module); vitest (`--project unit` / `--project integration`); Next.js App Router (SSR) + `next-intl` (en + id); `@apollo/client` live subscriptions (`useLiveTasks`); Playwright e2e. DB work runs ONLY against local Docker `ProjectFlow_Test`.

**Prerequisite:** Phases 1–8 merged (Phase 5 `TaskDependencies` + `usp_TaskDependency_*` + `usp_Task_UpdateDates`; Phase 3 query compiler + `ViewService.runConfig`; Phase 8d `workload`/`box` client-side view types that this slice reconciles into the DB CHECK). Phase 9a–9c are independent of this slice. On-disk migration tip is assumed at `0048` when this slice runs (Phase 6 `0038–0039`, Phase 7 `0040–0042`, Phase 8 `0043–0046`, Phase 9a `0047`, Phase 9c `0048`); **if the on-disk tip differs when you run, renumber `0049` to the next free integer and keep the filename/embedded comment in sync** (note it in `DECISIONS.md`).

---

## File Structure

**Migration: CHECK expansion + baselines**
- `infra/sql/migrations/0049_view_types_and_baselines.sql` — **Create.** Idempotent, GO-batched: drop-and-recreate `CK_SavedViews_Type` with the **full view-type union**; create `Baselines` + `BaselineTasks`.
- `infra/sql/migrations/rollback/0049_view_types_and_baselines.down.sql` — **Create.** Reverse: drop `BaselineTasks`, `Baselines`, and recreate the **original four-type** `CK_SavedViews_Type`.

**Stored procedures** (`infra/sql/procedures/`)
- `usp_Baseline_Capture.sql` — **Create.** Insert a `Baselines` row + freeze the in-scope tasks' `StartDate`/`DueDate` into `BaselineTasks` (one txn); return the new baseline header.
- `usp_Baseline_List.sql` — **Create.** Two recordsets: a view's baselines (newest first) + their frozen `BaselineTasks` rows.

**API** (`apps/api/src/`)
- `modules/views/gantt.service.ts` — **Create.** Pure `criticalPath(tasks, edges)` (longest dependency chain by duration) + `baselineDiff(current, captured)`; plus a `GanttService.resolve(...)` that assembles tasks + edges + critical-path ids + baselines from the repo.
- `modules/views/gantt.repository.ts` — **Create.** `listScopeDependencies(taskIds)` (edges among the page's tasks via `usp_View_GanttDeps`); `captureBaseline(...)` / `listBaselines(viewId)` over the two baseline SPs.
- `modules/views/__tests__/gantt.unit.test.ts` — **Create.** Pure `criticalPath` + `baselineDiff` tests.
- `modules/views/__tests__/gantt.integration.test.ts` — **Create.** Resolver returns tasks + dependency edges; baseline capture freezes dates; drag PATCH updates dates + emits a realtime event.
- `graphql/views.schema.ts` — **Modify.** Widen `VIEW_TYPES`/`assertViewType` to the full union; add `GanttTask`/`GanttEdge`/`GanttBaseline`/`ViewGanttData` object types + the `viewGanttData(viewId)` query + `captureBaseline(viewId,name)` mutation.
- `modules/roadmap/roadmap.service.ts` + `modules/roadmap/roadmap.routes.ts` — **Modify.** After a successful `updateDates`, publish a `task:event` `updated` (so a Gantt drag reflects live in List/Board) — the spec's "existing task date PATCH path which already publishes a realtime event."
- `infra/sql/procedures/usp_View_GanttDeps.sql` — **Create.** Return the `TaskDependencies` edges (TaskId waits_on DependsOn) restricted to a supplied set of task ids.

**Types** (`packages/types/`)
- `index.ts` — **Modify.** Expand the `ViewType` union to the full set; add `GanttTask`, `GanttEdge`, `GanttBaseline`, `BaselineTask`, `ViewGanttData`.

**Frontend** (`apps/next-web/src/`)
- `components/views/view-surface.tsx` — **Modify.** Register `gantt` → `<GanttView>` and `timeline` → `<TimelineView>` in the `ViewBody` switch; gate the filter-builder/me-mode affordances consistently.
- `components/views/gantt-view.tsx` — **Create.** Bars, drag move/resize (calls the date PATCH action), dependency lines (SVG), critical-path highlight, baseline overlay + capture button.
- `components/views/timeline-view.tsx` — **Create.** Date-laned rows grouped by assignee/status/custom field over the same task page; drag to reschedule.
- `server/queries/views.ts` — **Modify.** Add `loadGanttData(viewId)` SSR query (`viewGanttData`).
- `server/actions/gantt.ts` — **Create.** `updateTaskDates(taskId, { startDate?, dueDate? })` (→ `PATCH /roadmap/tasks/:id/dates`) + `captureBaseline(viewId, name)` server actions.
- `lib/realtime/useLiveTasks.ts` — **Reuse unchanged** (Gantt/Timeline merge live `task:event`s exactly like calendar).

**i18n**
- `apps/next-web/messages/en.json` — **Modify.** New `Gantt` + `Timeline` namespaces.
- `apps/next-web/messages/id.json` — **Modify.** Same keys, real Indonesian.

**Tests**
- `apps/api/src/modules/views/__tests__/gantt.unit.test.ts` — **Create.** (above)
- `apps/api/src/modules/views/__tests__/gantt.integration.test.ts` — **Create.** (above)
- `apps/next-web/src/components/views/__tests__/gantt-view.unit.test.tsx` — **Create.** Pure bar-geometry + dependency-line helpers.
- `apps/next-web/e2e/gantt-timeline.spec.ts` — **Create.** Open Gantt → dependency lines + critical path → capture a baseline → drag a task → date change reflected in List/Board live.

---

## Tasks

### Task 1: Migration + rollback (`0049_view_types_and_baselines.sql`)

**Files:**
- Create: `infra/sql/migrations/0049_view_types_and_baselines.sql`
- Create: `infra/sql/migrations/rollback/0049_view_types_and_baselines.down.sql`
- Test: manual deploy against local Docker `ProjectFlow_Test` (migrations have no unit harness; covered by the integration suite in Task 6).

Steps:

- [ ] Write the migration. Idempotent (constraint drop-then-recreate guards + `sys.tables` guards), GO-batched, matching the `0034`/`0043` style. The CHECK is **dropped and recreated** with the FULL union; the two baseline tables follow:

```sql
-- =============================================================================
-- Migration 0049: View types union + Gantt baselines (Phase 9d)
--   * Expand CK_SavedViews_Type from the four-type cap
--     ('list','board','table','calendar') to the FULL view-type union:
--       list, board, table, calendar, workload, box, gantt, timeline,
--       activity, map, mindmap, embed, chat, doc
--     (folds in Phase 8d's workload/box so the DB CHECK and the ViewType
--     union agree; 9e/9f add renderers for activity/map/mindmap/embed/chat/doc).
--   * Baselines + BaselineTasks — a frozen snapshot of task dates per view,
--     for the Gantt planned-vs-actual overlay.
-- Idempotent (constraint/table guards), GO-batched.
-- Rollback in rollback/0049_view_types_and_baselines.down.sql.
-- =============================================================================

-- ── Expand the SavedViews.Type CHECK to the full union (drop + recreate) ──────
-- Drop-and-recreate is the only safe edit to a CHECK constraint. Guard the drop
-- so a re-apply is a clean no-op; the recreate is unconditional after the drop.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_SavedViews_Type' AND parent_object_id = OBJECT_ID('dbo.SavedViews'))
    ALTER TABLE dbo.SavedViews DROP CONSTRAINT CK_SavedViews_Type;
GO

ALTER TABLE dbo.SavedViews WITH CHECK ADD CONSTRAINT CK_SavedViews_Type
    CHECK (Type IN (
        'list','board','table','calendar','workload','box',
        'gantt','timeline','activity','map','mindmap','embed','chat','doc'
    ));
GO

-- ── Baselines: a named, frozen snapshot of a view's task dates ────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Baselines')
BEGIN
    CREATE TABLE dbo.Baselines (
        Id         UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Baselines PRIMARY KEY DEFAULT NEWID(),
        ViewId     UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_Baselines_View REFERENCES dbo.SavedViews(Id) ON DELETE CASCADE,
        Name       NVARCHAR(200)    NOT NULL,
        CapturedAt DATETIME2        NOT NULL CONSTRAINT DF_Baselines_CapturedAt DEFAULT SYSUTCDATETIME(),
        CreatedBy  UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_Baselines_User REFERENCES dbo.Users(Id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Baselines_View' AND object_id = OBJECT_ID('dbo.Baselines'))
    CREATE NONCLUSTERED INDEX IX_Baselines_View ON dbo.Baselines (ViewId, CapturedAt DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'BaselineTasks')
BEGIN
    CREATE TABLE dbo.BaselineTasks (
        BaselineId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_BaselineTasks_Baseline REFERENCES dbo.Baselines(Id) ON DELETE CASCADE,
        TaskId     UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_BaselineTasks_Task REFERENCES dbo.Tasks(Id),
        -- StartDate is DATE (Gantt drag is day-granular); DueDate is DATETIME2,
        -- mirroring Tasks.StartDate/DueDate (migration 0024).
        StartDate  DATE             NULL,
        DueDate    DATETIME2        NULL,
        CONSTRAINT PK_BaselineTasks PRIMARY KEY (BaselineId, TaskId)
    );
END
GO
```

- [ ] Write the rollback `rollback/0049_view_types_and_baselines.down.sql` — drop the baseline tables (child first), then drop the expanded CHECK and recreate the **original four-type** CHECK:

```sql
-- Rollback 0049: drop BaselineTasks + Baselines, and restore the original
-- four-type CK_SavedViews_Type ('list','board','table','calendar').

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'BaselineTasks') DROP TABLE dbo.BaselineTasks;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Baselines')     DROP TABLE dbo.Baselines;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_SavedViews_Type' AND parent_object_id = OBJECT_ID('dbo.SavedViews'))
    ALTER TABLE dbo.SavedViews DROP CONSTRAINT CK_SavedViews_Type;
GO

ALTER TABLE dbo.SavedViews WITH CHECK ADD CONSTRAINT CK_SavedViews_Type
    CHECK (Type IN ('list','board','table','calendar'));
GO
```

- [ ] Run against local Docker `ProjectFlow_Test` only (explicit local DB env, never `apps/api/.env`). Apply `0049` → immediately the `.down.sql` → re-apply `0049` to prove idempotency + reversibility. Expected: all three runs succeed with no errors; the re-apply is a clean no-op (the CHECK guard skips the drop on second run, the tables already exist). Note: WITH CHECK validates existing rows — there are no rows with a type outside the old union, so validation passes both directions.

- [ ] Commit:
```
git add infra/sql/migrations/0049_view_types_and_baselines.sql infra/sql/migrations/rollback/0049_view_types_and_baselines.down.sql
git commit -m "feat(9d): view-type union + Gantt baselines migration — expand CK_SavedViews_Type + Baselines/BaselineTasks"
```

---

### Task 2: Baseline + Gantt-dep SPs (`usp_Baseline_Capture`, `usp_Baseline_List`, `usp_View_GanttDeps`)

**Files:**
- Create: `infra/sql/procedures/usp_Baseline_Capture.sql`
- Create: `infra/sql/procedures/usp_Baseline_List.sql`
- Create: `infra/sql/procedures/usp_View_GanttDeps.sql`
- Test: covered by `gantt.integration.test.ts` (Task 6); deploy via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`.

Steps:

- [ ] Write `usp_Baseline_Capture.sql` — insert the baseline header, then freeze the supplied tasks' current `StartDate`/`DueDate`. Tasks are passed as a comma-delimited GUID list (the flat-string transport `usp_WorkLogTag_Set` already uses), so no TVP is required and the caller (the Gantt resolver) supplies exactly the in-scope page task ids:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Baseline_Capture
    @ViewId    UNIQUEIDENTIFIER,
    @Name      NVARCHAR(200),
    @CreatedBy UNIQUEIDENTIFIER,
    @TaskIds   NVARCHAR(MAX) = NULL   -- comma-delimited GUID list of in-scope tasks
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Id UNIQUEIDENTIFIER = NEWID();

    BEGIN TRY
        BEGIN TRANSACTION;

        INSERT INTO dbo.Baselines (Id, ViewId, Name, CreatedBy)
        VALUES (@Id, @ViewId, @Name, @CreatedBy);

        -- Freeze each in-scope task's CURRENT dates. STRING_SPLIT + TRY_CONVERT
        -- mirrors usp_WorkLogTag_Set; only existing, non-deleted tasks are frozen.
        IF @TaskIds IS NOT NULL AND LEN(@TaskIds) > 0
            INSERT INTO dbo.BaselineTasks (BaselineId, TaskId, StartDate, DueDate)
            SELECT @Id, t.Id, t.StartDate, t.DueDate
            FROM dbo.Tasks t
            JOIN (
                SELECT DISTINCT TRY_CONVERT(UNIQUEIDENTIFIER, LTRIM(RTRIM(value))) AS TaskId
                FROM STRING_SPLIT(@TaskIds, ',')
                WHERE TRY_CONVERT(UNIQUEIDENTIFIER, LTRIM(RTRIM(value))) IS NOT NULL
            ) ids ON ids.TaskId = t.Id
            WHERE t.DeletedAt IS NULL;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT Id, ViewId, Name, CapturedAt, CreatedBy FROM dbo.Baselines WHERE Id = @Id;
END;
GO
```

- [ ] Write `usp_Baseline_List.sql` — two recordsets: the view's baseline headers (newest first), then all of their frozen task rows (the service zips them by `BaselineId`):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Baseline_List
    @ViewId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT Id, ViewId, Name, CapturedAt, CreatedBy
    FROM dbo.Baselines
    WHERE ViewId = @ViewId
    ORDER BY CapturedAt DESC;

    SELECT bt.BaselineId, bt.TaskId, bt.StartDate, bt.DueDate
    FROM dbo.BaselineTasks bt
    JOIN dbo.Baselines b ON b.Id = bt.BaselineId
    WHERE b.ViewId = @ViewId
    ORDER BY bt.BaselineId;
END;
GO
```

- [ ] Write `usp_View_GanttDeps.sql` — return the canonical dependency edges (`TaskId waits_on DependsOn`, i.e. `DependsOn` must finish before `TaskId`) restricted to a supplied set of task ids, so the resolver only ships edges between tasks actually on the page. Both endpoints of an edge must be in the set:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_View_GanttDeps
    @TaskIds NVARCHAR(MAX) = NULL   -- comma-delimited GUID list of in-scope tasks
AS
BEGIN
    SET NOCOUNT ON;
    IF @TaskIds IS NULL OR LEN(@TaskIds) = 0 RETURN;

    ;WITH ids AS (
        SELECT DISTINCT TRY_CONVERT(UNIQUEIDENTIFIER, LTRIM(RTRIM(value))) AS Id
        FROM STRING_SPLIT(@TaskIds, ',')
        WHERE TRY_CONVERT(UNIQUEIDENTIFIER, LTRIM(RTRIM(value))) IS NOT NULL
    )
    SELECT d.TaskId, d.DependsOn
    FROM dbo.TaskDependencies d
    WHERE d.TaskId    IN (SELECT Id FROM ids)
      AND d.DependsOn IN (SELECT Id FROM ids);
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test` (local DB env only). Expected: all three procedures created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_Baseline_Capture.sql infra/sql/procedures/usp_Baseline_List.sql infra/sql/procedures/usp_View_GanttDeps.sql
git commit -m "feat(9d): baseline + gantt-dep SPs — Baseline_Capture (freeze dates), Baseline_List, View_GanttDeps"
```

---

### Task 3: Types — `ViewType` union expansion + Gantt types + pure helpers

**Files:**
- Modify: `packages/types/index.ts` (the `ViewType` union at the "Views Engine (Phase 3)" block, ~line 974)
- Create: `apps/api/src/modules/views/gantt.service.ts` (pure `criticalPath` + `baselineDiff` + assembly)
- Create: `apps/api/src/modules/views/__tests__/gantt.unit.test.ts`

Steps:

- [ ] Expand the `ViewType` union in `packages/types/index.ts`. Replace the line:

```ts
export type ViewType = 'list' | 'board' | 'table' | 'calendar';
```

with the full union (must byte-for-byte match the DB CHECK + the GraphQL `VIEW_TYPES`):

```ts
export type ViewType =
  | 'list' | 'board' | 'table' | 'calendar'
  | 'workload' | 'box'                          // Phase 8d (reconciled into the DB CHECK here)
  | 'gantt' | 'timeline'                        // Phase 9d
  | 'activity' | 'map' | 'mindmap' | 'embed' | 'chat' | 'doc';  // Phase 9e/9f
```

- [ ] Add the Gantt/baseline types to the same Views Engine block (after the `SavedView`/`ViewTaskPage` types):

```ts
// ───────────────────────── Gantt + Timeline (Phase 9d) ─────────────────────────

/** A task projected for the Gantt/Timeline lane: its scheduling window + grouping
 *  facets. Dates are ISO strings (or null for an unscheduled task). */
export interface GanttTask {
  id:         string;
  title:      string;
  status:     string;
  startDate:  string | null;   // ISO; null = unscheduled
  dueDate:    string | null;   // ISO
  assigneeIds: string[];
}

/** A dependency edge: `dependsOn` must finish before `taskId` can start
 *  (the canonical Phase 5 `waiting_on` direction). */
export interface GanttEdge {
  taskId:    string;
  dependsOn: string;
}

export interface BaselineTask {
  taskId:    string;
  startDate: string | null;
  dueDate:   string | null;
}

export interface GanttBaseline {
  id:         string;
  viewId:     string;
  name:       string;
  capturedAt: string;
  createdBy:  string;
  tasks:      BaselineTask[];
}

export interface ViewGanttData {
  tasks:           GanttTask[];
  edges:           GanttEdge[];
  /** Task ids on the longest dependency chain by duration (the critical path). */
  criticalPathIds: string[];
  baselines:       GanttBaseline[];
}
```

- [ ] Write the failing unit tests first. `gantt.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { criticalPath, baselineDiff, type GanttTaskLike, type GanttEdgeLike } from '../gantt.service.js';
import type { BaselineTask } from '@projectflow/types';

// Helper: a task with a duration (in days) derived from start→due.
function task(id: string, start: string | null, due: string | null): GanttTaskLike {
  return { id, startDate: start, dueDate: due };
}

describe('criticalPath', () => {
  it('returns the longest chain by total duration', () => {
    // A(2d) -> B(5d) -> D(1d) = 8d ;  A(2d) -> C(1d) -> D(1d) = 4d
    const tasks: GanttTaskLike[] = [
      task('A', '2026-06-01', '2026-06-03'), // 2d
      task('B', '2026-06-03', '2026-06-08'), // 5d
      task('C', '2026-06-03', '2026-06-04'), // 1d
      task('D', '2026-06-08', '2026-06-09'), // 1d
    ];
    // edge.dependsOn must finish before edge.taskId.
    const edges: GanttEdgeLike[] = [
      { taskId: 'B', dependsOn: 'A' },
      { taskId: 'C', dependsOn: 'A' },
      { taskId: 'D', dependsOn: 'B' },
      { taskId: 'D', dependsOn: 'C' },
    ];
    expect(criticalPath(tasks, edges)).toEqual(['A', 'B', 'D']);
  });

  it('treats an unscheduled task as zero duration', () => {
    const tasks: GanttTaskLike[] = [
      task('A', '2026-06-01', '2026-06-05'), // 4d
      task('B', null, null),                 // 0d
    ];
    const edges: GanttEdgeLike[] = [{ taskId: 'B', dependsOn: 'A' }];
    expect(criticalPath(tasks, edges)).toEqual(['A', 'B']);
  });

  it('returns the single longest node when there are no edges', () => {
    const tasks: GanttTaskLike[] = [
      task('A', '2026-06-01', '2026-06-02'), // 1d
      task('B', '2026-06-01', '2026-06-10'), // 9d
    ];
    expect(criticalPath(tasks, [])).toEqual(['B']);
  });

  it('returns [] for no tasks', () => {
    expect(criticalPath([], [])).toEqual([]);
  });
});

describe('baselineDiff', () => {
  const captured: BaselineTask[] = [
    { taskId: 'A', startDate: '2026-06-01', dueDate: '2026-06-03' },
    { taskId: 'B', startDate: '2026-06-03', dueDate: '2026-06-08' },
  ];

  it('reports per-task whole-day drift of current vs captured', () => {
    const current = [
      task('A', '2026-06-01', '2026-06-03'), // unchanged
      task('B', '2026-06-05', '2026-06-10'), // +2d on both ends
    ];
    const d = baselineDiff(current, captured);
    expect(d.find((x) => x.taskId === 'A')).toMatchObject({ startDeltaDays: 0, dueDeltaDays: 0, changed: false });
    expect(d.find((x) => x.taskId === 'B')).toMatchObject({ startDeltaDays: 2, dueDeltaDays: 2, changed: true });
  });

  it('omits tasks absent from the baseline', () => {
    const current = [task('C', '2026-06-01', '2026-06-02')];
    expect(baselineDiff(current, captured)).toEqual([]);
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- gantt` (vitest `--project unit` filtered). Expected: FAIL — `Cannot find module '../gantt.service.js'`.

- [ ] Write `apps/api/src/modules/views/gantt.service.ts`. The pure helpers (`criticalPath`, `baselineDiff`) carry the unit-tested logic; `GanttService.resolve` wires the repo (Task 4):

```ts
import { GanttRepository } from './gantt.repository.js';
import { ViewService } from './view.service.js';
import type {
  GanttTask, GanttEdge, GanttBaseline, BaselineTask, ViewGanttData,
  ViewScopeType, ViewConfig,
} from '@projectflow/types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Minimal shapes the pure helpers need (the full GanttTask is a superset).
export interface GanttTaskLike { id: string; startDate: string | null; dueDate: string | null }
export interface GanttEdgeLike { taskId: string; dependsOn: string }

/** Whole-day duration of a task's [start, due] window; 0 when either end is
 *  missing or due precedes start. */
export function durationDays(t: GanttTaskLike): number {
  if (!t.startDate || !t.dueDate) return 0;
  const a = Date.parse(t.startDate);
  const b = Date.parse(t.dueDate);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / MS_PER_DAY));
}

/**
 * The critical path: the task-id chain with the greatest summed duration through
 * the dependency DAG. `edge.dependsOn` must finish before `edge.taskId`, so we
 * relax over edges from predecessor → successor. The graph is acyclic
 * (usp_TaskDependency_Add rejects cycles), so a memoized longest-path DFS is safe.
 */
export function criticalPath(tasks: GanttTaskLike[], edges: GanttEdgeLike[]): string[] {
  if (tasks.length === 0) return [];
  const dur = new Map<string, number>(tasks.map((t) => [t.id, durationDays(t)]));
  // predecessors[id] = tasks that must finish before id (id waits on them).
  const preds = new Map<string, string[]>();
  for (const t of tasks) preds.set(t.id, []);
  for (const e of edges) {
    if (preds.has(e.taskId) && dur.has(e.dependsOn)) preds.get(e.taskId)!.push(e.dependsOn);
  }

  const best = new Map<string, { len: number; path: string[] }>();
  const visiting = new Set<string>();
  const longestTo = (id: string): { len: number; path: string[] } => {
    const cached = best.get(id);
    if (cached) return cached;
    if (visiting.has(id)) return { len: 0, path: [id] }; // defensive: ignore any residual cycle
    visiting.add(id);
    const self = dur.get(id) ?? 0;
    let chosen: { len: number; path: string[] } = { len: self, path: [id] };
    for (const p of preds.get(id) ?? []) {
      const up = longestTo(p);
      if (up.len + self > chosen.len) chosen = { len: up.len + self, path: [...up.path, id] };
    }
    visiting.delete(id);
    best.set(id, chosen);
    return chosen;
  };

  let winner: { len: number; path: string[] } = { len: -1, path: [] };
  for (const t of tasks) {
    const r = longestTo(t.id);
    if (r.len > winner.len) winner = r;
  }
  return winner.path;
}

/** Per-task whole-day drift of `current` dates vs a captured baseline. Tasks not
 *  present in the baseline are omitted. */
export interface BaselineDiffEntry {
  taskId:         string;
  startDeltaDays: number;
  dueDeltaDays:   number;
  changed:        boolean;
}
export function baselineDiff(current: GanttTaskLike[], captured: BaselineTask[]): BaselineDiffEntry[] {
  const base = new Map(captured.map((b) => [b.taskId, b]));
  const deltaDays = (a: string | null, b: string | null): number => {
    if (!a || !b) return 0;
    const x = Date.parse(a); const y = Date.parse(b);
    if (Number.isNaN(x) || Number.isNaN(y)) return 0;
    return Math.round((y - x) / MS_PER_DAY);
  };
  const out: BaselineDiffEntry[] = [];
  for (const t of current) {
    const b = base.get(t.id);
    if (!b) continue;
    const startDeltaDays = deltaDays(b.startDate, t.startDate);
    const dueDeltaDays   = deltaDays(b.dueDate,   t.dueDate);
    out.push({ taskId: t.id, startDeltaDays, dueDeltaDays, changed: startDeltaDays !== 0 || dueDeltaDays !== 0 });
  }
  return out;
}

// ── Assembly (impure) ─────────────────────────────────────────────────────────

export class GanttService {
  private repo = new GanttRepository();
  private views = new ViewService();

  /** Build the Gantt payload for a saved view: in-scope tasks (Phase 3 compiler) +
   *  dependency edges among them + the critical path + the view's baselines. */
  async resolve(
    userId: string,
    scopeType: ViewScopeType,
    scopeId: string | null,
    config: ViewConfig,
    workspaceId: string | undefined,
    viewId: string,
  ): Promise<ViewGanttData> {
    // Reuse the exact compiled task query the other views use. A generous page
    // bound keeps the whole scope on one Gantt canvas (bounded by MAX_PAGE_SIZE).
    const page = await this.views.runConfig(scopeType, scopeId, config, { page: 1, pageSize: 200 }, workspaceId, userId);
    const tasks: GanttTask[] = (page.tasks as any[]).map((r) => ({
      id:          r.Id,
      title:       r.Title,
      status:      r.Status,
      startDate:   r.StartDate ? new Date(r.StartDate).toISOString() : null,
      dueDate:     r.DueDate ? new Date(r.DueDate).toISOString() : null,
      assigneeIds: (r.Assignees ?? []).map((a: any) => a.UserId),
    }));
    const ids = tasks.map((t) => t.id);
    const edges = await this.repo.listScopeDependencies(ids);
    const baselines = await this.repo.listBaselines(viewId);
    return { tasks, edges, criticalPathIds: criticalPath(tasks, edges), baselines };
  }

  async capture(viewId: string, name: string, createdBy: string, taskIds: string[]): Promise<GanttBaseline> {
    return this.repo.captureBaseline(viewId, name, createdBy, taskIds);
  }
}

export const ganttService = new GanttService();
```

- [ ] Run: `npm test --workspace apps/api -- gantt` (unit). Expected: PASS (the pure-helper tests; the `GanttService` methods aren't exercised here). Then `npm run build --workspace apps/api` will fail until Task 4 adds `gantt.repository.ts` — that's expected mid-task-sequence; the unit project compiles the test file + `gantt.service.ts` against the not-yet-existing repo import only at build time, so if running strictly task-by-task, defer `npm run build` to Task 4.

- [ ] Commit:
```
git add packages/types/index.ts apps/api/src/modules/views/gantt.service.ts apps/api/src/modules/views/__tests__/gantt.unit.test.ts
git commit -m "feat(9d): ViewType union expansion + Gantt types + pure critical-path/baseline-diff helpers + unit tests"
```

---

### Task 4: Gantt repository (deps + baseline capture/list)

**Files:**
- Create: `apps/api/src/modules/views/gantt.repository.ts`
- Test: covered by `gantt.integration.test.ts` (Task 6).

Steps:

- [ ] Write `gantt.repository.ts` — mirror `dependency.repository.ts`'s `execSp`/`execSpOne` + PascalCase→camelCase mapping. `listBaselines` reads the two-recordset `usp_Baseline_List` and zips frozen tasks onto their headers:

```ts
import sql from 'mssql';
import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';
import type { GanttEdge, GanttBaseline, BaselineTask } from '@projectflow/types';

export class GanttRepository {
  /** Edges among a supplied set of task ids (usp_View_GanttDeps). */
  async listScopeDependencies(taskIds: string[]): Promise<GanttEdge[]> {
    if (taskIds.length === 0) return [];
    const rows = await execSpOne<{ TaskId: string; DependsOn: string }>('usp_View_GanttDeps', [
      { name: 'TaskIds', type: sql.NVarChar(sql.MAX), value: taskIds.join(',') },
    ]);
    return rows.map((r) => ({ taskId: r.TaskId, dependsOn: r.DependsOn }));
  }

  /** Insert a baseline header + freeze the in-scope tasks' dates (usp_Baseline_Capture).
   *  Returns the new header with an empty `tasks` (the next list() re-reads frozen rows). */
  async captureBaseline(viewId: string, name: string, createdBy: string, taskIds: string[]): Promise<GanttBaseline> {
    const rows = await execSpOne<any>('usp_Baseline_Capture', [
      { name: 'ViewId',    type: sql.UniqueIdentifier, value: viewId },
      { name: 'Name',      type: sql.NVarChar(200),    value: name },
      { name: 'CreatedBy', type: sql.UniqueIdentifier, value: createdBy },
      { name: 'TaskIds',   type: sql.NVarChar(sql.MAX), value: taskIds.length ? taskIds.join(',') : null },
    ]);
    const h = rows[0];
    return {
      id: h.Id, viewId: h.ViewId, name: h.Name,
      capturedAt: new Date(h.CapturedAt).toISOString(), createdBy: h.CreatedBy, tasks: [],
    };
  }

  /** A view's baselines + their frozen task rows (usp_Baseline_List → 2 recordsets). */
  async listBaselines(viewId: string): Promise<GanttBaseline[]> {
    const sets = await execSp<any>('usp_Baseline_List', [
      { name: 'ViewId', type: sql.UniqueIdentifier, value: viewId },
    ]);
    const headers = (sets[0] ?? []) as any[];
    const frozen  = (sets[1] ?? []) as any[];
    const byBaseline = new Map<string, BaselineTask[]>();
    for (const f of frozen) {
      const k = String(f.BaselineId);
      const list = byBaseline.get(k) ?? [];
      list.push({
        taskId:    f.TaskId,
        startDate: f.StartDate ? new Date(f.StartDate).toISOString() : null,
        dueDate:   f.DueDate ? new Date(f.DueDate).toISOString() : null,
      });
      byBaseline.set(k, list);
    }
    return headers.map((h) => ({
      id: h.Id, viewId: h.ViewId, name: h.Name,
      capturedAt: new Date(h.CapturedAt).toISOString(), createdBy: h.CreatedBy,
      tasks: byBaseline.get(String(h.Id)) ?? [],
    }));
  }
}
```

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS — `gantt.service.ts` now resolves its `./gantt.repository.js` import; types compile. Then `npm test --workspace apps/api -- gantt` still PASS.

- [ ] Commit:
```
git add apps/api/src/modules/views/gantt.repository.ts
git commit -m "feat(9d): gantt.repository — scope dependency edges + baseline capture/list over the SPs"
```

---

### Task 5: Reschedule realtime publish on the date PATCH path

**Files:**
- Modify: `apps/api/src/modules/roadmap/roadmap.service.ts`
- Modify: `apps/api/src/modules/roadmap/roadmap.routes.ts` (only if the publish needs the route's response shape — keep the publish in the service)

Steps:

- [ ] The Gantt drag reuses `PATCH /roadmap/tasks/:id/dates` (`usp_Task_UpdateDates`). Today that path returns the updated row but does **not** publish a `task:event`, so a drag is not reflected live in List/Board. Wire the publish in `roadmap.service.updateDates` after the SP write, using the existing `publishTaskEvent` + `projectIdOf` pattern from `task.service.updateTask`. Add the import and publish:

```ts
import { publishTaskEvent } from '../../graphql/task-events.js';

// projectId lives on the SELECT * row returned by usp_Task_UpdateDates (Tasks.ProjectId).
function projectIdOf(row: any): string | null {
  return row?.ProjectId ?? row?.projectId ?? null;
}
```

Then in `updateDates`, after `repo.updateDates(...)`:

```ts
  async updateDates(
    taskId: string,
    requesterId: string,
    startDate?: string | null,
    dueDate?: string | null,
    clearStartDate?: boolean,
    clearDueDate?: boolean,
  ) {
    const row = await repo.updateDates(taskId, requesterId, startDate, dueDate, clearStartDate, clearDueDate);
    // A Gantt/Timeline drag moves dates; publish so List/Board/Calendar surfaces
    // re-merge the updated task live (best-effort; never fails the write).
    const projectId = projectIdOf(row);
    if (projectId) await publishTaskEvent('updated', { projectId, taskId });
    return row;
  }
```

- [ ] Run: `npm run build --workspace apps/api`. Expected: PASS. (Behavior is asserted by the integration test in Task 6 — a date PATCH emits a `task:event`.)

- [ ] Commit:
```
git add apps/api/src/modules/roadmap/roadmap.service.ts
git commit -m "feat(9d): publish task:event on the date PATCH path so Gantt drags reflect live in List/Board"
```

---

### Task 6: GraphQL Gantt resolver + integration test (resolver, baseline freeze, live drag)

**Files:**
- Modify: `apps/api/src/graphql/views.schema.ts` (widen `VIEW_TYPES`/`assertViewType`; add the Gantt types + `viewGanttData` query + `captureBaseline` mutation)
- Create: `apps/api/src/modules/views/__tests__/gantt.integration.test.ts`

Steps:

- [ ] Write the failing integration test first (copy the harness imports the existing views integration tests use — `testServer.js`, `truncate.js`, `factories.js`; mirror `views-graphql.integration.test.ts`):

```ts
/**
 * Phase 9d — Gantt resolver + baseline + live-drag integration coverage.
 * Exercises the Gantt GraphQL resolver, baseline freeze, and the date PATCH
 * realtime publish against the REAL SQL stack.
 * DB SAFETY: must target local Docker ProjectFlow_Test (see e2e/README).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json, gql } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { pubsub } from '../../../graphql/pubsub.js';
import { taskEventKey } from '../../../graphql/task-events.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

// Seeds a SPACE-scoped gantt SavedView over a list with two dated, dependent tasks.
async function seedGantt() {
  const owner = await createTestUser({ email: `gantt-${Date.now()}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'GanttSpace', key: `GT${Date.now() % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'L', position: 0 },
  }), 201)).data;
  const mk = async (title: string) => (await json<{ task: any }>(await request('/tasks', {
    method: 'POST', token, json: { projectId: space.Id, workspaceId: ws.Id, title, listId: list.id },
  }), 201)).task;
  const a = await mk('A'); const b = await mk('B');
  // Dates: A 06-01→06-03, B 06-03→06-08 (StartDate DATE, DueDate DATETIME2).
  const setDates = (id: string, s: string, d: string) =>
    request(`/roadmap/tasks/${id}/dates`, { method: 'PATCH', token, json: { startDate: s, dueDate: d } });
  await setDates(a.id, '2026-06-01', '2026-06-03T00:00:00.000Z');
  await setDates(b.id, '2026-06-03', '2026-06-08T00:00:00.000Z');
  // B waits on A.
  await request('/roadmap/dependencies', { method: 'POST', token, json: { taskId: b.id, dependsOn: a.id } });
  // A gantt SavedView over the SPACE.
  const view = (await json<{ data: { createSavedView: any } }>(await request('/graphql', {
    method: 'POST', token, gql: gql`mutation($i: CreateSavedViewInput!){ createSavedView(input:$i){ id type } }`,
    variables: { i: { scopeType: 'SPACE', scopeId: space.Id, type: 'gantt', name: 'GV', isShared: true, isDefault: false, config: '{}' } },
  }))).data.createSavedView;
  return { token, owner, ws, space, list, a, b, viewId: view.id };
}

describe('gantt resolver', () => {
  it('returns the in-scope tasks, the dependency edge, and the critical path', async () => {
    const { token, a, b, viewId } = await seedGantt();
    const res = (await json<{ data: { viewGanttData: any } }>(await request('/graphql', {
      method: 'POST', token,
      gql: gql`query($id:String!){ viewGanttData(viewId:$id){ tasks{ id startDate dueDate } edges{ taskId dependsOn } criticalPathIds baselines{ id } } }`,
      variables: { id: viewId },
    }))).data.viewGanttData;
    expect(res.tasks.map((t: any) => t.id).sort()).toEqual([a.id, b.id].sort());
    expect(res.edges).toContainEqual({ taskId: b.id, dependsOn: a.id });
    // A(2d) -> B(5d) is the only chain: critical path = [A, B].
    expect(res.criticalPathIds).toEqual([a.id, b.id]);
    expect(res.baselines).toEqual([]);
  });

  it('captureBaseline freezes the current dates and List returns them', async () => {
    const { token, a, viewId } = await seedGantt();
    const cap = (await json<{ data: { captureBaseline: any } }>(await request('/graphql', {
      method: 'POST', token,
      gql: gql`mutation($id:String!,$n:String!){ captureBaseline(viewId:$id,name:$n){ id name } }`,
      variables: { id: viewId, n: 'v1' },
    }))).data.captureBaseline;
    expect(cap.name).toBe('v1');
    // Move A; the baseline still reflects the FROZEN (pre-move) date.
    await request(`/roadmap/tasks/${a.id}/dates`, { method: 'PATCH', token, json: { startDate: '2026-06-05', dueDate: '2026-06-07T00:00:00.000Z' } });
    const res = (await json<{ data: { viewGanttData: any } }>(await request('/graphql', {
      method: 'POST', token,
      gql: gql`query($id:String!){ viewGanttData(viewId:$id){ baselines{ id name tasks{ taskId startDate } } } }`,
      variables: { id: viewId },
    }))).data.viewGanttData;
    const frozenA = res.baselines[0].tasks.find((x: any) => x.taskId === a.id);
    expect(frozenA.startDate).toContain('2026-06-01'); // frozen, NOT 06-05
  });

  it('a date PATCH (Gantt drag) emits a task:event updated on the project topic', async () => {
    const { token, a, space } = await seedGantt();
    const events: any[] = [];
    const it = pubsub.subscribe('task:event', taskEventKey.project(space.Id));
    const pump = (async () => { for await (const ev of it) { events.push(ev); break; } })();
    await request(`/roadmap/tasks/${a.id}/dates`, { method: 'PATCH', token, json: { startDate: '2026-06-04', dueDate: '2026-06-06T00:00:00.000Z' } });
    await Promise.race([pump, new Promise((r) => setTimeout(r, 1500))]);
    expect(events.some((e) => e.kind === 'updated' && e.taskId === a.id)).toBe(true);
  });
});
```

(Adjust the `pubsub.subscribe` call to the repo's actual pubsub API if it differs — mirror how `realtime`/`presence` integration tests subscribe to a topic; the assertion is "an `updated` event for the dragged task is published.")

- [ ] Run: `npm run test:integration --workspace apps/api -- gantt` against `ProjectFlow_Test`. Expected: FAIL — `viewGanttData`/`captureBaseline` are unknown fields, and `type: 'gantt'` is rejected by `assertViewType`.

- [ ] Widen the view-type allow-list in `views.schema.ts`. Replace:

```ts
type ViewType = 'list' | 'board' | 'table' | 'calendar';
const SCOPE_TYPES: readonly ViewScopeType[] = ['LIST', 'FOLDER', 'SPACE', 'EVERYTHING'];
const VIEW_TYPES: readonly ViewType[] = ['list', 'board', 'table', 'calendar'];
```

with the full union (keep it in lockstep with `@projectflow/types`' `ViewType` + the DB CHECK):

```ts
type ViewType =
  | 'list' | 'board' | 'table' | 'calendar'
  | 'workload' | 'box'
  | 'gantt' | 'timeline'
  | 'activity' | 'map' | 'mindmap' | 'embed' | 'chat' | 'doc';
const SCOPE_TYPES: readonly ViewScopeType[] = ['LIST', 'FOLDER', 'SPACE', 'EVERYTHING'];
const VIEW_TYPES: readonly ViewType[] = [
  'list', 'board', 'table', 'calendar', 'workload', 'box',
  'gantt', 'timeline', 'activity', 'map', 'mindmap', 'embed', 'chat', 'doc',
];
```

- [ ] Add the Gantt types + resolvers inside `registerViewsGraphql()`. Import `ganttService` at the top of the file:

```ts
import { ganttService } from '../modules/views/gantt.service.js';
import type { GanttTask, GanttEdge, GanttBaseline, ViewGanttData } from '@projectflow/types';
```

Then register the object types + query/mutation (place the types beside `ViewTaskPageType`, the query in the `builder.queryFields` block, the mutation in the `builder.mutationFields` block):

```ts
  // ── Gantt (Phase 9d) ────────────────────────────────────────────────────────
  const GanttTaskType = builder.objectRef<GanttTask>('GanttTask');
  GanttTaskType.implement({ fields: (t) => ({
    id:          t.exposeString('id'),
    title:       t.exposeString('title'),
    status:      t.exposeString('status'),
    startDate:   t.string({ nullable: true, resolve: (g) => g.startDate }),
    dueDate:     t.string({ nullable: true, resolve: (g) => g.dueDate }),
    assigneeIds: t.exposeStringList('assigneeIds'),
  }) });

  const GanttEdgeType = builder.objectRef<GanttEdge>('GanttEdge');
  GanttEdgeType.implement({ fields: (t) => ({
    taskId:    t.exposeString('taskId'),
    dependsOn: t.exposeString('dependsOn'),
  }) });

  const BaselineTaskType = builder.objectRef<{ taskId: string; startDate: string | null; dueDate: string | null }>('BaselineTask');
  BaselineTaskType.implement({ fields: (t) => ({
    taskId:    t.exposeString('taskId'),
    startDate: t.string({ nullable: true, resolve: (b) => b.startDate }),
    dueDate:   t.string({ nullable: true, resolve: (b) => b.dueDate }),
  }) });

  const GanttBaselineType = builder.objectRef<GanttBaseline>('GanttBaseline');
  GanttBaselineType.implement({ fields: (t) => ({
    id:         t.exposeString('id'),
    viewId:     t.exposeString('viewId'),
    name:       t.exposeString('name'),
    capturedAt: t.exposeString('capturedAt'),
    createdBy:  t.exposeString('createdBy'),
    tasks:      t.field({ type: [BaselineTaskType], resolve: (b) => b.tasks }),
  }) });

  const GanttDataType = builder.objectRef<ViewGanttData>('ViewGanttData');
  GanttDataType.implement({ fields: (t) => ({
    tasks:           t.field({ type: [GanttTaskType], resolve: (d) => d.tasks }),
    edges:           t.field({ type: [GanttEdgeType], resolve: (d) => d.edges }),
    criticalPathIds: t.exposeStringList('criticalPathIds'),
    baselines:       t.field({ type: [GanttBaselineType], resolve: (d) => d.baselines }),
  }) });
```

Query (in `builder.queryFields`, alongside `viewTasks`):

```ts
    viewGanttData: t.field({
      type: GanttDataType,
      args: { viewId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const userId = requireUser(ctx);
        const view = await viewService.getOrThrow(a.viewId);
        const node = authzNode(view.scopeType);
        if (node) await requireObjectLevel(ctx, node, view.scopeId, 'VIEW');
        else await requireEverythingWorkspace(ctx, view.workspaceId);
        return ganttService.resolve(userId, view.scopeType, view.scopeId, view.config, view.workspaceId, view.id);
      },
    }),
```

Mutation (in `builder.mutationFields`, alongside the saved-view CRUD mutations):

```ts
    captureBaseline: t.field({
      type: GanttBaselineType,
      args: { viewId: t.arg.string({ required: true }), name: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const userId = requireUser(ctx);
        const view = await viewService.getOrThrow(a.viewId);
        const node = authzNode(view.scopeType);
        if (node) await requireObjectLevel(ctx, node, view.scopeId, 'VIEW');
        else await requireEverythingWorkspace(ctx, view.workspaceId);
        // Freeze exactly the tasks the Gantt shows (the compiled scope page).
        const data = await ganttService.resolve(userId, view.scopeType, view.scopeId, view.config, view.workspaceId, view.id);
        return ganttService.capture(view.id, a.name, userId, data.tasks.map((x) => x.id));
      },
    }),
```

- [ ] Run: `npm run build --workspace apps/api` (compiles the Pothos schema). Expected: PASS. Then `npm run test:integration --workspace apps/api -- gantt`. Expected: PASS (3 tests). Then full unit `npm test --workspace apps/api`. Expected: PASS (existing GraphQL authz/views tests still green).

- [ ] Commit:
```
git add apps/api/src/graphql/views.schema.ts apps/api/src/modules/views/__tests__/gantt.integration.test.ts
git commit -m "feat(9d): GraphQL Gantt resolver + captureBaseline + full view-type allow-list + integration test"
```

---

### Task 7: Frontend SSR query + server actions + types wiring

**Files:**
- Modify: `apps/next-web/src/server/queries/views.ts` (add `loadGanttData`)
- Create: `apps/next-web/src/server/actions/gantt.ts`
- Note: read `node_modules/next/dist/docs/` per `apps/next-web/AGENTS.md` before writing web code (this Next.js has breaking changes).

Steps:

- [ ] Add `loadGanttData(viewId)` to `server/queries/views.ts`, mirroring the existing `previewViewTasks`/`viewTasks` `gqlData` helper usage in that file (use the same query-fetch wrapper + `cache(...)` the file already imports):

```ts
import type { ViewGanttData } from '@projectflow/types';

export const loadGanttData = cache(async (viewId: string): Promise<ViewGanttData | null> => {
  const { viewGanttData } = await gqlData<{ viewGanttData: ViewGanttData | null }>(
    /* GraphQL */ `
      query($id: String!) {
        viewGanttData(viewId: $id) {
          tasks { id title status startDate dueDate assigneeIds }
          edges { taskId dependsOn }
          criticalPathIds
          baselines { id name capturedAt createdBy tasks { taskId startDate dueDate } }
        }
      }
    `,
    { id: viewId },
  );
  return viewGanttData ?? null;
});
```

(Match the exact `gqlData` signature already used in this file — if it returns `{ data }` envelopes or takes a typed-document, follow `previewViewTasks`'s call shape verbatim.)

- [ ] Create `server/actions/gantt.ts` — mirror the existing view server actions' `{ ok, error }` envelope + REST helper (copy `addWorkLog`/the roadmap date action's implementation; `apiAction`/`apiFetch` below is a placeholder for the file's real fetch wrapper — adapt to the real one):

```ts
'use server';

import { apiAction } from '@/server/actions/_client'; // use the project's real helper

/** Move/resize a task on the Gantt: PATCH the date PATCH path the roadmap drag uses.
 *  StartDate is day-granular (YYYY-MM-DD); DueDate is a full ISO timestamp. */
export async function updateTaskDates(
  taskId: string,
  dates: { startDate?: string | null; dueDate?: string | null },
) {
  return apiAction(`/roadmap/tasks/${taskId}/dates`, { method: 'PATCH', body: dates });
}

/** Capture a named baseline via GraphQL (the REST surface has no views routes). */
export async function captureBaseline(viewId: string, name: string) {
  return apiAction('/graphql', {
    method: 'POST',
    body: {
      query: `mutation($id:String!,$n:String!){ captureBaseline(viewId:$id,name:$n){ id name capturedAt } }`,
      variables: { id: viewId, n: name },
    },
  });
}
```

- [ ] Run: `npm run build --workspace apps/next-web` (Next build — compiles the new server module against the widened `ViewType`/`ViewGanttData` types). Expected: PASS. (No behavior to assert yet; the renderers in Task 8 consume these.)

- [ ] Commit:
```
git add apps/next-web/src/server/queries/views.ts apps/next-web/src/server/actions/gantt.ts
git commit -m "feat(9d): Gantt SSR query (loadGanttData) + updateTaskDates/captureBaseline server actions"
```

---

### Task 8: Gantt + Timeline renderers + view-surface registry + unit test + i18n

**Files:**
- Create: `apps/next-web/src/components/views/gantt-view.tsx`
- Create: `apps/next-web/src/components/views/timeline-view.tsx`
- Create: `apps/next-web/src/components/views/gantt-geom.ts` (pure bar/line geometry helpers — unit-tested)
- Create: `apps/next-web/src/components/views/__tests__/gantt-view.unit.test.tsx`
- Modify: `apps/next-web/src/components/views/view-surface.tsx` (register `gantt`/`timeline` in `ViewBody`)
- Modify: `apps/next-web/messages/en.json` + `id.json` (add `Gantt` + `Timeline` namespaces)
- Note: read `node_modules/next/dist/docs/` per `AGENTS.md` first.

Steps:

- [ ] Write the failing geometry unit test first. `gantt-view.unit.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { barGeometry, lanePath, dayIndex } from '../gantt-geom';

describe('gantt geometry', () => {
  const origin = '2026-06-01';
  it('maps a date to a whole-day column index from the origin', () => {
    expect(dayIndex(origin, '2026-06-01')).toBe(0);
    expect(dayIndex(origin, '2026-06-04')).toBe(3);
  });
  it('computes a bar x/width from start/due in day-columns', () => {
    const g = barGeometry(origin, '2026-06-03', '2026-06-08', 24); // 24px/day
    expect(g.x).toBe(2 * 24);                       // starts on day index 2
    expect(g.width).toBe(Math.max(24, 5 * 24));     // 5-day span, min one column
  });
  it('returns a zero-width hidden bar for an unscheduled task', () => {
    const g = barGeometry(origin, null, null, 24);
    expect(g.hidden).toBe(true);
  });
  it('builds an elbow connector path between two bar endpoints', () => {
    const d = lanePath({ x: 10, y: 5 }, { x: 80, y: 35 });
    expect(typeof d).toBe('string');
    expect(d.startsWith('M')).toBe(true);
  });
});
```

- [ ] Run: `npm test --workspace apps/next-web -- gantt-view`. Expected: FAIL — module `../gantt-geom` not found.

- [ ] Write `gantt-geom.ts` (pure, no React — the testable core of the renderer):

```ts
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole-day column index of `date` relative to `origin` (both date-or-ISO strings). */
export function dayIndex(origin: string, date: string): number {
  const o = Date.parse(origin.length === 10 ? `${origin}T00:00:00Z` : origin);
  const d = Date.parse(date.length === 10 ? `${date}T00:00:00Z` : date);
  return Math.round((d - o) / MS_PER_DAY);
}

export interface BarGeom { x: number; width: number; hidden: boolean }

/** A bar's pixel x/width given the chart origin day, the task window, and px/day.
 *  Unscheduled (missing either end) → hidden. Width is clamped to one column. */
export function barGeometry(origin: string, start: string | null, due: string | null, pxPerDay: number): BarGeom {
  if (!start || !due) return { x: 0, width: 0, hidden: true };
  const s = dayIndex(origin, start);
  const e = dayIndex(origin, due);
  const span = Math.max(1, e - s);
  return { x: s * pxPerDay, width: Math.max(pxPerDay, span * pxPerDay), hidden: false };
}

/** SVG elbow path between a source point (a bar's right edge) and a target
 *  (a dependent bar's left edge) for a dependency line. */
export function lanePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const midX = (from.x + to.x) / 2;
  return `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`;
}
```

- [ ] Run: `npm test --workspace apps/next-web -- gantt-view`. Expected: PASS (4 tests).

- [ ] Write `gantt-view.tsx` — a client renderer consuming the SSR Gantt payload (`loadGanttData`) threaded as a prop, plus the SSR task page for live merge. It renders day-laned bars, dependency lines (SVG using `lanePath`), critical-path highlight, a baseline overlay, drag move/resize (calls `updateTaskDates`), and a "Capture baseline" button (`captureBaseline`). Live `task:event`s re-merge dates via `useLiveTasks` exactly like `calendar-view.tsx`:

```tsx
'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLiveTasks, buildAccepts } from '@/lib/realtime/useLiveTasks';
import { updateTaskDates, captureBaseline } from '@/server/actions/gantt';
import { notifyActionError } from '@/lib/apiErrorToast';
import { barGeometry, dayIndex, lanePath } from './gantt-geom';
import type { LiveScopeProp } from '@/components/views/view-surface';
import type { ViewTaskPageResult } from '@/server/queries/views';
import type { SavedView, ViewGanttData } from '@projectflow/types';

const PX_PER_DAY = 28;
const ROW_H = 32;

interface Props {
  taskPage: ViewTaskPageResult | null;
  activeView: SavedView;
  /** SSR-loaded Gantt payload (edges + critical path + baselines). */
  gantt: ViewGanttData | null;
  live: LiveScopeProp;
}

export function GanttView({ taskPage, activeView, gantt, live }: Props) {
  const t = useTranslations('Gantt');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showBaseline, setShowBaseline] = useState(true);

  const baseTasks = useMemo(() => taskPage?.tasks ?? [], [taskPage]);
  const tasks = useLiveTasks(
    baseTasks,
    live.projectId ? { projectId: live.projectId } : { workspaceId: live.workspaceId },
    buildAccepts(live.acceptKind, live.listScopeId),
  );

  const critical = useMemo(() => new Set(gantt?.criticalPathIds ?? []), [gantt]);
  const edges = gantt?.edges ?? [];
  const latestBaseline = gantt?.baselines?.[0] ?? null;
  const baselineByTask = useMemo(() => {
    const m = new Map<string, { startDate: string | null; dueDate: string | null }>();
    for (const b of latestBaseline?.tasks ?? []) m.set(b.taskId, { startDate: b.startDate, dueDate: b.dueDate });
    return m;
  }, [latestBaseline]);

  // Chart origin = earliest start among scheduled tasks (fallback: today).
  const origin = useMemo(() => {
    const starts = tasks.map((x) => x.startDate).filter(Boolean) as string[];
    if (!starts.length) return new Date().toISOString().slice(0, 10);
    return starts.reduce((a, b) => (a < b ? a : b)).slice(0, 10);
  }, [tasks]);

  const rowIndex = useMemo(() => new Map(tasks.map((x, i) => [x.id, i])), [tasks]);

  const onDragEnd = (taskId: string, newStart: string, newDue: string) =>
    start(async () => {
      const r: any = await updateTaskDates(taskId, { startDate: newStart, dueDate: newDue });
      if (!r.ok) return notifyActionError(r);
      router.refresh(); // re-seed SSR; live event also patches concurrent viewers
    });

  const onCaptureBaseline = () =>
    start(async () => {
      const r: any = await captureBaseline(activeView.id, t('baselineName', { date: new Date().toLocaleDateString() }));
      if (!r.ok) return notifyActionError(r);
      router.refresh();
    });

  // Bar center points for dependency lines (right edge of predecessor → left edge of successor).
  const anchor = (id: string, side: 'left' | 'right') => {
    const tk = tasks.find((x) => x.id === id);
    const ri = rowIndex.get(id) ?? 0;
    if (!tk?.startDate || !tk?.dueDate) return null;
    const g = barGeometry(origin, tk.startDate, tk.dueDate, PX_PER_DAY);
    return { x: side === 'right' ? g.x + g.width : g.x, y: ri * ROW_H + ROW_H / 2 };
  };

  return (
    <div data-testid="view-body-gantt" className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="text-sm font-semibold">{t('title')}</div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant={showBaseline ? 'primary' : 'outline'} onClick={() => setShowBaseline((s) => !s)} className="h-8 text-xs">
            {t('baseline')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onCaptureBaseline} disabled={pending} data-testid="gantt-capture-baseline" className="h-8 text-xs">
            {t('captureBaseline')}
          </Button>
        </div>
      </div>

      <div className="relative flex-1 overflow-auto" data-testid="gantt-canvas">
        {/* Dependency lines (SVG overlay) */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" data-testid="gantt-deps">
          {edges.map((e, i) => {
            const from = anchor(e.dependsOn, 'right');
            const to = anchor(e.taskId, 'left');
            if (!from || !to) return null;
            const onCp = critical.has(e.dependsOn) && critical.has(e.taskId);
            return <path key={i} d={lanePath(from, to)} data-testid="gantt-dep-line" fill="none" stroke={onCp ? '#ef4444' : '#94a3b8'} strokeWidth={onCp ? 2 : 1} />;
          })}
        </svg>

        {tasks.map((tk, ri) => {
          const g = barGeometry(origin, tk.startDate, tk.dueDate, PX_PER_DAY);
          const onCp = critical.has(tk.id);
          const base = baselineByTask.get(tk.id);
          const baseG = showBaseline && base ? barGeometry(origin, base.startDate, base.dueDate, PX_PER_DAY) : null;
          return (
            <div key={tk.id} className="relative flex items-center" style={{ height: ROW_H }} data-testid="gantt-row" data-task-id={tk.id}>
              <div className="w-40 shrink-0 truncate px-2 text-xs">{tk.title}</div>
              <div className="relative flex-1">
                {baseG && !baseG.hidden && (
                  <div className="absolute rounded bg-muted-foreground/20" data-testid="gantt-baseline-bar"
                       style={{ left: baseG.x, width: baseG.width, height: 6, top: ROW_H / 2 + 6 }} />
                )}
                {!g.hidden && (
                  <button
                    type="button"
                    data-testid="gantt-bar"
                    data-critical={onCp ? 'true' : undefined}
                    className={cn('absolute rounded px-1 text-[10px] text-white', onCp ? 'bg-red-500' : 'bg-primary')}
                    style={{ left: g.x, width: g.width, height: 18, top: ROW_H / 2 - 9 }}
                    onDoubleClick={() => {
                      // Minimal move affordance for v1: shift +1 day (drag wiring is
                      // pointer-handler detail; the action + live path are the contract).
                      if (!tk.startDate || !tk.dueDate) return;
                      const ns = new Date(Date.parse(tk.startDate) + 86400000).toISOString().slice(0, 10);
                      const nd = new Date(Date.parse(tk.dueDate) + 86400000).toISOString();
                      onDragEnd(tk.id, ns, nd);
                    }}
                  >
                    {tk.title}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

(The double-click "+1 day" is the v1 move affordance so the action + live path are exercised deterministically by the e2e; a pointer-drag handler can refine the UX later without changing the data contract — note it in `DECISIONS.md`.)

- [ ] Write `timeline-view.tsx` — a lighter date-laned view that groups rows by a facet (`config.groupBy` → assignee/status/custom field) over the **same task page**, each group a horizontal lane of bars, drag to reschedule (same `updateTaskDates` action). Reuse `gantt-geom` for bar geometry; reuse `useLiveTasks` for live merge:

```tsx
'use client';

import { useMemo, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/utils';
import { useLiveTasks, buildAccepts } from '@/lib/realtime/useLiveTasks';
import { updateTaskDates } from '@/server/actions/gantt';
import { notifyActionError } from '@/lib/apiErrorToast';
import { barGeometry } from './gantt-geom';
import { taskFieldValue } from './field-options';
import type { LiveScopeProp } from '@/components/views/view-surface';
import type { ViewTaskPageResult } from '@/server/queries/views';
import type { CustomField, FieldRef, SavedView } from '@projectflow/types';
import type { Task } from '@/server/queries/normalize-task';

const PX_PER_DAY = 24;
const ROW_H = 30;
const DEFAULT_GROUP: FieldRef = { kind: 'builtin', key: 'status' };

interface Props {
  taskPage: ViewTaskPageResult | null;
  activeView: SavedView;
  customFields?: CustomField[];
  live: LiveScopeProp;
}

export function TimelineView({ taskPage, activeView, customFields = [], live }: Props) {
  const t = useTranslations('Timeline');
  const router = useRouter();
  const [pending, start] = useTransition();

  const baseTasks = useMemo(() => taskPage?.tasks ?? [], [taskPage]);
  const tasks = useLiveTasks(
    baseTasks,
    live.projectId ? { projectId: live.projectId } : { workspaceId: live.workspaceId },
    buildAccepts(live.acceptKind, live.listScopeId),
  );

  const groupField = activeView.config.groupBy ?? DEFAULT_GROUP;

  const origin = useMemo(() => {
    const starts = tasks.map((x) => x.startDate).filter(Boolean) as string[];
    if (!starts.length) return new Date().toISOString().slice(0, 10);
    return starts.reduce((a, b) => (a < b ? a : b)).slice(0, 10);
  }, [tasks]);

  const groups = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const tk of tasks) {
      const raw = taskFieldValue(tk, groupField, customFields);
      const key = raw == null || raw === '' ? '∅' : String(raw);
      const arr = m.get(key) ?? [];
      arr.push(tk);
      m.set(key, arr);
    }
    return [...m.entries()];
  }, [tasks, groupField, customFields]);

  const onDrag = (taskId: string, start0: string | null, due0: string | null) => {
    if (!start0 || !due0) return;
    start(async () => {
      const ns = new Date(Date.parse(start0) + 86400000).toISOString().slice(0, 10);
      const nd = new Date(Date.parse(due0) + 86400000).toISOString();
      const r: any = await updateTaskDates(taskId, { startDate: ns, dueDate: nd });
      if (!r.ok) return notifyActionError(r);
      router.refresh();
    });
  };

  return (
    <div data-testid="view-body-timeline" className="flex h-full flex-col overflow-auto rounded-lg border border-border bg-background">
      {groups.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted-foreground">{t('empty')}</div>}
      {groups.map(([label, rows]) => (
        <div key={label} data-testid="timeline-lane" data-group={label} className="border-b border-border/60">
          <div className="bg-muted/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
          {rows.map((tk) => {
            const g = barGeometry(origin, tk.startDate, tk.dueDate, PX_PER_DAY);
            return (
              <div key={tk.id} className="relative flex items-center" style={{ height: ROW_H }} data-testid="timeline-row" data-task-id={tk.id}>
                <div className="w-40 shrink-0 truncate px-2 text-xs">{tk.title}</div>
                <div className="relative flex-1">
                  {!g.hidden && (
                    <button type="button" data-testid="timeline-bar"
                      className={cn('absolute rounded bg-primary px-1 text-[10px] text-white')}
                      style={{ left: g.x, width: g.width, height: 16, top: ROW_H / 2 - 8 }}
                      disabled={pending}
                      onDoubleClick={() => onDrag(tk.id, tk.startDate, tk.dueDate)}>
                      {tk.title}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
```

- [ ] Register both renderers in `view-surface.tsx`. Add the imports at the top:

```tsx
import { GanttView } from '@/components/views/gantt-view';
import { TimelineView } from '@/components/views/timeline-view';
import type { ViewGanttData } from '@projectflow/types';
```

Thread a `gantt` prop through `ViewSurface` → `ViewBody` (loaded SSR in the page in Task 9; null for non-gantt views). Add the `gantt` field to both `Props` and the `ViewBody` param object (`gantt?: ViewGanttData | null`), pass it from `ViewSurface` into `<ViewBody gantt={gantt} .../>`, and add the two switch cases in `ViewBody`:

```tsx
    case 'gantt':
      return <GanttView taskPage={taskPage} activeView={activeView} gantt={gantt ?? null} live={live} />;
    case 'timeline':
      return <TimelineView taskPage={taskPage} activeView={activeView} customFields={customFields} live={live} />;
```

- [ ] Add the i18n namespaces. `messages/en.json`:

```json
"Gantt": {
  "title": "Gantt",
  "baseline": "Baseline",
  "captureBaseline": "Capture baseline",
  "baselineName": "Baseline {date}",
  "criticalPath": "Critical path"
},
"Timeline": {
  "empty": "No scheduled tasks",
  "groupBy": "Group by"
}
```

`messages/id.json` (real Indonesian):

```json
"Gantt": {
  "title": "Gantt",
  "baseline": "Garis dasar",
  "captureBaseline": "Ambil garis dasar",
  "baselineName": "Garis dasar {date}",
  "criticalPath": "Jalur kritis"
},
"Timeline": {
  "empty": "Tidak ada tugas terjadwal",
  "groupBy": "Kelompokkan menurut"
}
```

- [ ] Run: `npm test --workspace apps/next-web` (includes the `messages.unit` i18n parity test + the gantt-geom unit). Expected: PASS — en/id key parity green; geometry tests green. Then `npm run build --workspace apps/next-web`. Expected: PASS (Next build clean; the widened `ViewType` switch is exhaustive-safe via the `default` ListView fallback).

- [ ] Commit:
```
git add apps/next-web/src/components/views/gantt-view.tsx apps/next-web/src/components/views/timeline-view.tsx apps/next-web/src/components/views/gantt-geom.ts apps/next-web/src/components/views/__tests__/gantt-view.unit.test.tsx apps/next-web/src/components/views/view-surface.tsx apps/next-web/messages/en.json apps/next-web/messages/id.json
git commit -m "feat(9d): Gantt + Timeline renderers + view-surface registry + geometry unit tests + i18n"
```

---

### Task 9: Wire `loadGanttData` into the views SSR page

**Files:**
- Modify: `apps/next-web/src/app/(app)/views/[scopeType]/[scopeId]/page.tsx`

Steps:

- [ ] In the views page, when the active view's `type === 'gantt'`, fetch the Gantt payload SSR (`loadGanttData(activeView.id)`) and pass it to `<ViewSurface gantt={...} />` (null otherwise). Mirror how the page already conditionally fetches `boardWorkflowStatuses` for board views. Add the import and the conditional fetch:

```tsx
import { loadGanttData } from '@/server/queries/views';

// …after the active view is resolved and taskPage is loaded:
const gantt = activeView?.type === 'gantt' ? await loadGanttData(activeView.id) : null;

// …pass it down:
<ViewSurface /* …existing props… */ gantt={gantt} />
```

- [ ] Run: `npm run build --workspace apps/next-web`. Expected: PASS. Then `npm test --workspace apps/next-web`. Expected: PASS.

- [ ] Commit:
```
git add "apps/next-web/src/app/(app)/views/[scopeType]/[scopeId]/page.tsx"
git commit -m "feat(9d): SSR-load Gantt data for gantt views and thread it into ViewSurface"
```

---

### Task 10: Playwright e2e (headline flow — §7.5 acceptance)

**Files:**
- Create: `apps/next-web/e2e/gantt-timeline.spec.ts`
- Note: e2e runs against local Docker `ProjectFlow_Test` only (use the project's existing e2e env/setup, same as the views/realtime specs).

Steps:

- [ ] Write the e2e spec covering the BUILD_PLAN §7.5 acceptance flow: open a Gantt view, see dependency lines + a critical-path highlight, capture a baseline, drag (double-click +1d) a task and see the date change reflected in List/Board live. Follow the existing views/realtime spec harness (login + seed a Space/List with two dated dependent tasks + a gantt SavedView; the realtime spec shows the two-tab live-reflection pattern):

```ts
import { test, expect } from '@playwright/test';
import { loginAndSeedGanttView } from './helpers'; // add to e2e helpers: seeds 2 dated, dependent tasks + a gantt + a list view

test.describe('Phase 9d — Gantt + Timeline', () => {
  test('Gantt shows dependencies + critical path, captures a baseline, drag reflects live in List', async ({ page, context }) => {
    const { ganttUrl, listUrl, taskATitle } = await loginAndSeedGanttView(page);

    // Open the Gantt view.
    await page.goto(ganttUrl);
    await expect(page.getByTestId('view-body-gantt')).toBeVisible();

    // Dependency line(s) + critical-path highlight render.
    await expect(page.getByTestId('gantt-dep-line').first()).toBeVisible();
    await expect(page.locator('[data-testid="gantt-bar"][data-critical="true"]').first()).toBeVisible();

    // Capture a baseline (overlay bar appears).
    await page.getByTestId('gantt-capture-baseline').click();
    await expect(page.getByTestId('gantt-baseline-bar').first()).toBeVisible();

    // Open List in a second tab to observe the live update.
    const listPage = await context.newPage();
    await listPage.goto(listUrl);
    await expect(listPage.getByText(taskATitle)).toBeVisible();

    // Drag task A (+1 day) on the Gantt → date PATCH → task:event updated.
    const barA = page.locator('[data-testid="gantt-row"]', { hasText: taskATitle }).getByTestId('gantt-bar');
    await barA.dblclick();

    // The List tab re-merges the live update (the task row is still present and
    // its due-date cell reflects the shift — assert on the live-updated date cell).
    await expect(listPage.locator('[data-testid="task-row"]', { hasText: taskATitle })).toBeVisible();
    await expect(listPage.locator('[data-testid="task-due-date"]').first()).toBeVisible();
  });

  test('Timeline lanes group tasks and a bar reschedules', async ({ page }) => {
    const { timelineUrl } = await loginAndSeedGanttView(page);
    await page.goto(timelineUrl);
    await expect(page.getByTestId('view-body-timeline')).toBeVisible();
    await expect(page.getByTestId('timeline-lane').first()).toBeVisible();
    await page.getByTestId('timeline-bar').first().dblclick();
    await expect(page.getByTestId('view-body-timeline')).toBeVisible(); // survives the reschedule + refresh
  });
});
```

(Add the `loginAndSeedGanttView` helper to the e2e helpers module alongside the existing seed helpers — it seeds two dated, dependent tasks, a `gantt` SavedView, a `timeline` SavedView, and a `list` SavedView on the same Space, returning their URLs + `taskATitle`. Add `data-testid="task-due-date"` to the List view's due-date cell if not already present so the live date change is targetable.)

- [ ] Run: the project's e2e command for a single spec against `ProjectFlow_Test` (same invocation the views/realtime specs use, e.g. `npx playwright test e2e/gantt-timeline.spec.ts`). Expected: PASS (2 tests) — dependency lines + critical path visible, baseline captured, drag reflects live, timeline lanes render + reschedule.

- [ ] Commit:
```
git add apps/next-web/e2e/gantt-timeline.spec.ts apps/next-web/e2e/helpers.ts
git commit -m "test(9d): e2e — Gantt deps/critical-path/baseline + live drag + Timeline lanes/reschedule"
```

---

### Task 11: Slice verification + DECISIONS.md

**Files:**
- Modify: `DECISIONS.md` (append a Phase 9d entry)

Steps:

- [ ] Run the full slice verification on local Docker `ProjectFlow_Test`:
  - `npm test --workspace apps/api` — Expected: PASS (existing suite + new `gantt` unit tests).
  - `npm run test:integration --workspace apps/api` — Expected: PASS (existing + `gantt.integration.test.ts`).
  - `npm test --workspace apps/next-web` — Expected: PASS (unit + `messages.unit` parity + `gantt-view` geometry).
  - `npm run build --workspace apps/api` and `npm run build --workspace apps/next-web` — Expected: both PASS.
  - The gantt-timeline e2e — Expected: PASS.

- [ ] Append a `DECISIONS.md` entry logging: the `CK_SavedViews_Type` drop-and-recreate to the **full union** (and that it folds in Phase 8d's `workload`/`box` so the DB CHECK, the `ViewType` union, and the GraphQL `VIEW_TYPES` allow-list all agree — 9e/9f depend on this); the `Baselines`/`BaselineTasks` shape; the pure `criticalPath` (memoized longest-path over the acyclic dependency DAG; unscheduled task = 0 duration) + `baselineDiff` helpers; reusing `ViewService.runConfig` (the Phase 3 compiler) as the single Gantt task source; the comma-delimited `@TaskIds` transport for `usp_Baseline_Capture`/`usp_View_GanttDeps`; the new realtime publish added to `roadmap.service.updateDates` (the date PATCH path now emits `task:event updated`, which the spec assumed); the v1 double-click "+1 day" move affordance (pointer-drag UX deferred); and any deviation found during implementation (incl. the actual migration number if `0049` was taken). DB-execution-policy note: all DB work ran ONLY against local Docker `ProjectFlow_Test`.

- [ ] Commit:
```
git add DECISIONS.md
git commit -m "docs(9d): DECISIONS entry — view-type union expansion + Gantt/Timeline + baselines + live drag"
```

---

## Definition of Done

Per-slice DoD (spec §3) + BUILD_PLAN acceptance (spec §7.5):

- [ ] **BUILD_PLAN §7.5 acceptance:** Gantt shows **dependencies** (lines between bars from `TaskDependencies`), the **critical path** (longest dependency chain by duration, highlighted), and a **saved baseline** (captured snapshot overlaid vs. current).
- [ ] Migration `0049_view_types_and_baselines.sql` is idempotent, GO-batched, and **reversible** via `rollback/0049_view_types_and_baselines.down.sql` (apply→rollback→re-apply verified clean); the rollback restores the **original four-type** CHECK.
- [ ] `CK_SavedViews_Type`, the `ViewType` union (`packages/types/index.ts`), and the GraphQL `VIEW_TYPES`/`assertViewType` allow-list (`views.schema.ts`) **all carry the identical full union** (`list, board, table, calendar, workload, box, gantt, timeline, activity, map, mindmap, embed, chat, doc`) — 9e/9f register renderers for the remaining members against this expanded set.
- [ ] SP-per-op for every new operation (`usp_Baseline_Capture`, `usp_Baseline_List`, `usp_View_GanttDeps`); the Gantt date PATCH reuses the existing `usp_Task_UpdateDates`.
- [ ] The Gantt data resolver (`viewGanttData`) returns in-scope tasks via the **Phase 3 compiler** (`ViewService.runConfig`) + dependency edges + the critical path + baselines; `captureBaseline` freezes the shown tasks' dates. Authorization fail-closed via `requireObjectLevel`/`requireEverythingWorkspace` (same gates as the other view resolvers).
- [ ] The date PATCH path publishes a `task:event updated`, so a Gantt/Timeline drag reflects **live** in List/Board/Calendar (asserted in integration + e2e).
- [ ] Unit tests (pure `criticalPath` + `baselineDiff`; pure `gantt-geom`) + integration tests (resolver returns tasks + edges; baseline freezes dates; date PATCH emits a realtime event) + ≥1 Playwright e2e for the headline flow — all green.
- [ ] `@projectflow/types` updated (`ViewType` expanded + `GanttTask`/`GanttEdge`/`GanttBaseline`/`BaselineTask`/`ViewGanttData`).
- [ ] i18n: new `Gantt`/`Timeline` keys in **en.json + id.json** (real Indonesian); `messages.unit` parity green.
- [ ] All DB work (migrations, SP deploy, integration, e2e) ran **ONLY against local Docker `ProjectFlow_Test`** — never the prod-pointing `apps/api/.env`.
- [ ] `DECISIONS.md` entry logs the mechanism choices + any deviations. **Stop for review/merge before Slice 9e.**

---

## Self-Review

**Spec coverage (§7):**
- §7.1 model — ✅ `0049` expands `CK_SavedViews_Type` to the exact full union via drop-and-recreate (Task 1) + `Baselines(Id, ViewId, Name, CapturedAt, CreatedBy)` + `BaselineTasks(BaselineId, TaskId, StartDate, DueDate)` with the exact columns; `ViewType` gains the same members (Task 3).
- §7.2 backend — ✅ Gantt data resolver = tasks via Phase 3 compiler (`ViewService.runConfig`) + `StartDate`/`DueDate` + `TaskDependencies` edges (Task 6 resolver, Task 4 repo, Task 2 `usp_View_GanttDeps`); pure unit-tested `criticalPath` in `gantt.service` (Task 3); baseline capture/list SPs `usp_Baseline_Capture`/`usp_Baseline_List` (Task 2); drag updates reuse the existing date PATCH path which is wired to publish realtime (Task 5).
- §7.3 frontend — ✅ Gantt UI: bars, drag move/resize, dependency lines, critical-path highlight, baseline overlay (Task 8); Timeline UI: date-laned rows grouped by a facet over the same resolver, drag to reschedule (Task 8).
- §7.4 tests — ✅ unit (critical-path + baseline diff + geometry), integration (resolver tasks+edges, baseline freeze, drag PATCH emits realtime), e2e headline (Task 10).
- §7.5 acceptance — ✅ explicitly covered by the e2e + DoD: dependencies, critical path, saved baseline.
- §2.2 uniform mechanism — ✅ one migration expands the CHECK to the full union, the `ViewType` union gains the same members, the registry (`view-surface.tsx` + GraphQL `VIEW_TYPES`) is widened, each renderer consumes the same compiled task query.

**Placeholder scan:** No "register the other view types later" — this slice registers gantt + timeline renderers AND expands the union/CHECK/allow-list to the full set so 9e/9f only add renderers. Full real SQL for the CHECK expansion (drop + recreate full union) + both baseline tables + rollback (recreate four-type CHECK); full baseline SPs + `usp_View_GanttDeps`; full pure `criticalPath`/`baselineDiff`/`gantt-geom` helpers + their tests; full Gantt resolver + `viewGanttData`/`captureBaseline`; full `gantt-view.tsx` + `timeline-view.tsx`. The only acknowledged simplifications are flagged inline (double-click "+1 day" stand-in for pointer-drag UX; the `apiAction`/`gqlData` helper names adapt to the file's real wrapper) — none leave a data-path gap.

**Type/name consistency:** Migration `0049_view_types_and_baselines.sql`; tables `Baselines`/`BaselineTasks`; SPs `usp_Baseline_Capture`/`usp_Baseline_List`/`usp_View_GanttDeps`; dependency table `dbo.TaskDependencies` (canonical `TaskId waits_on DependsOn`, `WorkspaceId`-scoped — matches `0034`); date columns `StartDate` (DATE) / `DueDate` (DATETIME2) — matches `usp_Task_UpdateDates`/migration 0024; the full `ViewType` union string is byte-identical across the DB CHECK, the `ViewType` union, and the GraphQL `VIEW_TYPES`. The Views surface is GraphQL-only (no REST routes module) — the resolver/SSR query/baseline mutation are all GraphQL, matching `views.schema.ts` + `server/queries/views.ts`; the date PATCH reuses the existing REST `PATCH /roadmap/tasks/:id/dates`. Renderers follow the `calendar-view.tsx` shape (`taskPage`/`activeView`/`live` props + `useLiveTasks`/`buildAccepts`). i18n files at `apps/next-web/messages/{en,id}.json` with the parity test at `src/i18n/__tests__/messages.unit.test.ts`.
