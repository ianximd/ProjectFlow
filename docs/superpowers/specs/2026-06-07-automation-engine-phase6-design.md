# Phase 6 — Automation Engine (Design)

**Date:** 2026-06-07
**Status:** Approved (design); spec under review
**BUILD_PLAN reference:** §Phase 6 ("Trigger → Condition → Action, with templates")
**Prerequisite:** Phases 1–5 complete (on `origin/main`). Builds directly on the Phase 4 realtime
event hooks and the Phase 5d `template.service` (reused by the `APPLY_TEMPLATE` action).

---

## 1. Overview & the real starting point

Phase 6 is **not greenfield.** A Jira-flavored automation feature already exists
(`infra/sql/migrations/0009_automation.sql`, `apps/api/src/modules/automation/*`, SPs, a full
When/If/Then builder at `apps/next-web/src/app/(app)/automations/automations-view.tsx`, worker
started in `apps/api/src/server.ts`). **But it is dormant:**

- 🔴 **It never fires.** `AutomationService.enqueueForEvent()` is the sole entry point and **nothing
  in the codebase ever calls it.** No task/sprint/comment mutation wires into it. Rules are created
  and stored, the worker runs, but zero events reach it.
- 🔴 **No scheduler.** `SCHEDULED` (cron) and `DUE_DATE_APPROACHING` triggers are defined but nothing
  sweeps them.
- 🟡 **Weak conditions** — AND-only, no OR groups, no operators; `ISSUE_MATCHES_FILTER` /
  `USER_HAS_ROLE` are stubbed to `return true`.
- 🟡 **Limited actions** — transition/assign/priority/comment/notify/webhook only; the webhook action
  is an **unsigned fire-and-forget `fetch`** that ignores the project's signed+retried+audited
  `webhook-outgoing` dispatcher.
- 🟡 **No `automation_runs` audit, no run-history UI, no loop guard, no seeded templates, no GraphQL
  mirror.** Scope is **project-only**.

**Phase 6's real job:** *activate* the dead engine against the live event stream + a scheduler, then
close every gap to the BUILD_PLAN spec. Delivered as **four sequential slices**, each independently
verified and merged behind a review checkpoint, matching the Phase 5 cadence.

| Slice | Feature | Greenfield? |
|------|---------|-------------|
| **6a** | Engine activation + BUILD_PLAN taxonomy rename + WORKSPACE/PROJECT scope + run audit + loop guard + GraphQL mirror | Rewires legacy `0009` engine |
| **6b** | Condition engine — nested AND/OR + operators + real filter/role checks | Replaces AND-only/stub evaluator |
| **6c** | Action expansion + per-action delay + scheduler + signed/audited webhooks | Extends legacy actions |
| **6d** | Template gallery (code catalog) + run-history UI + per-workspace metering | Greenfield |

### Locked product decisions (from brainstorming)
- **Ambition:** **full BUILD_PLAN parity** (not minimal "make-it-work", not a clean rebuild).
- **Scope model:** **PROJECT + WORKSPACE** rules. A workspace-level rule applies across all projects
  in the workspace. List/Folder-level scoping is a documented **Phase 10** deferral.
- **Taxonomy:** **rename** the legacy Jira-style enums to the BUILD_PLAN's ClickUp semantics, kept in
  the codebase's existing **SCREAMING_SNAKE** enum form (e.g. `ISSUE_CREATED → TASK_CREATED`,
  `ISSUE_TRANSITIONED → STATUS_CHANGED`, `TRANSITION_ISSUE → CHANGE_STATUS`). A data migration
  rewrites stored rules' JSON.
- **Templates:** an in-code **catalog instantiated on demand** (gallery pre-fills the builder; the
  user reviews and saves a real rule). No blind per-tenant seeding.

---

## 2. Architecture — how events reach the engine

The decisive choice. BUILD_PLAN triggers (`status_change`, `field_change`, `assignee_change`,
`comment_posted`) require **typed domain events carrying old/new values** — the engine must know
"status went `In Progress → Done`", not merely "a task changed."

**Chosen: explicit typed domain-event emission at the service layer** (rejected alternatives below).

- Add `apps/api/src/modules/automation/automation.bus.ts` — a thin `emit(event)` that replaces the
  dead `enqueueForEvent`. Service methods call it at the exact mutation points, *after commit*,
  best-effort (never throws into the caller — mirrors `publishTaskEvent`):
  - `task.service` create → `TASK_CREATED { task }`
  - `task.service.transitionTask` → `STATUS_CHANGED { task, fromStatus, toStatus }`
  - `task.service` update → diff-driven `FIELD_CHANGED { task, field, from, to }` and/or
    `ASSIGNEE_CHANGED { task, from, to }`
  - `comment.service.create` → `COMMENT_POSTED { task, comment, authorId }`
