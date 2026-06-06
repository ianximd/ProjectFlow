# Phase 5 — Dependencies · Relationships · Recurring · Templates (Design)

**Date:** 2026-06-06
**Status:** Approved (design); spec under review
**BUILD_PLAN reference:** §Phase 5 ("Task interconnection + reusability")
**Prerequisite:** Phases 1–4 complete. (BUILD_PLAN Phase 4 = Realtime/Comments/Notifications/Inbox was implemented here as "Phase 3.5" a/b/c + follow-ups + deferred-cleanup, on `origin/main`.)

---

## 1. Overview & Scope

Phase 5 adds task **interconnection** (dependencies, relationships) and **reusability**
(recurring tasks, templates). It is built as **four sequential slices**, each independently
verified and merged behind a review checkpoint:

| Slice | Feature | Greenfield? |
|------|---------|-------------|
| **5a** | Dependencies + *Dependency Warning* + *Reschedule Dependencies* | Extends legacy `TaskDependencies` (migration `0007`) |
| **5b** | Relationships + Rollup (new custom-field types) | Extends Phase-2 custom fields |
| **5c** | Recurring tasks (on-completion **and** scheduled) | Greenfield |
| **5d** | Templates (task / list / folder / space, full) | Greenfield |

### Locked product decisions (from brainstorming)
- **5a gating:** *Dependency Warning* and *Reschedule Dependencies* are **always-on** now. The
  real per-scope on/off toggle is deferred to Phase 10 (`apps_enabled`). Acceptance "if app
  enabled" ⇒ always enabled.
- **5c regeneration:** **both** on-completion **and** scheduled (BullMQ repeatable job).
- **5d depth:** **full** task / list / folder / space templates.

---

## 2. Cross-cutting conventions (every slice)

- **DB / SQL Server:** SP-per-op. Each SP `CREATE OR ALTER`, `SET NOCOUNT ON`,
  TRY/CATCH/TRANSACTION, returns `SELECT *` of the affected row(s). Files in
  `infra/sql/procedures/usp_<Entity>_<Action>.sql`, deployed by `scripts/db-deploy-sps.ts`.
- **Migrations:** one per slice — `0034` (deps), `0035` (relationships), `0036` (recurrences),
  `0037` (templates). Idempotent (`IF NOT EXISTS` / `COL_LENGTH` guards), GO-batched. Each has a
  matching reverse script in `infra/sql/migrations/rollback/00XX_*.down.sql`.
- **API dual surface:** Hono **REST** (primary; the SSR/web client uses REST) + a **GraphQL**
  mirror. Both delegate to one shared service. New modules under `apps/api/src/modules/`:
  `dependencies`, `relationships`, `recurrence`, `templates`.
- **Authorization:** `requireObjectLevel(ctx, 'LIST'|'FOLDER'|'SPACE', id, level)` for hierarchy
  ACL and `requirePermission` / `requireWorkspacePermission` for RBAC. All gates fail-closed
  (`if (!id) notFound()`). Mirrors the comments/watchers pattern.
- **Realtime:** any task-affecting mutation calls `publishTaskEvent(kind, { projectId, task })`
  (`apps/api/src/graphql/task-events.ts`) so live board/list/views surfaces update.
- **Shared types:** extend `packages/types/index.ts` (hand-written).
- **i18n:** all new UI strings in `en.json` + `id.json` (real Indonesian); the `messages.unit`
  parity test must stay green.
- **DB execution policy:** migrations/SP-deploy/integration/e2e run **ONLY against local Docker
  `ProjectFlow_Test`** via explicit local DB env — **never** the prod-pointing `apps/api/.env`.
- **Definition of Done (per slice):** all acceptance boxes pass; migration reversible; unit +
  integration tests for new endpoints; ≥1 Playwright e2e for the headline flow; `@projectflow/types`
  updated; a `DECISIONS.md` entry logs deviations. Then **stop for review/merge** before the next slice.

---

## 3. Slice 5a — Dependencies + Dependency Warning + Reschedule

### 3.1 Data model (`0034_dependencies.sql`)
Reuse the legacy `TaskDependencies` table (`Id, TaskId, DependsOn, Type, CreatedAt`, `UNIQUE(TaskId,DependsOn)`):
- **Semantics:** canonical directed edge **`(TaskId waits_on DependsOn)`** — `DependsOn` must
  complete before `TaskId`. The two user actions normalize to one edge:
  - "Task A is **waiting on** B" ⇒ row `(TaskId=A, DependsOn=B)`.
  - "Task A is **blocking** B" ⇒ row `(TaskId=B, DependsOn=A)`.
