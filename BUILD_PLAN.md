# BUILD_PLAN.md — "Helmwork" (a ClickUp-style work platform)

> **Purpose of this file.** This is the master specification for an agentic coding tool
> (Claude Code) to build a ClickUp-like product. It is written to be executed top-to-bottom.
> Each phase has: scope, data model deltas, API contracts, frontend work, and **acceptance
> criteria** that must pass before moving on. Do not skip phases — later phases assume the
> data model and conventions established earlier.
>
> **How to use this document (Claude Code):**
> 1. Read the whole file once before writing any code.
> 2. Work one phase at a time. Within a phase, do backend → migrations → API → frontend → tests.
> 3. After each phase, run the acceptance checklist and stop for human review.
> 4. Never invent fields or endpoints not in the spec without recording them in `DECISIONS.md`.
> 5. Keep `CLAUDE.md` (conventions) authoritative; if this plan and CLAUDE.md conflict, ask.

---

## 0. Product Summary

We are building a multi-tenant, collaborative work-management platform. The core idea is a
**nesting hierarchy** of containers with a **rich task object** at the center, surfaced through
**many interchangeable views**, extended by **modular feature toggles**, **automations**, and an
**AI layer**. Think: the data model is the spine; everything else reads from it.

**Non-negotiable architectural pillars (get these right or everything downstream breaks):**
1. **Hierarchy + inheritance** (Workspace → Space → Folder → List → Task → Subtask).
2. **Rich, customizable task object** (custom fields, custom statuses, dependencies, relationships).
3. **Views as first-class, savable objects** (filter / group / sort over the same data).
4. **Granular permissions with most-specific-wins inheritance.**
5. **Realtime collaboration** (presence, live updates, comments).
6. **Modular features ("Apps") + a Trigger→Condition→Action automation engine.**
7. **AI as a layer over the workspace graph**, not a bolted-on chatbot.

We name the product **Helmwork** internally to avoid trademark collisions. Rename via a single
constant (`PRODUCT_NAME`) — do not hardcode the name in UI strings.

---

## 1. Tech Stack & Conventions

Chosen to match the team's existing expertise and to suit a realtime collaborative SaaS.

**Backend**
- Language: **Go 1.22+**
- HTTP framework: **Gin**
- ORM: **GORM** (Postgres dialect)
- Migrations: **golang-migrate** (raw SQL migrations, versioned)
- Auth: JWT access tokens (15 min) + rotating refresh tokens (HTTP-only cookie); OAuth2 later
- Realtime: **WebSocket hub** (gorilla/websocket) + Postgres `LISTEN/NOTIFY` for fan-out
- Background jobs: **River** (Postgres-backed job queue) for automations, AI calls, notifications
- Cache / rate-limit / presence: **Redis**
- Object storage: S3-compatible (MinIO in dev) for attachments

**Database**
- **PostgreSQL 16** (primary). Rationale: JSONB for flexible custom-field values, partial &
  GIN indexes, `LISTEN/NOTIFY`, row-level security option, mature full-text search.
- *Note:* the team has deep SQL Server expertise. SQL Server is viable, but this plan assumes
  Postgres for JSONB + LISTEN/NOTIFY. If switching to SQL Server, replace JSONB with `NVARCHAR(MAX)`
  + `JSON_VALUE`, and replace LISTEN/NOTIFY with Service Broker or a Redis pub/sub bridge. Record
  the choice in `DECISIONS.md` before phase 1.

**Frontend**
- **Next.js 14+ (App Router) + TypeScript**
- State/server cache: **TanStack Query** (server state) + **Zustand** (UI state)
- Tables/grids: **TanStack Table** + **TanStack Virtual** (virtualized rows for large lists)
- Drag & drop: **dnd-kit**
- Dates: **Flatpickr** or `date-fns` + a calendar lib
- Rich text / Docs: **TipTap** (ProseMirror) with **Yjs** for CRDT collaboration
- Whiteboard: **tldraw** (embeddable) or a custom `<canvas>` later
- Styling: **Tailwind CSS** + a component layer (Radix primitives)
- Charts (dashboards): **Recharts**
- Forms: controlled components (no native `<form>` submit), validation via **Zod**