- `emit()` resolves matching enabled rules (`usp_AutomationRule_GetByTrigger`, now scope-aware) and
  enqueues one BullMQ job per rule onto the **existing `automation` queue/worker** — which already
  exists, is started in `server.ts`, and has retry/backoff configured.
- The realtime `publishTaskEvent` (live UI) stays **separate**; both fire from the same service
  methods. We do **not** couple automations to the realtime pub/sub topic.

**Rejected:**
- **A — tap `publishTaskEvent`.** Too coarse: carries only `created/updated/deleted`, no diffs → can't
  support `status_change`/`field_change` conditions on old/new. ❌
- **C — generic event outbox table + poller.** Most durable/decoupled but new infra, a poller, and
  ordering concerns; BullMQ already provides durability on the action side. Noted as a **future
  scaling path**, out of scope. ❌

**Date triggers** (`DATE_ARRIVED` / `DUE_DATE_PASSED` / `SCHEDULED`): a **BullMQ repeatable job**
copying the Phase 5c `recurrence.worker.ts` and `oauth-maintenance.worker.ts` pattern — Redis-gated,
bootstrapped at server start, sweeps due rules on an interval and enqueues normal automation jobs.

---

## 3. Cross-cutting conventions (every slice)

- **DB / SQL Server:** SP-per-op. Each SP `CREATE OR ALTER`, `SET NOCOUNT ON`,
  TRY/CATCH/TRANSACTION, returns `SELECT *` of affected row(s). Files in
  `infra/sql/procedures/usp_Automation*_*.sql`, deployed by `scripts/db-deploy-sps.ts`.
- **Migrations:** `0038_automation_scope.sql`, `0039_automation_runs.sql` (+ the taxonomy-rename
  data migration, folded into 6a). Idempotent (`IF NOT EXISTS` / `COL_LENGTH` guards), GO-batched,
  each with a matching `infra/sql/migrations/rollback/00XX_*.down.sql`.
- **API dual surface:** Hono **REST** (primary; the SSR web client uses REST) + a **GraphQL** mirror,
  both delegating to one shared `AutomationService`. (The legacy module is REST-only — 6a adds the
  GraphQL mirror to match the Phase 5 convention.)
- **Authorization:** `requirePermission('automation.create'|'.update'|'.delete')` with
  `resolveWorkspace` from the rule/project (already in place); WORKSPACE-scoped rules resolve
  workspace directly. All gates fail-closed.
- **Realtime:** unchanged — automations consume domain events; they don't add new live topics. Actions
  that mutate tasks continue to call `publishTaskEvent` through the normal service path so boards update.
- **Shared types:** extend `packages/types/index.ts` (hand-written) — the renamed enums live here.
- **i18n:** all new/renamed UI strings in `en.json` + `id.json` (real Indonesian); the `messages.unit`
  parity test must stay green. The rename touches `TRIGGER_KEYS`/`ACTION_KEYS`/`CONDITION_KEYS` label
  maps and their i18n keys.
- **DB execution policy:** migrations / SP-deploy / integration / e2e run **ONLY against local Docker
  `ProjectFlow_Test`** via explicit local DB env — **never** the prod-pointing `apps/api/.env`.
- **Definition of Done (per slice):** all acceptance boxes pass; migration reversible; unit +
  integration tests for new endpoints/behavior; ≥1 Playwright e2e for the headline flow;
  `@projectflow/types` updated; a `DECISIONS.md` entry logs deviations. Then **stop for review/merge**
  before the next slice.

---

## 4. Slice 6a — Engine activation + taxonomy + scope (the keystone)

The highest-value slice: makes rules actually fire. Everything else builds on it.

### 4.1 Data model
- **`0038_automation_scope.sql`** — on `AutomationRules`:
  - add `ScopeType NVARCHAR(12) NOT NULL DEFAULT 'PROJECT'` with `CHECK (ScopeType IN ('WORKSPACE','PROJECT'))`,
  - add `WorkspaceId UNIQUEIDENTIFIER NOT NULL` (denormalized for tenant-scoped lookups; backfilled
    from `Projects` via `ProjectId`),
  - relax `ProjectId` to `NULL` (null when `ScopeType='WORKSPACE'`),
  - add `ScopeId AS (CASE WHEN ScopeType='WORKSPACE' THEN WorkspaceId ELSE ProjectId END)` *(persisted
    computed col or maintained column)* + index `IX_AutomationRule_Scope (ScopeType, ScopeId, IsEnabled)`.
