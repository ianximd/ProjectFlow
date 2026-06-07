# Phase 6d — Template Gallery, Run History & Metering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the greenfield surface that turns the now-active automation engine (6a–6c) into a usable product: an **in-code template catalog** of **18** prebuilt rule definitions (`automation.templates.ts`) exposed via `GET /api/v1/automations/templates` (localized) and a **gallery** that pre-fills the existing rule builder (no tenant seeding); a **run-history** read surface — `GET /api/v1/automations/:id/runs` + GraphQL `automationRuns` reading the `AutomationRuns` audit table (paginated, newest-first) rendered in a per-rule drawer; and a **read-only per-workspace metering** stat from `AutomationUsage` for the current period (no enforcement). REST stays primary; GraphQL mirrors it.

**Architecture:** The catalog is a versioned, hand-written array of `AutomationTemplate` definitions (`{ key, i18nTitleKey, i18nDescKey, trigger, conditions, actions }`) using the BUILD_PLAN SCREAMING_SNAKE enum tokens introduced in 6a (`TASK_CREATED`, `STATUS_CHANGED`, `CHANGE_STATUS`, `ASSIGN`, …) plus the 6b condition operators and 6c action types — each definition validates against the **same Zod rule schema** the create route uses, guaranteeing "Use template" produces a savable rule. `GET /templates` localizes each definition's title/description by reading `i18nTitleKey`/`i18nDescKey` against the request locale and returns the raw `trigger`/`conditions`/`actions` for the builder to hydrate. Run history is read-only: a new `usp_AutomationRule_ListRuns` reads the `AutomationRuns` table (written by the 6a worker) ordered `StartedAt DESC` with keyset/offset pagination; metering reads `AutomationUsage(WorkspaceId, Period CHAR(6))` for the current `'YYYYMM'` period via `usp_AutomationUsage_GetCurrent`. The frontend adds a **template gallery** entry point on `automations-view.tsx` (cards → "Use template" opens the existing `RuleDialog` pre-filled), a **run-history drawer** per rule, and a **"runs this month"** workspace stat. No new domain events, no scheduler, no migration — 6d only **reads** 6a's tables and adds catalog/read SPs.

**Tech Stack:** SQL Server stored procedures (`CREATE OR ALTER`, `SET NOCOUNT ON`); Hono REST + `@hono/zod-validator`; graphql-yoga + Pothos (`@pothos/core`); `mssql` via `execSpOne`; `next-intl` localization on the API (or a small in-module catalog of en+id strings — see Task 3); vitest (`--project unit` / `--project integration`); Next.js App Router (SSR) + `next-intl`; Playwright e2e. DB work runs ONLY against local Docker `ProjectFlow_Test`.

**Prerequisite:** Phases 6a–6c merged (`AutomationRuns`/`AutomationUsage` exist; the engine fires; the taxonomy rename to `TASK_CREATED`/`STATUS_CHANGED`/`CHANGE_STATUS`/`ASSIGN`/… is in `packages/types/index.ts`, the route Zod schemas, the worker switch, and the frontend `TRIGGER_KEYS`/`ACTION_KEYS`/`CONDITION_KEYS`; the 6b nested-condition `Operator` tokens and the 6c action types `SET_FIELD`/`ADD_TAG`/`CREATE_SUBTASK`/`MOVE_TASK`/`APPLY_TEMPLATE` are in `@projectflow/types`).

---

## File Structure

**API — template catalog** (`apps/api/src/modules/automation/`)
- `automation.templates.ts` — **Create.** The versioned in-code catalog: `AutomationTemplate` interface + `AUTOMATION_TEMPLATES` array of **18** definitions + `getTemplateCatalog(locale)` localizer + `TEMPLATE_STRINGS` en/id map.
- `automation.templates.schema.ts` — **Create.** The shared Zod `ruleShapeSchema` (trigger/conditions/actions) lifted from the route, reused by both the create route and the catalog-integrity test so "validates against the rule schema" is literal.

**API — routes** (`apps/api/src/modules/automation/`)
- `automation.routes.ts` — **Modify.** Add `GET /templates` (localized catalog) and `GET /:id/runs` (paginated run history); import + reuse `ruleShapeSchema` for the existing create/update schemas.
- `automation.service.ts` — **Modify.** Add `listTemplates(locale)`, `listRuns(ruleId, { limit, cursor })`, `getUsage(workspaceId)`.
- `automation.repository.ts` — **Modify.** Add `listRuns(ruleId, limit, cursor)` and `getUsage(workspaceId, period)` reading the 6a tables.

**Stored procedures** (`infra/sql/procedures/`) — **read-only over 6a tables; NO migration**
- `usp_AutomationRule_ListRuns.sql` — **Create.** Paginated `AutomationRuns` for a rule, `StartedAt DESC`, keyset cursor `(StartedAt, Id)`.
- `usp_AutomationUsage_GetCurrent.sql` — **Create.** `AutomationUsage` row for `(WorkspaceId, @Period)`; returns `RunCount` (0 when absent).

**GraphQL** (`apps/api/src/graphql/`)
- `automation.schema.ts` — **Modify** (added in 6a) **or Create** if 6a put the mirror inline. Add `AutomationTemplateType` + `automationTemplates(locale)` query, `AutomationRunType` + `automationRuns(ruleId, limit, cursor)` query, and `AutomationUsageType` + `automationUsage(workspaceId)` query. (If 6a registered the automation GraphQL inline in `schema.ts`, add a `registerAutomationGraphql()` extension here and wire it.)
- `schema.ts` — **Modify** only if a new `registerAutomationGraphql()` is introduced (import + call near the other `register*Graphql()` block ~line 768).

**Types** (`packages/types/`)
- `index.ts` — **Modify.** Add `AutomationTemplate`, `AutomationRun`, `AutomationRunStatus`, `AutomationRunPage`, `AutomationUsage` interfaces (the `AutomationTriggerType`/`AutomationConditionType`/`AutomationActionType` unions already carry the 6a–6c tokens).

**Frontend — gallery + drawer + stat** (`apps/next-web/src/`)
- `server/queries/automations.ts` — **Modify.** Add `getAutomationTemplates()`, `getAutomationRuns(ruleId, cursor?)`, `getAutomationUsage()` server queries.
- `server/actions/automations.ts` — **Modify.** Add `loadAutomationRuns(ruleId, cursor?)` action (drawer pagination from the client).
- `app/(app)/automations/automations-view.tsx` — **Modify.** Mount the gallery entry point ("Browse templates"), wire "Use template" → pre-filled `RuleDialog`, add a per-rule "History" button → run-history drawer, and a "runs this month" KPI tile.
- `app/(app)/automations/TemplateGallery.tsx` — **Create.** The gallery dialog: template cards (title/desc/trigger/action chips) + "Use template".
- `app/(app)/automations/RunHistoryDrawer.tsx` — **Create.** The per-rule run-history drawer: status/trigger/duration/error rows + "Load more".
- `app/(app)/automations/automations.module.css` — **Create.** Minimal styles for gallery cards + drawer rows (or extend if a module already exists).

**i18n** (`apps/next-web/messages/`)
- `en.json` — **Modify.** Extend the `Automations` namespace with template title/desc keys (18 × 2), gallery/drawer/metering UI keys, and run-status labels.
- `id.json` — **Modify.** Same keys, real Indonesian.

**Tests**
- `apps/api/src/modules/automation/__tests__/templates.unit.test.ts` — **Create.** Catalog integrity: **every** template validates against `ruleShapeSchema`; key uniqueness; count is 15–20; **each `i18nTitleKey`/`i18nDescKey` exists in BOTH `en.json` and `id.json`** (catalog-integrity + localization test).
- `apps/api/src/modules/automation/__tests__/runs.integration.test.ts` — **Create.** Instantiate a template → saved rule matches the catalog config; trigger the rule; `GET /:id/runs` returns the audited run(s) newest-first; `GET /templates` returns localized titles; usage stat counts the run.
- `apps/next-web/src/app/(app)/automations/__tests__/RunHistoryDrawer.unit.test.tsx` — **Create.** Pure run-row formatting (duration + status badge).
- `apps/next-web/e2e/automation-templates.spec.ts` — **Create.** Pick a template from the gallery, save it, trigger it, see it in run history.

---

## Tasks

### Task 1: Types — `AutomationTemplate`, `AutomationRun`, `AutomationUsage`

**Files:**
- Modify: `packages/types/index.ts` (the `// ── Automation Engine ──` block, after `AutomationRule`)

Steps:

- [ ] Append the 6d read/catalog types to the Automation Engine block in `packages/types/index.ts` (the unions/`AutomationRule` already exist from 6a):

```ts
// ── Automation Templates / Run History / Metering (Phase 6d) ──────────────────

/**
 * An in-code template definition. The gallery pre-fills the rule builder from
 * `trigger`/`conditions`/`actions`; `i18nTitleKey`/`i18nDescKey` resolve to the
 * localized card title/description. No tenant rows are seeded.
 */
export interface AutomationTemplate {
  key:          string;                  // stable catalog id, e.g. 'auto-assign-on-create'
  i18nTitleKey: string;                  // dotted key under the Automations namespace
  i18nDescKey:  string;
  /** Server-localized strings (filled by GET /templates for the request locale). */
  title?:       string;
  description?: string;
  trigger:      AutomationTriggerConfig;
  conditions:   AutomationCondition[];
  actions:      AutomationAction[];
}

export type AutomationRunStatus =
  | 'success'
  | 'partial'
  | 'failed'
  | 'skipped'
  | 'loop_blocked';

/** One audited execution row from the AutomationRuns table (6a). */
export interface AutomationRun {
  id:            string;
  ruleId:        string;
  workspaceId:   string;
  projectId:     string | null;
  triggerType:   string;
  status:        AutomationRunStatus;
  payload:       unknown | null;
  actionResults: unknown | null;
  error:         string | null;
  depth:         number;
  startedAt:     string;
  finishedAt:    string | null;
  durationMs:    number | null;
}

/** A keyset page of run-history rows (newest first). */
export interface AutomationRunPage {
  runs:       AutomationRun[];
  nextCursor: string | null;            // opaque "<startedAtIso>|<id>" or null at end
}

/** Read-only per-workspace metering for the current period (no enforcement). */
export interface AutomationUsage {
  workspaceId: string;
  period:      string;                  // 'YYYYMM'
  runCount:    number;
}
```

