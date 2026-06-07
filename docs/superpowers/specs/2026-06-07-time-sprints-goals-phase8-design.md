# Phase 8 — Time Tracking · Sprints/Agile · Goals (Design)

**Date:** 2026-06-07
**Status:** Approved (design); spec under review
**BUILD_PLAN reference:** §Phase 8 ("Time + agile + objectives")
**Prerequisite:** Phases 1–7 complete. Reuses Phase 1 hierarchy (`Folders`/`Lists`), Phase 2
custom-field + tags engine, the Phase 5c `recurrence.worker` scheduler pattern, the Phase 4 realtime
`publishTaskEvent` path, and (for sprint events) the Phase 6 automation bus.

---

## 1. Overview & the real starting point

Phase 8 is **mostly "activate + complete," not greenfield** — three of its surfaces already have a
partial foundation, and two are new:

- 🟡 **Time tracking ~50% built.** `WorkLogs` (migration `0010_worklogs.sql`: `Id, TaskId, UserId,
  TimeSpentSeconds, StartedAt, Description, CreatedAt`) + a full REST CRUD module
  (`apps/api/src/modules/worklogs/*`, SPs `usp_WorkLog_Create|GetById|Update|Delete|ListByTask|
  GetContext`) + a `WorkLogSection.tsx` drawer UI with a `"1h 30m"` duration parser. **Missing:** a
  running timer (start/stop, one active per user), billable flag, entry tags, manual-vs-range source,
  task **time estimates** + estimate-vs-actual, subtask→parent **rollup**, and a **GraphQL mirror**.
