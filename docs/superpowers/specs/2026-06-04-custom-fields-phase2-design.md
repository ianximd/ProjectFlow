# Phase 2 — Custom Fields + Custom Task Types + Tags · Design

> **Status:** Approved design (2026-06-04). Next step: implementation plan via
> `superpowers:writing-plans` → `docs/superpowers/plans/2026-06-xx-custom-fields-phase2.md`.
>
> **Source of truth:** `BUILD_PLAN.md` §2.3–2.6 + PHASE 2 acceptance. Builds on the
> Phase 1 hierarchy design (`docs/superpowers/specs/2026-06-03-clickup-hierarchy-design.md`)
> and the live Phase 1 code conventions on `main` (tip `6580ccc`).
> **Branch:** `feat/custom-fields-phase2` (off `main` after Phase 1 fast-forward merge).
> Deviations recorded in `DECISIONS.md`.

---

## 0. Goal & scope

Add flexible task data to the Phase 1 spine: **custom fields** (15 type wave 1) with
location-scoped downward cascade, **configurable task types** (+ milestone), **tags** at
Space scope, **watchers**, and a **multiple-assignees toggle**. Backend (REST + GraphQL
mirror, one shared service per entity) + frontend (field manager, inline render/edit,
pickers). One reversible forward-only migration (0030) carries all schema.

### Locked decisions (from brainstorming, 2026-06-04)

1. **Tags reuse the existing `Labels` table.** `dbo.Labels` is already `ProjectId`(=Space)-scoped
   and colored, with a `TaskLabelLinks` FK junction — functionally ClickUp "Space tags." Phase 2
   exposes a Tag-terminology API/UI over `Labels` + `TaskLabelLinks`. **No new `Tags`/`TaskTags`
   tables.** Legacy string `TaskLabels` junction is left untouched.
2. **Task types are additive.** New `TaskTypes` table + nullable `Tasks.TaskTypeId` FK. Legacy
   `Tasks.Type` (`NVARCHAR(20)` enum `EPIC/STORY/TASK/BUG/…`) is **kept populated and in sync**, never
   dropped, because board categories and the roadmap depend on it. Lowest blast radius, reversible.
3. **Multiple-assignees gate = Space-level column.** `Projects.MultipleAssignees BIT NOT NULL
   DEFAULT 1`, mirroring the `Visibility`/`MaxSubtaskDepth` space settings added in migration 0029.
   The Phase 10 `apps_enabled` table is **not** pulled forward; migrate the gate there in Phase 10.
4. **One plan, four ordered work-streams** (A Custom Fields → B Task Types → C Tags → D
   Watchers + multi-assignee), with a review checkpoint between streams. Schema for all four ships in
   migration 0030.

### House-style invariants this design follows

- Stored-proc-per-op: `CREATE OR ALTER`, `SET NOCOUNT ON`, `BEGIN TRY/CATCH … THROW`, custom THROW
  codes (51xxx range), `SELECT *` return. Repositories call `execSpOne`/`execSp`; services hold
  logic; **both** the Hono REST routes and the Pothos GraphQL mirror delegate to one shared service
  per entity. Types hand-written in `packages/types/index.ts`.
- Frontend SSR: `serverFetch` queries + server actions + `revalidatePath`.
- Migrations forward-only with a committed `rollback/<n>.down.sql`. **Any `NOT NULL … DEFAULT`
  column creates an auto-named DEFAULT constraint** the down script must drop dynamically (via
  `sys.default_constraints`) before `DROP COLUMN` — this bit us in 0029 (`Projects.Visibility`).
- Access control via `requireObjectAccess(LEVEL, selector)` on the relevant SPACE/FOLDER/LIST node;
  every mutation calls `pubsub.publish`.

---

## A. Data model — migration 0030 (`infra/sql/migrations/0030_custom_fields.sql` + `rollback/0030_custom_fields.down.sql`)

All `CREATE`/`ALTER` guarded by `IF NOT EXISTS`, batched with `GO`, idempotent.

### New tables