- [ ] Run: `npm run build --workspace packages/types` (or the repo's `tsc` for types). Expected: PASS — no type errors.

- [ ] Commit:
```
git add packages/types/index.ts
git commit -m "feat(6d): types — AutomationTemplate/AutomationRun/AutomationRunPage/AutomationUsage"
```

---

### Task 2: Read-only SPs over the 6a tables (`ListRuns`, `Usage_GetCurrent`)

**Files:**
- Create: `infra/sql/procedures/usp_AutomationRule_ListRuns.sql`
- Create: `infra/sql/procedures/usp_AutomationUsage_GetCurrent.sql`
- Test: covered by `runs.integration.test.ts` (Task 6); deploy via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`. **No migration — these only read tables created by `0039_automation_runs.sql` in 6a.**

Steps:

- [ ] Write `usp_AutomationRule_ListRuns.sql` — newest-first keyset page over `AutomationRuns` for one rule. The cursor is the boundary `(StartedAt, Id)` of the last row of the previous page (NULL on the first page). `@Limit` rows are returned; the caller asks for `limit+1` to detect "has more":

```sql
-- usp_AutomationRule_ListRuns
-- Phase 6d: read-only paginated run history for a single rule, newest first.
-- Reads AutomationRuns (created by migration 0039 in slice 6a). Keyset pagination
-- on (StartedAt DESC, Id DESC) so concurrent inserts never skip/duplicate rows.
CREATE OR ALTER PROCEDURE dbo.usp_AutomationRule_ListRuns
  @RuleId       UNIQUEIDENTIFIER,
  @Limit        INT              = 20,
  @CursorStartedAt DATETIME2     = NULL,   -- boundary from the previous page
  @CursorId        UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;
  IF @Limit IS NULL OR @Limit < 1  SET @Limit = 20;
  IF @Limit > 100                  SET @Limit = 100;

  SELECT TOP (@Limit)
    r.Id, r.RuleId, r.WorkspaceId, r.ProjectId, r.TriggerType, r.Status,
    r.Payload, r.ActionResults, r.Error, r.Depth,
    r.StartedAt, r.FinishedAt, r.DurationMs
  FROM dbo.AutomationRuns r
  WHERE r.RuleId = @RuleId
    AND (
      @CursorStartedAt IS NULL
      OR r.StartedAt < @CursorStartedAt
      OR (r.StartedAt = @CursorStartedAt AND r.Id < @CursorId)
    )
  ORDER BY r.StartedAt DESC, r.Id DESC;
END;
GO
```

- [ ] Write `usp_AutomationUsage_GetCurrent.sql` — the `RunCount` for a workspace + period; returns a single row defaulting to 0 when no `AutomationUsage` row exists yet:

```sql
-- usp_AutomationUsage_GetCurrent
-- Phase 6d: read-only metering — RunCount for (WorkspaceId, Period 'YYYYMM').
-- Returns 0 when no AutomationUsage row exists (read-only; NO enforcement).
CREATE OR ALTER PROCEDURE dbo.usp_AutomationUsage_GetCurrent
  @WorkspaceId UNIQUEIDENTIFIER,
  @Period      CHAR(6)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT
    @WorkspaceId AS WorkspaceId,
    @Period      AS Period,
    ISNULL((SELECT u.RunCount
              FROM dbo.AutomationUsage u
              WHERE u.WorkspaceId = @WorkspaceId AND u.Period = @Period), 0) AS RunCount;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test` (local DB env only, never `apps/api/.env`). Expected: both procedures created with no errors. (If `AutomationRuns`/`AutomationUsage` are absent, 6a is not merged — STOP; the prerequisite is unmet.)

- [ ] Commit:
```
git add infra/sql/procedures/usp_AutomationRule_ListRuns.sql infra/sql/procedures/usp_AutomationUsage_GetCurrent.sql
git commit -m "feat(6d): read-only SPs — AutomationRule_ListRuns (keyset) + AutomationUsage_GetCurrent"
```

---

### Task 3: The in-code template catalog (`automation.templates.ts`) + shared rule schema

**Files:**
- Create: `apps/api/src/modules/automation/automation.templates.schema.ts`
- Create: `apps/api/src/modules/automation/automation.templates.ts`

Steps:

- [ ] Write `automation.templates.schema.ts` — the **shared** Zod rule shape (trigger/conditions/actions) that the create route reuses AND the catalog-integrity test validates each template against. Mirror the existing `automation.routes.ts` schemas but widen the enum lists to the 6a–6c tokens. Keep `.passthrough()` off — extra keys must fail so a malformed template is caught:

```ts
import { z } from 'zod';

/** Trigger/condition/action tokens after the 6a taxonomy rename + 6b/6c additions. */
export const TRIGGER_TYPES = [
  'TASK_CREATED', 'TASK_UPDATED', 'STATUS_CHANGED', 'FIELD_CHANGED',
  'ASSIGNEE_CHANGED', 'COMMENT_POSTED', 'DUE_DATE_PASSED', 'DATE_ARRIVED',
  'SPRINT_STARTED', 'SPRINT_COMPLETED', 'SCHEDULED', 'MANUAL', 'WEBHOOK',
] as const;

export const CONDITION_TYPES = [
  'ISSUE_MATCHES_FILTER', 'FIELD_EQUALS', 'FIELD_NOT_EQUALS',
  'USER_HAS_ROLE', 'IN_SPRINT', 'NOT_IN_SPRINT',
] as const;

export const OPERATORS = [
  'is', 'is_not', 'contains', 'gt', 'lt', 'before', 'after', 'is_set',
] as const;

export const ACTION_TYPES = [
  'CHANGE_STATUS', 'ASSIGN', 'UNASSIGN', 'SET_PRIORITY', 'POST_COMMENT',
  'SEND_NOTIFICATION', 'CALL_WEBHOOK', 'SET_FIELD', 'ADD_TAG',
  'CREATE_TASK', 'CREATE_SUBTASK', 'MOVE_TASK', 'APPLY_TEMPLATE',
] as const;

export const triggerSchema = z.object({
  type:           z.enum(TRIGGER_TYPES),
  cron:           z.string().optional(),
  toStatus:       z.string().optional(),
  fromStatus:     z.string().optional(),
  field:          z.string().optional(),
  hoursBeforeDue: z.number().optional(),
  daysAfterDue:   z.number().optional(),
}).strict();

// A leaf or a recursive AND/OR group (6b). z.lazy keeps the recursion typeable.
export const conditionNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({
      op:       z.enum(['AND', 'OR']),
      children: z.array(conditionNodeSchema),
    }).strict(),
    z.object({
      type:     z.enum(CONDITION_TYPES),
      field:    z.string().optional(),
      operator: z.enum(OPERATORS).optional(),
      value:    z.string().optional(),
      pql:      z.string().optional(),
    }).strict(),
  ]),
);

export const actionSchema = z.object({
  type:           z.enum(ACTION_TYPES),
  toStatus:       z.string().optional(),
  assigneeId:     z.string().optional(),
  priority:       z.string().optional(),
  message:        z.string().optional(),
  webhookUrl:     z.string().url().optional(),
  field:          z.string().optional(),
  value:          z.string().optional(),
  tagId:          z.string().optional(),
  tagName:        z.string().optional(),
  templateId:     z.string().optional(),
  title:          z.string().optional(),
  targetListId:   z.string().optional(),
  daysFromNow:    z.number().optional(),
  delaySeconds:   z.number().optional(),
}).strict();

/** The shape a saved rule's trigger+conditions+actions must satisfy. */
export const ruleShapeSchema = z.object({
  trigger:    triggerSchema,
  conditions: z.array(conditionNodeSchema),
  actions:    z.array(actionSchema).min(1),
});

export type RuleShape = z.infer<typeof ruleShapeSchema>;
```

> **Spec-ambiguity note (record in `DECISIONS.md`):** the spec's template tuple is `{ trigger, conditions, actions }` where each template "has placeholders the user fills in." We model `conditions` as the **6b recursive node** array (so the gallery hydrates the upgraded condition builder), and we keep placeholder strings (e.g. `assigneeId: 'REPORTER'`, `field: 'priority'`) inside the definitions — the user reviews/edits them in the builder before saving. The exact 6c action option keys (`tagName`, `templateId`, `daysFromNow`, …) follow the 6c action executor; if 6c named them differently, the implementer aligns `actionSchema` to the real 6c `AutomationAction` interface in one place.

- [ ] Write `automation.templates.ts` — the **18-definition** catalog + en/id strings + localizer. Every definition uses only the tokens enumerated above. (18 sits squarely inside the spec's 15–20 band, leaving headroom.)

```ts
import type { AutomationTemplate, AutomationTriggerConfig, AutomationCondition, AutomationAction } from '@projectflow/types';

/** Catalog version — bump when the set changes (telemetry/debug only). */
export const TEMPLATE_CATALOG_VERSION = 1;

type Def = {
  key: string;
  trigger: AutomationTriggerConfig;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
};

// ── The 18 prebuilt definitions (BUILD_PLAN §7.6: 15–20) ──────────────────────
const DEFS: Def[] = [
  {
    key: 'auto-assign-on-create',
    trigger: { type: 'TASK_CREATED' } as any,
    conditions: [],
    actions: [{ type: 'ASSIGN', assigneeId: 'REPORTER' } as any],
  },
  {
    key: 'move-to-in-progress-on-assign',
    trigger: { type: 'ASSIGNEE_CHANGED' } as any,
    conditions: [{ type: 'FIELD_EQUALS', field: 'assignee', operator: 'is_set' } as any],
    actions: [{ type: 'CHANGE_STATUS', toStatus: 'In Progress' } as any],
  },
  {
    key: 'comment-notify-on-blocker',
    trigger: { type: 'FIELD_CHANGED', field: 'tags' } as any,
    conditions: [{ type: 'FIELD_EQUALS', field: 'tag', operator: 'is', value: 'blocked' } as any],
    actions: [
      { type: 'POST_COMMENT', message: 'This task was marked blocked — please review.' } as any,
      { type: 'SEND_NOTIFICATION', message: 'A task you watch is now blocked.' } as any,
    ],
  },
  {
    key: 'nudge-assignee-on-overdue',
    trigger: { type: 'DUE_DATE_PASSED' } as any,
    conditions: [{ type: 'FIELD_NOT_EQUALS', field: 'status', operator: 'is_not', value: 'Done' } as any],
    actions: [{ type: 'SEND_NOTIFICATION', message: 'A task assigned to you is overdue.' } as any],
  },
  {
    key: 'close-stale-after-days',
    trigger: { type: 'SCHEDULED', cron: '0 2 * * *' } as any,
    conditions: [{ type: 'ISSUE_MATCHES_FILTER', pql: 'updated < -14d AND status != "Done"' } as any],
    actions: [{ type: 'CHANGE_STATUS', toStatus: 'Closed' } as any],
  },
  {
    key: 'set-priority-on-label',
    trigger: { type: 'FIELD_CHANGED', field: 'tags' } as any,
    conditions: [{ type: 'FIELD_EQUALS', field: 'tag', operator: 'is', value: 'urgent' } as any],
    actions: [{ type: 'SET_PRIORITY', priority: 'HIGHEST' } as any],
  },
  {
    key: 'webhook-on-done',
    trigger: { type: 'STATUS_CHANGED', toStatus: 'Done' } as any,
    conditions: [],
    actions: [{ type: 'CALL_WEBHOOK', webhookUrl: 'https://hooks.example.com/done' } as any],
  },
  {
    key: 'follow-up-subtask-on-done',
    trigger: { type: 'STATUS_CHANGED', toStatus: 'Done' } as any,
    conditions: [],
    actions: [{ type: 'CREATE_SUBTASK', title: 'Follow-up review' } as any],
  },
  {
    key: 'apply-checklist-on-create',
    trigger: { type: 'TASK_CREATED' } as any,
    conditions: [{ type: 'FIELD_EQUALS', field: 'type', operator: 'is', value: 'Bug' } as any],
    actions: [{ type: 'APPLY_TEMPLATE', templateId: '' } as any],
  },
  {
    key: 'notify-watchers-on-status',
    trigger: { type: 'STATUS_CHANGED' } as any,
    conditions: [],
    actions: [{ type: 'SEND_NOTIFICATION', message: 'Status changed on a task you watch.' } as any],
  },
  {
    key: 'escalate-priority-on-overdue',
    trigger: { type: 'DUE_DATE_PASSED' } as any,
    conditions: [{ type: 'FIELD_EQUALS', field: 'priority', operator: 'is', value: 'MEDIUM' } as any],
    actions: [{ type: 'SET_PRIORITY', priority: 'HIGH' } as any],
  },
  {
    key: 'archive-on-closed',
    trigger: { type: 'STATUS_CHANGED', toStatus: 'Closed' } as any,
    conditions: [],
    actions: [{ type: 'ADD_TAG', tagName: 'archived' } as any],
  },
  {
    key: 'tag-on-high-priority-create',
    trigger: { type: 'TASK_CREATED' } as any,
    conditions: [{ type: 'FIELD_EQUALS', field: 'priority', operator: 'is', value: 'HIGHEST' } as any],
    actions: [{ type: 'ADD_TAG', tagName: 'critical' } as any],
  },
  {
    key: 'reassign-to-reporter-on-reopen',
    trigger: { type: 'STATUS_CHANGED', toStatus: 'Reopened' } as any,
    conditions: [],
    actions: [{ type: 'ASSIGN', assigneeId: 'REPORTER' } as any],
  },
  {
    key: 'thank-on-comment',
    trigger: { type: 'COMMENT_POSTED' } as any,
    conditions: [{ type: 'FIELD_EQUALS', field: 'status', operator: 'is', value: 'Done' } as any],
    actions: [{ type: 'SEND_NOTIFICATION', message: 'New comment on a completed task.' } as any],
  },
  {
    key: 'unassign-on-backlog',
    trigger: { type: 'STATUS_CHANGED', toStatus: 'Backlog' } as any,
    conditions: [],
    actions: [{ type: 'UNASSIGN' } as any],
  },
  {
    key: 'sprint-rollover-housekeeping',
    trigger: { type: 'SPRINT_COMPLETED' } as any,
    conditions: [{ type: 'NOT_IN_SPRINT' } as any],
    actions: [{ type: 'POST_COMMENT', message: 'Sprint completed — unfinished items moved to backlog.' } as any],
  },
  {
    key: 'remind-on-due-date-arrived',
    trigger: { type: 'DATE_ARRIVED' } as any,
    conditions: [{ type: 'FIELD_NOT_EQUALS', field: 'status', operator: 'is_not', value: 'Done' } as any],
    actions: [{ type: 'SEND_NOTIFICATION', message: 'A task is due today.' } as any],
  },
];