- **`0039_automation_runs.sql`** — new audit + meter tables:
  ```
  AutomationRuns(
    Id UNIQUEIDENTIFIER PK, RuleId UNIQUEIDENTIFIER NOT NULL,
    WorkspaceId UNIQUEIDENTIFIER NOT NULL, ProjectId UNIQUEIDENTIFIER NULL,
    TriggerType NVARCHAR(40) NOT NULL,
    Status NVARCHAR(16) NOT NULL,   -- 'success'|'partial'|'failed'|'skipped'|'loop_blocked'
    Payload NVARCHAR(MAX) NULL, ActionResults NVARCHAR(MAX) NULL, Error NVARCHAR(MAX) NULL,
    Depth INT NOT NULL DEFAULT 0,
    StartedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), FinishedAt DATETIME2 NULL,
    DurationMs INT NULL
  )  -- IX (RuleId, StartedAt DESC), IX (WorkspaceId, StartedAt)
  AutomationUsage(WorkspaceId UNIQUEIDENTIFIER, Period CHAR(6), RunCount INT,  -- 'YYYYMM'
                  PRIMARY KEY (WorkspaceId, Period))
  ```

### 4.2 Taxonomy rename (BUILD_PLAN semantics, SCREAMING_SNAKE)
- **Triggers:** `ISSUE_CREATED→TASK_CREATED`, `ISSUE_UPDATED→TASK_UPDATED`,
  `ISSUE_TRANSITIONED→STATUS_CHANGED`, add `FIELD_CHANGED`, `ASSIGNEE_CHANGED`, `COMMENT_POSTED`,
  `DUE_DATE_APPROACHING→DUE_DATE_PASSED` (+ keep approaching semantics via config),
  add `DATE_ARRIVED`; keep `SPRINT_STARTED`/`SPRINT_COMPLETED`/`SCHEDULED`/`MANUAL`/`WEBHOOK`.
- **Actions:** `TRANSITION_ISSUE→CHANGE_STATUS`, `ASSIGN_ISSUE→ASSIGN`, `UNASSIGN_ISSUE→UNASSIGN`,
  `SET_PRIORITY` (kept), `ADD_COMMENT→POST_COMMENT`, `SEND_NOTIFICATION` (kept),
  `TRIGGER_WEBHOOK→CALL_WEBHOOK`. (New actions arrive in 6c.)
- **Data migration** (folded into 6a, idempotent): `UPDATE AutomationRules` rewriting the enum
  strings inside `TriggerConfig`/`ConditionConfig`/`ActionConfig` JSON via `REPLACE` on the known
  old→new tokens. Logged in `DECISIONS.md`. (The engine has never fired and prod-DB work is local-only,
  so live-rule risk is minimal — the migration is defensive.)
- Update `packages/types/index.ts` unions, `apps/api` zod route schemas + validators, the worker's
  action/condition switch labels, and the frontend `TRIGGER_KEYS`/`ACTION_KEYS`/`CONDITION_KEYS` +
  `en.json`/`id.json` keys.

### 4.3 Engine activation (the core fix)
- New `apps/api/src/modules/automation/automation.bus.ts` exporting `emitAutomationEvent(event)` —
  resolves scope-matching enabled rules and enqueues jobs. Replaces the dead
  `AutomationService.enqueueForEvent`.
- `usp_AutomationRule_GetByTrigger` rewritten to match
  `IsEnabled=1 AND TriggerType=@Type AND ((ScopeType='PROJECT' AND ScopeId=@ProjectId) OR (ScopeType='WORKSPACE' AND ScopeId=@WorkspaceId))`.
- **Service-layer hooks** (after-commit, best-effort) in `task.service` (create / transition / update)
  and `comment.service.create`, emitting the typed events from §2.
- Worker writes an `AutomationRuns` row per job (start → finish) capturing status, action results,
  error, depth, and bumps `AutomationUsage`.

### 4.4 Infinite-loop guard (BUILD_PLAN acceptance)
- Each enqueued job carries `{ depth, causationChain: ruleId[] }`. Actions that mutate a task pass
  `depth+1` and the extended chain into the domain events they cause.
