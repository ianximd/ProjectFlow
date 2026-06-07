# Phase 9 — Dashboards & Reporting + remaining views (Design)

**Date:** 2026-06-07
**Status:** Approved (design); spec under review
**BUILD_PLAN reference:** §Phase 9 ("Dashboards & Reporting + remaining views")
**Prerequisite:** Phases 1–8 complete. Reuses the Phase 3 **view query compiler** (view `config` →
parameterized SQL over tasks + custom-field values), the Phase 5 `task_dependencies` table (Gantt
lines / critical path), the Phase 8 time/sprint/goal services (time-tracked / sprint / goal cards),
the existing **report SPs** (`usp_Report_*`) + Recharts chart components, the Phase 4/3.5 realtime
publish path (live cards + Activity feed), the Phase 3.5 **notification/inbox** (scheduled-report
delivery), and the Phase 5c `recurrence.worker` BullMQ repeatable-job pattern (scheduled-report
scheduler). **Doc** and **Chat** views depend on the Phase 7 docs surface.

---

## 1. Overview & the real starting point

Phase 9 is **"make it first-class + complete the view matrix"**, not greenfield reporting. A
surprising amount already exists — it is just hardcoded, REST-only, and capped at four view types:

- 🟡 **Reporting ~70% built (REST-only).** Five report SPs exist —
  `usp_Report_Burndown`, `usp_Report_Velocity`, `usp_Report_SprintSummary`, `usp_Report_Workload`,
  `usp_Report_CreatedVsResolved` — with matching types in `packages/types/index.ts`
  (`BurndownReport`/`BurndownPoint`, `VelocityEntry`, `SprintSummaryReport`/`SprintStatusBreakdown`,
  `WorkloadEntry`, `CreatedVsResolvedEntry`) and REST routes in
  `apps/api/src/modules/reports/reports.routes.ts` (`GET /reports/burndown?sprintId=`,
  `/reports/velocity?projectId=&numSprints=`, `/reports/sprint-summary?sprintId=`,
  `/reports/workload?projectId=`, `/reports/created-vs-resolved?projectId=&weeks=`). **Missing:** a
  **GraphQL mirror**, the advanced sprint analytics (burnup, cumulative flow, lead/cycle time), and a
  cross-location **portfolio** rollup.
- 🟡 **Dashboard ~30% built (hardcoded).** Recharts **v3.8.1** is installed and there are five reusable
  chart components in `apps/next-web/src/components/charts/` (`BurndownChart`, `VelocityChart`,
  `SprintSummaryWidget`, `WorkloadChart`, `CreatedVsResolvedChart`), surfaced by a **single hardcoded
  page** `apps/next-web/src/app/(app)/dashboard/dashboard-view.tsx`. **Missing:** any
  `dashboards`/`dashboard_cards` table, a config-driven card model, a movable/resizable grid, per-card
  filters, the full card catalog, and PDF export. The dashboard is **not** a savable, user-configurable
  object today.
- 🔴 **Scheduled reports = greenfield.** The `recurrence.worker` BullMQ pattern exists to copy, but
  there is no scheduled-report table, no snapshot/delivery, and no run history.
- 🔴 **Remaining view types = greenfield.** `ViewType = 'list' | 'board' | 'table' | 'calendar'`
  (`packages/types/index.ts`) and the `SavedViews.Type` CHECK constraint
  (`infra/sql/migrations/0032_saved_views.sql`: `CK_SavedViews_Type IN
  ('list','board','table','calendar')`) both cap views at four; `view-surface.tsx` dispatches only to
  `ListView`/`BoardViewEngine`/`TableView`/`CalendarView`. **None** of Gantt, Timeline, Activity, Map,
  Mind Map, Embed, Chat, or Doc exists as a view type. *(Phase 8d adds `workload`/`box` client-side;
  Phase 9 also reconciles those into the DB CHECK — see 9d.)*