/**
 * en/id strings for each template's title + description. Kept beside the catalog
 * so the API can localize GET /templates without coupling to the web messages
 * bundle. The web side adds matching keys under the Automations namespace
 * (Task 8) so the in-app gallery localizes identically; the unit test asserts
 * parity across BOTH sources.
 */
type Locale = 'en' | 'id';
export const TEMPLATE_STRINGS: Record<Locale, Record<string, { title: string; description: string }>> = {
  en: {
    'auto-assign-on-create':            { title: 'Auto-assign on create',        description: 'Assign every new task to its reporter.' },
    'move-to-in-progress-on-assign':    { title: 'Start work on assign',         description: 'Move a task to In Progress when it gets an assignee.' },
    'comment-notify-on-blocker':        { title: 'Flag blockers',                description: 'Comment and notify when a task is marked blocked.' },
    'nudge-assignee-on-overdue':        { title: 'Nudge on overdue',             description: 'Notify the assignee when a task passes its due date.' },
    'close-stale-after-days':           { title: 'Close stale tasks',            description: 'Close tasks untouched for 14 days (nightly sweep).' },
    'set-priority-on-label':            { title: 'Urgent → highest priority',    description: 'Set priority to Highest when the urgent tag is added.' },
    'webhook-on-done':                  { title: 'Webhook on done',              description: 'POST a signed payload to an external URL when a task is Done.' },
    'follow-up-subtask-on-done':        { title: 'Follow-up subtask on done',    description: 'Create a follow-up review subtask when a task is Done.' },
    'apply-checklist-on-create':        { title: 'Apply checklist to new bugs',  description: 'Apply a saved template to every new Bug.' },
    'notify-watchers-on-status':        { title: 'Notify watchers on status',    description: 'Notify watchers whenever a task changes status.' },
    'escalate-priority-on-overdue':     { title: 'Escalate overdue priority',    description: 'Bump Medium tasks to High when they go overdue.' },
    'archive-on-closed':                { title: 'Archive closed tasks',         description: 'Tag a task archived when it is Closed.' },
    'tag-on-high-priority-create':      { title: 'Tag critical on create',       description: 'Tag new Highest-priority tasks as critical.' },
    'reassign-to-reporter-on-reopen':   { title: 'Reassign on reopen',           description: 'Reassign to the reporter when a task is Reopened.' },
    'thank-on-comment':                 { title: 'Notify on done comments',      description: 'Notify when a comment lands on a completed task.' },
    'unassign-on-backlog':              { title: 'Clear assignee in backlog',    description: 'Unassign a task when it moves to Backlog.' },
    'sprint-rollover-housekeeping':     { title: 'Sprint rollover note',         description: 'Comment housekeeping note when a sprint completes.' },
    'remind-on-due-date-arrived':       { title: 'Remind on due date',           description: 'Notify when a task reaches its due date.' },
  },
  id: {
    'auto-assign-on-create':            { title: 'Tetapkan otomatis saat dibuat', description: 'Tetapkan setiap tugas baru ke pelapornya.' },
    'move-to-in-progress-on-assign':    { title: 'Mulai kerja saat ditugaskan',   description: 'Pindahkan tugas ke Sedang Dikerjakan saat mendapat penerima tugas.' },
    'comment-notify-on-blocker':        { title: 'Tandai penghambat',             description: 'Beri komentar dan beri tahu saat tugas ditandai terhambat.' },
    'nudge-assignee-on-overdue':        { title: 'Ingatkan saat terlambat',       description: 'Beri tahu penerima tugas saat tugas melewati tenggat.' },
    'close-stale-after-days':           { title: 'Tutup tugas mangkrak',          description: 'Tutup tugas yang tidak tersentuh selama 14 hari (sapuan malam).' },
    'set-priority-on-label':            { title: 'Mendesak → prioritas tertinggi', description: 'Atur prioritas ke Tertinggi saat label mendesak ditambahkan.' },
    'webhook-on-done':                  { title: 'Webhook saat selesai',          description: 'Kirim payload bertanda tangan ke URL eksternal saat tugas Selesai.' },
    'follow-up-subtask-on-done':        { title: 'Subtugas tindak lanjut saat selesai', description: 'Buat subtugas tinjauan tindak lanjut saat tugas Selesai.' },
    'apply-checklist-on-create':        { title: 'Terapkan checklist ke bug baru', description: 'Terapkan templat tersimpan ke setiap Bug baru.' },
    'notify-watchers-on-status':        { title: 'Beri tahu pengamat saat status berubah', description: 'Beri tahu pengamat setiap kali tugas berganti status.' },
    'escalate-priority-on-overdue':     { title: 'Eskalasi prioritas terlambat',  description: 'Naikkan tugas Sedang ke Tinggi saat terlambat.' },
    'archive-on-closed':                { title: 'Arsipkan tugas tertutup',       description: 'Tandai tugas diarsipkan saat Ditutup.' },
    'tag-on-high-priority-create':      { title: 'Tandai kritis saat dibuat',     description: 'Tandai tugas prioritas Tertinggi baru sebagai kritis.' },
    'reassign-to-reporter-on-reopen':   { title: 'Tetapkan ulang saat dibuka kembali', description: 'Tetapkan ke pelapor saat tugas Dibuka Kembali.' },
    'thank-on-comment':                 { title: 'Beri tahu komentar pada tugas selesai', description: 'Beri tahu saat komentar masuk pada tugas selesai.' },
    'unassign-on-backlog':              { title: 'Kosongkan penerima di backlog',  description: 'Lepas penerima tugas saat pindah ke Backlog.' },
    'sprint-rollover-housekeeping':     { title: 'Catatan rollover sprint',       description: 'Beri komentar catatan rapi saat sprint selesai.' },
    'remind-on-due-date-arrived':       { title: 'Ingatkan saat tenggat tiba',    description: 'Beri tahu saat tugas mencapai tenggatnya.' },
  },
};

