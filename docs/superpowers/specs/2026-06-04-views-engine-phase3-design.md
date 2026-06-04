# Design: ClickUp-style features for ProjectFlow — Phase 3 (Views Engine)

**Date:** 2026-06-04
**Status:** Approved (design); ready for implementation planning
**Roadmap source:** `docs/superpowers/specs/2026-06-03-clickup-hierarchy-design.md` §1 (Phase 3 = Views Engine, BUILD_PLAN P3)
**Predecessors:** Phase 1 (Nesting Hierarchy, merged), Phase 2 (Custom Fields + Task Types + Tags + Watchers, merged @ `60d30b0`)

---

## 0. Context & framing decisions

Phase 3 delivers the **Views Engine**: savable, shareable views (List / Board / Table / Calendar)
backed by a structured query model that can filter / group / sort by **both built-in and
user-defined custom fields**, plus Me-mode and bulk edit.

This is the first phase to introduce **view/filter persistence** — today filters are URL-only and
ephemeral (`board-view.tsx` / `backlog-view.tsx` read `searchParams`), and the existing task-list
SPs (`usp_Task_List`, `usp_Task_Search_PQL`) take **fixed parameters** and cannot express arbitrary
predicates over N user-defined custom fields.

**Decisions taken during brainstorming (this document is the record):**

1. **Scope = the full phase in one spec:** query engine + saved views + List/Board/Table/Calendar +
   filter/group/sort + Me-mode + bulk edit. (Matches how Phases 1 & 2 shipped whole.)
2. **Query engine = a TypeScript query compiler → parameterized SQL.** A typed filter AST is compiled
   in a TS module into a single parameterized SQL statement and executed through the `mssql`
   parameterized request API. This is a **deliberate, documented exception** to the repo's
   "one stored procedure per operation" house style — recorded in `DECISIONS.md` — and is confined to
   the *one* layer whose query shape is inherently dynamic. Identifiers are strictly allow-listed;
   every value is a bound parameter. (Alternatives rejected: extending fixed-param SPs — cannot express
   arbitrary custom-field predicates; dynamic T-SQL via `sp_executesql` in an SP — far harder to test
   and maintain than a pure TS compiler.)
3. **Saved-view persistence = location-attached + shared/private.** A `SavedView` attaches to a node
   (List / Folder / Space / "Everything"@workspace), has a `Type` and a JSON `Config`, an owner, and an
   `IsShared` flag. Reuses the Phase-1 materialized-path scoping for ACL. (Alternatives rejected:
   per-user-only — loses team-standard views; workspace-level + location-in-config — loses per-node
   view tabs and permission inheritance.)
4. **Surface = retrofit.** The new engine is the **single rendering path**: the existing `/board` page
   is re-implemented as a default `board` saved view driven by the engine (Kanban UI component reused;
   bespoke `getTasks` fetch retired only after parity). `/backlog` (sprint planning) and `/roadmap`
   (Gantt) are **not** among the four view types and are untouched this phase. (Alternatives rejected:
   parallel new surface leaving a duplicate board path; full replace/redirect of `/board` + `/lists`
   this phase — too much scope/risk.)

Conventions to follow (observed in repo; see `apps/next-web/CLAUDE.md` → `AGENTS.md` and Phase 1/2 modules):
- Backend layering: GraphQL resolver (Pothos) → service → repository → stored procedure.
  Phase 2 added features via **GraphQL** (`apps/api/src/graphql/customfields.schema.ts`); Phase 3
  follows the same GraphQL-first surface.
- Data access = one stored procedure per operation (`CREATE OR ALTER PROCEDURE`, `SET NOCOUNT ON`,
  `BEGIN TRY/CATCH`, `THROW` with custom codes, return rows via `SELECT *`) — **except** the dynamic
  task query (decision 2).
- Migrations = numbered idempotent SQL files in `infra/sql/migrations/` with `IF NOT EXISTS` guards.
  Latest is `0031_tasktype_name_filtered_unique.sql`; this phase adds `0032_saved_views.sql`.
