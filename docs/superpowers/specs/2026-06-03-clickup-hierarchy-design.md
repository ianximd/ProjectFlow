# Design: ClickUp-style features for ProjectFlow — Roadmap + Phase 1 (Nesting Hierarchy)

**Date:** 2026-06-03
**Status:** Approved (design); ready for implementation planning
**Source spec:** `BUILD_PLAN.md` (treated as a feature wishlist + reference architecture, NOT a literal build script)

---

## 0. Context & framing decisions

`BUILD_PLAN.md` describes a *greenfield* ClickUp clone on **Go + Gin + GORM + PostgreSQL + REST**.
The actual repository is a mature, working product ("ProjectFlow", a Jira-style tool) on a
**different stack**:

| Concern | BUILD_PLAN.md | This repo (authoritative) |
|---|---|---|
| Backend lang | Go (Gin, GORM) | **TypeScript** (Hono) |
| API style | REST + OpenAPI | **GraphQL** (Pothos code-first + graphql-yoga) |
| Database | PostgreSQL 16 (JSONB, ltree, LISTEN/NOTIFY) | **SQL Server** (MSSQL, stored-procedure-per-operation) |
| Jobs | River (Postgres queue) | **BullMQ** (Redis) |
| Realtime | WS hub + LISTEN/NOTIFY | **pubsub** (graphql-yoga + Redis event target) |
| Hierarchy | Workspace→Space→Folder→List→Task→Subtask | **Workspace→Project→(Sprint)→Task** (Jira-style) |

**Decisions taken during brainstorming (this document is the record):**

1. **Adapt to the existing stack.** No rewrite. Translate the ClickUp feature vision onto
   TS + Hono + GraphQL + SQL Server + Next.js, reusing existing subsystems.
2. **Deliverable:** a roadmap covering *all* BUILD_PLAN features (§1 below) + a detailed spec for
   the first phase (§2+).