/** Dotted i18n keys under the web Automations namespace (Task 8 mirrors these). */
function titleKey(key: string): string { return `tpl_${camel(key)}_title`; }
function descKey(key: string):  string { return `tpl_${camel(key)}_desc`; }
function camel(k: string): string { return k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

/** The raw catalog (i18n keys attached; strings filled by getTemplateCatalog). */
export const AUTOMATION_TEMPLATES: AutomationTemplate[] = DEFS.map((d) => ({
  key:          d.key,
  i18nTitleKey: titleKey(d.key),
  i18nDescKey:  descKey(d.key),
  trigger:      d.trigger,
  conditions:   d.conditions,
  actions:      d.actions,
}));

/** Localize the catalog for a request locale (defaults to en). */
export function getTemplateCatalog(locale: string): AutomationTemplate[] {
  const loc: Locale = locale === 'id' ? 'id' : 'en';
  return AUTOMATION_TEMPLATES.map((t) => {
    const s = TEMPLATE_STRINGS[loc][t.key] ?? TEMPLATE_STRINGS.en[t.key];
    return { ...t, title: s?.title ?? t.key, description: s?.description ?? '' };
  });
}
```

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS — catalog compiles against `@projectflow/types`.

- [ ] Commit:
```
git add apps/api/src/modules/automation/automation.templates.schema.ts apps/api/src/modules/automation/automation.templates.ts
git commit -m "feat(6d): in-code template catalog (18 defs) + shared rule Zod schema + en/id strings"
```

---

### Task 4: Catalog-integrity + localization unit test

**Files:**
- Create: `apps/api/src/modules/automation/__tests__/templates.unit.test.ts`

Steps:

- [ ] Write the unit test FIRST asserting the spec §7.5 acceptance: every template validates against `ruleShapeSchema`; keys are unique; the count is in the 15–20 band; and **each `i18nTitleKey`/`i18nDescKey` resolves in BOTH `en.json` and `id.json`** (the web message bundle Task 8 adds). Import the web message JSONs directly (vitest resolves JSON):

```ts
import { describe, it, expect } from 'vitest';
import { AUTOMATION_TEMPLATES, TEMPLATE_STRINGS, getTemplateCatalog } from '../automation.templates.js';
import { ruleShapeSchema } from '../automation.templates.schema.js';
// The web Automations namespace is the source of truth for the in-app gallery
// labels; the catalog-localization invariant asserts every key exists in both.
import enMessages from '../../../../../../next-web/messages/en.json' assert { type: 'json' };
import idMessages from '../../../../../../next-web/messages/id.json' assert { type: 'json' };

const enAuto = (enMessages as any).Automations as Record<string, string>;
const idAuto = (idMessages as any).Automations as Record<string, string>;

describe('automation template catalog', () => {
  it('ships 15–20 templates with unique keys (BUILD_PLAN §7.6)', () => {
    expect(AUTOMATION_TEMPLATES.length).toBeGreaterThanOrEqual(15);
    expect(AUTOMATION_TEMPLATES.length).toBeLessThanOrEqual(20);
    const keys = AUTOMATION_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every template validates against the rule schema (savable as a real rule)', () => {
    for (const tpl of AUTOMATION_TEMPLATES) {
      const parsed = ruleShapeSchema.safeParse({
        trigger: tpl.trigger, conditions: tpl.conditions, actions: tpl.actions,
      });
      expect(parsed.success, `template '${tpl.key}': ${JSON.stringify(parsed.success ? '' : parsed.error.issues)}`).toBe(true);
    }
  });

  it('every template has at least one action', () => {
    for (const tpl of AUTOMATION_TEMPLATES) expect(tpl.actions.length).toBeGreaterThan(0);
  });

  it('each i18nTitleKey/i18nDescKey exists in BOTH en.json and id.json (Automations namespace)', () => {
    for (const tpl of AUTOMATION_TEMPLATES) {
      expect(enAuto[tpl.i18nTitleKey], `en missing ${tpl.i18nTitleKey}`).toBeTruthy();
      expect(enAuto[tpl.i18nDescKey],  `en missing ${tpl.i18nDescKey}`).toBeTruthy();
      expect(idAuto[tpl.i18nTitleKey], `id missing ${tpl.i18nTitleKey}`).toBeTruthy();
      expect(idAuto[tpl.i18nDescKey],  `id missing ${tpl.i18nDescKey}`).toBeTruthy();
    }
  });

  it('the API-side TEMPLATE_STRINGS covers every template in en + id', () => {
    for (const tpl of AUTOMATION_TEMPLATES) {
      expect(TEMPLATE_STRINGS.en[tpl.key]?.title, `en str ${tpl.key}`).toBeTruthy();
      expect(TEMPLATE_STRINGS.id[tpl.key]?.title, `id str ${tpl.key}`).toBeTruthy();
    }
  });

  it('getTemplateCatalog localizes titles for id', () => {
    const en = getTemplateCatalog('en');
    const id = getTemplateCatalog('id');
    expect(en[0].title).toBe(TEMPLATE_STRINGS.en[en[0].key].title);
    expect(id[0].title).toBe(TEMPLATE_STRINGS.id[id[0].key].title);
    expect(id[0].title).not.toBe(en[0].title); // genuinely translated
  });
});
```

> **Implementer note:** confirm the relative import depth to `apps/next-web/messages/*.json` from `apps/api/src/modules/automation/__tests__/` resolves (count the `../`); if the vitest config restricts cross-package JSON imports, instead read the files via `node:fs`/`path.resolve(process.cwd(), '../next-web/messages/en.json')` at test time — the assertion logic is unchanged. The keys asserted here are exactly those Task 8 writes, so this test FAILS until Task 8 lands (run it green at the end of Task 8).

- [ ] Run: `npm test --workspace apps/api -- templates`. Expected: catalog-validation + count + uniqueness PASS now; the en/id-key assertions FAIL until Task 8 adds the keys (expected; re-run green after Task 8). The `TEMPLATE_STRINGS` and `getTemplateCatalog` assertions PASS now.

- [ ] Commit:
```
git add apps/api/src/modules/automation/__tests__/templates.unit.test.ts
git commit -m "test(6d): catalog-integrity + localization unit test (schema + en/id keys)"
```

---

### Task 5: Service + repository — `listTemplates`, `listRuns`, `getUsage`

**Files:**
- Modify: `apps/api/src/modules/automation/automation.repository.ts`
- Modify: `apps/api/src/modules/automation/automation.service.ts`

Steps:

- [ ] Extend `automation.repository.ts` — add `listRuns` (keyset) and `getUsage`, mapping the 6a `AutomationRuns`/`AutomationUsage` rows. Add the imports `AutomationRun`, `AutomationRunPage`, `AutomationUsage` from `@projectflow/types`:

```ts
  async listRuns(ruleId: string, limit: number, cursor: string | null): Promise<AutomationRunPage> {
    // Cursor is "<startedAtIso>|<id>"; ask for limit+1 to detect "has more".
    let cursorStartedAt: Date | null = null;
    let cursorId: string | null = null;
    if (cursor) {
      const [iso, id] = cursor.split('|');
      cursorStartedAt = new Date(iso);
      cursorId = id ?? null;
    }
    const rows = await execSpOne<AutomationRunRow>('usp_AutomationRule_ListRuns', [
      { name: 'RuleId',          type: sql.UniqueIdentifier, value: ruleId },
      { name: 'Limit',           type: sql.Int,              value: limit + 1 },
      { name: 'CursorStartedAt', type: sql.DateTime2,        value: cursorStartedAt },
      { name: 'CursorId',        type: sql.UniqueIdentifier, value: cursorId },
    ]);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const runs = page.map(parseRunRow);
    const last = runs[runs.length - 1];
    return {
      runs,
      nextCursor: hasMore && last ? `${last.startedAt}|${last.id}` : null,
    };
  }

  async getUsage(workspaceId: string, period: string): Promise<AutomationUsage> {
    const rows = await execSpOne<{ WorkspaceId: string; Period: string; RunCount: number }>(
      'usp_AutomationUsage_GetCurrent', [
        { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
        { name: 'Period',      type: sql.Char(6),          value: period },
      ],
    );
    const r = rows[0];
    return { workspaceId: r.WorkspaceId, period: r.Period, runCount: r.RunCount };
  }
```

Add the row type + parser near the top of the file (beside `AutomationRuleRow`/`parseRow`):

```ts
export interface AutomationRunRow {
  Id:            string;
  RuleId:        string;
  WorkspaceId:   string;
  ProjectId:     string | null;
  TriggerType:   string;
  Status:        string;
  Payload:       string | null;
  ActionResults: string | null;
  Error:         string | null;
  Depth:         number;
  StartedAt:     Date;
  FinishedAt:    Date | null;
  DurationMs:    number | null;
}

function parseRunRow(row: AutomationRunRow): AutomationRun {
  const safeJson = (s: string | null): unknown => {
    if (!s) return null;
    try { return JSON.parse(s); } catch { return s; }
  };
  return {
    id:            row.Id,
    ruleId:        row.RuleId,
    workspaceId:   row.WorkspaceId,
    projectId:     row.ProjectId,
    triggerType:   row.TriggerType,
    status:        row.Status as AutomationRun['status'],
    payload:       safeJson(row.Payload),
    actionResults: safeJson(row.ActionResults),
    error:         row.Error,
    depth:         row.Depth,
    startedAt:     row.StartedAt.toISOString(),
    finishedAt:    row.FinishedAt?.toISOString() ?? null,
    durationMs:    row.DurationMs,
  };
}
```

- [ ] Extend `automation.service.ts` — add `listTemplates`, `listRuns`, `getUsage` delegating to the catalog + repo. Add imports `getTemplateCatalog` and the new types:

```ts
import { getTemplateCatalog } from './automation.templates.js';
import type { AutomationTemplate, AutomationRunPage, AutomationUsage } from '@projectflow/types';
```

```ts
  /** Localized in-code template catalog (no DB). */
  listTemplates(locale: string): AutomationTemplate[] {
    return getTemplateCatalog(locale);
  }

  /** Paginated run history (newest first) for one rule. */
  listRuns(ruleId: string, opts: { limit?: number; cursor?: string | null } = {}): Promise<AutomationRunPage> {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    return repo.listRuns(ruleId, limit, opts.cursor ?? null);
  }

  /** Read-only metering for a workspace in the current period (YYYYMM). */
  getUsage(workspaceId: string): Promise<AutomationUsage> {
    const now = new Date();
    const period = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    return repo.getUsage(workspaceId, period);
  }
```

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS — no type errors.

- [ ] Commit:
```
git add apps/api/src/modules/automation/automation.repository.ts apps/api/src/modules/automation/automation.service.ts
git commit -m "feat(6d): service/repo — listTemplates + listRuns (keyset) + getUsage (current period)"
```

---

### Task 6: REST routes (`GET /templates`, `GET /:id/runs`, `GET /usage`) + integration test

**Files:**
- Modify: `apps/api/src/modules/automation/automation.routes.ts`
- Create: `apps/api/src/modules/automation/__tests__/runs.integration.test.ts`

Steps:

- [ ] Write the failing integration test first (harness imports copied from an existing automation/recurrence integration test: `testServer.js`, `truncate.js`, `factories.js`). It instantiates a catalog template into a real rule, fires the trigger, and reads run history + usage:

```ts
/**
 * Phase 6d — Templates / run-history / metering integration coverage.
 * Reads the 6a AutomationRuns/AutomationUsage tables against the REAL SQL stack.
 * DB SAFETY: must target local Docker ProjectFlow_Test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

describe('automation templates + run history', () => {
  it('GET /automations/templates returns the localized catalog (15–20)', async () => {
    const owner = await createTestUser({ email: `auto-${Date.now()}@projectflow.test` });
    const list = (await json<{ templates: any[] }>(await request('/automations/templates', { token: owner.accessToken }))).templates;
    expect(list.length).toBeGreaterThanOrEqual(15);
    expect(list.length).toBeLessThanOrEqual(20);
    expect(list[0]).toHaveProperty('key');
    expect(list[0]).toHaveProperty('title');     // localized
    expect(list[0]).toHaveProperty('trigger');
    expect(list[0]).toHaveProperty('actions');
  });

  it('instantiating a template yields a savable rule whose config matches the catalog', async () => {
    const owner = await createTestUser({ email: `auto2-${Date.now()}@projectflow.test` });
    const token = owner.accessToken;
    const ws = await createTestWorkspace(token);
    const space = await createTestProject(ws.Id, token, { name: 'Auto', key: `AU${Date.now() % 100000}` });

    const tpl = (await json<{ templates: any[] }>(await request('/automations/templates', { token }))).templates
      .find((t: any) => t.key === 'webhook-on-done');
    expect(tpl).toBeTruthy();

    const rule = (await json<{ rule: any }>(await request('/automations', {
      method: 'POST', token,
      json: { projectId: space.Id, name: 'From template', trigger: tpl.trigger, conditions: tpl.conditions, actions: tpl.actions },
    }), 201)).rule;
    expect(rule.trigger.type).toBe('STATUS_CHANGED');
    expect(rule.actions[0].type).toBe('CALL_WEBHOOK');
  });

  it('GET /automations/:id/runs returns audited runs newest-first after the rule fires', async () => {
    const owner = await createTestUser({ email: `auto3-${Date.now()}@projectflow.test` });
    const token = owner.accessToken;
    const ws = await createTestWorkspace(token);
    const space = await createTestProject(ws.Id, token, { name: 'Auto3', key: `AV${Date.now() % 100000}` });

    // A simple TASK_CREATED → SEND_NOTIFICATION rule (fires synchronously via the 6a bus).
    const rule = (await json<{ rule: any }>(await request('/automations', {
      method: 'POST', token,
      json: { projectId: space.Id, name: 'Notify on create', trigger: { type: 'TASK_CREATED' }, conditions: [], actions: [{ type: 'SEND_NOTIFICATION', message: 'hi' }] },
    }), 201)).rule;

    // Trigger: create a task. (Drain the automation queue if the harness exposes a flush helper.)
    await request('/tasks', { method: 'POST', token, json: { projectId: space.Id, workspaceId: ws.Id, title: 'T' } });
    // …allow the worker to process (harness-specific wait/flush — see recurrence.integration.test.ts).

    const page = (await json<{ runs: any[]; nextCursor: string | null }>(
      await request(`/automations/${rule.id}/runs?limit=10`, { token }),
    )).runs;
    expect(page.length).toBeGreaterThanOrEqual(1);
    expect(page[0].ruleId).toBe(rule.id);
    expect(['success', 'partial', 'skipped', 'failed', 'loop_blocked']).toContain(page[0].status);
  });

  it('GET /automations/usage returns the current-period run count', async () => {
    const owner = await createTestUser({ email: `auto4-${Date.now()}@projectflow.test` });
    const token = owner.accessToken;
    const ws = await createTestWorkspace(token);
    const usage = (await json<{ usage: any }>(await request(`/automations/usage?workspaceId=${ws.Id}`, { token }))).usage;
    expect(usage.workspaceId).toBe(ws.Id);
    expect(usage.period).toMatch(/^\d{6}$/);
    expect(typeof usage.runCount).toBe('number');
  });
});
```

> **Note:** the run-history assertion depends on the 6a worker writing an `AutomationRuns` row. If the integration harness runs without a live BullMQ worker, use whatever synchronous-flush/`processJob` helper the 6a integration tests established (or assert run history against a row inserted directly via the worker's run-recording path). Keep the endpoint-shape assertions (templates, instantiation, usage) regardless.

- [ ] Run: `npm run test:integration --workspace apps/api -- runs` against `ProjectFlow_Test`. Expected: FAIL — the new routes 404.

- [ ] Modify `automation.routes.ts` — import the shared schema + add the three read routes. **Order matters:** register `/templates`, `/usage`, and `/:id/runs` correctly relative to the existing `/:id` patch/delete. `/templates` and `/usage` are static and win over `/:id`; `/:id/runs` is more specific than `/:id` so place it before the bare `/:id` handlers. Replace the inline `triggerSchema`/`conditionSchema`/`actionSchema` with imports from the shared module so create/update and the catalog share one source of truth:

```ts
import { z } from 'zod';
import { triggerSchema, conditionNodeSchema, actionSchema } from './automation.templates.schema.js';

// createSchema/updateSchema now reuse the shared shapes:
const createSchema = z.object({
  projectId:  z.string().uuid(),
  name:       z.string().min(1).max(255),
  trigger:    triggerSchema,
  conditions: z.array(conditionNodeSchema).default([]),
  actions:    z.array(actionSchema).min(1),
});
const updateSchema = z.object({
  name:       z.string().min(1).max(255).optional(),
  isEnabled:  z.boolean().optional(),
  trigger:    triggerSchema.optional(),
  conditions: z.array(conditionNodeSchema).optional(),
  actions:    z.array(actionSchema).optional(),
});

const runsQuerySchema = z.object({
  limit:  z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});
```

Add the routes (place `/templates` + `/usage` near the top of the file, and `/:id/runs` immediately before the `/:id` patch/delete handlers):

```ts
// GET /automations/templates — the localized in-code catalog (no DB, auth-only).
automationRoutes.get('/templates', async (c) => {
  // Locale from the Accept-Language header (next-intl sends it) → 'id' | 'en'.
  const accept = c.req.header('accept-language') ?? '';
  const locale = accept.toLowerCase().startsWith('id') ? 'id' : 'en';
  const templates = svc.listTemplates(locale);
  return c.json({ templates });
});

// GET /automations/usage?workspaceId= — read-only current-period run count.
automationRoutes.get('/usage', async (c) => {
  const workspaceId = c.req.query('workspaceId');
  if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
  // Membership gate: any workspace permission slug; reuse the create-permission
  // resolver against the explicit workspaceId.
  // (requirePermission with a constant resolveWorkspace returning the query param.)
  const usage = await svc.getUsage(workspaceId);
  return c.json({ usage });
});

// GET /automations/:id/runs — paginated run history (newest first).
automationRoutes.get(
  '/:id/runs',
  requirePermission('automation.update', { resolveWorkspace: resolveAutomationWorkspace }),
  zValidator('query', runsQuerySchema),
  async (c) => {
    const id = c.req.param('id');
    const { limit, cursor } = c.req.valid('query');
    const page = await svc.listRuns(id, { limit, cursor: cursor ?? null });
    return c.json(page);
  },
);
```

> **Authz note:** `/templates` is static catalog data with no tenant content → auth-only (the global auth middleware already gates it). `/usage` must be workspace-membership-gated — wrap it with `requirePermission('automation.read' | the existing read slug, { resolveWorkspace: (c) => c.req.query('workspaceId') ?? null })`; if no read slug exists, reuse `'automation.update'` (membership-equivalent) and record the choice in `DECISIONS.md`. `/:id/runs` reuses the existing `resolveAutomationWorkspace` + `automation.update` gate (same as PATCH), fail-closed.

- [ ] Run: `npm run test:integration --workspace apps/api -- runs` against `ProjectFlow_Test`. Expected: PASS (template/instantiation/usage; run-history per the worker-flush note). Then full unit `npm test --workspace apps/api -- templates` (the schema/count assertions still PASS; en/id-key assertions remain red until Task 8).

- [ ] Commit:
```
git add apps/api/src/modules/automation/automation.routes.ts apps/api/src/modules/automation/__tests__/runs.integration.test.ts
git commit -m "feat(6d): REST — GET /templates (localized) + /:id/runs (keyset) + /usage + integration test"
```

---

### Task 7: GraphQL mirror — `automationTemplates`, `automationRuns`, `automationUsage`

**Files:**
- Modify: `apps/api/src/graphql/automation.schema.ts` (the 6a mirror) — **or Create** + wire into `schema.ts` if 6a registered inline.

Steps:

- [ ] Add the 6d query fields to the automation GraphQL mirror, following the `templates.schema.ts`/`recurrence.schema.ts` pattern (typed `objectRef`, `requireWorkspacePermission`, delegating to the one shared `AutomationService`). If 6a created `automation.schema.ts` with a `registerAutomationGraphql()`, extend it; otherwise create the file and register it in `schema.ts`:

```ts
import { builder } from './builder.js';
import { AutomationService } from '../modules/automation/automation.service.js';
import { AutomationRepository } from '../modules/automation/automation.repository.js';
import { requireWorkspacePermission, requireAuth } from './authz.js';
import type { AutomationTemplate, AutomationRun, AutomationUsage } from '@projectflow/types';

const svc = new AutomationService();
const repo = new AutomationRepository();

export function registerAutomationReadGraphql(): void {
  // Template config is transported as JSON strings (mirrors SavedView.config /
  // TaskRecurrence.rule) — keeps the schema flat over the trigger/cond/action shapes.
  const TemplateType = builder.objectRef<AutomationTemplate>('AutomationTemplate');
  TemplateType.implement({ fields: (t) => ({
    key:         t.exposeString('key'),
    title:       t.string({ resolve: (r) => r.title ?? r.key }),
    description: t.string({ resolve: (r) => r.description ?? '' }),
    trigger:     t.string({ resolve: (r) => JSON.stringify(r.trigger) }),
    conditions:  t.string({ resolve: (r) => JSON.stringify(r.conditions) }),
    actions:     t.string({ resolve: (r) => JSON.stringify(r.actions) }),
  }) });

  const RunType = builder.objectRef<AutomationRun>('AutomationRun');
  RunType.implement({ fields: (t) => ({
    id:            t.exposeString('id'),
    ruleId:        t.exposeString('ruleId'),
    workspaceId:   t.exposeString('workspaceId'),
    projectId:     t.string({ nullable: true, resolve: (r) => r.projectId ?? null }),
    triggerType:   t.exposeString('triggerType'),
    status:        t.exposeString('status'),
    error:         t.string({ nullable: true, resolve: (r) => r.error ?? null }),
    depth:         t.exposeInt('depth'),
    actionResults: t.string({ nullable: true, resolve: (r) => (r.actionResults ? JSON.stringify(r.actionResults) : null) }),
    startedAt:     t.field({ type: 'Date', resolve: (r) => new Date(r.startedAt) }),
    finishedAt:    t.field({ type: 'Date', nullable: true, resolve: (r) => (r.finishedAt ? new Date(r.finishedAt) : null) }),
    durationMs:    t.int({ nullable: true, resolve: (r) => r.durationMs ?? null }),
  }) });

  const RunPageType = builder.objectRef<{ runs: AutomationRun[]; nextCursor: string | null }>('AutomationRunPage');
  RunPageType.implement({ fields: (t) => ({
    runs:       t.field({ type: [RunType], resolve: (p) => p.runs }),
    nextCursor: t.string({ nullable: true, resolve: (p) => p.nextCursor ?? null }),
  }) });

  const UsageType = builder.objectRef<AutomationUsage>('AutomationUsage');
  UsageType.implement({ fields: (t) => ({
    workspaceId: t.exposeString('workspaceId'),
    period:      t.exposeString('period'),
    runCount:    t.exposeInt('runCount'),
  }) });

  builder.queryFields((t) => ({
    automationTemplates: t.field({
      type: [TemplateType],
      args: { locale: t.arg.string({ required: false }) },
      resolve: (_, a, ctx) => {
        requireAuth(ctx);                       // static catalog → auth-only
        return svc.listTemplates(a.locale ?? 'en');
      },
    }),
    automationRuns: t.field({
      type: RunPageType,
      args: {
        ruleId: t.arg.string({ required: true }),
        limit:  t.arg.int({ required: false }),
        cursor: t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        const workspaceId = await repo.getWorkspaceId(a.ruleId);
        await requireWorkspacePermission(ctx, workspaceId, 'automation.update');
        return svc.listRuns(a.ruleId, { limit: a.limit ?? 20, cursor: a.cursor ?? null });
      },
    }),
    automationUsage: t.field({
      type: UsageType,
      args: { workspaceId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'automation.update');
        return svc.getUsage(a.workspaceId);
      },
    }),
  }));
}
```

- [ ] Wire it into `schema.ts` (only if a new function was introduced) near the other `register*Graphql()` calls (~line 768):

```ts
import { registerAutomationReadGraphql } from './automation.schema.js';
```
```ts
// ─────────────────────────────────────────
// Automation read surface (Phase 6d) — AutomationTemplate/AutomationRun/
// AutomationUsage types + automationTemplates/automationRuns/automationUsage queries.
// ─────────────────────────────────────────
registerAutomationReadGraphql();
```

- [ ] Run: `npm run build --workspace apps/api` (tsc — compiles the Pothos schema). Expected: PASS. Then `npm test --workspace apps/api` (existing GraphQL authz tests still green).

- [ ] Commit:
```
git add apps/api/src/graphql/automation.schema.ts apps/api/src/graphql/schema.ts
git commit -m "feat(6d): GraphQL mirror — automationTemplates/automationRuns/automationUsage queries"
```

---

### Task 8: i18n — template title/desc keys + gallery/drawer/metering UI keys (en + id)

**Files:**
- Modify: `apps/next-web/messages/en.json` (the `Automations` namespace)
- Modify: `apps/next-web/messages/id.json` (the `Automations` namespace)

Steps:

- [ ] Add to the `Automations` namespace in `en.json` — the 18 × 2 template strings (keys `tpl_<camelKey>_title` / `tpl_<camelKey>_desc`, matching `automation.templates.ts`) plus the gallery/drawer/metering UI keys. Merge into the existing namespace (do NOT drop existing keys):

```json
"galleryButton": "Browse templates",
"galleryTitle": "Automation templates",
"gallerySubtitle": "Pick a starting point — you can edit it before saving.",
"useTemplate": "Use template",
"kpiRunsThisMonth": "Runs this month",
"historyButton": "History",
"historyTitle": "Run history — {name}",
"historyEmpty": "No runs recorded yet.",
"historyLoadMore": "Load more",
"runStatusSuccess": "Success",
"runStatusPartial": "Partial",
"runStatusFailed": "Failed",
"runStatusSkipped": "Skipped",
"runStatusLoopBlocked": "Loop blocked",
"runTrigger": "Trigger",
"runDuration": "{ms} ms",
"runError": "Error",
"runStartedAt": "Ran {date}",
"tpl_autoAssignOnCreate_title": "Auto-assign on create",
"tpl_autoAssignOnCreate_desc": "Assign every new task to its reporter.",
"tpl_moveToInProgressOnAssign_title": "Start work on assign",
"tpl_moveToInProgressOnAssign_desc": "Move a task to In Progress when it gets an assignee.",
"tpl_commentNotifyOnBlocker_title": "Flag blockers",
"tpl_commentNotifyOnBlocker_desc": "Comment and notify when a task is marked blocked.",
"tpl_nudgeAssigneeOnOverdue_title": "Nudge on overdue",
"tpl_nudgeAssigneeOnOverdue_desc": "Notify the assignee when a task passes its due date.",
"tpl_closeStaleAfterDays_title": "Close stale tasks",
"tpl_closeStaleAfterDays_desc": "Close tasks untouched for 14 days (nightly sweep).",
"tpl_setPriorityOnLabel_title": "Urgent → highest priority",
"tpl_setPriorityOnLabel_desc": "Set priority to Highest when the urgent tag is added.",
"tpl_webhookOnDone_title": "Webhook on done",
"tpl_webhookOnDone_desc": "POST a signed payload to an external URL when a task is Done.",
"tpl_followUpSubtaskOnDone_title": "Follow-up subtask on done",
"tpl_followUpSubtaskOnDone_desc": "Create a follow-up review subtask when a task is Done.",
"tpl_applyChecklistOnCreate_title": "Apply checklist to new bugs",
"tpl_applyChecklistOnCreate_desc": "Apply a saved template to every new Bug.",
"tpl_notifyWatchersOnStatus_title": "Notify watchers on status",
"tpl_notifyWatchersOnStatus_desc": "Notify watchers whenever a task changes status.",
"tpl_escalatePriorityOnOverdue_title": "Escalate overdue priority",
"tpl_escalatePriorityOnOverdue_desc": "Bump Medium tasks to High when they go overdue.",
"tpl_archiveOnClosed_title": "Archive closed tasks",
"tpl_archiveOnClosed_desc": "Tag a task archived when it is Closed.",
"tpl_tagOnHighPriorityCreate_title": "Tag critical on create",
"tpl_tagOnHighPriorityCreate_desc": "Tag new Highest-priority tasks as critical.",
"tpl_reassignToReporterOnReopen_title": "Reassign on reopen",
"tpl_reassignToReporterOnReopen_desc": "Reassign to the reporter when a task is Reopened.",
"tpl_thankOnComment_title": "Notify on done comments",
"tpl_thankOnComment_desc": "Notify when a comment lands on a completed task.",
"tpl_unassignOnBacklog_title": "Clear assignee in backlog",
"tpl_unassignOnBacklog_desc": "Unassign a task when it moves to Backlog.",
"tpl_sprintRolloverHousekeeping_title": "Sprint rollover note",
"tpl_sprintRolloverHousekeeping_desc": "Comment housekeeping note when a sprint completes.",
"tpl_remindOnDueDateArrived_title": "Remind on due date",
"tpl_remindOnDueDateArrived_desc": "Notify when a task reaches its due date."
```

> The `camelKey` derivation must exactly match `camel()` in `automation.templates.ts` (e.g. `auto-assign-on-create` → `autoAssignOnCreate`). The catalog test (Task 4) asserts each `i18nTitleKey`/`i18nDescKey` is present — that test is the guardrail that these keys are correct.

- [ ] Add the identical key set to `id.json` with real Indonesian (mirror `TEMPLATE_STRINGS.id` from the catalog for the `tpl_*` keys, and translate the UI keys):

```json
"galleryButton": "Jelajahi templat",
"galleryTitle": "Templat automasi",
"gallerySubtitle": "Pilih titik awal — Anda bisa menyuntingnya sebelum menyimpan.",
"useTemplate": "Gunakan templat",
"kpiRunsThisMonth": "Jalan bulan ini",
"historyButton": "Riwayat",
"historyTitle": "Riwayat jalan — {name}",
"historyEmpty": "Belum ada jalan yang tercatat.",
"historyLoadMore": "Muat lebih banyak",
"runStatusSuccess": "Berhasil",
"runStatusPartial": "Sebagian",
"runStatusFailed": "Gagal",
"runStatusSkipped": "Dilewati",
"runStatusLoopBlocked": "Loop diblokir",
"runTrigger": "Pemicu",
"runDuration": "{ms} ms",
"runError": "Galat",
"runStartedAt": "Berjalan {date}",
"tpl_autoAssignOnCreate_title": "Tetapkan otomatis saat dibuat",
"tpl_autoAssignOnCreate_desc": "Tetapkan setiap tugas baru ke pelapornya.",
"tpl_moveToInProgressOnAssign_title": "Mulai kerja saat ditugaskan",
"tpl_moveToInProgressOnAssign_desc": "Pindahkan tugas ke Sedang Dikerjakan saat mendapat penerima tugas.",
"tpl_commentNotifyOnBlocker_title": "Tandai penghambat",
"tpl_commentNotifyOnBlocker_desc": "Beri komentar dan beri tahu saat tugas ditandai terhambat.",
"tpl_nudgeAssigneeOnOverdue_title": "Ingatkan saat terlambat",
"tpl_nudgeAssigneeOnOverdue_desc": "Beri tahu penerima tugas saat tugas melewati tenggat.",
"tpl_closeStaleAfterDays_title": "Tutup tugas mangkrak",
"tpl_closeStaleAfterDays_desc": "Tutup tugas yang tidak tersentuh selama 14 hari (sapuan malam).",
"tpl_setPriorityOnLabel_title": "Mendesak → prioritas tertinggi",
"tpl_setPriorityOnLabel_desc": "Atur prioritas ke Tertinggi saat label mendesak ditambahkan.",
"tpl_webhookOnDone_title": "Webhook saat selesai",
"tpl_webhookOnDone_desc": "Kirim payload bertanda tangan ke URL eksternal saat tugas Selesai.",
"tpl_followUpSubtaskOnDone_title": "Subtugas tindak lanjut saat selesai",
"tpl_followUpSubtaskOnDone_desc": "Buat subtugas tinjauan tindak lanjut saat tugas Selesai.",
"tpl_applyChecklistOnCreate_title": "Terapkan checklist ke bug baru",
"tpl_applyChecklistOnCreate_desc": "Terapkan templat tersimpan ke setiap Bug baru.",
"tpl_notifyWatchersOnStatus_title": "Beri tahu pengamat saat status berubah",
"tpl_notifyWatchersOnStatus_desc": "Beri tahu pengamat setiap kali tugas berganti status.",
"tpl_escalatePriorityOnOverdue_title": "Eskalasi prioritas terlambat",
"tpl_escalatePriorityOnOverdue_desc": "Naikkan tugas Sedang ke Tinggi saat terlambat.",
"tpl_archiveOnClosed_title": "Arsipkan tugas tertutup",
"tpl_archiveOnClosed_desc": "Tandai tugas diarsipkan saat Ditutup.",
"tpl_tagOnHighPriorityCreate_title": "Tandai kritis saat dibuat",
"tpl_tagOnHighPriorityCreate_desc": "Tandai tugas prioritas Tertinggi baru sebagai kritis.",
"tpl_reassignToReporterOnReopen_title": "Tetapkan ulang saat dibuka kembali",
"tpl_reassignToReporterOnReopen_desc": "Tetapkan ke pelapor saat tugas Dibuka Kembali.",
"tpl_thankOnComment_title": "Beri tahu komentar pada tugas selesai",
"tpl_thankOnComment_desc": "Beri tahu saat komentar masuk pada tugas selesai.",
"tpl_unassignOnBacklog_title": "Kosongkan penerima di backlog",
"tpl_unassignOnBacklog_desc": "Lepas penerima tugas saat pindah ke Backlog.",
"tpl_sprintRolloverHousekeeping_title": "Catatan rollover sprint",
"tpl_sprintRolloverHousekeeping_desc": "Beri komentar catatan rapi saat sprint selesai.",
"tpl_remindOnDueDateArrived_title": "Ingatkan saat tenggat tiba",
"tpl_remindOnDueDateArrived_desc": "Beri tahu saat tugas mencapai tenggatnya."
```

- [ ] Run: `npm test --workspace apps/next-web -- messages` (the `messages.unit` parity test). Expected: PASS — en/id key sets identical, no empty values. Then re-run the API catalog test `npm test --workspace apps/api -- templates`. Expected: now FULLY PASS (the en/id-key assertions are satisfied).

- [ ] Commit:
```
git add apps/next-web/messages/en.json apps/next-web/messages/id.json
git commit -m "feat(6d): i18n — 18 template title/desc keys + gallery/drawer/metering UI (en + id)"
```

---

### Task 9: Frontend data layer — server queries + drawer action

**Files:**
- Modify: `apps/next-web/src/server/queries/automations.ts`
- Modify: `apps/next-web/src/server/actions/automations.ts`
- Note: read the relevant `node_modules/next/dist/docs/` guide per `apps/next-web/AGENTS.md` before writing web code (this Next.js has breaking changes).

Steps:

- [ ] Add server queries to `queries/automations.ts` — the gallery + usage are fetched SSR on the page; run history is fetched on-demand from the drawer via the action below. Add typed shapes mirroring `@projectflow/types`:

```ts
import type { AutomationTemplate, AutomationRunPage, AutomationUsage } from '@projectflow/types';

export const getAutomationTemplates = cache(async (): Promise<AutomationTemplate[]> => {
  const body = await serverFetchBody<{ templates: AutomationTemplate[] }>('/automations/templates');
  return body?.templates ?? [];
});

export const getAutomationUsage = cache(async (workspaceId: string): Promise<AutomationUsage | null> => {
  if (!workspaceId) return null;
  const body = await serverFetchBody<{ usage: AutomationUsage }>(
    `/automations/usage?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  return body?.usage ?? null;
});

export const getAutomationRuns = cache(async (ruleId: string, cursor?: string): Promise<AutomationRunPage> => {
  const qs = new URLSearchParams({ limit: '20', ...(cursor ? { cursor } : {}) });
  const body = await serverFetchBody<AutomationRunPage>(
    `/automations/${encodeURIComponent(ruleId)}/runs?${qs.toString()}`,
  );
  return body ?? { runs: [], nextCursor: null };
});
```

- [ ] Add a `loadAutomationRuns` server action to `actions/automations.ts` so the drawer can page from the client (the `cache`d query is for SSR; the action is callable from the client component). Mirror the existing action shape:

```ts
import type { AutomationRunPage } from '@projectflow/types';

/** GET /automations/:id/runs — drawer pagination (client-callable). */
export async function loadAutomationRuns(
  ruleId: string,
  cursor?: string,
): Promise<ActionResult & { page?: AutomationRunPage }> {
  await requireSession();
  try {
    const qs = new URLSearchParams({ limit: '20', ...(cursor ? { cursor } : {}) });
    const page = await serverFetch<AutomationRunPage>(
      `/automations/${encodeURIComponent(ruleId)}/runs?${qs.toString()}`,
      { method: 'GET' },
    );
    return { ok: true, page };
  } catch (e) {
    return toActionError(e);
  }
}
```

> Adapt `serverFetch`'s return handling to the file's existing helper (the existing actions call `serverFetch` for its side-effect; here we need the parsed body — use the file's `serverFetchBody` equivalent or read `.json()`). Keep the `{ ok, error }` envelope the view already consumes.

- [ ] Run: `npm run build --workspace apps/next-web` (tsc portion). Expected: PASS — no type errors.

- [ ] Commit:
```
git add apps/next-web/src/server/queries/automations.ts apps/next-web/src/server/actions/automations.ts
git commit -m "feat(6d): web data layer — template/usage SSR queries + loadAutomationRuns action"
```

---

### Task 10: Template gallery + run-history drawer + metering stat (UI) + unit test

**Files:**
- Create: `apps/next-web/src/app/(app)/automations/TemplateGallery.tsx`
- Create: `apps/next-web/src/app/(app)/automations/RunHistoryDrawer.tsx`
- Create: `apps/next-web/src/app/(app)/automations/automations.module.css`
- Create: `apps/next-web/src/app/(app)/automations/__tests__/RunHistoryDrawer.unit.test.tsx`
- Modify: `apps/next-web/src/app/(app)/automations/automations-view.tsx`
- Modify: `apps/next-web/src/app/(app)/automations/page.tsx` (pass templates + usage SSR)

Steps:

- [ ] Write the failing unit test first — extract a pure `formatRunStatusKey` + `formatDurationMs` from the drawer so they are testable without rendering:

```tsx
import { describe, it, expect } from 'vitest';
import { runStatusKey, formatDurationMs } from '../RunHistoryDrawer';

describe('run-history formatting', () => {
  it('maps each run status to its i18n key', () => {
    expect(runStatusKey('success')).toBe('runStatusSuccess');
    expect(runStatusKey('loop_blocked')).toBe('runStatusLoopBlocked');
    expect(runStatusKey('partial')).toBe('runStatusPartial');
  });
  it('formats duration, guarding null', () => {
    expect(formatDurationMs(1234)).toBe('1234');
    expect(formatDurationMs(null)).toBe('—');
  });
});
```

- [ ] Run: `npm test --workspace apps/next-web -- RunHistoryDrawer`. Expected: FAIL — module not found.

- [ ] Write `RunHistoryDrawer.tsx` — a client drawer that takes `ruleId` + `ruleName`, loads the first page via `loadAutomationRuns`, renders status/trigger/duration/error rows, and pages with "Load more":

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { loadAutomationRuns } from '@/server/actions/automations';
import { notifyActionError } from '@/lib/apiErrorToast';
import { formatShortDate } from '@/lib/date';
import type { AutomationRun, AutomationRunStatus } from '@projectflow/types';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import styles from './automations.module.css';

/** Status → i18n key (pure, unit-tested). */
export function runStatusKey(status: AutomationRunStatus): string {
  switch (status) {
    case 'success':      return 'runStatusSuccess';
    case 'partial':      return 'runStatusPartial';
    case 'failed':       return 'runStatusFailed';
    case 'skipped':      return 'runStatusSkipped';
    case 'loop_blocked': return 'runStatusLoopBlocked';
    default:             return 'runStatusSkipped';
  }
}

/** Duration in ms, em-dash when null (pure, unit-tested). */
export function formatDurationMs(ms: number | null): string {
  return ms == null ? '—' : String(ms);
}

export function RunHistoryDrawer({
  ruleId, ruleName, open, onClose,
}: { ruleId: string; ruleName: string; open: boolean; onClose: () => void }) {
  const t = useTranslations('Automations');
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) { setRuns([]); setCursor(null); setLoaded(false); return; }
    start(async () => {
      const r = await loadAutomationRuns(ruleId);
      if (!r.ok) return notifyActionError(r);
      setRuns(r.page?.runs ?? []);
      setCursor(r.page?.nextCursor ?? null);
      setLoaded(true);
    });
  }, [open, ruleId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = () => start(async () => {
    if (!cursor) return;
    const r = await loadAutomationRuns(ruleId, cursor);
    if (!r.ok) return notifyActionError(r);
    setRuns((prev) => [...prev, ...(r.page?.runs ?? [])]);
    setCursor(r.page?.nextCursor ?? null);
  });

  const toneFor: Record<AutomationRunStatus, string> = {
    success: 'bg-emerald-100 text-emerald-700', partial: 'bg-amber-100 text-amber-700',
    failed: 'bg-red-100 text-red-700', skipped: 'bg-slate-100 text-slate-600',
    loop_blocked: 'bg-orange-100 text-orange-700',
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{t('historyTitle', { name: ruleName })}</DialogTitle></DialogHeader>
        <DialogBody className="max-h-[60vh] overflow-y-auto">
          {loaded && runs.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">{t('historyEmpty')}</p>
          ) : (
            <ul className={styles.runList}>
              {runs.map((r) => (
                <li key={r.id} className={styles.runRow} data-run-status={r.status}>
                  <Badge size="xs" variant="outline" appearance="outline" className={toneFor[r.status]}>
                    {t(runStatusKey(r.status) as Parameters<typeof t>[0])}
                  </Badge>
                  <span className={styles.runTrigger}>{r.triggerType}</span>
                  <span className={styles.runMeta}>{t('runStartedAt', { date: formatShortDate(new Date(r.startedAt)) })}</span>
                  <span className={styles.runMeta}>{t('runDuration', { ms: formatDurationMs(r.durationMs) })}</span>
                  {r.error && <span className={styles.runError}>{r.error}</span>}
                </li>
              ))}
            </ul>
          )}
          {cursor && (
            <Button size="sm" variant="ghost" onClick={loadMore} disabled={pending} className="mt-2">
              {t('historyLoadMore')}
            </Button>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] Write `TemplateGallery.tsx` — a dialog of template cards; "Use template" hands the chosen template's `trigger`/`conditions`/`actions` + `title` up so the parent opens the pre-filled `RuleDialog`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import type { AutomationTemplate } from '@projectflow/types';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import styles from './automations.module.css';

export function TemplateGallery({
  open, templates, onClose, onUse,
}: {
  open: boolean;
  templates: AutomationTemplate[];
  onClose: () => void;
  onUse: (tpl: AutomationTemplate) => void;
}) {
  const t = useTranslations('Automations');
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{t('galleryTitle')}</DialogTitle></DialogHeader>
        <DialogBody className="max-h-[65vh] overflow-y-auto">
          <p className="mb-3 text-xs text-muted-foreground">{t('gallerySubtitle')}</p>
          <div className={styles.galleryGrid}>
            {templates.map((tpl) => (
              <Card key={tpl.key} className="p-3 flex flex-col gap-2">
                <div className="text-sm font-semibold text-foreground">{tpl.title}</div>
                <div className="text-xs text-muted-foreground flex-1">{tpl.description}</div>
                <div className="flex flex-wrap gap-1">
                  <Badge size="xs" variant="outline" appearance="outline">{tpl.trigger.type}</Badge>
                  {tpl.actions.map((a, i) => (
                    <Badge key={i} size="xs" variant="outline" appearance="outline" className="font-normal">{a.type}</Badge>
                  ))}
                </div>
                <Button size="sm" variant="primary" onClick={() => onUse(tpl)}>{t('useTemplate')}</Button>
              </Card>
            ))}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] Write `automations.module.css`:

```css
.galleryGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.runList { display: flex; flex-direction: column; gap: 6px; }
.runRow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; background: var(--surface-2, rgba(0,0,0,.03)); }
.runTrigger { font-family: var(--font-mono, monospace); font-size: 12px; }
.runMeta { font-size: 12px; color: var(--text-2, #6b7280); }
.runError { font-size: 12px; color: #ef4444; flex-basis: 100%; }
```

- [ ] Wire into `automations-view.tsx`:
  1. Add props `templates: AutomationTemplate[]` and `usageRunCount: number | null` to `Props`.
  2. Add state `galleryOpen`, `historyRule` (the rule whose drawer is open) and import `TemplateGallery`/`RunHistoryDrawer`.
  3. Add a "Browse templates" button beside "New rule" in the header (`onClick={() => setGalleryOpen(true)}`).
  4. Add a 5th KPI tile "Runs this month" bound to `usageRunCount` (when non-null).
  5. In `RuleRow`, add a "History" ghost button (icon `History`) → `onHistory(rule)`.
  6. Implement `onUse(tpl)`: seed the create dialog from the template by storing `{ name: tpl.title ?? '', trigger: tpl.trigger, conditions: tpl.conditions, actions: tpl.actions }` as the create dialog's `initial`, then open it (reuse the existing `RuleDialog` — pass a `prefill` initial so the create form hydrates from the template instead of `null`). Close the gallery.

```tsx
// new imports
import type { AutomationTemplate } from '@projectflow/types';
import { TemplateGallery } from './TemplateGallery';
import { RunHistoryDrawer } from './RunHistoryDrawer';

// extended Props
interface Props {
  ctx:           WorkspaceProjectContext;
  automations:   Automation[];
  templates:     AutomationTemplate[];
  usageRunCount: number | null;
}

// inside AutomationsView:
const [galleryOpen, setGalleryOpen] = useState(false);
const [prefill, setPrefill] = useState<{
  name: string; trigger: AutomationTriggerConfig; conditions: AutomationCondition[]; actions: AutomationAction[];
} | null>(null);
const [historyRule, setHistoryRule] = useState<Automation | null>(null);

function handleUseTemplate(tpl: AutomationTemplate) {
  setPrefill({
    name: tpl.title ?? '',
    trigger: tpl.trigger,
    conditions: tpl.conditions,
    actions: tpl.actions,
  });
  setGalleryOpen(false);
  setCreateOpen(true);
}
```

> The existing `RuleDialog` derives its initial state from `initial` (an `Automation | null`). Extend `RuleDialog` to also accept an optional `prefill` (the template-shaped object) and seed `name`/`trigger`/`conditions`/`actions` from it when `mode === 'create'` and `prefill` is set. Pass `prefill={createOpen ? prefill : null}` to the create `RuleDialog`. Add the gallery KPI tile via the existing `KpiTile` with `icon={Activity}` `label={t('kpiRunsThisMonth')}` `value={usageRunCount ?? 0}`. Render `<TemplateGallery open={galleryOpen} templates={templates} onClose={() => setGalleryOpen(false)} onUse={handleUseTemplate} />` and `<RunHistoryDrawer open={!!historyRule} ruleId={historyRule?.id ?? ''} ruleName={historyRule?.name ?? ''} onClose={() => setHistoryRule(null)} />` near the existing dialogs.

- [ ] Update `page.tsx` to fetch templates + usage SSR and pass them down:

```tsx
import { getAutomations, getAutomationTemplates, getAutomationUsage } from '@/server/queries/automations';

export default async function AutomationsPage() {
  await requireSession();
  const ctx = await getWorkspaceProjectContext();
  if (ctx.workspaces.length === 0) redirect('/setup');
  const [automations, templates, usage] = await Promise.all([
    ctx.activeProjectId ? getAutomations(ctx.activeProjectId) : Promise.resolve([]),
    getAutomationTemplates(),
    ctx.activeWorkspaceId ? getAutomationUsage(ctx.activeWorkspaceId) : Promise.resolve(null),
  ]);
  return <AutomationsView ctx={ctx} automations={automations} templates={templates} usageRunCount={usage?.runCount ?? null} />;
}
```

- [ ] Run: `npm test --workspace apps/next-web -- RunHistoryDrawer`. Expected: PASS (2 tests). Then `npm test --workspace apps/next-web` (unit + `messages.unit` parity). Expected: PASS. Then `npm run build --workspace apps/next-web`. Expected: PASS.

- [ ] Commit:
```
git add apps/next-web/src/app/(app)/automations/TemplateGallery.tsx apps/next-web/src/app/(app)/automations/RunHistoryDrawer.tsx apps/next-web/src/app/(app)/automations/automations.module.css apps/next-web/src/app/(app)/automations/__tests__/RunHistoryDrawer.unit.test.tsx apps/next-web/src/app/(app)/automations/automations-view.tsx apps/next-web/src/app/(app)/automations/page.tsx
git commit -m "feat(6d): template gallery + run-history drawer + runs-this-month stat + prefilled builder"
```

---

### Task 11: Playwright e2e (headline flow)

**Files:**
- Create: `apps/next-web/e2e/automation-templates.spec.ts`
- Note: e2e runs against local Docker `ProjectFlow_Test` only (use the project's existing e2e env/setup, same as the views/realtime specs).

Steps:

- [ ] Write the e2e spec covering spec §7.6 acceptance — pick a template from the gallery, save it, trigger it, see it in run history. Follow the existing spec harness (login helper, seeded project/task) used by the views/presence specs:

```ts
import { test, expect } from '@playwright/test';
import { loginAndSeedProject } from './helpers'; // existing helper used by other specs

test.describe('Phase 6d — automation templates + run history', () => {
  test('use a gallery template, save the rule, trigger it, see it in run history', async ({ page }) => {
    const { projectUrl } = await loginAndSeedProject(page);
    await page.goto('/automations');

    // Open the gallery and use a TASK_CREATED template.
    await page.getByRole('button', { name: /browse templates/i }).click();
    const gallery = page.getByRole('dialog', { name: /automation templates/i });
    await expect(gallery).toBeVisible();
    // 18 cards present (15–20 acceptance).
    await expect(gallery.getByRole('button', { name: /use template/i })).toHaveCount(18);
    await gallery.getByRole('button', { name: /use template/i }).first().click();

    // The create dialog opens pre-filled — save it.
    const create = page.getByRole('dialog', { name: /new automation rule/i });
    await expect(create).toBeVisible();
    await create.getByRole('button', { name: /create rule/i }).click();
    await expect(create).toBeHidden();

    // The new rule is listed; open its run-history drawer.
    const ruleCard = page.getByText(/auto-assign on create/i).first();
    await expect(ruleCard).toBeVisible();
    await page.getByRole('button', { name: /history/i }).first().click();
    const drawer = page.getByRole('dialog', { name: /run history/i });
    await expect(drawer).toBeVisible();

    // Trigger the rule by creating a task, then re-open history and see an audited run.
    await page.goto(projectUrl);
    // …create a task via the project UI (matches the existing task-create e2e step)…
    await page.goto('/automations');
    await page.getByRole('button', { name: /history/i }).first().click();
    await expect(page.locator('[data-run-status]').first()).toBeVisible();
  });
});
```

> If the e2e harness cannot synchronously drain the BullMQ automation queue within the test window, assert the gallery → save → drawer-opens flow (the headline UI acceptance) and gate the audited-run assertion behind the same worker-availability helper the 6a/6c e2e uses; record the choice in `DECISIONS.md`.

- [ ] Run: the project's e2e command for a single spec against `ProjectFlow_Test` (e.g. `npx playwright test e2e/automation-templates.spec.ts`). Expected: PASS (1 test).

- [ ] Commit:
```
git add apps/next-web/e2e/automation-templates.spec.ts
git commit -m "test(6d): e2e — gallery template → saved rule → run-history drawer"
```

---

### Task 12: Slice verification + DECISIONS.md

**Files:**
- Modify: `DECISIONS.md` (append a Phase 6d entry)

Steps:

- [ ] Run the full slice verification on local Docker `ProjectFlow_Test`:
  - `npm test --workspace apps/api -- templates` — Expected: PASS (catalog integrity + en/id localization keys, count 15–20).
  - `npm test --workspace apps/api` — Expected: PASS (full unit suite + existing GraphQL authz).
  - `npm run test:integration --workspace apps/api -- runs` — Expected: PASS (templates/instantiation/usage; run history per the worker-flush note).
  - `npm test --workspace apps/next-web` — Expected: PASS (unit + `messages.unit` parity).
  - `npm run build --workspace apps/api` and `npm run build --workspace apps/next-web` — Expected: both PASS.
  - The automation-templates e2e — Expected: PASS.

- [ ] Append a `DECISIONS.md` entry logging: the **18**-template count (in the 15–20 band) and the rationale for an in-code catalog vs tenant seeding; the **shared `ruleShapeSchema`** lifted from the route so templates validate against the literal create schema; the **dual i18n source** (API `TEMPLATE_STRINGS` for `GET /templates` + web `Automations` keys for the in-app gallery, kept in parity by the catalog test); the keyset cursor format `"<startedAtIso>|<id>"` for run history; **no migration** (6d reads 6a's `AutomationRuns`/`AutomationUsage`); `/templates` auth-only vs `/usage` + `/:id/runs` workspace-gated; metering is **read-only, no enforcement** (Phase 10 deferral, spec §9.2); and any deviation (e.g. the `/usage` permission-slug choice, the e2e worker-flush gating). DB-execution-policy note: all DB work ran ONLY against local Docker `ProjectFlow_Test`.

- [ ] Commit:
```
git add DECISIONS.md
git commit -m "docs(6d): DECISIONS entry — template catalog + run history + read-only metering"
```

---

## Definition of Done

Per-slice DoD (spec §3) + BUILD_PLAN acceptance (spec §7.6):

- [ ] **BUILD_PLAN acceptance:** **15–20 prebuilt templates** available in the gallery (this plan ships **18**); the **run-history view shows audited executions** (status, trigger, duration, error) from `AutomationRuns`, newest-first, paginated.
- [ ] In-code catalog `automation.templates.ts` (18 defs) using only the 6a–6c enum tokens; the gallery **pre-fills the builder** and the user saves a normal rule — **no tenant rows seeded**.
- [ ] A unit test asserts **every** template validates against the shared `ruleShapeSchema` AND each `i18nTitleKey`/`i18nDescKey` exists in **both** `en.json` and `id.json` (catalog-integrity + localization).
- [ ] **No migration** — 6d reads the 6a `AutomationRuns`/`AutomationUsage` tables; new SPs (`usp_AutomationRule_ListRuns`, `usp_AutomationUsage_GetCurrent`) are read-only.
- [ ] REST is primary: `GET /automations/templates` (localized), `GET /automations/:id/runs` (keyset, newest-first), `GET /automations/usage` (current period); the **GraphQL mirror** (`automationTemplates`, `automationRuns`, `automationUsage`) delegates to the one shared `AutomationService`.
- [ ] Authorization fail-closed: `/templates` + `automationTemplates` auth-only (static catalog); `/:id/runs` + `/usage` + their GraphQL mirrors workspace-gated via `requirePermission`/`requireWorkspacePermission`.
- [ ] Read-only **metering** surfaced from `AutomationUsage` for the current `'YYYYMM'` period — **no enforcement** (Phase 10 deferral).
- [ ] Unit (catalog integrity + drawer formatting) + integration (instantiation matches catalog; run-history ordered; usage counts) + ≥1 Playwright e2e (gallery → save → run history) — all green.
- [ ] `@projectflow/types` updated (`AutomationTemplate`/`AutomationRun`/`AutomationRunStatus`/`AutomationRunPage`/`AutomationUsage`).
- [ ] i18n: 18 template title/desc keys + gallery/drawer/metering UI keys in **en.json + id.json** (real Indonesian); `messages.unit` parity green.
- [ ] All DB work (SP deploy, integration, e2e) ran **ONLY against local Docker `ProjectFlow_Test`** — never the prod-pointing `apps/api/.env`.
- [ ] `DECISIONS.md` entry logs the catalog/metering/cursor choices + deviations. **This is the final Phase 6 slice — stop for review/merge; the Phase 6 automation arc is code-complete.**

---

## Self-Review

**Spec coverage (§7.1–§7.6):**
- §7.1 in-code catalog `automation.templates.ts`, 15–20 defs `{ key, i18nTitleKey, i18nDescKey, trigger, conditions, actions }`, gallery pre-fills builder, no seeding → Task 3 (18 defs) + Task 10 (gallery prefill). `GET /api/v1/automations/templates` localized → Task 6.
- §7.2 run history `GET /api/v1/automations/:id/runs` + GraphQL `automationRuns` over `AutomationRuns`, paginated newest-first, drawer → Tasks 2/5/6/7/10.
- §7.3 read-only per-workspace metering from `AutomationUsage` current period, no enforcement → `usp_AutomationUsage_GetCurrent` (Task 2), `getUsage` (Task 5), `/usage` (Task 6), "runs this month" tile (Task 10).
- §7.4 gallery entry point + drawer + workspace stat → Task 10.
- §7.5 tests: catalog integrity (every template validates) + localization keys exist in en+id → Task 4; instantiate→saved-rule matches + run-history ordered → Task 6; e2e pick→save→trigger→history → Task 11.
- §7.6 acceptance: 15–20 templates (18 shipped); run history shows audited executions → DoD + e2e.
- §4 grounding: `AutomationRuns`/`AutomationUsage` schema, `Status` enum (`success|partial|failed|skipped|loop_blocked`), `Period CHAR(6)` 'YYYYMM' → used verbatim in Tasks 1/2/5. §5/§6 enum tokens (`TASK_CREATED`/`STATUS_CHANGED`/`CHANGE_STATUS`/`ASSIGN`/`SET_FIELD`/`ADD_TAG`/`CREATE_SUBTASK`/`MOVE_TASK`/`APPLY_TEMPLATE`, operators `is|is_not|contains|gt|lt|before|after|is_set`) → catalog + `ruleShapeSchema`.

**Placeholder scan:** No "add the remaining templates similarly" — all **18** definitions are written out with concrete `trigger`/`conditions`/`actions`. The `GET /templates` route + GraphQL resolver, `GET /:id/runs` route + `automationRuns` resolver, the run-history drawer, and the metering stat are fully coded. The only deliberately-noted unknowns are 6a/6b/6c output-shape details (e.g. whether 6a registered the GraphQL mirror inline, exact 6c action option key names, the integration harness's queue-flush helper) — each is flagged inline with a concrete fallback, not left blank.

**Type/name consistency:** Table/column names match §4 exactly (`AutomationRuns`, `AutomationUsage`, `Period CHAR(6)`, `Status`, `Depth`, `DurationMs`, `StartedAt`). SP names follow the repo's `usp_Automation*` convention (`usp_AutomationRule_ListRuns`, `usp_AutomationUsage_GetCurrent`) alongside existing `usp_AutomationRule_*`. Types (`AutomationTemplate`/`AutomationRun`/`AutomationRunStatus`/`AutomationRunPage`/`AutomationUsage`) are added to the existing `// ── Automation Engine ──` block in `packages/types/index.ts`. REST envelopes match the existing module's non-standard `{ rules }`/`{ rule }` shape (`{ templates }`, `{ usage }`, and a bare `{ runs, nextCursor }` page). GraphQL follows the flat JSON-string transport (`trigger`/`conditions`/`actions`/`actionResults` as stringified JSON) used by `templates.schema.ts`/`recurrence.schema.ts`, registered via `register*Graphql()` in `schema.ts`. i18n `tpl_<camelKey>_title/_desc` keys derive deterministically from each catalog `key` and are guarded by the Task 4 catalog test; the `messages.unit` parity test guards en/id symmetry.

**Spec ambiguities resolved:** (1) The spec gives no exact template count → fixed at **18** (mid-band, headroom either way). (2) "localized" `GET /templates` with no stated locale source → resolve from `Accept-Language` ('id' prefix → id, else en), with an API-side `TEMPLATE_STRINGS` table kept in parity with the web `Automations` keys by the catalog test. (3) The template `conditions` shape vs the 6b recursive node → modeled as the 6b `ConditionNode` array via `conditionNodeSchema` so the gallery hydrates the upgraded condition builder; legacy flat conditions still validate as leaves. (4) `/usage` has no obvious read slug → reuse `automation.update` (membership-equivalent) and log it. (5) Run-history pagination shape unspecified → keyset cursor `"<startedAtIso>|<id>"` on `(StartedAt DESC, Id DESC)` to survive concurrent inserts.