```sql
dbo.CustomFields
  Id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  WorkspaceId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Workspaces(Id),
  ScopeType   NVARCHAR(8)  NOT NULL,              -- 'SPACE'|'FOLDER'|'LIST'
  ScopeId     UNIQUEIDENTIFIER NOT NULL,
  ScopePath   NVARCHAR(900) NOT NULL,             -- materialized; copied from the scope node's Path
  Type        NVARCHAR(20) NOT NULL,              -- one of the 15 wave-1 types
  Name        NVARCHAR(255) NOT NULL,
  Config      NVARCHAR(MAX) NULL,                 -- JSON, shape per type
  Required    BIT NOT NULL DEFAULT 0,
  Position    FLOAT NOT NULL DEFAULT 0,
  CreatedAt   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  DeletedAt   DATETIME2 NULL,
  CONSTRAINT CK_CustomFields_ScopeType CHECK (ScopeType IN ('SPACE','FOLDER','LIST')),
  CONSTRAINT CK_CustomFields_Type CHECK (Type IN (
    'text','text_area','number','currency','checkbox','date','url','email','phone',
    'dropdown','labels','rating','people','progress_manual','progress_auto'))
  -- Indexes: IX_CustomFields_Scope (ScopeType, ScopeId, Position); IX_CustomFields_Path (ScopePath)

dbo.TaskCustomFieldValues
  TaskId    UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Tasks(Id),
  FieldId   UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.CustomFields(Id),
  Value     NVARCHAR(MAX) NULL,                   -- JSON-encoded, shape per type
  UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_TaskCustomFieldValues PRIMARY KEY (TaskId, FieldId)
  -- Index: IX_TCFV_Field (FieldId)

dbo.TaskTypes
  Id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  WorkspaceId  UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Workspaces(Id),
  NameSingular NVARCHAR(100) NOT NULL,
  NamePlural   NVARCHAR(100) NOT NULL,
  Icon         NVARCHAR(50) NULL,
  IsMilestone  BIT NOT NULL DEFAULT 0,
  IsDefault    BIT NOT NULL DEFAULT 0,
  Position     FLOAT NOT NULL DEFAULT 0,
  CreatedAt    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  DeletedAt    DATETIME2 NULL,
  CONSTRAINT UQ_TaskTypes_Name UNIQUE (WorkspaceId, NameSingular)

dbo.TaskWatchers
  TaskId    UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Tasks(Id),
  UserId    UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Users(Id),
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_TaskWatchers PRIMARY KEY (TaskId, UserId)
```

### Alters

- `Tasks.TaskTypeId UNIQUEIDENTIFIER NULL REFERENCES dbo.TaskTypes(Id)` + `IX_Tasks_TaskType`.
- `Projects.MultipleAssignees BIT NOT NULL DEFAULT 1`.

### Backfill (idempotent, in the same migration file, after table creation)

- For every Workspace lacking them, seed `TaskTypes`: `"Task"`/`"Tasks"` (`IsDefault=1`),
  `"Milestone"`/`"Milestones"` (`IsMilestone=1`).
- `UPDATE Tasks SET TaskTypeId = <workspace default Task type> WHERE TaskTypeId IS NULL`.
- Re-runnable: only seeds/sets where missing.

### Rollback (`0030_custom_fields.down.sql`) — reverse dependency order, idempotent

- Drop `IX_Tasks_TaskType`; drop the `Tasks.TaskTypeId` FK (dynamic name lookup) then the column.
- Drop `TaskWatchers`, `TaskCustomFieldValues`, `CustomFields`, `TaskTypes` (children first).
- **Auto-named DEFAULT constraint drops (the 0029 lesson):** `Projects.MultipleAssignees` was added
  `NOT NULL DEFAULT 1` → look up its `DF__Projects__Multi…` constraint in `sys.default_constraints`
  and `ALTER TABLE … DROP CONSTRAINT` it before `DROP COLUMN`. (`TaskTypes.IsMilestone/IsDefault`
  default constraints vanish with the table drop, so no separate handling.)
- `DELETE FROM dbo.MigrationHistory WHERE [FileName] = '0030_custom_fields.sql';`

---

## B. Field-type wave 1 — value shapes + validation (15 types)

**Validation lives in the TS service layer** (one validator per type, returns 422 with a field list
on failure). The stored proc only upserts the JSON value. Values stored JSON-encoded in
`TaskCustomFieldValues.Value`:

| Type | Value JSON | Config JSON | Validation |
|---|---|---|---|
| `text`, `text_area` | `"string"` | — | length |
| `url` | `"string"` | — | URL shape |
| `email` | `"string"` | — | email shape |
| `phone` | `"string"` | — | phone shape |
| `number` | `42.5` | `{ precision? }` | numeric |
| `currency` | `1234.5` | `{ currencyCode }` | ISO-4217 code valid |
| `checkbox` | `true` | — | boolean |
| `date` | `"ISO-8601"` | `{ includeTime? }` | parseable date |
| `dropdown` | `"optionId"` | `{ options:[{id,name,color}] }` | option exists |
| `labels` | `["optionId", …]` | `{ options:[{id,name,color}] }` | all options exist |
| `rating` | `3` | `{ max:5 }` | integer 0..max |
| `people` | `["userId", …]` | — | each is a workspace member |
| `progress_manual` | `0..100` | — | integer 0..100 |
| `progress_auto` | *computed, read-only* | `{ source:'subtasks' }` | rejects direct writes (422) |

### `progress_auto` source (wave-1 decision)