- 🟡 **Sprints ~60% built.** `Sprints` (`0001_init.sql`: `Id, ProjectId, Name, Goal, Status
  (PLANNED|STARTED|COMPLETED), StartDate, EndDate, CompletedAt`) + `Tasks.SprintId` + `Tasks.StoryPoints
  (FLOAT)` + `SprintService` (create/list/start/complete, emits `sprint.started`/`sprint.completed`
  webhooks) + REST **and** a GraphQL `SprintType` + report types (`SprintSummaryReport`,
  `VelocityEntry`, `BurndownReport`) + `usp_Report_SprintSummary` + a `SprintSummaryWidget`. Automation
  already has `SPRINT_STARTED`/`SPRINT_COMPLETED` triggers and `IN_SPRINT`/`NOT_IN_SPRINT` conditions.
  **Missing:** the **sprint-folder hierarchy**, auto-start/auto-complete/**auto-roll-forward**,
  per-assignee **points rollup**, and any sprint setup/management UI.
- 🔴 **Goals = greenfield.** No goals/targets table, service, or UI anywhere (only `Sprint.Goal`, a
  free-text string). Built from zero.
- 🔴 **Workload & Box views = greenfield.** `ViewType = 'list' | 'board' | 'table' | 'calendar'`
  (`packages/types/index.ts`); `view-surface.tsx` dispatches by type and new types add **client-side**
  (no migration). No `workload`/`box`/`gantt` views exist.

**Phase 8's real job:** finish time tracking into a true timer + estimates + rollup system, re-model
sprints into the hierarchy with auto-states, add the two capacity views, and stand Goals up greenfield.
Delivered as **five sequential slices**, each independently verified and merged behind a review
checkpoint, matching the Phase 5/6 cadence.

| Slice | Feature | Greenfield? |
|------|---------|-------------|
| **8a** | **Time Tracking** — running timer (one active/user), billable, entry tags, manual/range/timer source, task time-estimates + estimate-vs-actual, subtask→parent rollup, GraphQL mirror | Extends `WorkLogs` |
| **8b** | **Timesheets** — aggregate by user/date/task + submit/approve workflow + timesheet grid | Greenfield (over 8a) |
| **8c** | **Sprints/Agile** — sprint-folder hierarchy refactor + dates + auto-start/complete/roll-forward scheduler + points rollup (per-assignee split) + sprint setup UI | Re-models flat `Sprints` |
| **8d** | **Workload & Box views** — capacity by time/points + over-capacity flag; assignee-grouped Box view | Greenfield (ViewType add) |
| **8e** | **Goals & Targets** — `Goals`/`Targets` tables (number/boolean/currency/task-linked), goal folders, auto progress rollup; Goals UI | Greenfield |

### Locked product decisions (from brainstorming)
- **Ambition:** **full BUILD_PLAN parity** — every §Phase 8 item, not acceptance-minimal.
- **Time-entry model:** **evolve `WorkLogs` in place** (add columns + a timer concept + estimates) —
  one table, trivial backfill — rather than a new `TimeEntries` table. Mirrors Phase 6's
  "activate the existing feature" approach.
- **Sprint model:** **full sprint-folder hierarchy** — sprints become **Lists under a sprint-flagged
  Folder** inside the Phase 1 hierarchy (not flat rows under a Project). The largest refactor of the
  phase; isolated in 8c with a data migration.
- **Goals:** **dedicated `Goals` + `Targets` tables** with target kinds number/boolean/currency/
  task-linked, goal folders, and automatic progress rollup.

---

## 2. Architecture — the three decisive mechanisms

### 2.1 The running timer (8a) — one open `WorkLog` per user
A running timer **is an open `WorkLog` row**: `StartedAt` set, `EndedAt NULL`, `Source='timer'`.
**Stop** sets `EndedAt` and computes `TimeSpentSeconds = DATEDIFF(EndedAt, StartedAt)`. "One active
timer per user" is enforced by a **filtered unique index** on `WorkLogs(UserId) WHERE EndedAt IS NULL`
(plus a guard in `usp_WorkLog_StartTimer` that auto-stops any existing open entry first, so starting a
new timer is always safe). This reuses the entire existing module — no parallel timer table, no dual
write path. Manual entries write `EndedAt` immediately (`Source='manual'`); range entries set explicit
`StartedAt`/`EndedAt` (`Source='range'`).

### 2.2 The sprint-folder hierarchy (8c) — sprint = List under a sprint Folder
The decisive refactor. Sprints stop being flat rows under a Project and join the hierarchy:

- A **Folder** gains a **sprint capability**: `Folders.IsSprintFolder BIT` + a 1:1 `SprintSettings`
  row (cadence/duration, start day-of-week, auto-start/auto-complete/auto-roll-forward flags, the
  points field to roll up).
- A **Sprint = a List** under that folder. The existing `Sprints` row is evolved to bind **1:1 to a
  List** (`Sprints.ListId`) and to its sprint folder (`Sprints.FolderId`); its dates/status/goal now
  describe that sprint List. `ProjectId` is retained (denormalized) for backward-compat.
- **Task↔sprint membership = the task lives in the sprint List** (`Tasks.ListId` = sprint's List).
  `Tasks.SprintId` is **retained as a maintained denormalization** (updated whenever a task enters/
  leaves a sprint List) so existing reports (`usp_Report_SprintSummary`), automation conditions
  (`IN_SPRINT`/`NOT_IN_SPRINT`), and the velocity/burndown types keep working unchanged.
- **Auto-roll-forward** = the scheduler re-parents unfinished tasks' `ListId` from the ending sprint
  List into the next sprint List (and updates the `SprintId` denorm).
- **Data migration** (folded into 8c, idempotent): for each existing flat `Sprint`, designate/create a
  sprint Folder under its Project, create a sprint List, bind the `Sprints` row to it, and set
  membership for tasks currently referencing that `SprintId`. This is the phase's highest-risk step,
  which is why sprints are their own slice; prod-DB work is local-Docker-only, so live-data risk is minimal.

### 2.3 The schedulers — copy the `recurrence.worker` pattern
Two time-driven mechanisms reuse the Phase 5c BullMQ **repeatable-job** pattern
(`apps/api/src/modules/recurrence/recurrence.worker.ts`: idempotent `start*Worker()`, Redis-gated,
fixed sweep interval, a pure `run*Sweep(now?)` helper for tests, registered in `server.ts`):

- **`sprint.worker.ts` (8c)** — sweeps sprint folders: auto-**starts** sprints whose `StartDate`
  arrived, auto-**completes** those whose `EndDate` passed (firing the existing `sprint.completed`
  hook), **rolls** unfinished tasks into the next sprint, and **creates** the next sprint List per the
  folder's cadence.
- **Goal rollup (8e)** is primarily **event-driven** (a `goal.service` recompute hook on task
  completion via the same after-commit service pattern as Phase 6's automation bus), with an optional
  low-frequency reconcile sweep as a backstop.

---

## 3. Cross-cutting conventions (every slice)

- **DB / SQL Server:** SP-per-op (`CREATE OR ALTER`, `SET NOCOUNT ON`, TRY/CATCH/TRANSACTION,
  `SELECT *` of affected rows) in `infra/sql/procedures/`, deployed by `scripts/db-deploy-sps.ts`.
- **Migrations** (assume Phases 6/7 land first — on-disk is currently `0037`; Phase 6 uses
  `0038–0039`, Phase 7 `0040–0042`): `0043_time_tracking.sql`, `0044_timesheets.sql`,
  `0045_sprint_folders.sql` (+ the sprint data migration, folded in), `0046_goals.sql`. **8d adds no
  migration** (client-side ViewType + optional `SavedViews.config` keys only). Each idempotent
  (`IF NOT EXISTS` / `COL_LENGTH` guards), GO-batched, with a matching
  `infra/sql/migrations/rollback/00XX_*.down.sql`.
- **API dual surface:** Hono **REST** (primary; the SSR web client uses REST) + a **GraphQL** mirror,
  both delegating to one shared service per module (`worklogs` [+GraphQL], `timesheets`, `sprints`,
  `goals`). The worklogs module is REST-only today — 8a adds its GraphQL mirror to match convention.
- **Authorization:** `requirePermission('<entity>.<action>')` with `resolveWorkspace` from the
  entity/project (e.g. `worklog.create`, `timesheet.submit`, `timesheet.approve`, `sprint.manage`,
  `goal.create|update|delete`) + `requireObjectLevel` for hierarchy-scoped objects (sprint Lists,
  goal scope). Owner-scoped variants where they exist today (`worklog.update.own`, `worklog.delete.own`).
  All gates fail-closed.
- **Realtime:** timer start/stop, sprint state changes, and goal-progress updates publish via the
  existing event path so open views/widgets update live; no new live topics are introduced.
- **Shared types:** extend `packages/types/index.ts` (hand-written) — new `WorkLog` fields, `Timesheet`,
  `Sprint`/`SprintSettings`, `Goal`/`Target`, and `ViewType` additions live here.
- **i18n:** all new UI strings in `en.json` + `id.json` (real Indonesian); the `messages.unit` parity
  test must stay green.
- **DB execution policy:** migrations / SP-deploy / integration / e2e run **ONLY against local Docker
  `ProjectFlow_Test`** via explicit local DB env — **never** the prod-pointing `apps/api/.env`.
- **⚠️ Next.js:** per `apps/next-web/AGENTS.md`, this Next.js has breaking changes — **read the in-repo
  `node_modules/next/dist/docs/` before writing web code.**
- **Definition of Done (per slice):** all acceptance boxes pass; migration reversible; unit +
  integration tests for new endpoints/behavior; ≥1 Playwright e2e for the headline flow;
  `@projectflow/types` updated; a `DECISIONS.md` entry logs deviations. Then **stop for review/merge**
  before the next slice.

---

## 4. Slice 8a — Time Tracking (timer + estimates + rollup)

The foundation: turns worklogs into a real timer + estimate system that 8b (timesheets) and 8d
(workload capacity) read from.

### 4.1 Data model (`0043_time_tracking.sql`)
- **Evolve `WorkLogs`:** add
  ```
  EndedAt    DATETIME2     NULL,                 -- NULL = running timer
  Billable   BIT           NOT NULL DEFAULT 0,
  Source     NVARCHAR(10)  NOT NULL DEFAULT 'manual'   -- 'manual' | 'range' | 'timer'
  ```
  + filtered unique index `UQ_WorkLog_ActiveTimer ON WorkLogs(UserId) WHERE EndedAt IS NULL`.
  (`TimeSpentSeconds` stays; for timer/range entries it is derived from `StartedAt`/`EndedAt`.)
- **Entry tags:** `WorkLogTags(WorkLogId, TagId)` reusing the Phase 2 Space-scoped `Tags`.
- **Task estimates:** add `Tasks.TimeEstimateSeconds INT NULL`; per-assignee estimates via
  `TaskEstimates(TaskId, UserId, EstimateSeconds, PRIMARY KEY (TaskId, UserId))`.

### 4.2 Backend
- New SPs: `usp_WorkLog_StartTimer` (auto-stop any open entry, insert open row),
  `usp_WorkLog_StopTimer` (set `EndedAt`, compute duration), `usp_WorkLog_GetActiveTimer(@UserId)`;
  extend `usp_WorkLog_Create`/`Update` for `Billable`/`Source`/tags; `usp_Task_SetEstimate` +
  `usp_Task_GetTimeRollup` (sum logged + estimate down the `parent_task_id` subtree).
- `worklog.service`: `startTimer/stopTimer/getActiveTimer`, billable + tag handling, estimate
  set/get, and a **rollup** resolver that aggregates a task's own + descendants' logged time and
  estimates (the Phase 2 `progress_auto` subtree pattern). Estimate-vs-actual = `TimeEstimateSeconds`
  vs summed `TimeSpentSeconds`.
- **GraphQL mirror** for worklogs (new): `taskWorkLogs(taskId)`, `activeTimer`, `startTimer`,
  `stopTimer`, `createWorkLog`, `updateWorkLog`, `deleteWorkLog`.

### 4.3 Frontend
- **Global timer widget** (in the app shell): start/stop, shows the running task + elapsed time, live
  tick; one active timer enforced by the UI + the unique index. Start from a task → opens a timer
  bound to that task.
- Upgrade `WorkLogSection.tsx`: billable toggle, time-tag picker, manual vs. start/end **range**
  entry. Task panel shows **estimate** field + **estimate-vs-actual** bar and the **rollup** total.

### 4.4 Tests
- **Unit:** duration computation; one-open-timer guard (start auto-stops prior); rollup subtree math;
  estimate-vs-actual.
- **Integration:** start→stop produces a closed entry with correct duration; a second start auto-stops
  the first; billable + tags persist; rollup sums subtasks into the parent.
- **e2e:** start the global timer on a task, stop it, see the entry; estimate vs. actual renders.

### 4.5 Acceptance (BUILD_PLAN)
- [ ] Global timer tracks across tasks; only one active timer per user; rollup to parent works.

---

## 5. Slice 8b — Timesheets (aggregate + submit/approve)

### 5.1 Data model (`0044_timesheets.sql`)
```
Timesheets(Id PK, WorkspaceId, UserId, PeriodStart DATE, PeriodEnd DATE,
     Status NVARCHAR(12) NOT NULL DEFAULT 'draft',   -- 'draft'|'submitted'|'approved'|'rejected'
     SubmittedAt DATETIME2 NULL, ReviewedById NULL, ReviewedAt DATETIME2 NULL,
     Note NVARCHAR(500) NULL, CreatedAt, UpdatedAt)
     -- UQ (UserId, PeriodStart, PeriodEnd)
```
The timesheet is the **submit/approve envelope**; its line data is the existing `WorkLogs` aggregated
within `[PeriodStart, PeriodEnd]`.

### 5.2 Backend
- `usp_Timesheet_GetOrCreate(@UserId,@PeriodStart,@PeriodEnd)`, `usp_Timesheet_Submit`,
  `usp_Timesheet_Review` (approve/reject), and `usp_Timesheet_Aggregate` returning logged time grouped
  **by user / date / task** for the period (billable split).
- `timesheet.service` + REST routes (`GET /timesheets`, `GET /timesheets/:id`,
  `POST /timesheets/:id/submit`, `POST /timesheets/:id/review`) + GraphQL mirror. Submit locks the
  period from edits (worklog writes in a submitted/approved period 422 unless reopened); approve/reject
  gated by `timesheet.approve`.

### 5.3 Frontend
- **Timesheet grid** (TanStack Table): rows = days/tasks, columns = the period, totals + billable
  split; submit button; reviewer approve/reject view with status badges.

### 5.4 Tests
- **Unit:** period aggregation (by user/date/task); status-transition guard (draft→submitted→
  approved/rejected; no edits while submitted).
- **Integration:** aggregate matches underlying worklogs; submit→approve flow; locked-period write 422.
- **e2e:** log time, submit a timesheet, approve it as a reviewer.

### 5.5 Acceptance (BUILD_PLAN)
- [ ] Timesheet aggregates correctly and supports submit/approve.

---

## 6. Slice 8c — Sprints/Agile (sprint-folder hierarchy + auto-states + points)

The phase's keystone refactor (see §2.2).

### 6.1 Data model (`0045_sprint_folders.sql`)
- `Folders`: add `IsSprintFolder BIT NOT NULL DEFAULT 0`.
- `SprintSettings(FolderId PK/FK, DurationDays INT, StartDayOfWeek TINYINT NULL,
   AutoStart BIT, AutoComplete BIT, AutoRollForward BIT, PointsFieldId UNIQUEIDENTIFIER NULL,
   CreatedAt, UpdatedAt)`.
- `Sprints`: add `ListId UNIQUEIDENTIFIER NULL` (1:1 with the sprint's List, FK `Lists`),
  `FolderId UNIQUEIDENTIFIER NULL` (FK `Folders`); keep `ProjectId` (denormalized).
- **Data migration** (idempotent, folded in): for each existing `Sprint`, ensure a sprint Folder under
  its Project, create a sprint List, set `Sprints.ListId`/`FolderId`, and set task membership
  (`Tasks.ListId` → sprint List; `Tasks.SprintId` denorm maintained). Logged in `DECISIONS.md`.

### 6.2 Backend
- SPs: `usp_Folder_SetSprintSettings`, `usp_Sprint_CreateInFolder` (creates the sprint List + row),
  `usp_Sprint_RollForward` (move unfinished tasks → next sprint List), and a points rollup
  `usp_Sprint_GetPointsRollup` (`Tasks.StoryPoints` summed per sprint **and split per assignee** via
  `task_assignees`). Extend `usp_Report_SprintSummary` to read sprint-List membership.
- `sprint.service`: sprint-folder CRUD + settings; create/start/complete now operate on the
  List-bound sprint; **per-assignee points rollup**; roll-forward. Start/complete keep emitting the
  existing `sprint.started`/`sprint.completed` hooks (→ automation `SPRINT_STARTED`/`SPRINT_COMPLETED`).
- **`sprint.worker.ts`** scheduler (§2.3): auto-start, auto-complete, auto-roll-forward, next-sprint
  creation per `SprintSettings`. Bootstrapped in `server.ts` alongside the recurrence/oauth workers.

### 6.3 Frontend
- **Sprint setup UI**: mark a Folder as a sprint folder + configure cadence/auto-state flags + points
  field; sprint list within the folder with dates/status; per-assignee points display. The existing
  `SprintSummaryWidget` continues to work (now sprint-List-backed).

### 6.4 Tests
- **Unit:** points rollup + per-assignee split; auto-state date math; roll-forward selection
  (unfinished only); next-sprint cadence computation.
- **Integration:** create a sprint folder + sprint, add tasks, complete the sprint → unfinished tasks
  roll to the next sprint; scheduler auto-completes a past-`EndDate` sprint; data migration moves a
  legacy flat sprint into the hierarchy.
- **e2e:** set up a sprint folder, run a sprint, observe auto-complete + roll-forward (via the sweep
  helper) and the points rollup.

### 6.5 Acceptance (BUILD_PLAN)
- [ ] Sprint auto-completes at end date and rolls unfinished tasks to the next sprint.

---

## 7. Slice 8d — Workload & Box views

### 7.1 Model
- Add `'workload'` and `'box'` to the `ViewType` union (`packages/types/index.ts`); register both in
  `view-surface.tsx`. No migration (optional `SavedViews.config` keys: capacity-per-day/points,
  group-by field).
- A server aggregation endpoint (REST + GraphQL) sums **assigned estimates / story points by
  assignee** within a view scope + date range, for capacity computation. (Reuses 8a estimates + 8c
  points; built on the Phase 3 query compiler.)

### 7.2 Frontend
- **Workload view**: per-assignee capacity bars (configurable capacity in hours/day or points/sprint)
  vs. assigned estimates over a date range; **over-capacity assignees flagged** (color/badge).
- **Box view**: board grouped into per-assignee swimlanes (reuses the board-view engine's grouping),
  card counts per assignee.

### 7.3 Tests
- **Unit:** capacity aggregation by assignee; over/under-capacity classification.
- **Integration:** capacity endpoint sums estimates + points correctly within scope/range.
- **e2e:** open the Workload view; an over-loaded assignee is flagged; Box view groups by assignee.

### 7.4 Acceptance (BUILD_PLAN)
- [ ] Workload view flags over-capacity assignees.

---

## 8. Slice 8e — Goals & Targets (greenfield)

### 8.1 Data model (`0046_goals.sql`)
```
GoalFolders(Id PK, WorkspaceId, Name, OwnerId, CreatedAt, UpdatedAt, DeletedAt)
Goals(Id PK, WorkspaceId, ScopeType NVARCHAR(12), ScopeId NULL, FolderId NULL,
     Name, Description NVARCHAR(MAX) NULL, OwnerId, DueDate DATE NULL,
     Status NVARCHAR(12) NOT NULL DEFAULT 'active',   -- 'active'|'achieved'|'archived'
     CreatedAt, UpdatedAt, DeletedAt)
Targets(Id PK, GoalId,
     Kind NVARCHAR(10) NOT NULL,         -- 'number'|'boolean'|'currency'|'task'
     Name, Unit NVARCHAR(20) NULL, CurrencyCode CHAR(3) NULL,
     StartValue FLOAT NULL, TargetValue FLOAT NULL, CurrentValue FLOAT NULL,
     TaskFilter NVARCHAR(MAX) NULL,      -- for Kind='task': which tasks count (filter or id list)
     Position FLOAT, CreatedAt, UpdatedAt)
```
**Progress model (explicit):** each `Target` keeps a `CurrentValue` — user-maintained for
`number`/`currency`/`boolean`, and **recomputed** for `task` (= completed/total over `TaskFilter`). A
target's completion **ratio** is derived per kind (§8.2). Goal **progress is computed on read** as the
**equal-weighted average** of its targets' ratios (no stored goal-level progress column in v1).

### 8.2 Backend
- Goal-folder + goal + target CRUD (SP-per-op); a **progress resolver**:
  - `number`/`currency`: `(Current − Start) / (Target − Start)`;
  - `boolean`: 0 or 1;
  - `task`: completed/total over the `TaskFilter` (reuses the Phase 3 query compiler / Phase 5 rollup).
- **Auto rollup** for `task` targets: a `goal.service.recomputeForTask(taskId)` hook called
  after-commit from `task.service` completion (same pattern as Phase 6's automation bus), so closing a
  task advances any task-linked target; an optional low-frequency reconcile sweep backstops it.
- REST routes + GraphQL mirror.

### 8.3 Frontend
- **Goals UI**: goal folders → goals → targets, each with a **progress bar**; add/edit targets of each
  kind; task-linked target picker; goal status (active/achieved/archived).

### 8.4 Tests
- **Unit:** progress math per target kind; goal aggregate progress; task-target recompute.
- **Integration:** create a task-linked target; complete its tasks → target + goal progress advance
  automatically; number/currency/boolean targets compute correctly.
- **e2e:** create a goal with a task-linked target, complete the tasks, watch progress reach 100%.

### 8.5 Acceptance (BUILD_PLAN)
- [ ] A task-linked Goal target updates progress automatically as tasks complete.

---

## 9. Execution model

Each slice via **subagent-driven-development** (a fresh implementer subagent per task + a two-stage
spec/quality review per task, matching the Phase 5/6 flow). After a slice:
1. Verify on **local Docker `ProjectFlow_Test`**: API unit + integration, web unit + i18n parity,
   `npm run build`, and the slice's e2e headline flow.
2. Record decisions/deviations in `DECISIONS.md`.
3. **Stop for review / merge** before the next slice.

Order: **8a → 8b → 8c → 8d → 8e.** 8a (time foundation) feeds 8b (timesheets) and 8d (capacity); 8c
(sprints + points) also feeds 8d, so 8d sits after both. 8e (goals) is independent and could move
earlier if objectives are more urgent than the two views. If fewer checkpoints are preferred, 8d may
fold into 8c.

---

## 10. Consolidated deferrals (logged for `DECISIONS.md`)
1. **Reporting views:** **Gantt / Timeline** and the sprint **burndown / velocity / cumulative-flow**
   *dashboard cards* are **Phase 9** (Dashboards & remaining views); Phase 8 ships only the **Workload**
   and **Box** views and keeps the existing report *types*/`SprintSummaryWidget`.
2. **Billing / plan-gating:** metering or charging for time/seats/goals → **Phase 10** (apps toggles +
   limits). Phase 8 may gate features behind `apps_enabled` keys (Time Tracking, Sprint Points) but does
   not meter.
3. **AI:** natural-language sprint/goal creation and AI stand-ups (compiled from time + activity) →
   **Phase 11**.
4. **Public surface:** timesheet/CSV **export** and external time-tracking API → **Phase 12**.
5. **Custom-field rollup overlap:** the Phase 2 `progress_auto` field and Goals' task-target rollup share
   subtree-aggregation logic; consolidate into one shared aggregator if duplication grows (follow-up).
6. **Sprint-data migration:** moving legacy flat sprints into the hierarchy is local-Docker-only this
   phase; a production cutover runbook (if/when prod has live sprints) is an ops follow-up.