- Narrow the `Type` CHECK to `'waiting_on'` (the legacy `RELATES_TO`/`DUPLICATES` move to 5b
  relationships). Migration converts any existing rows: keep `BLOCKS`/`IS_BLOCKED_BY` interpreted
  into the canonical direction; drop/relabel `RELATES_TO`/`DUPLICATES` (none expected in prod; log
  the conversion rule).
- Add `WorkspaceId` column (denormalized from the task) for tenant-scoped queries + an index
  `IX_TaskDep_DependsOn` (exists) and `IX_TaskDep_Workspace`.

### 3.2 Stored procedures
- `usp_TaskDependency_Add(@TaskId, @DependsOn, @WorkspaceId)` — rewrite with **full transitive
  cycle detection** via a recursive CTE (reject if `DependsOn` can already reach `TaskId`), self-edge
  reject, idempotent insert, returns the row. (Replaces the legacy direct-only check.)
- `usp_TaskDependency_Remove(@TaskId, @DependsOn)` — delete edge.
- `usp_TaskDependency_ListForTask(@TaskId)` — returns waiting-on (rows where `TaskId=@TaskId`) and
  blocking (rows where `DependsOn=@TaskId`), each joined to task title/status for display.
- `usp_Task_HasOpenBlockers(@TaskId)` — returns blocker tasks (the `DependsOn` set) whose status is
  **not** in a DONE/CLOSED group. Status-group resolution mirrors `usp_Task_Transition`: use
  `WorkflowStatuses.Category = 'DONE'` when a workflow is attached, else the hardcoded name set
  (`Done`/`Resolved`/`Closed`/`Completed`).
- `usp_TaskDependency_RescheduleDependents(@TaskId, @DeltaSeconds)` — for every task that waits on
  `@TaskId` (rows where `DependsOn=@TaskId`), shift `StartDate`/`DueDate` by the delta; recurse with a
  visited-set guard; returns the set of shifted task ids (for event emission).

### 3.3 Behavior hooks (service layer)
- **Dependency Warning (always-on):** in `task.service.transitionTask` immediately after the
  existing `customFieldService.assertRequiredMetForStatus`, call `dependencyService.assertNoOpenBlockers`
  when the target status is a DONE-group status. If `usp_Task_HasOpenBlockers` returns rows, throw a new
  `DependencyWarningError` carrying the blocker list → mapped to **HTTP 409** (REST) /
  `DEPENDENCY_BLOCKED` (GraphQL).
- **Reschedule Dependencies (always-on):** in the task **update** path, read the task's current
  `StartDate`/`DueDate` before the update; after a date change, compute Δ (by the moved field) and call
  `usp_TaskDependency_RescheduleDependents`; emit `publishTaskEvent('updated', …)` for each shifted task.
  *(Deferral: cascade runs synchronously with a visited-set guard. Offloading very large cascades to a
  BullMQ job is a documented follow-up, not in 5a.)*

### 3.4 API
- **REST** (`apps/api/src/modules/dependencies/dependency.routes.ts`):
  - `POST /api/v1/tasks/:taskId/dependencies` — body `{ dependsOnId, relation: 'waiting_on'|'blocking' }`
    (normalized to the canonical edge). ACL: `requireObjectLevel('LIST', <taskId.listId>, 'EDIT')` on the
    edited task + `'VIEW'` on the other task's list.
  - `DELETE /api/v1/tasks/:taskId/dependencies/:dependsOnId`.
  - `GET /api/v1/tasks/:taskId/dependencies` → `{ waitingOn: [...], blocking: [...] }`.
- **GraphQL mirror:** `taskDependencies(taskId)`, `addTaskDependency`, `removeTaskDependency`.
- Migrate the **roadmap** module's add/remove routes to delegate to `dependencyService`;
  `usp_Roadmap_GetItems` (gantt edges) continues to read the same table unchanged.

### 3.5 Frontend
- A **Dependencies** section in the task slide-over: "Waiting on" + "Blocking" lists, each with a
  task-picker **add** and a **remove**. Closing a blocked task surfaces the 409 in a warning modal
  listing the open blockers. (Roadmap/gantt dependency edges already render.)