Checklists do not exist until a later phase, so wave-1 `progress_auto` = **percentage of direct
subtasks in a DONE-category status**. Recomputed when a child subtask is created, deleted, or
transitioned. (A `checklist` source is added when checklists land.)

### Required-field enforcement (decision)

Required fields **block a transition into a DONE-category status** (HTTP 422,
`code: CUSTOM_FIELD_REQUIRED`, body lists the missing field ids/names) — matching the BUILD_PLAN
acceptance wording "Required field blocks status→done." Required is **not** enforced on every save,
so drafts remain editable.

---

## C. Field resolver / cascade (reuses the Phase 1 path mechanism)

`usp_CustomField_EffectiveForTask @TaskId` returns the effective field set via **materialized-Path
prefix match** — the same mechanism as `usp_List_EffectiveStatuses` and the ObjectPermissions ACL.
A field applies to a task when its `ScopePath` is a prefix of the task's `Tasks.ListPath`:

- SPACE-level fields cascade to every list beneath the space.
- FOLDER-level fields cascade to lists in that folder/subfolders.
- LIST-level fields stay local to that list.

Ordering by (depth, Position). No new path algorithm — reuses `apps/api/src/modules/hierarchy/path.ts`.
The proc returns each effective field joined to the task's current `TaskCustomFieldValues.Value`
(NULL when unset).

---

## D. API surface (REST routes + Pothos GraphQL mirror; one shared service per entity)

New modules follow the Phase 1 layout exactly:
`*.repository.ts` (`execSpOne`) → `*.service.ts` (logic, UUID upper-cased, validation) →
`*.routes.ts` (Hono + `zValidator` + `requireObjectAccess` + `pubsub.publish`) →
GraphQL mirror via `registerXGraphql(builder)` delegating to the same service.

### `modules/customfields`
Procs: `usp_CustomField_Create/Update/Delete/List/Reorder`, `usp_CustomField_EffectiveForTask`,
`usp_TaskCustomFieldValue_Set/Delete`.

- `POST /custom-fields` — create at SPACE/FOLDER/LIST. ACL `EDIT` on the scope node. Service
  materializes `ScopePath` from the scope node's `Path`.
- `GET /custom-fields?scopeType&scopeId` — fields defined directly at a node. ACL `VIEW`.
- `PATCH /custom-fields/:id` (`EDIT`) · `DELETE /custom-fields/:id` (`FULL`, soft delete).
- `PATCH /custom-fields/:id/reorder` (`EDIT`).
- `GET /tasks/:id/fields` — **effective** field set + current values. ACL `VIEW` on the task's list.
- `PUT /tasks/:id/fields/:fieldId` — set one value; per-type validation → 422 on failure. ACL `EDIT`.

### `modules/tasktypes`
Procs: `usp_TaskType_Create/Update/Delete/List`.

- `GET /task-types` (workspace-scoped) · `POST /task-types` · `PATCH/DELETE /task-types/:id`.
- `PATCH /tasks/:id/type` — set `TaskTypeId`; service **keeps legacy `Tasks.Type` in sync**
  (milestone/custom → a sensible enum bucket; default Task type → `'TASK'`).

### Tags (delegates to existing `Labels` + `TaskLabelLinks`)
Thin Tag surface; reuse existing label procs where possible, add `usp_Tag_*` wrappers only if needed.

- `GET /spaces/:spaceId/tags` · `POST /spaces/:spaceId/tags` (create, optional color).
- `DELETE /tags/:id`.
- `POST /tasks/:id/tags/:tagId` · `DELETE /tasks/:id/tags/:tagId` (link/unlink via `TaskLabelLinks`).

### Watchers (`modules/watchers` or folded into tasks)
Procs: `usp_TaskWatcher_Add/Remove/List`.

- `GET /tasks/:id/watchers` · `POST /tasks/:id/watchers/:userId` · `DELETE /tasks/:id/watchers/:userId`.
- Auto-watch on `@mention`/assignment is **Phase 4** scope, not here.

### Multi-assignee gate
- `PATCH /spaces/:id` accepts `multipleAssignees: boolean` (extends the existing Space settings PATCH).
- `setAssignees` service rejects >1 assignee with 422 (`code: MULTIPLE_ASSIGNEES_DISABLED`) when the
  space has the toggle off.

Every mutation publishes a `pubsub` event (`customfield:updated`, `tasktype:updated`,
`task:updated`, `tag:updated`, `watcher:updated`), consistent with Phase 1.

---

## E. Types (`packages/types/index.ts`, hand-written)

New exports:

- `CustomFieldType` — union of the 15 wave-1 type strings.
- `CustomFieldScopeType` = `'SPACE' | 'FOLDER' | 'LIST'`.
- `CustomFieldConfig` — discriminated union keyed by field type (dropdown/labels options,
  currencyCode, rating max, progress source, number precision, date includeTime).