**Repo layout (monorepo)**
```
/helmwork
  /apps
    /api            # Go service (Gin)
    /web            # Next.js app
    /worker         # Go background worker (River consumers)
  /packages
    /shared-types   # generated TS types from Go structs / OpenAPI
  /db
    /migrations     # golang-migrate SQL files
  /docs
    BUILD_PLAN.md   # this file
    CLAUDE.md       # conventions (create in phase 0)
    DECISIONS.md    # running log of deviations
  docker-compose.yml
```

**Conventions (also write these into `CLAUDE.md`):**
- All IDs are **UUIDv7** (time-sortable). Never expose sequential integer PKs in URLs.
- Every tenant-scoped table has `workspace_id NOT NULL`; every query is workspace-scoped.
- Soft deletes via `deleted_at TIMESTAMPTZ NULL` (GORM soft delete) for user-facing objects.
- Timestamps: `created_at`, `updated_at` UTC. Store user time zone separately.
- API: REST, JSON, plural nouns (`/v1/tasks`), cursor pagination (`?cursor=&limit=`), envelope
  `{ "data": ..., "meta": { "next_cursor": ... } }`. Errors: `{ "error": { "code", "message", "details" } }`.
- HTTP status codes are meaningful (404 vs 403 vs 422). Validation errors → 422 with field list.
- Every mutating endpoint publishes a realtime event (see §6) and may enqueue automation eval.
- Tests required per phase: Go unit + integration (testcontainers Postgres), Playwright e2e for
  critical web flows. No phase is "done" until its acceptance checklist passes.

---

## 2. Core Data Model (the spine)

This is the single most important section. Build it carefully in Phase 1. Below is the conceptual
model; SQL DDL appears in Phase 1.

### 2.1 Hierarchy
```
Workspace (tenant root)
  └─ Space (department/team/client; public or private; owns statuses, fields, enabled apps)
       └─ Folder (optional grouping; can override statuses/fields; supports subfolders)
            └─ List (holds tasks; defines task statuses + custom fields; can also live directly under Space)
                 └─ Task
                      └─ Subtask (recursive; nested subtasks allowed)
```
Key rules:
- **Folders are optional.** A List may attach directly to a Space (`folder_id NULL`).
- A Task has a **home List** (`list_id`) that defines its available statuses + fields.
- A Task may also appear in **other Lists** (many-to-many `task_list_membership`), but status &
  custom-field values follow the home List.
- **Subtasks are tasks** (`parent_task_id` self-reference). Nesting depth is configurable per
  Space ("Nested Subtasks" app). Subtasks inherit parent permissions.
- **Inheritance**: configuration (statuses, fields, enabled apps, permissions) cascades downward;
  the most specific level that defines a value wins.

### 2.2 Generic "container" abstraction
Implement Space/Folder/List as rows in a single polymorphic pattern OR three tables with a shared
`hierarchy_node` ancestry table. **Decision for this build:** three concrete tables
(`spaces`, `folders`, `lists`) + a materialized **closure/ancestry helper** (`hierarchy_path`
stored as Postgres `ltree` on each node) so "give me everything under node X" is a single indexed
query. Record rationale in DECISIONS.md.

### 2.3 The Task object (fields)
Columns: `id, workspace_id, list_id, parent_task_id, task_type_id, title, description (rich JSON),
status_id, priority (0-4), start_date, due_date, time_estimate_seconds, created_by, position
(fractional index for ordering), created_at, updated_at, deleted_at, archived_at`.
Plus related tables:
- `task_assignees(task_id, user_id)` — many-to-many (Multiple Assignees app).
- `task_watchers(task_id, user_id)`.
- `task_tags(task_id, tag_id)`; `tags` live at Space scope.
- `task_custom_field_values(task_id, field_id, value JSONB)`.
- `task_dependencies(task_id, depends_on_task_id, type)` — type ∈ {waiting_on, blocking}.
- `task_relationships(from_task_id, to_task_id, relationship_field_id, kind)` — reference / custom.
- `checklists(id, task_id, name)` + `checklist_items(id, checklist_id, name, resolved, assignee_id, position)`.
- `task_list_membership(task_id, list_id)` — tasks in multiple lists.
- `attachments(id, parent_type, parent_id, file_key, mime, size, uploaded_by)`.