- IDs are `UNIQUEIDENTIFIER DEFAULT NEWID()`. Every tenant-scoped table has `WorkspaceId NOT NULL`.
- Next.js 16 has breaking changes — read `node_modules/next/dist/docs/` before writing web code.

---

## 1. Architecture overview

A new `views` backend module with a `views/query` sub-package, plus a frontend view surface.

```
GraphQL (graphql/views.schema.ts)
   → ViewService
        (permission checks via Phase-1 resolveAccess; ViewConfig validation;
         me-mode overlay; bulk-edit orchestration)
      → ViewRepository
          ├─ SavedView CRUD        → usp_View_* stored procedures (fixed-param, house style)
          └─ dynamic task querying → QueryCompiler (TS, pure) → parameterized SQL via mssql request
```

Module layout (mirrors `apps/api/src/modules/tasks` and `…/customfields`):

```
apps/api/src/modules/views/
  view.service.ts
  view.repository.ts
  view.routes.ts            # optional REST parity; GraphQL is the primary surface
  query/
    field-catalog.ts        # allow-list of queryable fields (built-in + custom) for a scope
    compiler.ts             # pure: FilterGroup + sort -> { whereSql, orderSql, params }
    types.ts                # FieldRef, Operator, FilterRule, FilterGroup, SortKey, ViewConfig (re-exported from packages/types)
  __tests__/
    compiler.unit.test.ts
    view.integration.test.ts
apps/api/src/graphql/views.schema.ts
infra/sql/migrations/0032_saved_views.sql
infra/sql/procedures/usp_View_Create.sql  (+ _Update / _Delete / _List / _Reorder / _GetWorkspaceId)
```

---

## 2. Data model — migration `0032_saved_views.sql` (reversible)

One new table. No changes to `Tasks` / `CustomFields` — the engine reads existing tables.

**New table `SavedViews`**
```
Id           UNIQUEIDENTIFIER PK DEFAULT NEWID()
WorkspaceId  UNIQUEIDENTIFIER NOT NULL -> Workspaces(Id)          -- tenant scope
OwnerId      UNIQUEIDENTIFIER NOT NULL -> Users(Id)
ScopeType    NVARCHAR(12) NOT NULL  CHECK (ScopeType IN ('LIST','FOLDER','SPACE','EVERYTHING'))
ScopeId      UNIQUEIDENTIFIER NULL                                -- NULL only when ScopeType='EVERYTHING'
ScopePath    NVARCHAR(900) NULL                                  -- denormalized container Path (Phase-1) for ACL/scope prefix
Type         NVARCHAR(10) NOT NULL  CHECK (Type IN ('list','board','table','calendar'))
Name         NVARCHAR(255) NOT NULL
IsShared     BIT NOT NULL DEFAULT 0                              -- shared: visible to anyone with node access; else owner-only
IsDefault    BIT NOT NULL DEFAULT 0                              -- the node's default tab
Config       NVARCHAR(MAX) NOT NULL                              -- typed ViewConfig JSON (see §3.4)
Position     FLOAT NOT NULL DEFAULT 0                            -- fractional tab order (reuse existing algorithm)
CreatedAt    DATETIME2 NOT NULL DEFAULT GETUTCDATE()
UpdatedAt    DATETIME2 NOT NULL DEFAULT GETUTCDATE()
DeletedAt    DATETIME2 NULL
```

**Indexes**
```
IX_SavedViews_Scope (WorkspaceId, ScopeType, ScopeId, Position)   -- list views at a node in order
IX_SavedViews_Owner (OwnerId)                                     -- a user's private views
```

**Constraints / rules**
- `CHECK (ScopeType = 'EVERYTHING' OR ScopeId IS NOT NULL)` — non-Everything views must name a node.
- A `CONSTRAINT` is not needed for default uniqueness in v1; the service ensures at most one
  `IsDefault=1` per (scope, type) when toggling default (set-based update inside `usp_View_Update`).
- **Down migration** drops `SavedViews` (and its indexes) — no data dependencies elsewhere.