### 3.6 Tests
- **Unit:** transitive-cycle detection (pure helper mirrored in TS for the picker), status-group
  classification, reschedule Δ math.
- **Integration:** add/remove edge; cycle rejection (direct + transitive); blocked-close → 409;
  reschedule cascade shifts dependents (with cycle guard).
- **e2e:** add a waiting-on dependency, attempt to close the blocked task → warning shown.

### 3.7 Acceptance (BUILD_PLAN)
- [ ] Closing a blocked task triggers the Dependency Warning.
- [ ] Moving a task's date reschedules dependents.

---

## 4. Slice 5b — Relationships + Rollup

### 4.1 Custom-field type additions (`0035_relationships.sql`)
Add `'relationship'` and `'rollup'` to:
- the `CustomFieldType` union in `packages/types/index.ts`,
- the `validators.ts` switch,
- the `CK_CustomFields_Type` CHECK (via `0035`).

`CustomFieldConfig` gains:
```ts
// relationship
relationshipTargetType?: 'any' | 'list';
relationshipTargetListId?: string;   // when targetType = 'list'
// rollup
rollupRelationshipFieldId?: string;  // a 'relationship' field on the same scope
rollupSourceField?: FieldRef;        // builtin key or custom field id to aggregate
rollupFunction?: 'sum' | 'avg' | 'count' | 'min' | 'max' | 'first' | 'concat';
```

### 4.2 Data model — relationship values
New **`TaskRelationships`** link table (source of truth for relationship-field values — **not**
`TaskCustomFieldValues`, so reverse lookups + rollup are clean SQL):
```
TaskRelationships(
  Id UNIQUEIDENTIFIER PK,
  WorkspaceId UNIQUEIDENTIFIER NOT NULL,
  FieldId UNIQUEIDENTIFIER NOT NULL,     -- the 'relationship' CustomFields row
  FromTaskId UNIQUEIDENTIFIER NOT NULL,
  ToTaskId UNIQUEIDENTIFIER NOT NULL,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_TaskRel UNIQUE (FieldId, FromTaskId, ToTaskId)
)
-- indexes on (FieldId, FromTaskId) and (FieldId, ToTaskId)
```
The "value" of a relationship field on task T = `{ ToTaskId | (FieldId, FromTaskId=T) }`.

### 4.3 Stored procedures
- `usp_TaskRelationship_Add(@FieldId, @FromTaskId, @ToTaskId, @WorkspaceId)` (validate both tasks in
  workspace; if `targetType='list'`, validate `ToTaskId` lives in the configured list — checked in
  service or SP), `usp_TaskRelationship_Remove`, `usp_TaskRelationship_ListForTask(@TaskId, @FieldId)`.
- **Rollup is computed in the service** (read-only), not an SP: fetch related task ids via
  `TaskRelationships`, fetch the source-field values (builtin column or `TaskCustomFieldValues`),
  aggregate by `rollupFunction`. Validator rejects writes to `rollup` (like `progress_auto`).

### 4.4 API
- Relationship value get/set: `GET /api/v1/tasks/:taskId/relationships/:fieldId`,
  `PUT /api/v1/tasks/:taskId/relationships/:fieldId` (set the full ToTask id set) + GraphQL mirror.
- Rollup value: surfaced in the task's resolved custom-field values (read path) + GraphQL field.
- Field-manager create/update accepts the two new types' config (validated).
- ACL: `EDIT` on the task's list to set; `VIEW` to read.

### 4.5 Frontend
- Field-manager config UI for `relationship` (target any/list + list picker) and `rollup`
  (pick relationship field + source field + function).
- Task panel + table view: relationship **task-picker** (link/unlink) and a **read-only rollup column**.

### 4.6 Tests
- **Unit:** rollup aggregation (each function; empty set; mixed types), config validation.
- **Integration:** set relationship across two lists (list-to-list); compute rollup pulling a value
  from related tasks; targetType='list' enforcement.
- **e2e:** link two tasks across lists; rollup column shows the aggregated value.

### 4.7 Acceptance (BUILD_PLAN)
- [ ] List-to-list relationship + rollup shows a value pulled from the related task.