### 2.4 Custom Statuses
- `statuses(id, scope_type, scope_id, name, color, group, order)` where `group ∈
  {not_started, active, done, closed}` and `scope_type ∈ {space, folder, list}`.
- Resolution: a List's effective status set = its own statuses, else inherited from Folder, else Space.

### 2.5 Custom Fields
- `custom_fields(id, workspace_id, scope_type, scope_id | task_type_id, type, name, config JSONB, required)`.
- `type ∈` the full type list below. `config` holds type-specific data (dropdown options, currency
  code, formula expression, relationship target, rating scale, AI field subtype, etc.).
- Values stored in `task_custom_field_values.value` as JSONB, shape depends on type.

**Custom field types to support (build in waves, see phases):**
`text`, `text_area`, `number`, `currency`, `checkbox`, `date`, `url`, `email`, `phone`,
`dropdown` (single), `labels` (multi), `rating`, `progress_auto`, `progress_manual`, `people`,
`tasks` (link, no relationship), `relationship` (any-task / list-to-list + rollup),
`location` (geo), `files`, `formula` (expression engine), `ai_field` (summary/sentiment/translate/
action_items/categorize/custom), `voting`.

### 2.6 Custom Task Types
- `task_types(id, workspace_id, name_singular, name_plural, icon, is_milestone)`.
- Default type "Task" seeded per workspace. Milestone is a built-in type with a flag.
- Custom fields can be scoped to a task type (beta-style) in a later phase.

### 2.7 Views
- `views(id, scope_type, scope_id, type, name, config JSONB, visibility, owner_id, is_default, position)`.
- `type ∈ {list, board, calendar, gantt, timeline, table, workload, box, activity, map, mindmap,
  chat, doc, form, embed}`.
- `config` holds filters (AND/OR groups), grouping, sort, visible columns, swimlane field, etc.

### 2.8 Identity & permissions
- `users`, `workspace_members(workspace_id, user_id, role)` where
  `role ∈ {owner, admin, member, limited_member, guest}` (+ custom roles later).
- `permissions(subject_type, subject_id, object_type, object_id, level)` where
  `level ∈ {full, edit, comment, view}`. Resolution = most-specific object in the ancestry wins;
  membership role sets the floor.

### 2.9 Collaboration & misc
- `comments(id, parent_type, parent_id, author_id, body JSON, assigned_to, resolved, created_at)`.
- `notifications`, `reminders`, `goals`, `targets`, `automations`, `automation_runs`, `apps_enabled`,
  `templates`, `time_entries`, `docs`, `doc_pages`, `whiteboards`, `forms`, `form_submissions`,
  `dashboards`, `dashboard_cards`. Detailed columns appear in their respective phases.

---

## 3. API Design Contract (apply to every endpoint)

- Base path `/v1`. Auth via `Authorization: Bearer` (access token).
- Workspace context via `X-Workspace-Id` header (validated against membership) OR path
  `/v1/workspaces/{wid}/...` for workspace-scoped collections.
- Standard CRUD shape per resource:
  - `GET /v1/{resource}?filters` → list (cursor paginated)
  - `POST /v1/{resource}` → create (422 on validation)
  - `GET /v1/{resource}/{id}` → read
  - `PATCH /v1/{resource}/{id}` → partial update
  - `DELETE /v1/{resource}/{id}` → soft delete
- All list endpoints accept `filter`, `group_by`, `sort`, `cursor`, `limit`.
- Every successful mutation returns the full updated object and emits a realtime event (§6).
- OpenAPI spec generated and kept in `/apps/api/openapi.yaml`; TS types generated into
  `/packages/shared-types`.

---

## 4. Build Phases (execute in order)

> Each phase ends with **Acceptance**. Do not proceed until every box is checkable.

### PHASE 0 — Foundations & Scaffolding
**Scope:** repo, tooling, auth, multitenancy skeleton, CI, `CLAUDE.md`, `DECISIONS.md`.
**Tasks:**
- Initialize monorepo per §1 layout; docker-compose with Postgres 16, Redis, MinIO.
- Go API skeleton (Gin), health check, structured logging, config via env, graceful shutdown.
- Migration tooling wired (golang-migrate); first migration creates `users`, `workspaces`,
  `workspace_members`, `refresh_tokens`.