> `Config` is opaque to SQL. It is validated/typed in TS against the `ViewConfig` schema (§3.4) before
> persistence; the SP stores it verbatim.

---

## 3. The query engine

Three units under `apps/api/src/modules/views/query/`.

### 3.1 `field-catalog.ts`
Given `(workspaceId, scopeType, scopeId)`, returns the allow-list of queryable fields:

- **Built-in fields** (fixed map → physical `Tasks` columns / known joins): `status`, `priority`,
  `type` (task type), `assignee` (via `TaskAssignees`), `reporter`, `sprint`, `tags`, `watchers`,
  `dueDate`, `startDate`, `createdAt`, `updatedAt`, `title`, `storyPoints`, `position` (the existing
  fractional kanban order; default sort key). Each entry carries a logical type
  (`string|number|date|enum|user|array`) and how it maps to SQL (column or EXISTS-join).
- **Custom fields** effective at the scope (from `CustomFields`, resolved by `ScopePath` prefix as in
  Phase 2's `effectiveForTask`), each carrying its `Type` (text, number, currency, checkbox, date, url,
  email, phone, dropdown, labels, rating, people, progress_manual, progress_auto).

A `FieldRef` is `{ kind: 'builtin' | 'custom', key: string }`. For `custom`, `key` is the `FieldId`
**GUID** (validated against the catalog) — never a raw user string concatenated into SQL.

The catalog is the **single source of allow-listing**: any `FieldRef` / operator not present or not
valid for the field's type is rejected before compilation (`THROW`/422-equivalent).

### 3.2 `compiler.ts` (pure, the unit-test priority)
`compile({ filter, sort, scope, workspaceId, catalog }) → { whereSql, orderSql, params }`.

- **Filter AST**
  - `FilterGroup { conjunction: 'AND' | 'OR', rules: Array<FilterRule | FilterGroup> }` — arbitrary
    nesting → `( … AND/OR … )`.
  - `FilterRule { field: FieldRef, op: Operator, value?: unknown }`.
- **Built-in rule** → `t.<MappedColumn> <op> @pN`, or an `EXISTS (…)` for join-backed fields
  (`assignee` → `EXISTS (SELECT 1 FROM TaskAssignees a WHERE a.TaskId=t.Id AND a.UserId=@pN)`;
  `tags` / `watchers` similarly).
- **Custom-field rule** →
  ```sql
  EXISTS (SELECT 1 FROM TaskCustomFieldValues v
          WHERE v.TaskId = t.Id AND v.FieldId = @pK
            AND <typed compare on JSON_VALUE(v.Value,'$')>)
  ```
  The `<typed compare>` casts by the field's `Type`:
  - number / currency / rating / progress_* → `CAST(JSON_VALUE(v.Value,'$') AS FLOAT) <op> @pN`
  - date → `CAST(JSON_VALUE(v.Value,'$') AS DATETIME2) <op> @pN`
  - checkbox → compare to `'true'`/`'false'`
  - text / url / email / phone / dropdown → string compare (`=`, `!=`, `LIKE` for `contains`)
  - labels / people (array-valued) → membership via
    `EXISTS (SELECT 1 FROM OPENJSON(v.Value) j WHERE j.value = @pN)`
- **Operators** from a fixed enum: `= , != , > , >= , < , <= , in , not_in , contains , is_empty ,
  is_not_empty`. Operator validity is gated per field type by the catalog. `is_empty` /
  `is_not_empty` map to `NULL` / `NOT EXISTS` checks (and empty-string handling for text).
- **Always-injected base predicate** (centralizes the multitenancy + scope + soft-delete guard, so no
  view query can omit it):
  ```sql
  t.WorkspaceId = @ws AND t.DeletedAt IS NULL
  AND (<scope prefix>)
  ```
  where `<scope prefix>` is `t.ListPath LIKE @scopePrefix` for LIST/FOLDER/SPACE (Phase-1 materialized
  path, e.g. `'/{spaceId}/%'`), and omitted (TRUE) for EVERYTHING (still workspace-bounded).