- 🟢 **Activity has a backing store already.** `dbo.AuditLog` (`0015_audit_log.sql`: `Id, WorkspaceId,
  UserId, UserEmail, Action, Resource, ResourceId, OldValues, NewValues (JSON), IpAddress, UserAgent,
  CreatedAt`) + `usp_AuditLog_Create`/`usp_AuditLog_List` + `AuditLogEntry`/`AuditLogPage` types. The
  Activity **view** reads this — no new event table is needed.
- 🔴 **No geo/location field.** Custom-field types are fixed at `text…progress_auto` (`0030`) +
  `relationship`/`rollup` (`0035`). The **Map** view requires a new `location` field type first.

**Phase 9's real job:** lift reporting from REST-only to GraphQL + dashboard-card data sources, make
**dashboards a first-class config-driven object** with the full card catalog + PDF export, add
**scheduled delivery**, and build **all eight remaining view types** to full BUILD_PLAN parity.
Delivered as **six sequential slices**, each independently verified and merged behind a review
checkpoint, matching the Phase 5/6/8 cadence.

| Slice | Feature | Greenfield? |
|------|---------|-------------|
| **9a** | **Dashboards core** — `dashboards`+`dashboard_cards`, scoped CRUD, dnd-kit movable/resizable grid, wave-1 cards (task-list, calculation, bar/line/pie, time-tracked, goal), per-card filters, **PDF export**; REST + GraphQL | Greenfield (reuses chart components) |
| **9b** | **Analytics & sprint/portfolio cards** — GraphQL mirror for the 5 reports + **burnup / cumulative-flow / lead-cycle-time** SPs + **portfolio**, **timesheet**, **battery** cards | Extends reports |
| **9c** | **Scheduled reports** — `scheduled_reports`+`_runs`, worker, inbox delivery, run history | Greenfield |
| **9d** | **Gantt + Timeline views** — dependency lines, critical path, baselines + Timeline; expand `CK_SavedViews_Type` to the full union | Greenfield (ViewType + CHECK) |
| **9e** | **Activity + Embed + Doc views** — Activity over `AuditLog` + realtime; Embed (external URL); Doc view (Phase 7 docs) | Greenfield |
| **9f** | **Map + Mind Map + Chat views** — greenfield `location` custom-field type + map render; Mind Map (hierarchy tree); Chat view | Greenfield |

### Locked product decisions (from brainstorming)
- **Ambition:** **full BUILD_PLAN parity** — every §Phase 9 item, including all eight remaining view
  types (Map/Mind Map/Chat included) and scheduled-report delivery.
- **Dashboards:** **dedicated first-class `dashboards` + `dashboard_cards` tables** (config-driven,
  scoped like `SavedViews`); the existing chart components become reusable **card renderers**, and the
  hardcoded dashboard page is re-pointed at the new model (kept working throughout).
- **Card data:** **one shared aggregation layer** — a `card.service` dispatcher routes generic cards
  through the Phase 3 query compiler, report cards through the `usp_Report_*` SPs, and goal/timesheet
  cards through Phase 8 services. No per-card bespoke query plumbing.