### 4.8 Deferral (documented)
Filter/sort/group on `relationship` & `rollup` fields in the Views **query compiler** is **out of
scope** this slice — display + rollup only (consistent with the Phase 3 v1 "column renders but not all
fields filterable" limitation). Logged in `DECISIONS.md`.

---

## 5. Slice 5c — Recurring tasks (on-completion + scheduled)

### 5.1 Data model (`0036_recurrences.sql`)
```
TaskRecurrences(
  Id UNIQUEIDENTIFIER PK,
  TaskId UNIQUEIDENTIFIER NOT NULL,      -- the "template" task (current open occurrence)
  WorkspaceId UNIQUEIDENTIFIER NOT NULL,
  Rule NVARCHAR(MAX) NOT NULL,           -- JSON recurrence rule
  RegenerateMode NVARCHAR(20) NOT NULL,  -- 'on_complete' | 'schedule' | 'both'
  NextRunAt DATETIME2 NULL,              -- for scheduled mode
  Active BIT NOT NULL DEFAULT 1,
  LastSpawnedTaskId UNIQUEIDENTIFIER NULL,
  IncludeDependencies BIT NOT NULL DEFAULT 0,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  DeletedAt DATETIME2 NULL
)
-- index on (Active, NextRunAt) for the scheduler sweep
```
**Rule JSON (RRULE-ish):** `{ freq:'daily'|'weekly'|'monthly'|'yearly', interval:number,
byWeekday?:number[], byMonthday?:number, endsAt?:ISO, count?:number }`.

`computeNextOccurrence(rule, from): Date | null` — **pure, unit-tested** (interval, byWeekday,
month-end clamping, `endsAt`/`count` termination).

### 5.2 Spawn logic
- `usp_Task_CloneForRecurrence(@SourceTaskId, @NewStart, @NewDue, @ActorId)` — clone the task
  (title/description/type/priority/list/estimate) + copy custom-field values, assignees, watchers,
  checklists; reset status to the list's default/first status; apply new dates. `IncludeDependencies`
  controls whether dependency edges are also cloned. Returns the new task. Update
  `TaskRecurrences.LastSpawnedTaskId` + advance `NextRunAt`.

### 5.3 Triggers
- **On-completion:** in `task.service.transitionTask`, after a successful DONE-group transition, if the
  task has an active recurrence with mode incl. `on_complete`, spawn the next occurrence
  (fire-and-forget after the transition commits; errors logged, never block the transition).
- **Scheduled:** a **BullMQ repeatable job** following the `oauth-maintenance.worker.ts` pattern — new
  `apps/api/src/modules/recurrence/recurrence.worker.ts` + queue, `upsertJobScheduler` (e.g. every 15
  min), processor sweeps `TaskRecurrences WHERE Active=1 AND NextRunAt <= now AND mode incl 'schedule'`,
  spawns, advances `NextRunAt`. Bootstrapped at server start alongside the oauth worker; conditional on
  Redis being configured.

### 5.4 API
- `GET / PUT / DELETE /api/v1/tasks/:taskId/recurrence` (set/clear the rule + mode) + GraphQL mirror.
- ACL: `EDIT` on the task's list.

### 5.5 Frontend
- Recurrence editor in the task panel (freq / interval / weekday / monthday / end-condition);
  a recurring badge on recurring tasks.

### 5.6 Tests
- **Unit:** `computeNextOccurrence` across freq/interval/byWeekday/month-end/`endsAt`/`count`;
  regenerate-mode gating.
- **Integration:** set rule → complete task → next occurrence spawned with remapped dates + copied
  fields/assignees/checklists; scheduled sweep spawns due rows and advances `NextRunAt`.
- **e2e:** set a weekly recurrence, complete the task, the next instance appears.

### 5.7 Acceptance (BUILD_PLAN)
- [ ] Recurring task regenerates correctly with the chosen rule.

---

## 6. Slice 5d — Templates (task / list / folder / space)

### 6.1 Data model (`0037_templates.sql`)
```
Templates(
  Id UNIQUEIDENTIFIER PK,
  WorkspaceId UNIQUEIDENTIFIER NOT NULL,
  ScopeType NVARCHAR(8) NOT NULL,       -- 'TASK' | 'LIST' | 'FOLDER' | 'SPACE'
  Name NVARCHAR(255) NOT NULL,
  Description NVARCHAR(MAX) NULL,
  Snapshot NVARCHAR(MAX) NOT NULL,      -- JSON subtree + settings; dates as offsets
  CreatedById UNIQUEIDENTIFIER NOT NULL,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  DeletedAt DATETIME2 NULL,
  CONSTRAINT CK_Templates_Scope CHECK (ScopeType IN ('TASK','LIST','FOLDER','SPACE'))
)
```
**Snapshot-JSON** approach (vs normalized template tables): one JSON blob per template capturing the
subtree + settings. Every date in the snapshot is stored as an **offset (days) from a reference
anchor** so apply can remap to a chosen anchor date.

Snapshot contents by scope:
- **TASK:** title, description, type, priority, estimate, checklists, **subtasks (recursive)**,
  custom-field values, tags. (User-specific assignees captured optionally; default = dropped.)
- **LIST:** list settings (workflow/statuses, custom-field **definitions**, **views**) + each task as a
  task snapshot.
- **FOLDER:** folder + nested lists (each a list snapshot) + subfolders (recursive).
- **SPACE:** space settings (statuses, fields, enabled apps placeholder) + folders + lists.

### 6.2 Capture & apply (`template.service`)
- **Capture** composes existing reads (hierarchy tree, tasks, custom fields, views, checklists) into
  the snapshot; no new read SPs unless a gap is found.
- **Apply** recreates the subtree using existing create SPs (`usp_Project_Create` / `usp_Folder_Create`
  / `usp_List_Create` / `usp_Task_Create` + custom-field create + `usp_View_Create`), generating fresh
  IDs, building `Path` from parent paths, **remapping dates** from the chosen anchor, with an
  **"import selected items"** subset option (`selectedItemIds`).
- `remapDate(offsetDays, anchorDate)` — pure, unit-tested.

### 6.3 API
- `POST /api/v1/templates` — create from a source node `{ scopeType, sourceId, name, description? }`.
- `GET /api/v1/templates?scopeType=` — list workspace templates.
- `GET /api/v1/templates/:id` — read (incl. snapshot for the apply preview).
- `POST /api/v1/templates/:id/apply` — `{ targetParentId, anchorDate, selectedItemIds? }`.
- `DELETE /api/v1/templates/:id` — soft delete.
- GraphQL mirror for all of the above.
- ACL: **capture** needs `VIEW` on the source node; **apply** needs the create permission at the target
  parent (`project.create` for SPACE, list/folder create perms for LIST/FOLDER) + `EDIT` on the target.

### 6.4 Frontend
- "Save as template" action on space / folder / list / task.
- Create-template modal; apply / "create from template" modal (target picker, date anchor, item
  selection); a basic **Template Center** list.

### 6.5 Tests
- **Unit:** `remapDate` offset math; snapshot shape builders.
- **Integration:** capture a LIST template → apply → recreates tasks + fields + views with remapped
  dates; TASK template apply; FOLDER + SPACE subtree apply.
- **e2e:** save a list as a template, apply it, verify the recreated tasks.

### 6.6 Acceptance (BUILD_PLAN)
- [ ] Applying a list template recreates tasks, fields, views, and remaps dates.

---

## 7. Execution model

Each slice is executed via **subagent-driven-development** (a fresh implementer subagent per task +
a two-stage spec/quality review per task, matching the 3.5a/b/c flow). After a slice:
1. Verify on **local Docker `ProjectFlow_Test`**: API unit + integration, web unit + i18n parity,
   `npm run build`, and the slice's e2e headline flow.
2. Record decisions/deviations in `DECISIONS.md`.
3. **Stop for review / merge** before starting the next slice.

Slices are ordered 5a → 5b → 5c → 5d. 5b's relationship field type is independent of 5a; 5c and 5d
build on the task model but not on 5a/5b. The order matches BUILD_PLAN and keeps each slice's blast
radius small.

---

## 8. Consolidated deferrals (logged for `DECISIONS.md`)
1. **5a:** dependency reschedule cascade runs **synchronously** (visited-set guarded); BullMQ offload
   for very large cascades is a follow-up.
2. **5b:** `relationship` / `rollup` fields are **not filterable/sortable/groupable** in the Views
   query compiler this slice — display + rollup only.
3. **5a gating:** *Dependency Warning* / *Reschedule* are **always-on**; the `apps_enabled` per-scope
   toggle is Phase 10.
4. **5d:** assignee capture in TASK templates **defaults to dropped** (user-specific); can be made
   optional later.