- **Sort** (`SortKey[]`, multi-key): built-in → allow-listed column + `ASC|DESC`; custom-field → typed
  `JSON_VALUE` with the same cast rules. Unknown sort fields rejected.

All values are emitted as bound parameters (`@p0, @p1, …`); identifiers come only from the catalog /
operator enum. No user string is ever concatenated into SQL.

### 3.3 `view.repository.ts` (query execution)
Assembles and runs:
```sql
SELECT t.*  FROM Tasks t  WHERE {whereSql}  ORDER BY {orderSql}
OFFSET @off ROWS FETCH NEXT @size ROWS ONLY;
```
through the `mssql` **parameterized** request (`request.input('p0', …)`), plus:
- a parallel `SELECT COUNT(*) FROM Tasks t WHERE {whereSql}` for pagination metadata, and
- when `config.groupBy` is set, a grouped-count query
  `SELECT <groupExpr> AS GroupKey, COUNT(*) FROM Tasks t WHERE {whereSql} GROUP BY <groupExpr>`
  to produce accurate group-header counts without fetching all rows.

Assignees for the returned page are loaded with the existing pattern (a follow-up query keyed by the
page's task ids), consistent with `usp_Task_List`'s third result set.

**Pagination = offset-based** (`OFFSET … FETCH`), matching the existing codebase. (Keyset pagination is
a deferred optimization, not v1.)

### 3.4 `ViewConfig` (typed, in `packages/types`)
```ts
type FieldRef = { kind: 'builtin' | 'custom'; key: string };
type Operator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'not_in'
              | 'contains' | 'is_empty' | 'is_not_empty';
type FilterRule  = { field: FieldRef; op: Operator; value?: unknown };
type FilterGroup = { conjunction: 'AND' | 'OR'; rules: Array<FilterRule | FilterGroup> };
type SortKey     = { field: FieldRef; dir: 'ASC' | 'DESC' };

type ViewConfig = {
  filter: FilterGroup;          // default: { conjunction:'AND', rules:[] } = no filter
  groupBy?: FieldRef;           // List/Table grouping; Board groups by status implicitly
  sort: SortKey[];              // default: [{ field:{kind:'builtin',key:'position'}, dir:'ASC' }]
  columns?: FieldRef[];         // Table visible columns (built-in + custom)
  dateField?: FieldRef;         // Calendar: which date drives placement (default builtin dueDate)
  meMode?: boolean;             // persisted me-mode (overlay also available per-request, §6)
  pageSize?: number;            // default 25 (matches existing)
};
```
`ViewService` validates `Config` against this shape and against the field-catalog before persisting.

### 3.5 Grouping decision
The engine returns a **flat filtered + sorted page**; grouping is applied as follows:
- **List / Table** — group **client-side** by `config.groupBy`; group-header counts come from the §3.3
  grouped-count query.
- **Board** — issues one filtered page + count **per workflow status column** (mirrors the existing
  board pattern in `board-view.tsx`), with status columns sourced from the node's effective workflow.

(YAGNI: no server-side per-group pagination in v1.)

---

## 4. GraphQL API — `apps/api/src/graphql/views.schema.ts`

**Types**
- `SavedView { id, workspaceId, ownerId, scopeType, scopeId, type, name, isShared, isDefault,
  config(JSON string), position }`
- `ViewGroup { key: String!, label: String!, count: Int! }`
- `ViewTaskPage { tasks: [Task!]!, total: Int!, groups: [ViewGroup!] }`

**Queries**
- `savedViews(scopeType, scopeId)` — views visible to the caller at the node = shared ∪ own-private,
  ordered by `Position`.
- `viewTasks(viewId, page, meMode)` — run a **saved** view through the engine; `meMode` overlays at
  request time without mutating the stored config.
- `previewViewTasks(scopeType, scopeId, config, page)` — run an **unsaved** `ViewConfig` (live filter
  editing before "Save view").

**Mutations**
- `createSavedView(input) / updateSavedView(id, input) / deleteSavedView(id) / reorderSavedView(id, position)`
- `bulkUpdateTasks(input)` — see §6.

**Resolver rules**
- Delegate to `ViewService`, which calls Phase-1 `resolveAccess(userId, node)` for the scope node
  (private Space → non-members **403**; `viewTasks`/`previewViewTasks` require read on the node;
  mutations require the appropriate write level).
- Validate `Config` against `ViewConfig` (§3.4) + field-catalog before persist.
- Mutations honor `Idempotency-Key` and publish `pubsub` events: `savedView:updated` on CRUD, and
  `task:updated` per affected task on bulk edit (consistent with existing modules).

**Stored procedures** (house style, fixed-param): `usp_View_Create`, `usp_View_Update`,
`usp_View_Delete`, `usp_View_List`, `usp_View_Reorder`, `usp_View_GetWorkspaceId` (for the standard
workspace-ownership guard used by other modules).

---

## 5. Frontend — retrofit Board + new view surface (`apps/next-web`)

The new engine is the **single rendering path** for the four view types.

- **View surface component** mounted on a node: a tab row of the node's `savedViews` + an "＋ New view"
  affordance + per-view "edit / duplicate / delete / set default / share toggle". Selecting a tab
  renders by `type`:
  - **List** — flat or grouped rows (reuses the existing task-row component).
  - **Board** — Kanban. The existing `/board` page is **re-implemented** to call `viewTasks` with a
    default `board` saved view (seeded per Space — see §9). The Kanban **UI** component and drag-reorder
    are reused; only the data fetch (`getTasks`) is replaced by the engine query. Bespoke fetch retired
    only after parity (§5 risk control).
  - **Table** — new: spreadsheet-style with configurable `columns` (built-in + custom fields).
  - **Calendar** — new: month grid keyed by `config.dateField` (default builtin `dueDate`).
- **Filter / group / sort builder UI** — a panel editing the `ViewConfig` AST (add/remove rules, nest
  AND/OR groups, pick group-by, multi-key sort, choose columns). Uses `previewViewTasks` for live
  results; "Save" updates the active view, "Save as new" calls `createSavedView`.
- **Data fetch** — new `src/server/queries/views.ts` (`getSavedViews`, `getViewTasks`) and
  `src/server/actions/views.ts` (CRUD + `bulkUpdateTasks`), following the existing SSR
  `serverFetchEnvelope` + `normalizeTask` pattern. Filters now persist server-side in the saved view;
  the active `viewId` lives in the URL for shareable links.
- **i18n** — new strings externalized (Indonesian + English) per the cross-cutting goal.

**Retrofit risk control:** the engine-driven `/board` must reach parity with the current page
(filter by type/priority/free-text, status columns from the node's workflow, drag-reorder persistence)
**before** the bespoke `getTasks` board path is removed. `/backlog` and `/roadmap` are untouched this
phase.

---

## 6. Me-mode & Bulk edit

- **Me-mode** — a non-destructive overlay. When on, the compiler ANDs an "assigned to current user"
  predicate (`EXISTS (SELECT 1 FROM TaskAssignees a WHERE a.TaskId=t.Id AND a.UserId=@me)`) onto the
  active filter. Exposed via `viewTasks(meMode:true)` and a header toggle; persisted only if the user
  saves it into a view (`config.meMode`).
- **Bulk edit** — `bulkUpdateTasks({ taskIds:[…], action })` over multi-selected tasks. Supported
  actions (v1): **set status** (transition), **set priority**, **set assignees**, **set one
  custom-field value**, **move to list**, **delete**. The service **reuses existing single-task
  repository operations** in a per-task loop, enforcing `resolveAccess` per task, honoring
  `Idempotency-Key`, and returns `{ updated: [ids], failed: [{ id, reason }] }` so the UI can show
  partial success. No new bulk SPs (reuses `usp_Task_Transition`, `usp_Task_*`, assignee/move/delete
  ops). (YAGNI: bulk tags/watchers deferred.)

---

## 7. Realtime & cross-cutting
- Container/view mutations publish `pubsub` events (`savedView:updated`) so view tabs update live across
  clients; bulk edit publishes `task:updated` per task (consistent with existing `task:updated`).
- `WorkspaceId NOT NULL` on `SavedViews`; the compiler's always-injected base predicate guarantees
  every task query is workspace-scoped. A multitenancy-isolation test asserts no view query returns
  cross-workspace rows.
- New mutations honor `Idempotency-Key`.
- Performance: the always-present `(WorkspaceId, ListPath)` predicate uses the Phase-1
  `IX_Tasks_ListPath` / `IX_Tasks_List` indexes. Custom-field predicates scan
  `TaskCustomFieldValues` within the already-narrowed task set (the existing `FieldId` index helps);
  a computed-column/persisted index for hot custom-field filters is a **documented future
  optimization**, not v1.

---

## 8. Tests
- **Unit** (`*.unit.test.ts`) — the compiler is the priority:
  - filter AST → SQL + params for every operator; nested AND/OR; each custom-field type's cast;
    multi-key sort; the always-injected tenant/scope/soft-delete predicate.
  - field-catalog allow-listing: unknown field or invalid field/op combo is rejected.
  - me-mode overlay composition; `ViewConfig` validation.
- **Integration** (`*.integration.test.ts`, vitest `integration` project + mssql):
  - seed Space → Folder → List with tasks + custom-field values; assert filter / group / sort results
    over **built-in and custom fields**.
  - saved-view CRUD; shared-vs-private visibility (owner sees private; other member sees only shared);
    private-Space **403** vs owner **200**.
  - **multitenancy isolation:** a view query never returns another workspace's tasks (the mandated test).
  - bulk update: partial-success reporting + per-task permission enforcement.
  - Board retrofit returns the same task set as the legacy `getTasks` path (parity assertion).
- **e2e** (Playwright):
  - create a Table view with a custom-field filter + grouping, save it, reload → it persists.
  - toggle Me-mode; bulk-change status on multi-selected rows.
  - Board tab renders through the new engine.

---

## 9. Acceptance criteria (mirrors BUILD_PLAN Phase 3)
- [ ] Can create / save / rename / delete / reorder views at a List / Folder / Space / "Everything"
      node; shared views visible to node members, private views only to their owner; one default per
      (scope, type).
- [ ] Four view types render from saved config: **List, Board, Table, Calendar**.
- [ ] Filter (nested AND/OR, all operators), group, and multi-key sort work on **built-in and custom
      fields**.
- [ ] Me-mode overlays "assigned to me" without mutating the saved view.
- [ ] Bulk edit applies status / priority / assignees / custom-field / move / delete to multi-selected
      tasks, with partial-success reporting and per-task permission checks.
- [ ] Existing `/board` renders through the new engine at parity; `/backlog` and `/roadmap` unaffected.
- [ ] **Multitenancy isolation** test passes: no view query returns cross-workspace rows.

---

## 10. Definition of Done (Phase 3)
All acceptance boxes pass; the `0032_saved_views.sql` migration is reversible; unit + integration tests
cover the compiler / SPs / services; at least one Playwright e2e covers the save-view + bulk-edit flow;
the GraphQL schema and generated `@projectflow/types` are updated; the SP-per-op exception (decision 2)
is recorded in `DECISIONS.md`; and any deviation from this design is recorded in `DECISIONS.md`. Then
stop for human review before Phase 3.5 (Collaboration gaps).

---

## 11. Build order (for the implementation plan)
1. Migration `0032_saved_views.sql` + `usp_View_*` SPs + `ViewRepository` CRUD + repo CRUD tests.
2. Query engine — `field-catalog.ts` + `compiler.ts`, **unit-tested in isolation first** (no DB).
3. `ViewRepository` query execution + `ViewService` + GraphQL (`viewTasks` / `previewViewTasks` / CRUD)
   + integration tests (incl. multitenancy isolation + private-Space 403 + custom-field filtering).
4. Bulk edit + Me-mode (API) + integration tests.
5. Frontend: view surface + Table + Calendar; **then** Board retrofit to parity; bulk-edit UI; Playwright e2e.