- **Scheduled delivery:** delivered **via the Phase 3.5 notification/inbox** (an in-app "your report is
  ready" notification carrying the snapshot); an **email adapter is pluggable but deferred** to Phase 12
  (no SMTP infra yet). This satisfies the §Phase 9 "delivered on its cadence" acceptance now.
- **View types:** **expand** the `ViewType` union, the `CK_SavedViews_Type` CHECK, and the
  `view-surface.tsx` registry to the full set; every new view is a **client renderer over the same
  compiled task query** — no parallel data path.

---

## 2. Architecture — the three decisive mechanisms

### 2.1 The dashboard card — typed config over a shared aggregation layer (9a/9b)
A dashboard is a `Dashboards` row; each card is a `DashboardCards(Type, Config JSONB, Layout)` row.
The decisive idea is **one resolver, three data sources**:

```
card.service.resolve(card, dashboardScope) ─┬─ generic cards  → Phase 3 query compiler
                                            │   (bar/line/pie/battery/calculation/task-list)
                                            ├─ report cards    → usp_Report_* SPs
                                            │   (burndown/velocity/burnup/cumulative-flow/lead-cycle)
                                            └─ entity cards    → Phase 8 services
                                                (time-tracked/timesheet/goal)
```

- **Generic cards** carry a `config` shaped like a view (filter groups, group_by, an aggregate op
  `count|sum|avg|min|max` over a field) and run through the **Phase 3 query compiler** — the same
  filter/group machinery the views already use, so a card is "a saved query + a chart shape."
- **Report cards** carry their report params (`sprintId`, `projectId`, `weeks`…) and call the existing
  (9b: extended) `usp_Report_*` SPs; the existing Recharts components render the result unchanged.
- **Entity cards** call Phase 8 `goal.service` / `worklog.service` / `timesheet.service`.
- **Per-card filters** + a dashboard-level scope (`workspace|space|folder|list`) compose: the card's
  own filter `AND` the dashboard scope. A **portfolio** card (9b) deliberately spans multiple
  folders/lists by taking a set of scope nodes instead of one.
- **PDF export** renders the dashboard via a dedicated print-optimized `?print=1` layout and triggers
  the browser print-to-PDF — no new server dependency, and export always matches what the cards show.

### 2.2 New view types — expand the registry, reuse the compiler (9d/9e/9f)
The four-type cap is the only thing in the way. The mechanism to lift it is uniform:

1. **One migration** (`0049`) expands `CK_SavedViews_Type` to the full union
   (`list, board, table, calendar, workload, box, gantt, timeline, activity, map, mindmap, embed,
   chat, doc`) — this also folds in Phase 8d's `workload`/`box` so the DB and the `ViewType` union
   agree.
2. The `ViewType` union in `packages/types/index.ts` gains the same members.
3. `view-surface.tsx` registers a renderer per new type.
4. Each renderer consumes the **same compiled task query** the existing views use (via the Phase 3
   compiler) and layers presentation on top:
   - **Gantt/Timeline** read `start_date`/`due_date` + Phase 5 `task_dependencies` for bars + lines.
   - **Activity** reads `usp_AuditLog_List` (scoped) + subscribes to the realtime event stream.
   - **Map** reads the new `location` field's `{lat,lng,label}` JSONB value.
   - **Mind Map** reads the `parent_task_id` subtree (the Phase 1 hierarchy) as a node graph.
   - **Embed** stores an external URL in `config` and renders a sandboxed `<iframe>`.
   - **Doc/Chat** embed the Phase 7 doc surface (Doc = a pinned doc; Chat = a task/list comment stream
     rendered as a channel).

No view introduces a second source of truth; a view is always a *lens* over the task graph (or, for
Activity, the audit log), so filters/grouping/realtime behave consistently across all of them.

### 2.3 Scheduled reports — the `recurrence.worker` pattern + inbox delivery (9c)
Scheduled delivery copies the Phase 5c BullMQ **repeatable-job** pattern wholesale
(`apps/api/src/modules/recurrence/recurrence.worker.ts`: idempotent `start*Worker()`, Redis-gated,
fixed sweep interval, a pure `run*Sweep(now?)` helper for tests, registered in `server.ts`):

- A `ScheduledReports` row binds a **dashboard** (or a single report) to a **cadence** (RRULE-ish,
  reusing the Phase 5 recurrence-rule shape) + a **recipient set**.
- **`scheduled-report.worker.ts`** sweeps due schedules, **snapshots** the dashboard/report (resolves
  every card via `card.service`, freezing the data + a render payload), writes a `ScheduledReportRuns`
  audit row, and **delivers** via the Phase 3.5 notification path — an in-app notification linking to
  the frozen snapshot. The **email adapter is a no-op stub** behind a `DeliveryChannel` field
  (`inbox` now; `email` wired in Phase 12).
- Delivery is **idempotent per (schedule, period)** so a worker restart never double-delivers.

---

## 3. Cross-cutting conventions (every slice)

- **DB / SQL Server:** SP-per-op (`CREATE OR ALTER`, `SET NOCOUNT ON`, TRY/CATCH/TRANSACTION,
  `SELECT *` of affected rows) in `infra/sql/procedures/`, deployed by `scripts/db-deploy-sps.ts`.
- **Migrations** (assume Phases 6/7/8 land first — on-disk is currently `0037`; Phase 6 uses
  `0038–0039`, Phase 7 `0040–0042`, Phase 8 `0043–0046`): `0047_dashboards.sql`,
  `0048_scheduled_reports.sql`, `0049_view_types_and_baselines.sql` (expand `CK_SavedViews_Type` +
  Gantt baseline tables), `0050_location_field.sql` (add `location` to the custom-field type CHECK).
  **9b and 9e add no migration** (9b = new report SPs + GraphQL only; 9e = Activity reads `AuditLog`,
  Embed/Doc are `config`-only). Each idempotent (`IF NOT EXISTS` / `COL_LENGTH` / constraint
  drop-then-recreate guards), GO-batched, with a matching
  `infra/sql/migrations/rollback/00XX_*.down.sql`.
- **API dual surface:** Hono **REST** (primary; the SSR web client uses REST) + a **GraphQL** mirror,
  both delegating to one shared service per module (`dashboards`, `reports` [+GraphQL],
  `scheduled-reports`). The reports module is REST-only today — 9b adds its GraphQL mirror to match
  convention.
- **Authorization:** `requirePermission('<entity>.<action>')` with `resolveWorkspace` from the
  entity/scope (e.g. `dashboard.create|update|delete`, `dashboard.read`, `report.read`,
  `scheduled_report.manage`) + `requireObjectLevel` for hierarchy-scoped dashboards/views (a dashboard
  scoped to a private Space requires `VIEW` on that Space). All gates fail-closed. A dashboard's
  cards never return data the requesting user couldn't read directly — card resolution runs through the
  same object-level filter as the views.
- **Realtime:** dashboard cards bound to live data and the Activity view subscribe to the existing
  event path so they update without refresh; no new live topics are introduced (cards re-resolve on
  the relevant `task:event`).
- **Shared types:** extend `packages/types/index.ts` (hand-written) — `Dashboard`, `DashboardCard`,
  `CardType`/`CardConfig`, the new report types (`BurnupReport`, `CumulativeFlowEntry`,
  `LeadCycleTimeReport`, `PortfolioEntry`), `ScheduledReport`/`ScheduledReportRun`, the `ViewType`
  additions, and the `location` field value shape.
- **i18n:** all new UI strings in `en.json` + `id.json` (real Indonesian); the `messages.unit` parity
  test must stay green. Chart axis/series labels and card-type names are externalized.
- **DB execution policy:** migrations / SP-deploy / integration / e2e run **ONLY against local Docker
  `ProjectFlow_Test`** via explicit local DB env — **never** the prod-pointing `apps/api/.env`.
- **⚠️ Next.js:** per `apps/next-web/AGENTS.md`, this Next.js has breaking changes — **read the in-repo
  `node_modules/next/dist/docs/` before writing web code.**
- **Definition of Done (per slice):** all acceptance boxes pass; migration reversible; unit +
  integration tests for new endpoints/behavior; ≥1 Playwright e2e for the headline flow;
  `@projectflow/types` updated; a `DECISIONS.md` entry logs deviations. Then **stop for review/merge**
  before the next slice.

---

## 4. Slice 9a — Dashboards core (config-driven grid + wave-1 cards + PDF)

The foundation: turns the hardcoded dashboard into a first-class, savable, scoped object with a card
grid that 9b/9c build on.

### 4.1 Data model (`0047_dashboards.sql`)
```
Dashboards(Id PK, WorkspaceId, ScopeType NVARCHAR(12) NOT NULL,   -- 'workspace'|'space'|'folder'|'list'
     ScopeId UNIQUEIDENTIFIER NULL, Name, Description NVARCHAR(MAX) NULL,
     Visibility NVARCHAR(10) NOT NULL DEFAULT 'shared',           -- 'private'|'shared'|'protected'
     OwnerId, IsDefault BIT NOT NULL DEFAULT 0, Position FLOAT,
     CreatedAt, UpdatedAt, DeletedAt)
DashboardCards(Id PK, DashboardId FK, Type NVARCHAR(24) NOT NULL,  -- see card catalog
     Title NVARCHAR(200) NULL, Config NVARCHAR(MAX) NOT NULL,      -- JSONB: data source + chart shape + filter
     Layout NVARCHAR(MAX) NOT NULL,                                -- {x,y,w,h} grid position/size
     Position FLOAT, CreatedAt, UpdatedAt)
```
Visibility mirrors `SavedViews` (private/shared/protected) and reuses its resolution. Scope mirrors the
view scope set (`workspace|space|folder|list`).

### 4.2 Backend
- SPs: `usp_Dashboard_Create|GetById|Update|Delete|ListByScope`, `usp_DashboardCard_Create|Update|
  Delete|Reorder`, `usp_Dashboard_SetDefault`.
- `dashboard.service`: dashboard + card CRUD, default-per-scope guard (one), visibility resolution
  (reuse the `SavedViews` visibility check).
- **`card.service`** (the §2.1 dispatcher): `resolve(card, scope)` → for **wave-1 card types**
  `task_list`, `calculation` (count/sum/avg over a field), `bar`, `line`, `pie`, `time_tracked`,
  `goal`. Generic cards compile their `config` via the **Phase 3 query compiler** under the
  requesting user's object-level filter; `time_tracked`/`goal` call Phase 8 services.
- REST routes (`/dashboards`, `/dashboards/:id`, `/dashboards/:id/cards`, …) + GraphQL mirror
  (`dashboards(scope)`, `dashboard(id)`, `dashboardCardData(cardId)`, create/update/delete mutations).

### 4.3 Frontend
- **Dashboard grid**: a movable/resizable card grid (**dnd-kit**) with add-card, configure-card,
  resize, reorder; cards render via the existing Recharts components + a generic `task_list`/
  `calculation` renderer. Per-card filter editor reuses the Phase 3 filter-builder component.
- Re-point `dashboard/dashboard-view.tsx` at the new model (a seeded default workspace dashboard
  preserves today's view). **PDF export** button → opens a `?print=1` print-optimized layout and
  triggers the browser print-to-PDF.

### 4.4 Tests
- **Unit:** card `config` → compiled query (generic cards); calculation aggregates; default-per-scope
  guard; visibility resolution.
- **Integration:** dashboard + card CRUD; card data resolves under object-level scoping (a user without
  access to a list sees no rows from it in a card); reorder/resize persists.
- **e2e:** create a dashboard, add ≥6 card types with live data + per-card filters, export to PDF.

### 4.5 Acceptance (BUILD_PLAN)
- [ ] Dashboard renders ≥6 card types with live data and per-card filters.

---

## 5. Slice 9b — Analytics & sprint/portfolio cards (+ reports GraphQL)

### 5.1 Data model
No new tables. New **report SPs** in `infra/sql/procedures/`:
- `usp_Report_Burnup` (completed vs. scope over a sprint),
- `usp_Report_CumulativeFlow` (status-band counts over time),
- `usp_Report_LeadCycleTime` (per-task lead/cycle time from status timestamps / audit history),
- `usp_Report_Portfolio` (rollup across a set of folders/lists: counts, progress, on-track).

### 5.2 Backend
- Extend the `reports` module with the four new SPs + types (`BurnupReport`, `CumulativeFlowEntry`,
  `LeadCycleTimeReport`, `PortfolioEntry`).
- **GraphQL mirror for reports** (new): `burndown(sprintId)`, `velocity(projectId,numSprints)`,
  `sprintSummary(sprintId)`, `workload(projectId)`, `createdVsResolved(projectId,weeks)`,
  `burnup(sprintId)`, `cumulativeFlow(scope,range)`, `leadCycleTime(scope,range)`,
  `portfolio(scopeIds)`.
- New **card types** in `card.service`: `burndown`, `velocity`, `burnup`, `cumulative_flow`,
  `lead_cycle_time`, `sprint_summary`, `portfolio`, `timesheet`, `battery` (a progress "battery"
  card = aggregate progress vs. target). Each maps to a report SP / Phase 8 service + a Recharts
  component (existing where present; new `BurnupChart`/`CumulativeFlowChart`/`PortfolioCard` otherwise).

### 5.3 Frontend
- New chart components (`BurnupChart`, `CumulativeFlowChart`, `LeadCycleTimeChart`, `PortfolioCard`,
  `BatteryCard`, `TimesheetCard`) registered in the card renderer registry; card-config editors expose
  their params (sprint, scope set, range).

### 5.4 Tests
- **Unit:** burnup/cumulative-flow/lead-cycle math; portfolio rollup across multiple scopes.
- **Integration:** GraphQL report queries return the same computed values as their REST counterparts
  (envelope shape aside); sprint burndown + velocity compute correctly against seeded sprint data.
- **e2e:** add a burndown + a velocity + a portfolio card to a dashboard; values reflect real data.

### 5.5 Acceptance (BUILD_PLAN)
- [ ] Sprint burndown + velocity compute correctly against real sprint data.

---

## 6. Slice 9c — Scheduled reports (worker + delivery + history)

### 6.1 Data model (`0048_scheduled_reports.sql`)
```
ScheduledReports(Id PK, WorkspaceId, DashboardId FK NULL, ReportKind NVARCHAR(24) NULL,
     ReportParams NVARCHAR(MAX) NULL,                 -- when scheduling a single report instead of a dashboard
     Cadence NVARCHAR(MAX) NOT NULL,                  -- RRULE-ish (reuse Phase 5 recurrence shape)
     DeliveryChannel NVARCHAR(10) NOT NULL DEFAULT 'inbox',   -- 'inbox' | 'email' (email deferred)
     Recipients NVARCHAR(MAX) NOT NULL,               -- user ids (+ external emails when email lands)
     Enabled BIT NOT NULL DEFAULT 1, NextRunAt DATETIME2 NULL,
     OwnerId, CreatedAt, UpdatedAt, DeletedAt)
ScheduledReportRuns(Id PK, ScheduledReportId FK, PeriodKey NVARCHAR(40) NOT NULL,
     RanAt DATETIME2, Status NVARCHAR(12), SnapshotRef NVARCHAR(MAX) NULL, Error NVARCHAR(MAX) NULL,
     UNIQUE (ScheduledReportId, PeriodKey))           -- idempotent per period
```

### 6.2 Backend
- SPs: `usp_ScheduledReport_Create|Update|Delete|ListDue`, `usp_ScheduledReportRun_Record`.
- `scheduled-report.service`: CRUD, next-run computation (reuse the Phase 5 recurrence-rule evaluator),
  and `snapshot(schedule)` — resolves every card via `card.service` into a frozen payload.
- **`scheduled-report.worker.ts`** (§2.3): BullMQ repeatable sweep → `runScheduledReportSweep(now?)`
  (pure, test-friendly) selects due schedules, snapshots, records a run (unique per `PeriodKey` →
  idempotent), and **delivers via the Phase 3.5 notification path** (in-app "report ready"
  notification linking the snapshot). Email delivery is a stubbed adapter behind `DeliveryChannel`.
  Registered in `server.ts` beside the recurrence/sprint/oauth workers.

### 6.3 Frontend
- Schedule editor on a dashboard ("Deliver this dashboard every Monday 9am to …"); a run-history list
  with status; the delivered snapshot opens read-only.

### 6.4 Tests
- **Unit:** next-run/cadence computation; per-period idempotency (a re-run of the same period is a
  no-op); snapshot freezes card data.
- **Integration:** a due schedule produces exactly one run + one inbox notification per period; a
  worker restart mid-period does not double-deliver.
- **e2e:** schedule a dashboard, advance the sweep helper, see the run recorded + an inbox notification.

### 6.5 Acceptance (BUILD_PLAN)
- [ ] Scheduled report is delivered on its cadence.

---

## 7. Slice 9d — Gantt + Timeline views

The headline view of the phase.

### 7.1 Model (`0049_view_types_and_baselines.sql`)
- **Expand** `CK_SavedViews_Type` to the full union (drop-and-recreate the CHECK):
  `list, board, table, calendar, workload, box, gantt, timeline, activity, map, mindmap, embed, chat,
  doc`. Add the same members to the `ViewType` union.
- **Baselines** (Gantt): `Baselines(Id PK, ViewId FK, Name, CapturedAt, CreatedBy)` +
  `BaselineTasks(BaselineId FK, TaskId, StartDate, DueDate)` — a frozen snapshot of task dates to
  compare planned-vs-actual.

### 7.2 Backend
- A Gantt data resolver: tasks in scope (Phase 3 compiler) + their `start_date`/`due_date` +
  **`task_dependencies`** (Phase 5) edges; a **critical-path** computation (longest dependency chain by
  duration) in `gantt.service` (pure, unit-tested). Baseline capture/list SPs
  (`usp_Baseline_Capture`, `usp_Baseline_List`).
- Drag updates reuse the existing task `start_date`/`due_date` PATCH path (which already publishes a
  realtime event); dependency edits reuse Phase 5 endpoints.

### 7.3 Frontend
- **Gantt UI**: horizontal bars per task, drag to move/resize (updates dates), **dependency lines**
  between bars, **critical-path** highlight, and a **baseline** overlay (saved snapshot vs. current).
- **Timeline UI**: a lighter date-laned view (group rows by assignee/status/custom field) over the same
  resolver, drag to reschedule.

### 7.4 Tests
- **Unit:** critical-path computation; baseline diff (current vs. captured).
- **Integration:** Gantt resolver returns tasks + dependency edges; baseline capture freezes dates;
  drag PATCH updates dates and emits a realtime event.
- **e2e:** open Gantt, see dependency lines + critical path, capture a baseline, drag a task and see
  the date change reflected in List/Board live.

### 7.5 Acceptance (BUILD_PLAN)
- [ ] Gantt shows dependencies, critical path, and a saved baseline.

---

## 8. Slice 9e — Activity + Embed + Doc views

### 8.1 Model
No migration. Activity reads `dbo.AuditLog`; Embed/Doc store their target in `SavedViews.config`.

### 8.2 Backend
- Activity resolver: `usp_AuditLog_List` scoped to the view's hierarchy node (+ the requesting user's
  object-level filter), paginated; subscribes to the realtime event stream for live prepend.
- Doc view: resolves a pinned Phase 7 doc id from `config`. Chat is 9f; Doc here renders a single doc.
- Embed: validates/normalizes the external URL in `config` (allow-list scheme, no `javascript:`).

### 8.3 Frontend
- **Activity view**: a reverse-chronological event feed (actor, action, object, time) with live
  prepend and filter-by-actor/action; rendered from `AuditLogEntry`.
- **Embed view**: sandboxed `<iframe>` (`sandbox`, `referrerpolicy`) for the configured URL.
- **Doc view**: embeds the Phase 7 doc editor/reader for the pinned doc.

### 8.4 Tests
- **Unit:** audit-feed scoping/pagination; embed URL validation (rejects unsafe schemes).
- **Integration:** Activity returns only events for objects the user can see; new mutation appears live.
- **e2e:** open Activity, perform an edit in another tab, see it appear; add an Embed view with a URL.

### 8.5 Acceptance (covers BUILD_PLAN "remaining views")
- [ ] Activity feed renders scoped events live; Embed and Doc views render their targets.

---

## 9. Slice 9f — Map + Mind Map + Chat views

### 9.1 Model (`0050_location_field.sql`)
- Add `location` to the custom-field type CHECK (`0030`/`0035` lineage). Value shape (JSONB):
  `{ "lat": number, "lng": number, "label": string }`. No other migration (Mind Map reads the existing
  `parent_task_id` hierarchy; Chat reads existing comments; both store only `config`).

### 9.2 Backend
- Map resolver: tasks in scope with a non-null `location` field value (Phase 3 compiler + a field
  filter). Field-type validation for `location` (lat/lng ranges) added to the Phase 2 validator.
- Mind Map resolver: the `parent_task_id` subtree under the view scope as a node/edge graph (reuse the
  Phase 1 "everything under node X" descendant query).
- Chat resolver: a task's/list's comment stream (Phase 4 comments) rendered as a channel; posting
  reuses the existing comment-create path.

### 9.3 Frontend
- **Map view**: a map canvas plotting tasks by their `location` value (a lightweight tile map; no paid
  key — OpenStreetMap tiles), click a pin → task panel.
- **Mind Map view**: a radial/tree node graph of the task hierarchy; expand/collapse nodes.
- **Chat view**: a channel-style comment stream with inline compose (reuses the comment components).

### 9.4 Tests
- **Unit:** `location` field validation (lat/lng bounds); mind-map graph build from a subtree.
- **Integration:** Map returns only located tasks in scope; Chat post creates a real comment.
- **e2e:** set a task's location, see the pin on Map; expand the Mind Map; post in Chat view.

### 9.5 Acceptance (covers BUILD_PLAN "remaining views")
- [ ] Map plots located tasks; Mind Map renders the hierarchy; Chat view streams + posts comments.

---

## 10. Execution model

Each slice via **subagent-driven-development** (a fresh implementer subagent per task + a two-stage
spec/quality review per task, matching the Phase 5/6/8 flow). After a slice:
1. Verify on **local Docker `ProjectFlow_Test`**: API unit + integration, web unit + i18n parity,
   `npm run build`, and the slice's e2e headline flow.
2. Record decisions/deviations in `DECISIONS.md`.
3. **Stop for review / merge** before the next slice.

Order: **9a → 9b → 9c → 9d → 9e → 9f.** 9a (dashboard core + `card.service`) is the foundation 9b
(more cards) and 9c (scheduled snapshots) read from. 9d (Gantt) carries the `CK_SavedViews_Type`
expansion that 9e/9f also need, so it goes first among the view slices. 9e (Activity/Embed/Doc) and 9f
(Map/MindMap/Chat) are independent of each other and could swap; **Doc + Chat assume Phase 7 docs/
comments exist** — if Phase 7 slips, ship Doc/Chat as stubs and re-enable when Phase 7 lands.

---

## 11. Consolidated deferrals (logged for `DECISIONS.md`)
1. **Scheduled-report email/Slack delivery:** Phase 9 delivers via the **in-app inbox** only; SMTP/
   external delivery channels → **Phase 12** (public surface + integrations). The `DeliveryChannel`
   column + stub adapter are in place so the later wiring is additive.
2. **PDF rendering engine:** Phase 9 uses **client print-to-PDF** of a `?print=1` layout; a
   server-rendered PDF service (headless render, pixel-perfect export) is a later optimization.
3. **Map tiles / geocoding:** Phase 9 plots raw `lat/lng` on free OpenStreetMap tiles; **address →
   coordinates geocoding** and paid map providers → out of scope v1.
4. **Doc / Chat views depend on Phase 7:** if the Phase 7 docs/comments surface is not yet built when
   9e/9f run, those two renderers ship as feature-flagged stubs and are enabled when Phase 7 lands.
5. **AI report narration:** natural-language "what changed this week" summaries over the Activity feed
   and dashboards → **Phase 11**.
6. **Lead/cycle-time history source:** lead/cycle-time uses status-transition timestamps; if status
   history is thin, it falls back to `AuditLog` status-change events — a richer per-status duration
   table is a follow-up if reporting demands it.