- Auth: signup, login, refresh, logout; password hashing (argon2id); JWT issuance; middleware
  that resolves user + workspace + role into request context.
- Next.js app skeleton with auth pages, protected layout, TanStack Query provider, API client
  with token refresh interceptor.
- CI: lint (golangci-lint, eslint), unit tests, build, run migrations against ephemeral Postgres.
- Author `CLAUDE.md` (conventions from §1) and empty `DECISIONS.md`.

**Acceptance:**
- [ ] `docker-compose up` brings up api + web + postgres + redis + minio.
- [ ] A user can sign up, log in, refresh, and hit an authenticated `/v1/me` endpoint.
- [ ] Creating a user auto-creates a personal workspace with role `owner`.
- [ ] CI is green on a clean checkout.

---

### PHASE 1 — Hierarchy + Task Core (THE SPINE)
**Scope:** Spaces, Folders, Lists, Tasks, Subtasks, statuses, basic permissions inheritance.
**Data model:** implement §2.1–2.4, §2.8 tables. Add `ltree` ancestry to hierarchy nodes.
**Backend tasks:**
- CRUD for spaces, folders, lists with parent validation (list under space OR folder; subfolder
  under folder). Maintain `hierarchy_path` (ltree) on insert/move.
- Task CRUD: create under a list, set title/description/status/priority/dates/assignees.
- Subtask support via `parent_task_id`; "Everything" query: tasks under any node via ltree
  descendant query.
- Status resolution endpoint: effective statuses for a given list.
- Permission resolver service: given (user, object) → effective level using role floor +
  most-specific permission row. Enforce in middleware on every task/container endpoint.
- Fractional-index `position` for ordering (e.g., `fractional-indexing` algorithm) so reordering
  is O(1) and conflict-tolerant.
**Frontend tasks:**
- Sidebar tree: Workspace → Spaces → Folders → Lists with create/rename/delete, drag to reorder.
- Basic **List view** of tasks (no custom fields yet): title, status pill, assignee avatars,
  priority flag, due date. Inline create, inline status change, drag reorder.
- Task detail panel (slide-over): title, description (plain for now), status, assignees, dates,
  priority, subtasks list.
**Acceptance:**
- [ ] Can build a tree: Space → Folder → List, and a folderless List under a Space.
- [ ] Can create tasks + nested subtasks; subtasks inherit parent visibility.
- [ ] Custom statuses defined at a Space are inherited by Lists and overridable at List level.
- [ ] A member without permission on a private Space gets 403; owner gets 200.
- [ ] Reordering tasks persists and survives concurrent edits (fractional index).
- [ ] "Everything" endpoint returns all tasks beneath any chosen node.

---

### PHASE 2 — Custom Fields + Custom Task Types + Tags
**Scope:** flexible task data: field types wave 1, task types, tags, watchers, multiple assignees.
**Backend tasks:**
- `custom_fields` + `task_custom_field_values` (JSONB). Implement field types **wave 1**:
  `text, text_area, number, currency, checkbox, date, url, email, phone, dropdown, labels,
  rating, people, progress_manual, progress_auto` (auto = computed from subtasks/checklist).
- Field scoping by location (space/folder/list) with downward cascade; field resolver returns the
  effective field set for a task.
- `task_types` with seeded "Task" + custom types; `is_milestone` flag.
- Tags at Space scope + `task_tags`; watchers; multiple assignees app toggle.
- Validation per field type (e.g., currency code, dropdown option exists, required fields → 422).
**Frontend tasks:**
- Field manager UI (create/edit/reorder fields per location).
- Render + edit each field type inline in List view and in the task panel.
- Task-type selector with custom icon; milestone rendering (diamond marker placeholder).
- Tag picker; watcher add/remove; multi-assignee picker.
**Acceptance:**
- [ ] All wave-1 field types can be created, edited inline, validated, and persisted.
- [ ] Adding a field at a Space cascades to all lists beneath; List-level field stays local.
- [ ] `progress_auto` updates when subtasks/checklist items complete.
- [ ] Required field blocks status→done (or task save) with a 422 and clear UI message.
- [ ] Custom task types render with their icon and plural/singular names.