- `CustomField` (row shape), `TaskCustomFieldValue`, `EffectiveField` (field + current value).
- `TaskType`, `Tag` (alias over the existing `Label` shape), `TaskWatcher`.
- Extend `Task`: `taskTypeId: string | null`, `tagIds: string[]`, `watcherIds: string[]`. The
  vestigial `customFields: Record<string, unknown>` is repurposed to carry resolved
  `{ [fieldId]: value }` for a task.
- Extend `SpaceExtras`: `multipleAssignees: boolean`.

---

## F. Frontend (Next.js SSR — `serverFetch` queries + server actions + `revalidatePath`)

- **Field Manager UI** — in Space/Folder/List settings: create/edit/reorder/delete fields, a type
  picker, and a per-type config editor (dropdown options, currency code, rating scale, etc.).
  Server actions in `server/actions/custom-fields.ts`; queries in `server/queries/custom-fields.ts`.
- **Inline render/edit per type** — a `<CustomFieldCell field value onChange>` dispatcher with one
  small focused component per type under `components/custom-fields/types/`, reused in **both** the
  List view (as columns) and the TaskDrawer. Edits go through a server action + `revalidatePath`.
- **Task-type selector** with custom icon; **milestone** renders a diamond marker placeholder.
- **Tag picker** (reads space tags, create-on-the-fly with color), **watcher add/remove** control,
  **multi-assignee picker** that collapses to a single-select when the space toggle is off.

Each type editor is its own file so components stay small and independently testable.

---

## G. Testing & verification (local Docker MSSQL only — never prod)

TDD where specified: per-type validators, field resolver cascade, required-on-done.

- **Unit** (`apps/api`): 15 per-type value validators; config validation; path-prefix resolver
  helper; legacy-`Type` sync mapping.
- **Integration** (`ProjectFlow_Test`): field CRUD; **scoping cascade** (a Space-level field appears
  on a nested list's task; a List-level field stays local); value set/validate/persist round-trip;
  `progress_auto` recompute on subtask transition; **required-blocks-done 422**; task-type
  seed/assign + legacy-`Type` sync; tag link/unlink; watcher add/remove; **multi-assignee gate 422**;
  a **multitenancy scope** assertion on every new repository method.
- **e2e** (Playwright — headline flow): create a Space-level `dropdown` + a `required text` field →
  see both cascade onto a list's task → edit inline → blocked from moving to Done until the required
  field is filled → succeeds once filled.
- **Reversibility:** apply 0030, then run `0030_custom_fields.down.sql` on a scratch DB; assert a
  clean teardown (auto-named DEFAULT-constraint drop verified).
- **Regression:** `/board`, `/backlog`, `/roadmap` still render 200 (legacy `Type` intact).
- **Real test output is pasted before any step is claimed to pass.**

---

## H. Work-stream sequencing (one plan, four streams; review checkpoint between each)

Migration 0030 carries all schema (A–D) so the phase has one reversible forward-only migration;
code lands stream-by-stream.

1. **Stream A — Custom Fields engine** (bulk): 0030 tables/procs, resolver, 15 validators, REST +
   GraphQL, field manager + inline cells, headline e2e.
2. **Stream B — Task Types**: table, seed/backfill, `TaskTypeId`, selector, milestone marker,
   legacy-`Type` sync.
3. **Stream C — Tags**: Tag surface over `Labels` + `TaskLabelLinks`, tag picker.
4. **Stream D — Watchers + multi-assignee gate**: `TaskWatchers`, `Projects.MultipleAssignees`,
   watcher + multi-assignee pickers.

---

## I. Acceptance-criteria mapping (BUILD_PLAN PHASE 2)

| BUILD_PLAN acceptance box | Covered by |
|---|---|
| All wave-1 field types created, edited inline, validated, persisted | B (types/validators), D (`PUT /tasks/:id/fields/:fieldId`), F (inline cells), G |
| Adding a field at a Space cascades to all lists beneath; List-level stays local | A (`ScopePath`), C (resolver), G integration |
| `progress_auto` updates when subtasks complete | B (subtasks source), G integration |
| Required field blocks status→done with 422 + clear UI message | B/C (enforcement), D, F, G integration |
| Custom task types render with icon + plural/singular names | A/B (TaskTypes), E, F |

---

## J. Out of scope for Phase 2 (deferred, per BUILD_PLAN)

- Field types beyond wave 1: `tasks`, `relationship`/rollup, `location`, `files`, `formula`,
  `ai_field`, `voting` (later phases).
- Checklist-sourced `progress_auto` (checklists land in a later phase).
- `apps_enabled` toggle infrastructure (Phase 10) — multi-assignee uses the Space column for now.
- Auto-watch on mention/assignment (Phase 4 realtime/comments).
- Field-scoping by task type ("beta-style", a later phase).