- The bus **drops** an enqueue when `depth >= MAX_DEPTH` (default 5) **or** the rule id is already in
  the causation chain (a rule can't re-trigger itself in one causal chain), recording a
  `loop_blocked` `AutomationRuns` row.
- Plus a short per-`(ruleId, entityId)` cooldown (Redis key, e.g. 10s) to damp tight thrash.

### 4.5 GraphQL mirror
- Add `automationRules(projectId|workspaceId)`, `createAutomationRule`, `updateAutomationRule`,
  `toggleAutomationRule`, `deleteAutomationRule`, `automationRuns(ruleId)` resolvers delegating to the
  shared service (REST stays primary).

### 4.6 Frontend
- Scope selector in the builder: **This project** vs **Entire workspace** (drives `scopeType`).
- Renamed labels everywhere (label maps + i18n). No structural UI change yet (gallery + run history
  land in 6d).

### 4.7 Tests
- **Unit:** loop-guard depth/chain logic; scope-match resolution; taxonomy-rename token mapping.
- **Integration:** create a `STATUS_CHANGED → CHANGE_STATUS+ASSIGN` rule, transition a task, assert
  the actions ran + an `AutomationRuns` row exists; workspace-scoped rule fires for a task in any
  project; a self-referential rule is `loop_blocked`.
- **e2e:** create a rule in the builder, perform the trigger in the app, observe the effect.

### 4.8 Acceptance (BUILD_PLAN)
- [ ] "When status → Done, assign to QA and set due date +2 days" runs reliably.
- [ ] Infinite-loop guard prevents an automation from retriggering itself endlessly.

---

## 5. Slice 6b — Condition engine

### 5.1 Model
- `AutomationCondition` becomes a **recursive group**:
  ```ts
  type ConditionNode =
    | { op: 'AND' | 'OR'; children: ConditionNode[] }
    | { type: ConditionType; field?: string; operator: Operator; value?: string };
  type Operator = 'is' | 'is_not' | 'contains' | 'gt' | 'lt' | 'before' | 'after' | 'is_set';
  ```
  Backward-compatible parse: a legacy flat `AutomationCondition[]` is read as an implicit top-level
  `AND` group (no migration needed for stored rules).

### 5.2 Evaluator
- Pure, unit-tested `evaluateConditionTree(node, ctx): boolean` replacing the AND-only
  `evaluateConditions`. `ctx` exposes the event payload (task before/after, actor, comment).
- `ISSUE_MATCHES_FILTER` → **reuse the existing PQL parser** (`modules/search/pql.parser.ts`) to
  evaluate a saved-filter expression against the task. `USER_HAS_ROLE` → real RBAC check via the
  access/roles service. (Both currently stub to `true`.)

### 5.3 Frontend
- Condition builder upgraded to nested AND/OR groups with an operator dropdown per leaf.

### 5.4 Tests
- **Unit:** each operator; nested AND/OR include/exclude; legacy-flat compatibility; PQL-filter and
  role evaluation.
- **Integration:** a rule with an `OR` group fires for either branch and not otherwise.

### 5.5 Acceptance (BUILD_PLAN)
- [ ] Conditions with AND/OR correctly include/exclude tasks.

---

## 6. Slice 6c — Action expansion + scheduler + signed webhooks

### 6.1 New actions
Add to the action executor + types + builder UI: `SET_FIELD` (custom-field value via the Phase 2
custom-field service/SPs), `ADD_TAG`, `CREATE_TASK`, `CREATE_SUBTASK`, `MOVE_TASK` (reuse
`publishTaskMove`), and `APPLY_TEMPLATE` (**reuse the Phase 5d `template.service.apply`**). All
actions performed as a **system actor** (`SYSTEM_USER_ID`) and emit their own domain events tagged
with the incremented loop-guard depth/chain.

### 6.2 Ordered actions with optional delay
- Actions already run sequentially. Add an optional `delaySeconds` per action → when set, the
  remaining action list is re-enqueued as a **BullMQ delayed job** (preserving order, depth, and
  causation chain) rather than blocking the worker.

### 6.3 Signed + audited webhooks
- `CALL_WEBHOOK` is rerouted through the existing **`webhook-outgoing`** dispatcher
  (`deliverWebhook` → HMAC-SHA256 `X-ProjectFlow-Signature`, BullMQ retries, delivery records). The
  raw fire-and-forget `fetch` in `automation.actions.ts` is removed.

### 6.4 Scheduler (date triggers)
- New `apps/api/src/modules/automation/automation.scheduler.worker.ts` — a BullMQ **repeatable** job
  (e.g. every 5 min, Redis-gated) that:
  - for `DUE_DATE_PASSED` / `DATE_ARRIVED` rules, queries tasks whose due/target date crossed the
    threshold since the last sweep and enqueues automation jobs;
  - for `SCHEDULED` (cron) rules, fires those whose cron window elapsed.
- Bootstrapped at server start alongside the recurrence/oauth workers.

### 6.5 Tests
- **Unit:** each new action's SP-arg mapping; delay re-enqueue ordering; scheduler due-window math.
- **Integration:** `APPLY_TEMPLATE` recreates a subtree; `CREATE_SUBTASK` adds a child; delayed
  action runs after the delay; `CALL_WEBHOOK` produces a signed delivery record; scheduler fires a
  `DUE_DATE_PASSED` rule.
- **e2e:** a due-date rule fires via the scheduler within its window.

### 6.6 Acceptance (BUILD_PLAN)
- [ ] Date-based trigger fires via scheduler within its window.
- [ ] Webhook action posts a signed payload to an external URL; run is audited.

---

## 7. Slice 6d — Template gallery + run-history + metering

### 7.1 Template catalog (code, instantiated on demand)
- `apps/api/src/modules/automation/automation.templates.ts` — a versioned in-code array of **15–20**
  template definitions, each `{ key, i18nTitleKey, i18nDescKey, trigger, conditions, actions }` with
  placeholders the user fills in. Examples: auto-assign on create; move to In Progress on assign;
  comment + notify on blocker added; nudge assignee on overdue; close stale after N days; set
  priority on label; post to webhook on Done; create follow-up subtask on Done; apply checklist
  template on create; notify watchers on status change; round-robin assign; escalate priority on due
  date passed; archive on closed; sprint-rollover housekeeping; etc.
- `GET /api/v1/automations/templates` returns the catalog (localized). Selecting one **pre-fills the
  builder**; the user reviews and saves a normal rule. No tenant rows seeded.

### 7.2 Run history
- `GET /api/v1/automations/:id/runs` (+ GraphQL `automationRuns`) reading `AutomationRuns`
  (paginated, newest first). A **run-history drawer** per rule shows status, trigger, actions,
  duration, and errors.

### 7.3 Metering
- Per-workspace counter surfaced read-only from `AutomationUsage` (current period). **No enforcement**
  — limits/gating are a Phase 10 concern.

### 7.4 Frontend
- Template **gallery** entry point on the Automations view (cards → "Use template" pre-fills the
  create dialog). Run-history drawer. A small "runs this month" workspace stat.

### 7.5 Tests
- **Unit:** catalog integrity (every template validates against the rule schema); localization keys
  exist in en + id.
- **Integration:** instantiate a template → saved rule matches; run-history endpoint returns audited
  runs in order.
- **e2e:** pick a template from the gallery, save it, trigger it, see it in run history.

### 7.6 Acceptance (BUILD_PLAN)
- [ ] 15–20 prebuilt automation templates available (gallery).
- [ ] Run history view shows audited executions.

---

## 8. Execution model

Each slice is executed via **subagent-driven-development** (a fresh implementer subagent per task +
a two-stage spec/quality review per task, matching the Phase 5 / 3.5 flow). After a slice:
1. Verify on **local Docker `ProjectFlow_Test`**: API unit + integration, web unit + i18n parity,
   `npm run build`, and the slice's e2e headline flow.
2. Record decisions/deviations in `DECISIONS.md`.
3. **Stop for review / merge** before the next slice.

Order: **6a → 6b → 6c → 6d.** 6a is the keystone (activation) and must land first; 6b (conditions)
and 6c (actions/scheduler) are largely independent and could parallelize but are sequenced to keep
each slice's blast radius small; 6d depends on the rest.

---

## 9. Consolidated deferrals (logged for `DECISIONS.md`)
1. **Scope:** List/Folder-level rule scoping (the BUILD_PLAN `scope_type ∈ {space,folder,list}`) is
   deferred to **Phase 10** (`apps_enabled` + hierarchy resolution). Phase 6 ships PROJECT + WORKSPACE.
2. **Metering:** per-workspace run **enforcement / limits** deferred to **Phase 10**; Phase 6 counts only.
3. **AI:** natural-language automation builder is **Phase 11** (it builds a rule over this engine's UI).
4. **Scaling:** a generic durable **event outbox + poller** (Architecture option C) is a future path,
   not this phase — BullMQ provides action-side durability.
5. **Webhook trigger inbound:** the `WEBHOOK` *trigger* (inbound) reuses the trigger plumbing but a
   public inbound endpoint is minimal in 6c; full inbound-webhook intake aligns with Phase 12
   (Public API / webhooks).