---

### PHASE 3 — Views Engine (wave 1 views)
**Scope:** savable views with filter/group/sort; List, Board, Table, Calendar.
**Backend tasks:**
- `views` table; generic **query compiler** that turns a view `config` (filter groups with AND/OR,
  group_by, sort, visible columns) into a parameterized SQL query over tasks + field values.
- View CRUD; visibility (private/shared/protected); default view per location (one).
- Server-side grouping + counts so the frontend can render swimlanes without overfetching.
**Frontend tasks:**
- View bar (tabs) per location with add/rename/pin/duplicate; "Me mode" toggle (filter to me).
- **List view** upgraded: grouping by status/assignee/priority/custom field; multi-sort; column
  show/hide; saved filters.
- **Board (Kanban)**: columns by status (or any field), drag cards between columns (updates field),
  WIP counts, collapse columns.
- **Table view**: spreadsheet grid (TanStack Table + virtualization), bulk edit, fill-down,
  add field as column.
- **Calendar view**: month/week, drag to reschedule (updates due date), recurring placeholder.
**Acceptance:**
- [ ] A view's filter/group/sort persists and reloads identically.
- [ ] Dragging a card on Board changes the underlying status; List view reflects it live (§6).
- [ ] Table view edits 1,000+ tasks smoothly (virtualized) and supports bulk status change.
- [ ] Calendar drag updates due date and is reflected in List/Board without refresh.
- [ ] Private views are invisible to others; protected views can't be edited by non-owners.

---

### PHASE 4 — Realtime Collaboration + Comments + Notifications + Inbox
**Scope:** the live layer. (See §6 for architecture.)
**Backend tasks:**
- WebSocket hub: clients subscribe to "rooms" (workspace, list, task). On mutation, publish event
  to Postgres `NOTIFY`; a listener fans out to subscribed sockets via Redis pub/sub (multi-instance).
- Event schema: `{type, object_type, object_id, scope_path, actor_id, payload, ts}`.
- Comments on tasks/docs/attachments; threaded replies; reactions; **assigned comments**
  (require resolution); `@mention` parsing → adds follower + notification.
- Notifications table + delivery; **Inbox** endpoints (unread, by type, save-for-later).
- Presence: who's viewing a task/list (Redis with TTL heartbeats).
**Frontend tasks:**
- WS client with reconnect/backoff; optimistic updates reconciled with server events.
- Live cursors/avatars (presence) on a task/list.
- Comment thread UI with mentions, reactions, assign-comment, resolve.
- Inbox page; notification bell with unread count; toast for live changes.
**Acceptance:**
- [ ] Two browsers on the same List see each other's task edits within ~200ms, no refresh.
- [ ] `@mention` adds the user as follower and creates an Inbox notification.
- [ ] Assigned comment shows as an action item and can be resolved by the assignee.
- [ ] Presence avatars appear/disappear as users open/close a task.
- [ ] Works across two API instances (Redis fan-out verified).

---

### PHASE 5 — Dependencies, Relationships, Recurring, Templates
**Scope:** task interconnection + reusability.
**Backend tasks:**
- `task_dependencies` (waiting_on/blocking) + apps: **Dependency Warning** (block closing a task
  with open blockers), **Reschedule Dependencies** (shift dependent dates when a date moves).
- `task_relationships` + relationship custom-field type (any-task / list-to-list) with **rollup**
  (surface a field from related tasks).
- Recurring tasks: recurrence rule (RRULE-ish), regenerate on completion or schedule; include/
  exclude dependencies option.
- Templates: task / list / folder / space templates; capture settings + nested content; apply with
  date remapping and "import selected items" options. Auto-apply task template via automation hook.
**Frontend tasks:**
- Dependency UI (add waiting-on/blocking; warning modal on close); relationship picker + rollup column.
- Recurrence editor; template create/apply modals; template center (basic).
**Acceptance:**
- [ ] Closing a blocked task triggers the Dependency Warning (if app enabled).
- [ ] Moving a task's date reschedules dependents (if Reschedule app enabled).
- [ ] List-to-list relationship + rollup shows a value pulled from the related task.
- [ ] Recurring task regenerates correctly with the chosen rule.
- [ ] Applying a list template recreates tasks, fields, views, and remaps dates.