3. **First phase = Nesting Hierarchy** (the "spine"), per BUILD_PLAN's own ordering.
4. **Hierarchy mapping = Approach A:** the existing **Project becomes the Space**; add lightweight
   **Folders** and **Lists**; tasks re-home to a default **List** via a safe backfill, keeping
   `Tasks.ProjectId` as a compatibility bridge; "Everything under node X" via a materialized path
   (the SQL-Server analog of BUILD_PLAN's Postgres `ltree`).
5. **Naming = ClickUp terms:** Space / Folder / List in the UI; "Project" → "Space" via a single
   label constant. The physical `Projects` **table keeps its name** (so existing FKs/SPs/queries
   keep working); only the GraphQL/UI vocabulary changes.

Conventions to follow (observed in repo, see `apps/next-web/CLAUDE.md` → `AGENTS.md`):
- Data access = **one stored procedure per operation** (`CREATE OR ALTER PROCEDURE`, `SET NOCOUNT ON`,
  `BEGIN TRY/CATCH`, `THROW` with custom codes, return the full row via `SELECT *`).
- Repositories call SPs via `execSpOne`; services delegate to repositories; GraphQL resolvers
  delegate to services and publish realtime events via `pubsub`.
- Migrations = numbered idempotent SQL files in `infra/sql/migrations/` with `IF NOT EXISTS` guards.
- IDs are `UNIQUEIDENTIFIER DEFAULT NEWID()`. Every tenant-scoped table has `WorkspaceId NOT NULL`.
- **Next.js 16 has breaking changes** — read `node_modules/next/dist/docs/` before writing web code.

---

## 1. Roadmap — full BUILD_PLAN coverage matrix

Legend: ✅ built · 🟡 partial (extend) · 🟦N planned in Phase N · ⛔ out-of-scope v1

### Already built (reuse, do not rebuild)
Auth / OAuth (google·github·microsoft) / MFA / account-lockout / password-reset · **RBAC** (Permissions,
Roles, RolePermissions, UserRoles — object-level + custom roles) · realtime **pubsub** · **automation
engine** (rules/triggers/conditions/actions/worker) · comments **+ reactions** · attachments (S3) ·
notifications · Git / Slack / Teams integrations · outgoing webhooks · audit log · search (PQL) ·
reports/dashboard pages · **Gantt** UI · worklogs · sprints · task **dependencies** · versions /
components / labels · **subtasks** (`ParentTaskId`) · **multiple assignees** (`TaskAssignees`) ·
fractional **Position** ordering.

⇒ BUILD_PLAN **Phase 4** (realtime/comments) and **Phase 6** (automation) are *largely* already done;
their residual gaps are captured below.

### Phase plan (gaps only, dependency-ordered)

| Our phase | Title | BUILD_PLAN | Headline scope |
|---|---|---|---|
| **1** | **Nesting Hierarchy** | P1 | Space/Folder/List + inheritance + materialized path + resolvers (**this doc, §2+**) |
| 2 | Custom Fields + Task Types + Tags + Watchers | P2 | wave-1 field types, field manager, `task_types`, tags@space, watchers |
| 3 | Views Engine | P3 | query compiler; savable List/Board/Table/Calendar; filter/group/sort; Me-mode; bulk edit |
| 3.5 | Collaboration gaps | P4 (residual) | assigned comments, @mention→follower+notification, **Inbox** (unread/by-type/save-for-later), **presence** |
| 4 | Task interconnect | P5 | Dependency-Warning app, Reschedule app, relationships+rollup, multi-list membership, checklists, recurring (RRULE), templates |
| 4b | Automation hardening | P6 (residual) | verify all triggers/actions, ordered actions+delay, 15–20 seeded templates, metering, loop guard, builder UI, run history |
| 5 | Docs / Wikis / Whiteboards / Forms | P7 | TipTap+Yjs docs, version history, doc↔task, mark-as-wiki; tldraw whiteboards (shape→task); forms (conditional logic, submission→task) |
| 6 | Time tracking + Sprints app + Goals | P8 | timer (single active, rollup), estimates+actuals, timesheets (submit/approve), sprint folders/auto-roll/points, goals+targets, Workload + Box views |
| 7 | Dashboards++ & remaining views | P9 | dashboard cards (incl. sprint velocity/burndown/burnup/CFD/lead-cycle, portfolio), scheduled reports, PDF export; Timeline/Activity/Map/MindMap/Embed/Chat/Doc views; formalize Gantt (critical path, baselines) |
| 8 | Apps toggles + permissions hardening + sharing | P10 | `apps_enabled` + inheritance, gate features, private spaces, request-access, **public share links** (scoped read-only tokens), guest rules, Custom Task IDs |
| 9 | AI layer | P11 | provider-agnostic gateway (zero-retention), permission-filtered retrieval (vector+keyword), AI Q&A, summarization + `ai_field`, standups, NL automation builder, AI writer; ⛔ stretch agents |
| 10 | Public API + importers + template center | P12 | public API v2 + OpenAPI + personal tokens + OAuth2 apps + rate-limit; importers (CSV/Asana/Trello/Jira/Monday); template center; CSV/Excel export; optional desktop wrapper |

### Cross-cutting (§5 BUILD_PLAN) — apply every phase
Multitenancy isolation test (fails if any query omits `WorkspaceId`) · performance budgets + indexes
(path index, custom-field-value index, `(list_id, status, position)`) · audit log → Activity view /
AI standups · **Idempotency-Key** on mutations · **a11y + i18n (Indonesian + English)** · observability
(queue depth, WS connections, automation runs).

### Out of scope v1 (§8 BUILD_PLAN) — explicitly excluded
⛔ billing/plan-gating (feature flags only) · native mobile / Expo · voice/video/clips/AI-notetaker ·
app marketplace · SSO/SAML/SCIM · autonomous code-writing agents.

> **Completeness note:** every feature enumerated in BUILD_PLAN §0–§8 is accounted for above —
> either ✅ built, assigned to a 🟦 phase, or ⛔ explicitly deferred. Items flagged 🟡 (comment
> threading/mentions, permission resolver depth, automation trigger/action coverage, i18n wiring)
> should be confirmed-and-extended in their listed phase rather than assumed complete.

---

## 2. Phase 1 — Nesting Hierarchy: detailed design

**Goal:** introduce the Space → Folder → List layer, re-home tasks to Lists via a safe backfill,
with inheritance (permissions + statuses), a materialized path for "Everything", and configurable
subtask depth — **without breaking** existing board/backlog/roadmap pages.

### 2.1 Data model (SQL Server)

Keep `Projects` physically as the **Space**. Add two tables + columns.

**New table `Folders`**
```
Id             UNIQUEIDENTIFIER PK DEFAULT NEWID()
WorkspaceId    UNIQUEIDENTIFIER NOT NULL  -> Workspaces(Id)
SpaceId        UNIQUEIDENTIFIER NOT NULL  -> Projects(Id)        -- owning Space
ParentFolderId UNIQUEIDENTIFIER NULL      -> Folders(Id)         -- subfolders
Name           NVARCHAR(255) NOT NULL
Position       FLOAT NOT NULL DEFAULT 0                          -- fractional order
Path           NVARCHAR(900) NOT NULL                            -- '/{spaceId}/{folderId}/...'
WorkflowId     UNIQUEIDENTIFIER NULL     -> Workflows(Id)        -- optional status override
CreatedAt/UpdatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
DeletedAt      DATETIME2 NULL
```

**New table `Lists`**
```
Id          UNIQUEIDENTIFIER PK DEFAULT NEWID()
WorkspaceId UNIQUEIDENTIFIER NOT NULL -> Workspaces(Id)
SpaceId     UNIQUEIDENTIFIER NOT NULL -> Projects(Id)
FolderId    UNIQUEIDENTIFIER NULL     -> Folders(Id)             -- NULL = directly under Space
Name        NVARCHAR(255) NOT NULL
Position    FLOAT NOT NULL DEFAULT 0
Path        NVARCHAR(900) NOT NULL                               -- '/{spaceId}/{folderId?}/{listId}/'
WorkflowId  UNIQUEIDENTIFIER NULL     -> Workflows(Id)           -- optional status override
IsDefault   BIT NOT NULL DEFAULT 0                               -- the backfilled "General" list
CreatedAt/UpdatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
DeletedAt   DATETIME2 NULL
```

**Alter `Tasks`**
```
ListId    UNIQUEIDENTIFIER NULL -> Lists(Id)   -- new home (ProjectId retained as bridge)
ListPath  NVARCHAR(900) NULL                   -- denormalized List.Path for single-query "Everything"
ArchivedAt DATETIME2 NULL
```

**Alter `Projects` (= Space)**
```
Visibility      NVARCHAR(10) NOT NULL DEFAULT 'PUBLIC'  -- PUBLIC | PRIVATE
MaxSubtaskDepth INT NULL                                -- Nested-Subtasks depth limit (NULL = unlimited)
```

**Alter `Workflows`** (generalize status scope; `ProjectId` stays):
```
FolderId UNIQUEIDENTIFIER NULL -> Folders(Id)
ListId   UNIQUEIDENTIFIER NULL -> Lists(Id)
```

**Indexes**
```
IX_Folders_Space   (SpaceId, ParentFolderId, Position)
IX_Folders_Path    (Path)          -- prefix scans
IX_Lists_Space     (SpaceId, FolderId, Position)
IX_Lists_Path      (Path)
IX_Tasks_List      (ListId, Status, Position)
IX_Tasks_ListPath  (ListPath)      -- "Everything under node X"
```

**Materialized path rule.** `Path` is `/` + ancestor ids in order + trailing `/`. "Everything under
node X" = `WHERE ListPath LIKE '/…/{X}/%'` (single indexed scan). Paths are maintained by the SP that
creates/moves a container; moving a container rewrites descendant paths in that SP (set-based update
on the `LIKE` prefix).

### 2.2 Migration + backfill — `infra/sql/migrations/0029_hierarchy.sql` (reversible)

1. Create `Folders`, `Lists`; add the `Tasks` / `Projects` / `Workflows` columns; create indexes —
   all guarded by `IF NOT EXISTS`.
2. **Backfill** (idempotent):
   - For each `Projects` row lacking a default List, create one `Lists` row `IsDefault=1`,
     `FolderId NULL`, `Name = Project.Name`, `Path = '/{spaceId}/{listId}/'`.
   - `UPDATE Tasks SET ListId = <defaultList>, ListPath = <list.Path> WHERE ProjectId = <space> AND ListId IS NULL`.
3. **Down migration** drops the columns/tables in reverse order.

> Backfill is a SQL step in the migration (or a `scripts/` one-off run via `db:migrate` tooling) — to
> be finalized in the implementation plan; it must be re-runnable without duplicating default Lists.

### 2.3 API — GraphQL (Pothos) + stored procedures

**GraphQL types:** `Space` (relabel of existing `Project` type — add `visibility`, `maxSubtaskDepth`),
new `Folder`, new `List`; `Task` gains `listId`. Keep `Project`-named fields working during transition
(alias), to avoid breaking existing web queries.

**Queries**
- `spaces(workspaceId)` — (existing `projects`, relabeled; keep `projects` as deprecated alias)
- `folders(spaceId)` , `lists(spaceId, folderId?)`
- `effectiveStatuses(listId)` — resolved status set for a List
- `everythingUnder(nodeId, nodeType)` — all tasks beneath a Space/Folder/List (uses `ListPath`)

**Mutations**
- `createFolder / updateFolder / moveFolder / deleteFolder`
- `createList / updateList / moveList / deleteList`
- `createTask(input{ …, listId })` — `listId` becomes the primary home (derive `projectId`=SpaceId
  from the List for the bridge)
- `moveTask(taskId, listId, position)` — re-home + reorder
- Every mutation publishes a `pubsub` event (existing pattern) and respects `Idempotency-Key`.

**Stored procedures** (one per op, house style):
`usp_Folder_Create / _Update / _Delete / _List / _Move / _GetWorkspaceId`,
`usp_List_Create / _Update / _Delete / _List / _Move / _GetWorkspaceId`,
`usp_List_EffectiveStatuses`, `usp_Hierarchy_DescendantTasks`,
updated `usp_Task_Create` (+`@ListId`, derives Space, sets `ListPath`), `usp_Task_Move`.
Parent-validation (List under Space-or-Folder; subfolder under Folder; all same `WorkspaceId`) is
enforced inside the SP (`THROW`) and pre-checked in the service.

### 2.4 Resolver services (TypeScript)

- **Permission resolver** `resolveAccess(userId, node) → level | 403`: walk ancestry
  List → Folder → Space → Workspace; apply membership-role *floor* + **most-specific** `Permissions`
  row (existing RBAC tables). Private Space (`Visibility='PRIVATE'`) → non-members denied. Enforced in
  middleware on all container + task endpoints. *(Confirm whether a resolver already exists in
  `modules/roles` / `modules/admin`; extend rather than duplicate.)*
- **Status resolver** `effectiveStatuses(listId)`: `List.WorkflowId ?? Folder.WorkflowId ??
  Space.WorkflowId` (most-specific wins), returning that workflow's `WorkflowStatuses`.
- **Subtask-depth guard**: on task create/move, walk the `ParentTaskId` chain; reject beyond the
  Space's `MaxSubtaskDepth` with a 422.
- **Ordering**: reuse the existing fractional `Position` algorithm for folders, lists, and task moves.

### 2.5 Frontend (Next.js 16 — read `node_modules/next/dist/docs/` first)

- **Sidebar tree**: Workspace → Spaces → Folders → Lists; create / rename / delete; **dnd-kit**
  drag-reorder and move across parents; collapsible nodes. Built on the existing
  `src/server/actions` + `src/server/queries` SSR pattern.
- **List view**: tasks for the selected List — reuse the existing task list component (now keyed by
  `listId`).
- **Task detail slide-over**: reuse existing; add a Space / Folder / List breadcrumb.
- **Naming**: add `PRODUCT_NAME` + UI label constants (e.g. `src/config`); relabel "Project" → "Space"
  in one place. Externalize new strings for i18n (ID + EN).

### 2.6 Realtime & cross-cutting
- Container mutations publish `pubsub` events (`space|folder|list:updated`) so the sidebar updates live
  across clients, consistent with existing `task:updated`.
- `WorkspaceId NOT NULL` on `Folders`/`Lists`; add a multitenancy-isolation test asserting new
  repository methods are workspace-scoped.
- Honor `Idempotency-Key` on new mutations (consistent with §5 cross-cutting goal).

### 2.7 Tests
- **Unit:** path computation (create/move rewrites), permission-resolver matrix (owner/member/guest ×
  public/private × most-specific override), status resolution precedence, subtask-depth guard,
  fractional reorder.
- **Integration (vitest `integration` project + mssql):** build Space→Folder→List and folderless List;
  `everythingUnder` returns correct descendants; private-Space 403 vs owner 200; backfill creates one
  default List per Project and assigns existing tasks; existing board/backlog queries still pass via
  the `ProjectId` bridge.
- **e2e (Playwright):** create Space/Folder/List in the sidebar; create a task in a List; drag a task to
  another List and a List to another Folder; verify persistence after reload.

### 2.8 Acceptance criteria (mirrors BUILD_PLAN Phase 1)
- [ ] Can build a tree: Space → Folder → List, **and** a folderless List directly under a Space.
- [ ] Can create tasks + nested subtasks within `MaxSubtaskDepth`; subtasks inherit parent visibility.
- [ ] Custom statuses defined at a Space are inherited by Lists and overridable at List level.
- [ ] A member without permission on a private Space gets **403**; owner gets **200**.
- [ ] Reordering folders/lists/tasks persists and survives concurrent edits (fractional index).
- [ ] "Everything" endpoint returns all tasks beneath any chosen node (single indexed query on `ListPath`).
- [ ] **Backfill:** every existing task lands in its Project's default List; existing board / backlog /
      roadmap pages keep working through the `ProjectId` bridge.

---

## 3. Definition of Done (Phase 1)
All acceptance boxes pass; the `0029_hierarchy.sql` migration is reversible; unit + integration tests
cover the new SPs/resolvers; at least one Playwright e2e covers the sidebar create-tree + task-move
flow; the GraphQL schema and any generated `@projectflow/types` are updated; and any deviation from
this design is recorded in `DECISIONS.md`. Then stop for human review before Phase 2 (Custom Fields).