---

### PHASE 6 — Automation Engine
**Scope:** Trigger → Condition → Action, with templates. (Prerequisite for "natural-language" AI later.)
**Backend tasks:**
- `automations(id, scope_type, scope_id, trigger JSONB, conditions JSONB, actions JSONB, enabled,
  run_count)` + `automation_runs` audit.
- Trigger types: status_change, field_change, task_created, date_arrived, assignee_change,
  comment_posted, due_date_passed. Evaluated from the realtime event stream (§4) + a scheduler
  (River periodic jobs) for date triggers.
- Conditions: AND/OR groups with operators (is/is_not/contains/gt/lt/before/after/is_set).
- Actions (ordered, with optional delay): change_status, set_field, assign, add_tag, create_task,
  create_subtask, apply_template, post_comment, move_task, send_notification, call_webhook.
- 15–20 prebuilt automation templates seeded. Metering counter per workspace (for future limits).
**Frontend tasks:**
- Automation builder (When / If / Then) with dropdowns per trigger/condition/action; template gallery;
  enable/disable; run history view.
**Acceptance:**
- [ ] "When status → Done, assign to QA and set due date +2 days" runs reliably.
- [ ] Date-based trigger fires via scheduler within its window.
- [ ] Conditions with AND/OR correctly include/exclude tasks.
- [ ] Webhook action posts a signed payload to an external URL; run is audited.
- [ ] Infinite-loop guard prevents an automation from retriggering itself endlessly.

---

### PHASE 7 — Docs, Wikis, Whiteboards, Forms
**Scope:** connected knowledge + intake surfaces.
**Backend tasks:**
- `docs` + `doc_pages` (nested pages, position, icon, cover); rich body stored as ProseMirror JSON;
  Yjs document persistence (store update blobs) for CRDT collaboration; version history snapshots.
- Doc↔task relationships; create task from doc text; embed task/view in doc.
- "Mark as wiki" flag (surfaces to search/AI later) + verification/owner.
- Whiteboards: persist tldraw document JSON; convert shape/sticky/text → task (creates task in a
  target list, title from text); embed live task/doc cards.
- Forms: form builder config; **conditional logic** (show/hide based on prior answers); each
  submission → task in a target list with field mapping + optional task template; public link + embed;
  authenticated-only option.
**Frontend tasks:**
- Doc editor (TipTap + Yjs): nested page tree, slash commands, inline comments, page history/restore.
- Whiteboard canvas (tldraw) with convert-to-task and embed cards.
- Form builder (drag fields, branching rules) + public form renderer.
**Acceptance:**
- [ ] Two users co-edit a Doc with live cursors; offline edits merge via CRDT on reconnect.
- [ ] Page history restores a prior version.
- [ ] A whiteboard sticky converts into a real task in the chosen list.
- [ ] A form with conditional logic hides/shows questions and creates a task on submit.
- [ ] Doc marked as wiki is flagged and retrievable as such.

---

### PHASE 8 — Time Tracking, Sprints/Agile, Goals
**Scope:** time + agile + objectives.
**Backend tasks:**
- Time tracking app: `time_entries(task_id, user_id, start, end, duration, billable, note, tags)`;
  start/stop timer (single active timer per user), manual + range entries, rollup subtask→parent.
- Time estimates (per task / per assignee); estimate-vs-actual.
- Timesheets: aggregate by user/date/task; submit/approve workflow.
- Sprints app: sprint folders, sprint dates, auto-start/auto-complete/auto-roll-forward; sprint
  **points** field (rollup, per-assignee split).
- Goals + targets (number / boolean / currency / task-linked) with auto progress rollup; goal folders.
**Frontend tasks:**
- Timer widget (global), manual entry, timesheet grid (TanStack Table), billable toggle.
- Sprint setup; **Workload view** (capacity by points/time) and **Box view** (group by assignee).
- Goals UI with targets and progress bars.
**Acceptance:**
- [ ] Global timer tracks across tasks; only one active timer per user; rollup to parent works.
- [ ] Timesheet aggregates correctly and supports submit/approve.
- [ ] Sprint auto-completes at end date and rolls unfinished tasks to the next sprint.
- [ ] Workload view flags over-capacity assignees.
- [ ] A task-linked Goal target updates progress automatically as tasks complete.

---

### PHASE 9 — Dashboards & Reporting + remaining views
**Scope:** reporting layer + Gantt/Timeline/Workload/Map/Mind Map/Activity/Embed/Chat/Doc views.
**Backend tasks:**
- `dashboards` + `dashboard_cards(type, config)`; aggregation endpoints for: bar/line/pie/battery,
  calculation, task list, time tracked, timesheet, goal, portfolio, and **sprint cards** (velocity,
  burndown, burnup, cumulative flow, lead/cycle time).
- Scheduled reports (recurring delivery via worker). Portfolio card across folders/lists.
- Implement remaining view types: **Gantt** (dependencies, critical path, baselines),
  **Timeline**, **Activity** (event feed), **Map** (location field), **Mind Map**, **Embed**,
  **Chat view**, **Doc view**. Reuse the query compiler from Phase 3.
**Frontend tasks:**
- Dashboard grid (movable/resizable cards, Recharts), card config, drill-down, PDF export.
- Gantt UI with drag, dependency lines, critical path highlight, baseline snapshot.
- Remaining views' UIs.
**Acceptance:**
- [ ] Dashboard renders ≥6 card types with live data and per-card filters.
- [ ] Sprint burndown + velocity compute correctly against real sprint data.
- [ ] Gantt shows dependencies, critical path, and a saved baseline.
- [ ] Scheduled report is delivered on its cadence.

---

### PHASE 10 — Apps Toggles, Permissions Hardening, Sharing, Guests
**Scope:** modularity + enterprise-grade access control.
**Backend tasks:**
- `apps_enabled(scope_type, scope_id, app_key, enabled)`; gate features (Time Tracking, Multiple
  Assignees, Sprint Points, Nested Subtasks, Dependency Warning, Reschedule, Email, Custom Task IDs…)
  on these toggles, resolved by inheritance.
- Roles finalized: owner/admin/member/limited_member/guest + custom roles; private Spaces;
  per-object permission rows; request-access flow; public share links (task/doc/dashboard/view/whiteboard)
  with scoped read-only tokens.
- Guests cannot be added to Spaces; org-email users can't be guests (become limited members).
**Frontend tasks:**
- App Center (toggle apps per workspace/space); sharing modals (private + public link); member &
  guest management; permission editor per object.
**Acceptance:**
- [ ] Disabling the Time Tracking app hides timers everywhere beneath that scope.
- [ ] A public share link exposes only the shared object, read-only, no auth.
- [ ] Guest sees only explicitly shared items; cannot see the Space tree.
- [ ] Most-specific permission wins over the role floor (verified with a test matrix).

---

### PHASE 11 — AI Layer (Brain-equivalent)
**Scope:** AI as a layer over the workspace graph. Build only after the data model + automations exist.
**Architecture:**
- An **AI gateway** service (in worker) that talks to an LLM provider; **provider-agnostic** interface
  so models can be swapped. Never let the provider train on tenant data (contractual + zero-retention).
- A **retrieval layer**: index tasks, docs, comments, wikis into a vector store (pgvector) +
  keyword search; queries are **permission-filtered** (only return what the asking user can see).
**Features (build in this order):**
1. **AI Q&A / Knowledge search** — natural-language question → permission-scoped retrieval → answer
   with source links. (Highest leverage.)
2. **Summarization** — summarize a task thread, a doc, an inbox; AI Fields wave: summary, sentiment,
   translate, action_items, categorize, custom (these are custom-field type `ai_field`, Phase 2 stub
   now implemented).
3. **AI status updates / stand-ups** — compile daily updates + blockers from activity.
4. **Natural-language automation builder** — turn a sentence into an `automations` row (UI over the
   Phase 6 engine; validate before saving).
5. **AI writer** — generate/edit content in docs/tasks/comments.
6. **(Stretch) Agents** — an assignable "agent user" that can be @mentioned and run a constrained set
   of tool actions (create/update tasks, post comments) on a schedule, with an audit log and
   human-approval gate for destructive actions.
**Acceptance:**
- [ ] "What's at risk in the Marketing space this week?" returns an answer citing real tasks the
      user is allowed to see (and excludes tasks they can't).
- [ ] Task-thread summary and an `ai_field` (e.g., sentiment) populate correctly.
- [ ] A sentence creates a valid, previewable automation that, once saved, runs.
- [ ] AI never returns content from objects outside the requesting user's permissions (test this hard).

---

### PHASE 12 — Public API, Webhooks, Imports, Templates Center, Apps
**Scope:** ecosystem + platform readiness.
**Tasks:**
- Public REST API v2 surface + OpenAPI; Personal API tokens + OAuth2 apps; rate limiting (Redis).
- Outbound **webhooks** (subscribe to events per hierarchy location; signed payloads; retries).
- **Importers**: CSV, plus mappers for Asana / Trello / Jira / Monday (map their hierarchy → ours).
- Template Center (browse/apply community + workspace templates) and export (CSV/Excel for list/table).
- Native/desktop wrappers (optional): Tauri or Electron shell over the web app; mobile via Expo (later).
**Acceptance:**
- [ ] A third-party token can CRUD tasks within its permission scope, rate-limited.
- [ ] A webhook fires on task creation with a valid signature and retries on failure.
- [ ] A Trello/CSV import recreates boards/lists/cards as spaces/lists/tasks.
- [ ] Templates can be browsed, applied, and exported.

---

## 5. Cross-Cutting Concerns (apply in every phase)
- **Multitenancy isolation:** every query filtered by `workspace_id`; add a test that fails if any
  repository method omits the workspace scope. Consider Postgres RLS as defense-in-depth.
- **Performance budgets:** list endpoints < 300ms p95 for 10k tasks; views virtualized on the client.
  Use partial/GIN indexes on `task_custom_field_values(field_id, (value))`, ltree GIST index on
  `hierarchy_path`, and composite indexes on `(list_id, status_id, position)`.
- **Auditing:** activity log table records who changed what; powers Activity view + AI stand-ups.
- **Idempotency:** mutating endpoints accept `Idempotency-Key` for safe retries.
- **Accessibility & i18n:** all UI keyboard-navigable; externalize strings (the team works in
  Indonesian + English — wire i18n from Phase 0).
- **Observability:** structured logs, request tracing, metrics (job queue depth, WS connections,
  automation runs), error tracking.

---

## 6. Realtime Architecture (reference for Phase 4 onward)
```
Client (WS) ──subscribe rooms──▶ API instance ──▶ Redis pub/sub ◀── API instance ◀── other clients
     ▲                                                  ▲
     └──────── live events ◀── Postgres LISTEN/NOTIFY ──┘  (DB triggers / app emits on mutation)
```
- On any mutation, the API: (1) writes to Postgres, (2) emits a domain event, (3) the event is
  published to Redis, (4) each API instance pushes to its subscribed WS clients, (5) the event is
  also enqueued for **automation evaluation** and **search indexing**.
- Client applies optimistic update, then reconciles against the authoritative event.
- CRDT (Yjs) handles Docs/Whiteboards separately from this event bus (block-level merge).

---

## 7. Definition of Done (per phase)
A phase is complete only when: all acceptance boxes pass; migrations are reversible; unit +
integration tests cover the new endpoints; at least one Playwright e2e covers the headline flow;
OpenAPI + generated TS types are updated; and any deviation from this plan is logged in
`DECISIONS.md`. Then stop and request human review before the next phase.

---

## 8. What to Defer / Out of Scope (v1)
- Pricing/billing/plan-gating (build feature flags, but don't meter/charge yet).
- Native mobile apps (web-responsive first; Expo later).
- Voice/video calls, screen-recording clips, AI notetaker for meetings (post-v1).
- Marketplace for third-party apps; SSO/SAML/SCIM (enterprise, post-v1).
- Advanced AI agents that autonomously write/ship code.

---

## 9. First Commands for Claude Code
1. Create `CLAUDE.md` from §1 conventions and `DECISIONS.md` (empty log).
2. Confirm the Postgres-vs-SQL-Server decision in `DECISIONS.md`.
3. Begin **Phase 0**. Do not touch Phase 1 tables until Phase 0 acceptance passes.
4. After each phase, output: what changed, how to run it, and the acceptance checklist results.
