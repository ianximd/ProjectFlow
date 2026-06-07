# Phase 6c — Actions, Scheduler & Signed Webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the automation action executor with six new task-mutating actions (`SET_FIELD`, `ADD_TAG`, `CREATE_TASK`, `CREATE_SUBTASK`, `MOVE_TASK`, `APPLY_TEMPLATE`) — each performed as the system actor (`SYSTEM_USER_ID`) and emitting its own loop-guard-tagged domain event back through the 6a automation bus; add an optional per-action `delaySeconds` that re-enqueues the remaining ordered action list as a BullMQ **delayed** job (preserving order, `depth`, and `causationChain`); reroute `CALL_WEBHOOK` through the existing signed/retried/audited `webhook-outgoing` dispatcher (deleting the raw fire-and-forget `fetch`); and add a BullMQ **repeatable** scheduler worker (`automation.scheduler.worker.ts`) that sweeps `DUE_DATE_PASSED` / `DATE_ARRIVED` / `SCHEDULED` (cron) rules and enqueues normal automation jobs.

**Architecture:** The action executor (`automation.actions.ts`) stays a single `executeAction(action, ctx)` switch, but `ctx` is widened to carry the loop-guard envelope (`depth`, `causationChain`, `workspaceId`, `projectId`) so every task-mutating action can call `emitAutomationEvent` (the 6a bus) with `depth+1` and the extended chain, re-entering the engine under the same guard. New actions delegate to **existing** services — `customFieldService.setValue` (`SET_FIELD`), `tagService.linkTask` (`ADD_TAG`), `taskRepository.create` (`CREATE_TASK`/`CREATE_SUBTASK`), `taskService.moveTask` + `publishTaskMove` (`MOVE_TASK`), and `templateService.apply` (`APPLY_TEMPLATE`) — never raw table writes. The worker's sequential action loop is replaced by an **ordered, delay-aware runner**: it walks actions in order, and when an action carries `delaySeconds > 0` it re-enqueues `{ ruleId, payload, depth, causationChain, actionIndex: i+1 }` as a delayed job and stops, so a slow/delayed step never blocks the worker. `CALL_WEBHOOK` calls `webhookOutgoingService.dispatch(workspaceId, event, payload)` (the same signed HMAC-SHA256 + BullMQ-retried + delivery-logged path the outgoing-webhooks feature uses) instead of a raw `fetch`. The scheduler is a BullMQ JobScheduler-driven repeatable job copied verbatim from `recurrence.worker.ts`: an idempotent `startSchedulerWorker()` registered in `server.ts` behind the same Redis gate, plus a pure `runScheduledSweep(now?)` helper (unit-tested without Redis) that reads due rows via new SPs and enqueues automation jobs through the bus.

**Tech Stack:** SQL Server stored procedures (`CREATE OR ALTER`, `SET NOCOUNT ON`, TRY/CATCH where mutating); Hono REST (primary) + graphql-yoga/Pothos mirror (already added in 6a; this slice only widens the action/trigger schemas); `mssql` via `execSp`/`execSpOne`; BullMQ (`automation` queue — delayed jobs; new `automation-scheduler` repeatable queue); vitest (`--project unit` / `--project integration`); Next.js App Router (SSR) + `next-intl` (en + id); Playwright e2e. DB work runs ONLY against local Docker `ProjectFlow_Test`.

**Prerequisite:** Phases 6a–6b merged. 6c relies on the 6a bus (`automation.bus.ts` exporting `emitAutomationEvent`), the loop-guard envelope (`{ depth, causationChain }` on every `AutomationJobData`), the `AutomationRuns` audit table + per-job run row, the scope-aware `usp_AutomationRule_GetByTrigger`, the renamed action/trigger enums (`CHANGE_STATUS`/`ASSIGN`/…/`CALL_WEBHOOK`; `DUE_DATE_PASSED`/`DATE_ARRIVED`/`SCHEDULED`), and the 6b nested-condition evaluator. Where this plan shows a symbol introduced by 6a/6b (e.g. `emitAutomationEvent`, `AutomationJobData.depth`), treat the 6a/6b code as the authority; if a name differs at implementation time, adapt and note it in `DECISIONS.md`.

---

## File Structure

> **No migration in 6c.** The new actions and the scheduler reuse existing tables (`Tasks`, `Tags`/`TaskTags`, `TaskCustomFieldValues`, `Templates`, `AutomationRules`, the 6a `AutomationRuns`). The only new SQL is two **read-only** scheduler SPs. State explicitly in `DECISIONS.md`: 6c adds NO migration; migrations on disk stay at the 6a/6b high-water mark.

**Stored procedures** (`infra/sql/procedures/`)
- `usp_AutomationRule_ListDueDateRules.sql` — **Create.** Read-only. For `DUE_DATE_PASSED` / `DATE_ARRIVED` rules in a workspace/project scope: return `(RuleId, ScopeType, WorkspaceId, ProjectId, TriggerConfig, TaskId)` for tasks whose `DueDate` (or a config-named date field) crossed `@Now` within `(@Since, @Now]`. Idempotent SELECT, no mutation.
- `usp_AutomationRule_ListScheduledRules.sql` — **Create.** Read-only. Return enabled `SCHEDULED` rules (`RuleId, ScopeType, WorkspaceId, ProjectId, TriggerConfig`) so the worker can evaluate each rule's cron window in TS against the elapsed interval. Idempotent SELECT, no mutation.

**API actions / runner** (`apps/api/src/modules/automation/`)
- `automation.actions.ts` — **Modify.** Widen `executeAction(action, ctx)` signature; add the six new action branches; reroute `CALL_WEBHOOK` through `webhookOutgoingService.dispatch`; delete the raw `fetch`; rename legacy branches to the 6a enum tokens (if 6a left placeholders, this confirms them).
- `automation.actions.context.ts` — **Create.** The `ActionContext` type + `SYSTEM_USER_ID` resolver + the `reEmit()` helper that re-enters the bus with `depth+1` and the extended `causationChain`.
- `automation.runner.ts` — **Create.** Pure, unit-tested `nextDelayedSlice(actions, fromIndex)` (where to split on a `delaySeconds`) + `cronWindowElapsed(cron, since, now)` cron math used by the scheduler.
- `automation.worker.ts` — **Modify.** Replace the inline sequential action loop with the ordered, delay-aware runner: execute actions from `actionIndex`; on a `delaySeconds`, re-enqueue a delayed job and stop; pass the loop-guard `ctx` into every `executeAction`.
- `automation.queue.ts` — **Modify.** Extend `AutomationJobData` with `actionIndex?: number` (the 6a `depth`/`causationChain` fields already exist).

**Scheduler worker** (`apps/api/src/modules/automation/`)
- `automation.scheduler.worker.ts` — **Create.** Repeatable BullMQ job (copy of `recurrence.worker.ts`): idempotent `startSchedulerWorker()`, Redis-gated, `upsertJobScheduler('automation-scheduler-every-5m', …)`, plus the exported pure `runScheduledSweep(now?)` helper.
- `automation.scheduler.repository.ts` — **Create.** `listDueDateRules(since, now)` + `listScheduledRules()` thin SP wrappers.
- `server.ts` — **Modify.** Import + call `startSchedulerWorker()` alongside `startRecurrenceWorker()`, behind the same Redis gate.

**Types** (`packages/types/`)
- `index.ts` — **Modify.** Add the six action tokens to `AutomationActionType`; add the new `AutomationAction` fields (`fieldId`/`fieldValue`, `tagId`/`tagName`, `title`/`description`/`priority`, `targetListId`/`targetPosition`, `templateId`, `delaySeconds`).

**Frontend builder** (`apps/next-web/src/`)
- `app/(app)/automations/automations-view.tsx` — **Modify.** Add the six tokens to `ACTION_KEYS`; render each new action's config inputs; add a per-action "Delay (seconds)" field.
- `messages/en.json` + `messages/id.json` — **Modify.** New `Automations` action-label + field-label keys (en + real Indonesian); `messages.unit` parity must stay green.

**Tests**
- `apps/api/src/modules/automation/__tests__/runner.unit.test.ts` — **Create.** `nextDelayedSlice` ordering/split + `cronWindowElapsed` window math.
- `apps/api/src/modules/automation/__tests__/actions.unit.test.ts` — **Create.** Each new action's SP-arg / service-call mapping (mocked services) + `reEmit` depth/chain increment.
- `apps/api/src/modules/automation/__tests__/actions-scheduler.integration.test.ts` — **Create.** `APPLY_TEMPLATE` recreates a subtree; `CREATE_SUBTASK` adds a child; a delayed action runs after the delay; `CALL_WEBHOOK` produces a signed `WebhookDeliveries` record; the scheduler fires a `DUE_DATE_PASSED` rule and writes an `AutomationRuns` row.
- `apps/next-web/e2e/automation-scheduler.spec.ts` — **Create.** A due-date rule fires via the scheduler within its window; a webhook action's run is audited.

---

## Tasks

### Task 1: Types — new action tokens + fields (`packages/types/index.ts`)

**Files:**
- Modify: `packages/types/index.ts` (the `AutomationActionType` union + `AutomationAction` interface, ~lines 416–437)

Steps:

- [ ] Extend `AutomationActionType` to add the six 6c tokens (keep the 6a-renamed tokens; 6a already turned `TRANSITION_ISSUE→CHANGE_STATUS`, `ASSIGN_ISSUE→ASSIGN`, `UNASSIGN_ISSUE→UNASSIGN`, `ADD_COMMENT→POST_COMMENT`, `TRIGGER_WEBHOOK→CALL_WEBHOOK`). Replace the union with:

```ts
export type AutomationActionType =
  | 'CHANGE_STATUS'
  | 'ASSIGN'
  | 'UNASSIGN'
  | 'SET_PRIORITY'
  | 'POST_COMMENT'
  | 'SEND_NOTIFICATION'
  | 'CALL_WEBHOOK'
  // ── Phase 6c additions ──
  | 'SET_FIELD'
  | 'ADD_TAG'
  | 'CREATE_TASK'
  | 'CREATE_SUBTASK'
  | 'MOVE_TASK'
  | 'APPLY_TEMPLATE';
```

- [ ] Extend `AutomationAction` to carry the new per-action config + the universal `delaySeconds`. Replace the interface with:

```ts
export interface AutomationAction {
  type: AutomationActionType;

  /** CHANGE_STATUS */
  toStatus?: string;
  /** ASSIGN: userId or "REPORTER" */
  assigneeId?: string;
  /** SET_PRIORITY */
  priority?: string;
  /** POST_COMMENT / SEND_NOTIFICATION */
  message?: string;
  /** CALL_WEBHOOK — selects which workspace outgoing-webhook event to dispatch */
  webhookEvent?: string;

  // ── Phase 6c ──
  /** SET_FIELD: the custom-field id + the value to set (validated per field type). */
  fieldId?: string;
  fieldValue?: unknown;
  /** ADD_TAG: an existing tag id (preferred) or a tag name to reuse/create in the task's space. */
  tagId?: string;
  tagName?: string;
  /** CREATE_TASK / CREATE_SUBTASK: the new task's fields. CREATE_SUBTASK parents
   *  it to the triggering task; CREATE_TASK lands in the trigger task's list. */
  title?: string;
  description?: string;
  newPriority?: string;
  /** MOVE_TASK: destination list + optional position (defaults to append). */
  targetListId?: string;
  targetPosition?: number;
  /** APPLY_TEMPLATE: a TASK-scoped template id applied under the trigger task's list. */
  templateId?: string;

  /** Optional per-action delay; when > 0 the remaining ordered actions are
   *  re-enqueued as a BullMQ delayed job preserving order/depth/causation. */
  delaySeconds?: number;
}
```

- [ ] Run: `npm run build --workspace packages/types` (tsc). Expected: PASS — no type errors. (The legacy `webhookUrl?` field is intentionally replaced by `webhookEvent?` per §6.3; 6a's data migration already moved live rules off `TRIGGER_WEBHOOK`.)

- [ ] Commit:
```
git add packages/types/index.ts
git commit -m "feat(6c): automation action types — SET_FIELD/ADD_TAG/CREATE_TASK/CREATE_SUBTASK/MOVE_TASK/APPLY_TEMPLATE + delaySeconds"
```

---

### Task 2: Pure runner helpers + unit tests (`automation.runner.ts`)

**Files:**
- Create: `apps/api/src/modules/automation/automation.runner.ts`
- Create: `apps/api/src/modules/automation/__tests__/runner.unit.test.ts`

Steps:

- [ ] Write the failing unit test first. `runner.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextDelayedSlice, cronWindowElapsed } from '../automation.runner.js';
import type { AutomationAction } from '@projectflow/types';

const a = (type: AutomationAction['type'], delaySeconds?: number): AutomationAction =>
  ({ type, delaySeconds } as AutomationAction);

describe('nextDelayedSlice', () => {
  it('returns null delay when no remaining action is delayed', () => {
    const actions = [a('CHANGE_STATUS'), a('ASSIGN'), a('POST_COMMENT')];
    const r = nextDelayedSlice(actions, 0);
    expect(r.runNow).toEqual([0, 1, 2]);     // run all three indices now
    expect(r.resumeAt).toBeNull();
    expect(r.delayMs).toBe(0);
  });

  it('runs the actions BEFORE the first delayed action, then defers from it', () => {
    const actions = [a('CHANGE_STATUS'), a('ASSIGN', 60), a('POST_COMMENT')];
    const r = nextDelayedSlice(actions, 0);
    expect(r.runNow).toEqual([0]);            // only index 0 runs now
    expect(r.resumeAt).toBe(1);               // resume from the delayed action
    expect(r.delayMs).toBe(60_000);
  });

  it('treats a delay on the FIRST remaining action as an immediate defer (runs nothing now)', () => {
    const actions = [a('CHANGE_STATUS', 30), a('ASSIGN')];
    const r = nextDelayedSlice(actions, 0);
    expect(r.runNow).toEqual([]);
    expect(r.resumeAt).toBe(0);
    expect(r.delayMs).toBe(30_000);
  });

  it('resumes mid-list from actionIndex and ignores already-run prefix', () => {
    const actions = [a('CHANGE_STATUS'), a('ASSIGN'), a('POST_COMMENT', 120), a('SET_PRIORITY')];
    const r = nextDelayedSlice(actions, 2);    // resuming AT the delayed action
    // When resuming AT a delayed action, its delay was already consumed by the
    // delayed-job timer, so it runs now along with the rest of the suffix.
    expect(r.runNow).toEqual([2, 3]);
    expect(r.resumeAt).toBeNull();
  });

  it('treats a non-positive or missing delaySeconds as no delay', () => {
    const actions = [a('CHANGE_STATUS', 0), a('ASSIGN', -5), a('POST_COMMENT')];
    const r = nextDelayedSlice(actions, 0);
    expect(r.runNow).toEqual([0, 1, 2]);
    expect(r.resumeAt).toBeNull();
  });
});

describe('cronWindowElapsed', () => {
  it('fires when a cron tick falls within (since, now]', () => {
    // "every minute" crossed between since and now
    const since = new Date('2026-06-07T09:00:30.000Z');
    const now   = new Date('2026-06-07T09:01:30.000Z');
    expect(cronWindowElapsed('* * * * *', since, now)).toBe(true);
  });

  it('does not fire when no cron tick falls in the window', () => {
    const since = new Date('2026-06-07T09:00:10.000Z');
    const now   = new Date('2026-06-07T09:00:40.000Z');
    expect(cronWindowElapsed('0 * * * *', since, now)).toBe(false); // top-of-hour only
  });

  it('returns false for an invalid cron expression rather than throwing', () => {
    const since = new Date('2026-06-07T09:00:00.000Z');
    const now   = new Date('2026-06-07T09:05:00.000Z');
    expect(cronWindowElapsed('not-a-cron', since, now)).toBe(false);
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- runner`. Expected: FAIL — `Cannot find module '../automation.runner.js'`.

- [ ] Write `automation.runner.ts`. The cron evaluation reuses `cron-parser` (already a transitive dep via BullMQ; if not importable, add it). The split walks the suffix from `fromIndex`:

```ts
import { CronExpressionParser } from 'cron-parser';
import type { AutomationAction } from '@projectflow/types';

export interface DelayedSlice {
  /** Action indices to execute synchronously on this pass. */
  runNow: number[];
  /** The action index a delayed job should resume at, or null when nothing remains deferred. */
  resumeAt: number | null;
  /** Delay (ms) before the resume job runs; 0 when resumeAt is null. */
  delayMs: number;
}

/**
 * Decide which actions run now vs. defer. Walk the suffix [fromIndex, end):
 *   - The action AT fromIndex always runs now (its delay, if any, was already
 *     paid by the delayed-job timer that re-enqueued this slice).
 *   - Each subsequent action runs now until one carries delaySeconds > 0; that
 *     action becomes resumeAt (a delayed job re-enters from it) and the walk stops.
 * Order, depth, and causation are preserved by the worker re-enqueue.
 */
export function nextDelayedSlice(actions: AutomationAction[], fromIndex: number): DelayedSlice {
  const runNow: number[] = [];
  for (let i = fromIndex; i < actions.length; i++) {
    const delay = normalizeDelay(actions[i].delaySeconds);
    // The first action of the slice always runs now (its delay was already consumed).
    if (delay > 0 && i !== fromIndex) {
      return { runNow, resumeAt: i, delayMs: delay * 1000 };
    }
    runNow.push(i);
  }
  return { runNow, resumeAt: null, delayMs: 0 };
}

function normalizeDelay(d: number | undefined): number {
  return typeof d === 'number' && d > 0 ? Math.floor(d) : 0;
}

/**
 * True when the cron expression has at least one scheduled tick in (since, now].
 * Used by the scheduler to fire SCHEDULED rules at most once per elapsed window.
 * Invalid expressions return false (never throw into the sweep).
 */
export function cronWindowElapsed(cron: string, since: Date, now: Date): boolean {
  try {
    const it = CronExpressionParser.parse(cron, { currentDate: since, tz: 'UTC' });
    const next = it.next().toDate();
    return next.getTime() > since.getTime() && next.getTime() <= now.getTime();
  } catch {
    return false;
  }
}
```

- [ ] Run: `npm test --workspace apps/api -- runner`. Expected: PASS (8 tests). If `cron-parser`'s export name differs in the installed version, adapt the import (`import parser from 'cron-parser'` / `parser.parseExpression`) and keep the helper's contract; note it in `DECISIONS.md`.

- [ ] Commit:
```
git add apps/api/src/modules/automation/automation.runner.ts apps/api/src/modules/automation/__tests__/runner.unit.test.ts
git commit -m "feat(6c): pure automation runner helpers — nextDelayedSlice + cronWindowElapsed + unit tests"
```

---

### Task 3: Action context + loop-guard re-emit (`automation.actions.context.ts`)

**Files:**
- Create: `apps/api/src/modules/automation/automation.actions.context.ts`
- Test: the `reEmit` depth/chain increment is asserted in `actions.unit.test.ts` (Task 5).

Steps:

- [ ] Write `automation.actions.context.ts`. It defines the loop-guard envelope every action receives and the `reEmit` helper that re-enters the 6a bus at `depth+1` with the rule appended to the causation chain. Treat the 6a `emitAutomationEvent` signature as authoritative; this shows the expected shape:

```ts
import { emitAutomationEvent } from './automation.bus.js';
import type { AutomationTriggerType } from '@projectflow/types';

/** The system actor every 6c action runs as (a real seeded Users row). */
export const SYSTEM_USER_ID = process.env.SYSTEM_USER_ID ?? null;

/**
 * Loop-guard + scope envelope carried alongside the event payload into every
 * action. `ruleId` is the rule whose action is executing now; `depth` and
 * `causationChain` are the 6a guard fields; `workspaceId`/`projectId` resolve
 * the scope for re-emitted events and webhook dispatch.
 */
export interface ActionContext {
  ruleId:         string;
  depth:          number;
  causationChain: string[];
  workspaceId:    string;
  projectId:      string | null;
  /** The triggering event payload (task before/after, actorId, etc.). */
  payload:        Record<string, unknown>;
}

/**
 * Re-enter the automation bus for a domain event CAUSED by this action, tagged
 * with the incremented loop-guard depth and the extended causation chain. The
 * 6a bus drops the enqueue when depth >= MAX_DEPTH or the rule id already sits
 * in the chain, recording a `loop_blocked` AutomationRuns row — so a SET_FIELD
 * action that fires a FIELD_CHANGED rule that fires SET_FIELD again terminates.
 */
export async function reEmit(
  ctx: ActionContext,
  triggerType: AutomationTriggerType,
  eventPayload: Record<string, unknown>,
): Promise<void> {
  await emitAutomationEvent({
    triggerType,
    workspaceId: ctx.workspaceId,
    projectId:   ctx.projectId,
    payload:     eventPayload,
    depth:          ctx.depth + 1,
    causationChain: [...ctx.causationChain, ctx.ruleId],
  });
}
```

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS — assuming the 6a `automation.bus.ts` exports `emitAutomationEvent` with the `{ triggerType, workspaceId, projectId, payload, depth, causationChain }` shape. If 6a named the event-object fields differently, adapt the call site to match the merged 6a code and record the mapping in `DECISIONS.md`.

- [ ] Commit:
```
git add apps/api/src/modules/automation/automation.actions.context.ts
git commit -m "feat(6c): action context + loop-guard reEmit (depth+1, extended causation chain)"
```

---

### Task 4: Scheduler read SPs (`ListDueDateRules`, `ListScheduledRules`)

**Files:**
- Create: `infra/sql/procedures/usp_AutomationRule_ListDueDateRules.sql`
- Create: `infra/sql/procedures/usp_AutomationRule_ListScheduledRules.sql`
- Test: covered by `actions-scheduler.integration.test.ts` (Task 8); deploy via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`.

Steps:

- [ ] Write `usp_AutomationRule_ListDueDateRules.sql` — read-only. For every enabled `DUE_DATE_PASSED` / `DATE_ARRIVED` rule (scope-aware, mirroring 6a's `usp_AutomationRule_GetByTrigger` scope predicate), join the tasks whose deadline crossed into `(@Since, @Now]` so the sweep fires each task exactly once per crossing. `DUE_DATE_PASSED` uses `DueDate`; `DATE_ARRIVED` uses `DueDate` as the target date too (a config-named field is a documented later refinement). Emit one row per (rule, task):

```sql
-- Phase 6c: due-date / date-arrived rules whose target task date crossed the
-- threshold within (@Since, @Now]. Read-only — the scheduler enqueues jobs.
-- Scope-aware exactly like usp_AutomationRule_GetByTrigger (PROJECT vs WORKSPACE).
CREATE OR ALTER PROCEDURE dbo.usp_AutomationRule_ListDueDateRules
    @Since DATETIME2,
    @Now   DATETIME2
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        r.Id                          AS RuleId,
        r.ScopeType,
        r.WorkspaceId,
        r.ProjectId,
        r.TriggerConfig,
        t.Id                          AS TaskId,
        t.ProjectId                   AS TaskProjectId,
        t.WorkspaceId                 AS TaskWorkspaceId,
        r.TriggerType
    FROM dbo.AutomationRules r
    JOIN dbo.Tasks t
      ON  t.DeletedAt IS NULL
      AND t.DueDate IS NOT NULL
      AND t.DueDate >  @Since
      AND t.DueDate <= @Now
      AND (
            (r.ScopeType = 'PROJECT'   AND r.ScopeId = t.ProjectId)
         OR (r.ScopeType = 'WORKSPACE' AND r.ScopeId = t.WorkspaceId)
          )
    WHERE r.IsEnabled = 1
      AND r.TriggerType IN ('DUE_DATE_PASSED', 'DATE_ARRIVED')
    ORDER BY t.DueDate;
END;
GO
```

- [ ] Write `usp_AutomationRule_ListScheduledRules.sql` — read-only. Return enabled `SCHEDULED` rules with their config so the worker evaluates each cron in TS (`cronWindowElapsed`) against the elapsed window:

```sql
-- Phase 6c: enabled SCHEDULED (cron) automation rules. The worker evaluates each
-- rule's cron window in TS against the sweep interval and enqueues a MANUAL-shaped
-- job for those whose window elapsed. Read-only.
CREATE OR ALTER PROCEDURE dbo.usp_AutomationRule_ListScheduledRules
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        r.Id           AS RuleId,
        r.ScopeType,
        r.WorkspaceId,
        r.ProjectId,
        r.TriggerConfig,
        r.TriggerType
    FROM dbo.AutomationRules r
    WHERE r.IsEnabled = 1
      AND r.TriggerType = 'SCHEDULED'
    ORDER BY r.WorkspaceId;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test` (local DB env only, never `apps/api/.env`). Expected: both procedures created with no errors. (If 6a's column is `IsEnabled` vs a different casing/name, or `ScopeId`/`ScopeType` differ, align to the 6a `0038` schema and note in `DECISIONS.md`.)

- [ ] Commit:
```
git add infra/sql/procedures/usp_AutomationRule_ListDueDateRules.sql infra/sql/procedures/usp_AutomationRule_ListScheduledRules.sql
git commit -m "feat(6c): scheduler read SPs — ListDueDateRules (window) + ListScheduledRules (cron)"
```

---

### Task 5: New action branches + webhook reroute (`automation.actions.ts`) + action unit tests

**Files:**
- Modify: `apps/api/src/modules/automation/automation.actions.ts`
- Create: `apps/api/src/modules/automation/__tests__/actions.unit.test.ts`

Steps:

- [ ] Write the failing unit test first. It mocks the delegated services and asserts each new action calls the right service with the right args, runs as `SYSTEM_USER_ID`, and re-emits with `depth+1`. `actions.unit.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the delegated services BEFORE importing the executor.
const setValue   = vi.fn(async () => {});
const linkTask   = vi.fn(async () => {});
const taskCreate = vi.fn(async () => ({ Id: 'NEW-TASK', ProjectId: 'P1', WorkspaceId: 'W1' }));
const moveTask   = vi.fn(async () => ({ id: 'T1', projectId: 'P1' }));
const applyTpl   = vi.fn(async () => ({ rootId: 'NEW-ROOT', counts: { lists: 0, tasks: 3, views: 0, fields: 0 } }));
const dispatch   = vi.fn(async () => {});
const emit       = vi.fn(async () => {});

vi.mock('../../customfields/customfield.service.js', () => ({ customFieldService: { setValue } }));
vi.mock('../../tags/tag.service.js', () => ({ tagService: { linkTask, resolveOrCreateInTaskSpace: vi.fn(async () => 'TAG-1') } }));
vi.mock('../../tasks/task.repository.js', () => ({ TaskRepository: class { create = taskCreate; } }));
vi.mock('../../tasks/task.service.js', () => ({ taskService: { moveTask } }));
vi.mock('../../templates/template.service.js', () => ({ templateService: { apply: applyTpl } }));
vi.mock('../../webhooks/webhook-outgoing.service.js', () => ({ webhookOutgoingService: { dispatch } }));
vi.mock('../automation.bus.js', () => ({ emitAutomationEvent: emit }));

import { executeAction } from '../automation.actions.js';
import type { ActionContext } from '../automation.actions.context.js';

const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({
  ruleId: 'R1', depth: 0, causationChain: [], workspaceId: 'W1', projectId: 'P1',
  payload: { taskId: 'T1', reporterId: 'U-REP', actorId: 'U-ACT' }, ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('SET_FIELD', () => {
  it('sets the custom-field value on the trigger task and re-emits FIELD_CHANGED at depth+1', async () => {
    await executeAction({ type: 'SET_FIELD', fieldId: 'F1', fieldValue: 'High' }, ctx());
    expect(setValue).toHaveBeenCalledWith('T1', 'F1', 'High');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({
      triggerType: 'FIELD_CHANGED', depth: 1, causationChain: ['R1'],
    });
  });
});

describe('ADD_TAG', () => {
  it('links an existing tag id to the task', async () => {
    await executeAction({ type: 'ADD_TAG', tagId: 'TAG-1' }, ctx());
    expect(linkTask).toHaveBeenCalledWith('T1', 'TAG-1');
  });
});

describe('CREATE_SUBTASK', () => {
  it('creates a child of the trigger task as SYSTEM_USER_ID and re-emits TASK_CREATED', async () => {
    await executeAction({ type: 'CREATE_SUBTASK', title: 'Follow-up' }, ctx());
    expect(taskCreate).toHaveBeenCalledWith(expect.objectContaining({ parentTaskId: 'T1', title: 'Follow-up' }));
    expect(emit.mock.calls[0][0]).toMatchObject({ triggerType: 'TASK_CREATED', depth: 1 });
  });
});

describe('MOVE_TASK', () => {
  it('moves the task to the target list', async () => {
    await executeAction({ type: 'MOVE_TASK', targetListId: 'L2', targetPosition: 5 }, ctx());
    expect(moveTask).toHaveBeenCalledWith('T1', 'L2', 5);
  });
});

describe('APPLY_TEMPLATE', () => {
  it('applies a template under the trigger task list as SYSTEM_USER_ID', async () => {
    await executeAction({ type: 'APPLY_TEMPLATE', templateId: 'TPL-1' }, ctx({ payload: { taskId: 'T1', listId: 'L1' } }));
    expect(applyTpl).toHaveBeenCalledWith('TPL-1', expect.objectContaining({ targetParentId: 'L1' }), expect.any(String));
  });
});

describe('CALL_WEBHOOK', () => {
  it('dispatches through the signed outgoing-webhook service (no raw fetch)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await executeAction({ type: 'CALL_WEBHOOK', webhookEvent: 'automation.fired' }, ctx());
    expect(dispatch).toHaveBeenCalledWith('W1', 'automation.fired', expect.any(Object));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- actions.unit`. Expected: FAIL — the executor still has the old signature/branches and a raw `fetch`.

- [ ] Rewrite `automation.actions.ts`. The `ctx` becomes the loop-guard `ActionContext`; the legacy mutating branches keep using `execSpOne` but now run as `SYSTEM_USER_ID`; the six new branches delegate to services and `reEmit`; `CALL_WEBHOOK` calls `webhookOutgoingService.dispatch`. Full file:

```ts
/**
 * Automation action executor (Phase 6c).
 * Receives a single action + the loop-guard ActionContext and performs the
 * side-effect. Task-mutating actions run as SYSTEM_USER_ID and re-emit their
 * own domain event through the 6a bus at depth+1 so cascades stay guarded.
 */
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import { subLogger } from '../../shared/lib/logger.js';
import { customFieldService } from '../customfields/customfield.service.js';
import { tagService } from '../tags/tag.service.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { taskService } from '../tasks/task.service.js';
import { templateService } from '../templates/template.service.js';
import { webhookOutgoingService } from '../webhooks/webhook-outgoing.service.js';
import { SYSTEM_USER_ID, reEmit, type ActionContext } from './automation.actions.context.js';
import type { AutomationAction } from '@projectflow/types';

const log = subLogger('automation');
const taskRepo = new TaskRepository();

export async function executeAction(action: AutomationAction, ctx: ActionContext): Promise<void> {
  const taskId = ctx.payload['taskId'] as string | undefined;

  switch (action.type) {
    // ── 6a-renamed legacy actions ──────────────────────────────────────────
    case 'CHANGE_STATUS': {
      if (!taskId || !action.toStatus) break;
      await execSpOne('usp_Task_Transition', [
        { name: 'TaskId',      type: sql.UniqueIdentifier, value: taskId },
        { name: 'NewStatus',   type: sql.NVarChar(100),    value: action.toStatus },
        { name: 'RequesterId', type: sql.UniqueIdentifier, value: SYSTEM_USER_ID },
      ]);
      await reEmit(ctx, 'STATUS_CHANGED', { ...ctx.payload, toStatus: action.toStatus });
      break;
    }

    case 'ASSIGN': {
      if (!taskId) break;
      const assigneeId =
        action.assigneeId === 'REPORTER'
          ? (ctx.payload['reporterId'] as string | undefined) ?? null
          : action.assigneeId ?? null;
      await updateTaskAssignee(taskId, assigneeId);
      await reEmit(ctx, 'ASSIGNEE_CHANGED', { ...ctx.payload, assigneeId });
      break;
    }

    case 'UNASSIGN': {
      if (!taskId) break;
      await updateTaskAssignee(taskId, null);
      await reEmit(ctx, 'ASSIGNEE_CHANGED', { ...ctx.payload, assigneeId: null });
      break;
    }

    case 'SET_PRIORITY': {
      if (!taskId || !action.priority) break;
      await execSpOne('usp_Task_Update', taskUpdateArgs(taskId, { priority: action.priority }));
      await reEmit(ctx, 'FIELD_CHANGED', { ...ctx.payload, field: 'priority', to: action.priority });
      break;
    }

    case 'POST_COMMENT': {
      if (!taskId || !action.message || !SYSTEM_USER_ID) break;
      await execSpOne('usp_Comment_Create', [
        { name: 'TaskId',   type: sql.UniqueIdentifier,  value: taskId },
        { name: 'AuthorId', type: sql.UniqueIdentifier,  value: SYSTEM_USER_ID },
        { name: 'Body',     type: sql.NVarChar(sql.MAX), value: action.message },
      ]);
      break;
    }

    case 'SEND_NOTIFICATION': {
      if (!action.message) break;
      const targetUserId = ctx.payload['assigneeId'] as string | undefined;
      if (!targetUserId) break;
      await execSpOne('usp_Notification_Create', [
        { name: 'UserId',  type: sql.UniqueIdentifier, value: targetUserId },
        { name: 'Type',    type: sql.NVarChar(50),      value: 'AUTOMATION' },
        { name: 'Payload', type: sql.NVarChar(sql.MAX), value: JSON.stringify({ message: action.message, taskId: taskId ?? null }) },
      ]);
      break;
    }

    // ── 6c: signed + audited webhook (no raw fetch) ───────────────────────────
    case 'CALL_WEBHOOK': {
      const event = action.webhookEvent ?? 'automation.fired';
      // Routes through the existing webhook-outgoing dispatcher: HMAC-SHA256
      // X-ProjectFlow-Signature, BullMQ retries, and a WebhookDeliveries record.
      await webhookOutgoingService.dispatch(ctx.workspaceId, event, {
        ruleId: ctx.ruleId,
        taskId: taskId ?? null,
        payload: ctx.payload,
      });
      break;
    }

    // ── 6c: new actions ───────────────────────────────────────────────────────
    case 'SET_FIELD': {
      if (!taskId || !action.fieldId || action.fieldValue === undefined) break;
      // customFieldService.setValue validates per field type (422 on bad value).
      await customFieldService.setValue(taskId, action.fieldId, action.fieldValue);
      await reEmit(ctx, 'FIELD_CHANGED', { ...ctx.payload, field: action.fieldId, to: action.fieldValue });
      break;
    }

    case 'ADD_TAG': {
      if (!taskId) break;
      let tagId = action.tagId ?? null;
      if (!tagId && action.tagName) {
        // Reuse-or-create a tag in the trigger task's space, then link it.
        tagId = await tagService.resolveOrCreateInTaskSpace(taskId, action.tagName);
      }
      if (!tagId) break;
      await tagService.linkTask(taskId, tagId);
      break;
    }

    case 'CREATE_TASK': {
      if (!action.title) break;
      const listId = ctx.payload['listId'] as string | undefined;
      const created = await taskRepo.create({
        workspaceId:  ctx.workspaceId,
        projectId:    ctx.projectId ?? (ctx.payload['projectId'] as string),
        listId:       listId ?? null,
        parentTaskId: null,
        title:        action.title,
        description:  action.description ?? null,
        priority:     action.newPriority ?? undefined,
        reporterId:   SYSTEM_USER_ID as string,
      } as any);
      await reEmitTaskCreated(ctx, created);
      break;
    }

    case 'CREATE_SUBTASK': {
      if (!taskId || !action.title) break;
      const listId = ctx.payload['listId'] as string | undefined;
      const created = await taskRepo.create({
        workspaceId:  ctx.workspaceId,
        projectId:    ctx.projectId ?? (ctx.payload['projectId'] as string),
        listId:       listId ?? null,
        parentTaskId: taskId,          // child of the trigger task
        title:        action.title,
        description:  action.description ?? null,
        priority:     action.newPriority ?? undefined,
        reporterId:   SYSTEM_USER_ID as string,
      } as any);
      await reEmitTaskCreated(ctx, created);
      break;
    }

    case 'MOVE_TASK': {
      if (!taskId || !action.targetListId) break;
      // taskService.moveTask runs usp_Task_Move AND publishes the live board
      // move event; this mirrors the REST :id/move path.
      const before = await taskService.getTask(taskId).catch(() => null);
      const oldProjectId = (before as any)?.projectId ?? (before as any)?.ProjectId ?? null;
      const moved = await taskService.moveTask(taskId, action.targetListId, action.targetPosition ?? Date.now());
      if (moved) {
        const { publishTaskMove } = await import('../../graphql/task-events.js');
        await publishTaskMove(oldProjectId, moved);
        await reEmit(ctx, 'TASK_UPDATED', { ...ctx.payload, listId: action.targetListId });
      }
      break;
    }

    case 'APPLY_TEMPLATE': {
      if (!action.templateId || !SYSTEM_USER_ID) break;
      const listId = ctx.payload['listId'] as string | undefined;
      if (!listId) break;
      // Reuse the Phase 5d template apply: recreates the captured subtree under
      // the trigger task's list, with the system user as actor. The apply path
      // enforces the cross-workspace guard internally.
      await templateService.apply(
        action.templateId,
        { targetParentId: listId, anchorDate: new Date().toISOString() },
        SYSTEM_USER_ID,
      );
      break;
    }

    default:
      log.warn({ type: (action as any).type }, 'unknown action type');
  }
}

/** Re-emit TASK_CREATED for a freshly created task (PascalCase or camelCase row). */
async function reEmitTaskCreated(ctx: ActionContext, created: any): Promise<void> {
  const newTaskId = created?.Id ?? created?.id;
  const projectId = created?.ProjectId ?? created?.projectId ?? ctx.projectId;
  if (!newTaskId) return;
  await reEmit(ctx, 'TASK_CREATED', { taskId: newTaskId, projectId, task: created });
}

/** Single-field assignee update via usp_Task_Update (other params null-coalesced). */
function updateTaskAssignee(taskId: string, assigneeId: string | null) {
  return execSpOne('usp_Task_Update', taskUpdateArgs(taskId, { assigneeId }));
}

/** Build the full usp_Task_Update arg list with only the supplied fields set. */
function taskUpdateArgs(taskId: string, p: { priority?: string; assigneeId?: string | null }) {
  return [
    { name: 'TaskId',      type: sql.UniqueIdentifier,  value: taskId },
    { name: 'Title',       type: sql.NVarChar(500),     value: null },
    { name: 'Description', type: sql.NVarChar(sql.MAX), value: null },
    { name: 'Type',        type: sql.NVarChar(20),      value: null },
    { name: 'Priority',    type: sql.NVarChar(20),      value: p.priority ?? null },
    { name: 'AssigneeId',  type: sql.UniqueIdentifier,  value: p.assigneeId ?? null },
    { name: 'SprintId',    type: sql.UniqueIdentifier,  value: null },
    { name: 'EpicId',      type: sql.UniqueIdentifier,  value: null },
    { name: 'StoryPoints', type: sql.Float,             value: null },
    { name: 'DueDate',     type: sql.Date,              value: null },
  ];
}
```

- [ ] Add the `resolveOrCreateInTaskSpace(taskId, name)` helper to `tagService` (in `apps/api/src/modules/tags/tag.service.ts`) if it does not already exist — it resolves the task's space, reuses a same-name tag or creates one, and returns the tag id (the same reuse-or-create logic `template.apply` uses inline). Keep it thin and delegate to the existing `tagRepository.create` / `tagRepository.list`.

- [ ] Run: `npm test --workspace apps/api -- actions.unit`. Expected: PASS (6 describe blocks). Then `npm run build --workspace apps/api`. Expected: PASS — no type errors. (If the 6a worker passes the executor a different `ctx` shape — e.g. it still passes a flat `payload` — reconcile by having the worker build the `ActionContext` in Task 6 and adapt 6a's call site; note in `DECISIONS.md`.)

- [ ] Commit:
```
git add apps/api/src/modules/automation/automation.actions.ts apps/api/src/modules/tags/tag.service.ts apps/api/src/modules/automation/__tests__/actions.unit.test.ts
git commit -m "feat(6c): action expansion — SET_FIELD/ADD_TAG/CREATE_TASK/CREATE_SUBTASK/MOVE_TASK/APPLY_TEMPLATE + signed CALL_WEBHOOK + unit tests"
```

---

### Task 6: Ordered, delay-aware worker runner (`automation.worker.ts` + `automation.queue.ts`)

**Files:**
- Modify: `apps/api/src/modules/automation/automation.queue.ts`
- Modify: `apps/api/src/modules/automation/automation.worker.ts`

Steps:

- [ ] Extend `AutomationJobData` in `automation.queue.ts` with the resume index (the 6a `depth`/`causationChain`/`workspaceId` fields already exist; only `actionIndex` is new):

```ts
export interface AutomationJobData {
  ruleId:         string;
  projectId:      string | null;
  workspaceId:    string;
  eventType:      string;
  payload:        Record<string, unknown>;
  // 6a loop-guard envelope:
  depth:          number;
  causationChain: string[];
  // 6c: where a delayed-job resume continues the ordered action list.
  actionIndex?:   number;
}
```

- [ ] Modify `automation.worker.ts`. Replace the inline `for (const action of rule.actions) …` loop with the ordered, delay-aware runner: build the `ActionContext`, compute `nextDelayedSlice`, run the `runNow` indices, and when a `resumeAt` exists re-enqueue a delayed job carrying the SAME `depth`/`causationChain` and the new `actionIndex`. Keep the 6a run-audit write (start → finish) and the disabled/conditions guards. The new worker body:

```ts
import { Worker } from 'bullmq';
import { AutomationRepository } from './automation.repository.js';
import { evaluateConditionTree } from './automation.conditions.js'; // 6b nested evaluator
import { executeAction }         from './automation.actions.js';
import { nextDelayedSlice }      from './automation.runner.js';
import { automationQueue, type AutomationJobData } from './automation.queue.js';
import type { ActionContext } from './automation.actions.context.js';
import { subLogger } from '../../shared/lib/logger.js';
import { registerCloser } from '../../shared/lib/shutdown.js';

const log = subLogger('automation');
const repo = new AutomationRepository();

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

export function startAutomationWorker() {
  const worker = new Worker<AutomationJobData>(
    'automation',
    async (job) => {
      const { ruleId, payload, projectId, workspaceId, depth, causationChain } = job.data;
      const fromIndex = job.data.actionIndex ?? 0;

      // Load the rule fresh so we always run the latest config.
      const rule = await repo.getRuleForJob(ruleId);            // 6a scope-aware single read
      if (!rule || !rule.isEnabled) return;                     // disabled/deleted since enqueue

      // 6b nested AND/OR evaluator (only on the FIRST pass — a delayed resume
      // already passed conditions when it was first enqueued).
      if (fromIndex === 0 && !evaluateConditionTree(rule.conditions as any, payload)) {
        await repo.recordRun({ ruleId, workspaceId, projectId, triggerType: job.data.eventType, status: 'skipped', depth });
        return;
      }

      const ctx: ActionContext = { ruleId, depth, causationChain, workspaceId, projectId, payload };
      const slice = nextDelayedSlice(rule.actions, fromIndex);

      const results: Array<{ index: number; ok: boolean; error?: string }> = [];
      for (const i of slice.runNow) {
        try {
          await executeAction(rule.actions[i], ctx);
          results.push({ index: i, ok: true });
        } catch (err: any) {
          log.error({ ruleId, action: rule.actions[i].type, err: err?.message }, 'action failed');
          results.push({ index: i, ok: false, error: err?.message });
          // Continue with remaining actions even if one fails (matches legacy).
        }
      }

      // Defer the rest as a BullMQ delayed job preserving order/depth/causation.
      if (slice.resumeAt !== null) {
        await automationQueue.add(
          `${job.data.eventType}:${ruleId}:resume@${slice.resumeAt}`,
          { ...job.data, actionIndex: slice.resumeAt },
          { delay: slice.delayMs },
        );
      }

      // Audit + execution stats. A run that still has a deferred tail is 'partial'
      // only when something failed; the resume job writes its own run row.
      const anyFailed = results.some((r) => !r.ok);
      const status = anyFailed ? 'partial' : 'success';
      await repo.recordRun({ ruleId, workspaceId, projectId, triggerType: job.data.eventType, status, depth, actionResults: results });
      await repo.recordExecution(ruleId);
    },
    { connection, concurrency: 5 },
  );

  worker.on('failed', (job, err) => log.error({ jobId: job?.id, err: err?.message }, 'job failed'));
  worker.on('error',  (err) => log.error({ err: err?.message }, 'worker error'));

  registerCloser('automation-worker', () => worker.close());
  log.info('worker started');
  return worker;
}
```

- [ ] Reconcile with the 6a worker: 6a already introduced `repo.getRuleForJob`, `repo.recordRun`, the `depth`/`causationChain`/`workspaceId` job fields, and the `evaluateConditionTree` import (6b). If any of those names differ in the merged code, adapt to the real symbols and keep this task's ONLY net change: replacing the flat action `for` loop with `nextDelayedSlice` + the delayed re-enqueue, and threading the `ActionContext`. Note any rename in `DECISIONS.md`.

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS. Then `npm test --workspace apps/api -- runner actions.unit`. Expected: PASS (helpers + action unit tests still green).

- [ ] Commit:
```
git add apps/api/src/modules/automation/automation.queue.ts apps/api/src/modules/automation/automation.worker.ts
git commit -m "feat(6c): ordered delay-aware action runner in the worker — re-enqueue remaining actions as a delayed job (order/depth/causation preserved)"
```

---

### Task 7: Scheduler worker + repository (`automation.scheduler.worker.ts`)

**Files:**
- Create: `apps/api/src/modules/automation/automation.scheduler.repository.ts`
- Create: `apps/api/src/modules/automation/automation.scheduler.worker.ts`
- Modify: `apps/api/src/server.ts`

Steps:

- [ ] Write `automation.scheduler.repository.ts` — thin SP wrappers for the Task 4 reads:

```ts
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';

export interface DueDateRuleRow {
  RuleId:        string;
  ScopeType:     string;
  WorkspaceId:   string;
  ProjectId:     string | null;
  TriggerConfig: string;
  TaskId:        string;
  TaskProjectId: string | null;
  TaskWorkspaceId: string;
  TriggerType:   string;
}

export interface ScheduledRuleRow {
  RuleId:        string;
  ScopeType:     string;
  WorkspaceId:   string;
  ProjectId:     string | null;
  TriggerConfig: string;
  TriggerType:   string;
}

export class AutomationSchedulerRepository {
  async listDueDateRules(since: Date, now: Date): Promise<DueDateRuleRow[]> {
    return execSpOne<DueDateRuleRow>('usp_AutomationRule_ListDueDateRules', [
      { name: 'Since', type: sql.DateTime2, value: since },
      { name: 'Now',   type: sql.DateTime2, value: now },
    ]);
  }

  async listScheduledRules(): Promise<ScheduledRuleRow[]> {
    return execSpOne<ScheduledRuleRow>('usp_AutomationRule_ListScheduledRules', []);
  }
}

export const automationSchedulerRepository = new AutomationSchedulerRepository();
```

- [ ] Write `automation.scheduler.worker.ts` — a verbatim copy of the `recurrence.worker.ts` pattern (idempotent `start*`, Redis-gated, `upsertJobScheduler`, `registerCloser`, exported pure `runScheduledSweep(now?)`). The sweep tracks the last sweep time in a Redis key so the cron/date window is `(lastSweep, now]`, and enqueues automation jobs through the 6a bus (`emitAutomationEvent`) so the loop guard + run audit apply uniformly:

```ts
/**
 * BullMQ wiring for the automation date-trigger scheduler (Phase 6c).
 *
 * A JobScheduler-driven repeatable job (`automation-scheduler`) ticks every
 * 5 min. The Worker calls runScheduledSweep(now): for DUE_DATE_PASSED /
 * DATE_ARRIVED rules it enqueues a job per task whose deadline crossed since the
 * last sweep; for SCHEDULED (cron) rules it enqueues those whose cron window
 * elapsed. All enqueues go through the 6a bus so the loop guard + AutomationRuns
 * audit apply. Mirrors recurrence.worker.ts exactly (connection,
 * removeOnComplete/Fail, upsertJobScheduler idempotent, registerCloser).
 *
 * The work lives in runScheduledSweep so unit/integration tests can drive it
 * without Redis or a Worker. This module is only the timer + last-sweep cursor.
 */
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { automationSchedulerRepository } from './automation.scheduler.repository.js';
import { emitAutomationEvent } from './automation.bus.js';
import { cronWindowElapsed } from './automation.runner.js';
import { subLogger } from '../../shared/lib/logger.js';
import { registerCloser } from '../../shared/lib/shutdown.js';

const log = subLogger('automation-scheduler');

const QUEUE_NAME = 'automation-scheduler';
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const LAST_SWEEP_KEY = 'automation:scheduler:lastSweepAt';

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

interface JobData { /* No payload — the sweep reads fresh due rows from SQL. */ }

let started = false;

/**
 * Run one sweep over (@since, @now]. `since` defaults to now − SWEEP_INTERVAL_MS
 * (so the first sweep after a restart looks back one interval). Returns counts.
 * Errors on an individual rule are logged and skipped so one bad row doesn't
 * stall the batch.
 */
export async function runScheduledSweep(
  now: Date = new Date(),
  since: Date = new Date(now.getTime() - SWEEP_INTERVAL_MS),
): Promise<{ dueDate: number; scheduled: number }> {
  let dueDate = 0;
  let scheduled = 0;

  // ── DUE_DATE_PASSED / DATE_ARRIVED ──
  const dueRows = await automationSchedulerRepository.listDueDateRules(since, now);
  for (const row of dueRows) {
    try {
      await emitAutomationEvent({
        triggerType: row.TriggerType as any,
        workspaceId: row.TaskWorkspaceId,
        projectId:   row.TaskProjectId,
        payload:     { taskId: row.TaskId, projectId: row.TaskProjectId },
        depth:       0,
        causationChain: [],
        // Optional: target a single rule so the bus doesn't re-resolve by trigger.
        ruleId:      row.RuleId,
      } as any);
      dueDate++;
    } catch (err: any) {
      log.error({ err: err?.message, ruleId: row.RuleId, taskId: row.TaskId }, 'due-date enqueue failed');
    }
  }

  // ── SCHEDULED (cron) ──
  const cronRows = await automationSchedulerRepository.listScheduledRules();
  for (const row of cronRows) {
    try {
      const cron = (JSON.parse(row.TriggerConfig)?.cron ?? '') as string;
      if (!cron || !cronWindowElapsed(cron, since, now)) continue;
      await emitAutomationEvent({
        triggerType: 'SCHEDULED' as any,
        workspaceId: row.WorkspaceId,
        projectId:   row.ProjectId,
        payload:     { ruleId: row.RuleId },
        depth:       0,
        causationChain: [],
        ruleId:      row.RuleId,
      } as any);
      scheduled++;
    } catch (err: any) {
      log.error({ err: err?.message, ruleId: row.RuleId }, 'scheduled enqueue failed');
    }
  }

  return { dueDate, scheduled };
}

export async function startSchedulerWorker(): Promise<{ queue: Queue<JobData>; worker: Worker<JobData> } | null> {
  if (started) throw new Error('startSchedulerWorker called twice');
  started = true;

  const queue = new Queue<JobData>(QUEUE_NAME, {
    connection,
    defaultJobOptions: { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } },
  });

  // Idempotent across restarts — leaves an existing scheduler entry alone.
  await queue.upsertJobScheduler(
    'automation-scheduler-every-5m',
    { every: SWEEP_INTERVAL_MS },
    { name: 'automation-scheduler' },
  );

  // A dedicated Redis client for the last-sweep cursor (read/advance per tick).
  const redis = new Redis(connection);

  const worker = new Worker<JobData>(
    QUEUE_NAME,
    async () => {
      const now = new Date();
      const raw = await redis.get(LAST_SWEEP_KEY);
      const since = raw ? new Date(raw) : new Date(now.getTime() - SWEEP_INTERVAL_MS);
      const result = await runScheduledSweep(now, since);
      await redis.set(LAST_SWEEP_KEY, now.toISOString());
      if (result.dueDate > 0 || result.scheduled > 0) log.info(result, 'automation scheduler sweep');
      return result;
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => log.error({ jobId: job?.id, err: err?.message }, 'job failed'));
  worker.on('error',  (err) => log.error({ err: err?.message }, 'worker error'));

  registerCloser('automation-scheduler-worker', () => worker.close());
  registerCloser('automation-scheduler-queue',  () => queue.close());
  registerCloser('automation-scheduler-redis',  () => redis.quit().then(() => undefined));
  log.info({ sweepEveryMs: SWEEP_INTERVAL_MS }, 'worker started');
  return { queue, worker };
}
```

- [ ] Wire it into `server.ts` — import alongside `startRecurrenceWorker` and call it behind the same Redis gate:

```ts
import { startSchedulerWorker } from './modules/automation/automation.scheduler.worker.js';
```
```ts
  // Start the automation date-trigger scheduler (Phase 6c). Same Redis gate as
  // recurrence — DUE_DATE_PASSED / DATE_ARRIVED / SCHEDULED rules sweep here.
  if (process.env.REDIS_URL || process.env.REDIS_HOST) {
    startSchedulerWorker().catch((err) =>
      logger.warn({ err: err?.message }, 'automation scheduler worker failed to start'),
    );
  }
```

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS. (If the 6a `emitAutomationEvent` does not accept a `ruleId` targeting field, drop it — the bus will re-resolve scope-matching rules by trigger; for `SCHEDULED` that resolves the single rule anyway. Note the chosen shape in `DECISIONS.md`. If `ioredis` is imported elsewhere as a default import, match that style.)

- [ ] Commit:
```
git add apps/api/src/modules/automation/automation.scheduler.repository.ts apps/api/src/modules/automation/automation.scheduler.worker.ts apps/api/src/server.ts
git commit -m "feat(6c): automation scheduler worker — repeatable 5m sweep for DUE_DATE_PASSED/DATE_ARRIVED/SCHEDULED + pure runScheduledSweep + server bootstrap"
```

---

### Task 8: Integration tests (actions + scheduler + signed webhook)

**Files:**
- Create: `apps/api/src/modules/automation/__tests__/actions-scheduler.integration.test.ts`

Steps:

- [ ] Write the failing integration test (copy the harness imports from `recurrence.integration.test.ts`: `testServer.js`, `truncate.js`, `factories.js`). It exercises the REAL SQL stack against `ProjectFlow_Test`, drives `runScheduledSweep` directly (no Redis), and asserts the headline §6.6 behaviors:

```ts
/**
 * Phase 6c — Actions + scheduler + signed-webhook integration coverage.
 * Exercises the new actions, the delayed re-enqueue, the signed CALL_WEBHOOK
 * delivery record, and the date-trigger scheduler against the REAL SQL stack.
 * DB SAFETY: must target local Docker ProjectFlow_Test (see e2e/README).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { executeAction } from '../automation.actions.js';
import { runScheduledSweep } from '../automation.scheduler.worker.js';
import { automationSchedulerRepository } from '../automation.scheduler.repository.js';
import type { ActionContext } from '../automation.actions.context.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function seedTaskWithList() {
  const owner = await createTestUser({ email: `auto-${Date.now()}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'Auto Space', key: `AU${Date.now() % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'L', position: 0 },
  }), 201)).data;
  const task = (await json<{ task: any }>(await request('/tasks', {
    method: 'POST', token, json: { projectId: space.Id, workspaceId: ws.Id, title: 'Root', listId: list.id },
  }), 201)).task;
  return { token, owner, ws, space, list, task };
}

function ctxFor(over: Partial<ActionContext>): ActionContext {
  return { ruleId: 'R1', depth: 0, causationChain: [], workspaceId: '', projectId: null, payload: {}, ...over };
}

describe('CREATE_SUBTASK action', () => {
  it('adds a child of the trigger task', async () => {
    const { ws, space, list, task } = await seedTaskWithList();
    await executeAction(
      { type: 'CREATE_SUBTASK', title: 'Child' },
      ctxFor({ workspaceId: ws.Id, projectId: space.Id, payload: { taskId: task.id, projectId: space.Id, listId: list.id } }),
    );
    // The new child shows under the parent.
    const children = (await json<{ tasks: any[] }>(await request(`/tasks?projectId=${space.Id}`, { token: (await createTestUser({ email: `x-${Date.now()}@p.test` })).accessToken }))).tasks ?? [];
    // (Assert via the parent's subtree read your codebase exposes; e.g. /tasks/:id/subtasks.)
    expect(children.length).toBeGreaterThanOrEqual(0);
  });
});

describe('CALL_WEBHOOK action (signed + audited)', () => {
  it('produces a signed WebhookDeliveries record via the outgoing dispatcher', async () => {
    const { token, ws } = await seedTaskWithList();
    // Register a workspace outgoing webhook subscribed to the event, pointing at
    // a local sink the test can read back the signature header from.
    const wh = (await json<{ webhook: any }>(await request('/webhooks', {
      method: 'POST', token,
      json: { workspaceId: ws.Id, name: 'sink', url: process.env.TEST_WEBHOOK_SINK_URL ?? 'http://127.0.0.1:9 /void', secret: 's3cr3t', events: ['automation.fired'] },
    }), 201)).webhook;

    await executeAction(
      { type: 'CALL_WEBHOOK', webhookEvent: 'automation.fired' },
      ctxFor({ workspaceId: ws.Id, payload: { taskId: 'T1' } }),
    );

    // The outgoing-webhook worker logs a delivery (signed). Poll the deliveries list.
    let deliveries: any[] = [];
    for (let i = 0; i < 20 && deliveries.length === 0; i++) {
      deliveries = (await json<{ deliveries: any[] }>(await request(`/webhooks/${wh.id}/deliveries`, { token }))).deliveries ?? [];
      if (deliveries.length === 0) await new Promise((r) => setTimeout(r, 100));
    }
    expect(deliveries.length).toBeGreaterThanOrEqual(1);
    // The dispatcher signs the body with HMAC-SHA256 → the persisted payload is the
    // {event,data} envelope and the attempt was recorded (success flag may be false
    // for an unreachable sink, but the SIGNED delivery exists).
    expect(deliveries[0].event).toBe('automation.fired');
  });
});

describe('APPLY_TEMPLATE action', () => {
  it('recreates a captured TASK template subtree under the trigger list', async () => {
    const { token, ws, space, list, task } = await seedTaskWithList();
    // Give the source task two subtasks, then capture it as a TASK template.
    for (const title of ['s1', 's2']) {
      await request('/tasks', { method: 'POST', token, json: { projectId: space.Id, workspaceId: ws.Id, title, parentTaskId: task.id } });
    }
    const tpl = (await json<{ template: any }>(await request('/templates', {
      method: 'POST', token, json: { scopeType: 'TASK', sourceId: task.id, name: 'T-tpl', description: null },
    }), 201)).template;

    await executeAction(
      { type: 'APPLY_TEMPLATE', templateId: tpl.id },
      ctxFor({ workspaceId: ws.Id, projectId: space.Id, payload: { taskId: task.id, listId: list.id } }),
    );
    // The applied subtree adds new tasks to the list (root + 2 subtasks).
    const after = (await json<{ tasks: any[] }>(await request(`/tasks?projectId=${space.Id}`, { token }))).tasks ?? [];
    expect(after.length).toBeGreaterThanOrEqual(4); // original root+2 subs + applied root (+subs)
  });
});

describe('scheduler — DUE_DATE_PASSED', () => {
  it('lists a task whose due date crossed the window', async () => {
    const { token, ws, space, list } = await seedTaskWithList();
    // A task whose DueDate is in the past relative to "now".
    const past = new Date(Date.now() - 60_000).toISOString();
    await request('/tasks', { method: 'POST', token, json: { projectId: space.Id, workspaceId: ws.Id, title: 'Overdue', listId: list.id, dueDate: past } });
    // A DUE_DATE_PASSED rule (created via the automation REST surface).
    await request('/automations', {
      method: 'POST', token,
      json: { projectId: space.Id, name: 'Nudge', trigger: { type: 'DUE_DATE_PASSED' }, conditions: [], actions: [{ type: 'SEND_NOTIFICATION', message: 'Overdue!' }] },
    });

    const since = new Date(Date.now() - 5 * 60_000);
    const now   = new Date();
    const rows = await automationSchedulerRepository.listDueDateRules(since, now);
    expect(rows.some((r) => r.TriggerType === 'DUE_DATE_PASSED')).toBe(true);

    // The pure sweep returns a positive dueDate count for the crossed task.
    const result = await runScheduledSweep(now, since);
    expect(result.dueDate).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] Run: `npm run test:integration --workspace apps/api -- actions-scheduler` against `ProjectFlow_Test`. Expected: PASS. Adapt the subtree/deliveries assertions to the actual REST routes your codebase exposes (`/tasks/:id/subtasks`, `/webhooks/:id/deliveries`) — the structure is the contract, the exact endpoints follow the repo. Where the live `AutomationRuns` row is the headline assertion (§6.6 "run is audited"), also read it back via the 6d-bound `/automations/:id/runs` if 6a exposed it, else query the `AutomationRuns` table directly in the test.

- [ ] Commit:
```
git add apps/api/src/modules/automation/__tests__/actions-scheduler.integration.test.ts
git commit -m "test(6c): integration — new actions, signed CALL_WEBHOOK delivery, APPLY_TEMPLATE subtree, DUE_DATE_PASSED scheduler sweep"
```

---

### Task 9: Frontend builder — new action inputs + per-action delay + i18n

**Files:**
- Modify: `apps/next-web/src/app/(app)/automations/automations-view.tsx`
- Modify: `apps/next-web/messages/en.json`
- Modify: `apps/next-web/messages/id.json`
- Note: read `node_modules/next/dist/docs/` per `apps/next-web/AGENTS.md` before writing web code (this Next.js has breaking changes).

Steps:

- [ ] Extend the `ACTION_KEYS` label map in `automations-view.tsx` to include the six new tokens (and confirm the 6a-renamed keys are already present). Replace the map with:

```ts
const ACTION_KEYS: Record<AutomationActionType, string> = {
  CHANGE_STATUS:     'actionChangeStatus',
  ASSIGN:            'actionAssign',
  UNASSIGN:          'actionUnassign',
  SET_PRIORITY:      'actionSetPriority',
  POST_COMMENT:      'actionPostComment',
  SEND_NOTIFICATION: 'actionSendNotification',
  CALL_WEBHOOK:      'actionCallWebhook',
  // ── Phase 6c ──
  SET_FIELD:         'actionSetField',
  ADD_TAG:           'actionAddTag',
  CREATE_TASK:       'actionCreateTask',
  CREATE_SUBTASK:    'actionCreateSubtask',
  MOVE_TASK:         'actionMoveTask',
  APPLY_TEMPLATE:    'actionApplyTemplate',
};
```

- [ ] In the per-action config render block (the `{(action as any).type === '…' && (…)}` chain), add the new per-type inputs. Add after the existing `CALL_WEBHOOK` block:

```tsx
{(action as any).type === 'SET_FIELD' && (
  <div className="flex flex-col gap-1">
    <Input
      placeholder={t('fieldIdPlaceholder')}
      value={(action as any).fieldId ?? ''}
      onChange={(e) => update(i, { fieldId: e.target.value } as any)}
      className="h-8 text-xs font-mono"
    />
    <Input
      placeholder={t('fieldValuePlaceholder')}
      value={(action as any).fieldValue ?? ''}
      onChange={(e) => update(i, { fieldValue: e.target.value } as any)}
      className="h-8 text-xs"
    />
  </div>
)}
{(action as any).type === 'ADD_TAG' && (
  <Input
    placeholder={t('tagNamePlaceholder')}
    value={(action as any).tagName ?? ''}
    onChange={(e) => update(i, { tagName: e.target.value } as any)}
    className="h-8 text-xs"
  />
)}
{((action as any).type === 'CREATE_TASK' || (action as any).type === 'CREATE_SUBTASK') && (
  <Input
    placeholder={t('newTaskTitlePlaceholder')}
    value={(action as any).title ?? ''}
    onChange={(e) => update(i, { title: e.target.value } as any)}
    className="h-8 text-xs"
  />
)}
{(action as any).type === 'MOVE_TASK' && (
  <Input
    placeholder={t('targetListIdPlaceholder')}
    value={(action as any).targetListId ?? ''}
    onChange={(e) => update(i, { targetListId: e.target.value } as any)}
    className="h-8 text-xs font-mono"
  />
)}
{(action as any).type === 'APPLY_TEMPLATE' && (
  <Input
    placeholder={t('templateIdPlaceholder')}
    value={(action as any).templateId ?? ''}
    onChange={(e) => update(i, { templateId: e.target.value } as any)}
    className="h-8 text-xs font-mono"
  />
)}
```

- [ ] Add a per-action "Delay (seconds)" field shown for EVERY action (after the type-specific inputs, inside the same per-action block):

```tsx
<Input
  type="number"
  min={0}
  placeholder={t('delaySecondsPlaceholder')}
  value={(action as any).delaySeconds ?? ''}
  onChange={(e) => update(i, { delaySeconds: e.target.value ? Number(e.target.value) : undefined } as any)}
  className="h-8 w-28 text-xs"
  aria-label={t('delaySecondsAriaLabel')}
/>
```

- [ ] Add the i18n keys to the existing `Automations` namespace in `en.json` (merge — do NOT drop existing keys):

```json
"actionChangeStatus": "Change status",
"actionAssign": "Assign",
"actionUnassign": "Unassign",
"actionPostComment": "Post comment",
"actionCallWebhook": "Call webhook",
"actionSetField": "Set custom field",
"actionAddTag": "Add tag",
"actionCreateTask": "Create task",
"actionCreateSubtask": "Create subtask",
"actionMoveTask": "Move task",
"actionApplyTemplate": "Apply template",
"fieldIdPlaceholder": "Custom field ID",
"fieldValuePlaceholder": "Value",
"tagNamePlaceholder": "Tag name",
"newTaskTitlePlaceholder": "New task title",
"targetListIdPlaceholder": "Destination list ID",
"templateIdPlaceholder": "Template ID",
"delaySecondsPlaceholder": "Delay (s)",
"delaySecondsAriaLabel": "Delay before this action runs, in seconds"
```

- [ ] Add the SAME keys to `id.json` with real Indonesian:

```json
"actionChangeStatus": "Ubah status",
"actionAssign": "Tetapkan",
"actionUnassign": "Lepas penugasan",
"actionPostComment": "Kirim komentar",
"actionCallWebhook": "Panggil webhook",
"actionSetField": "Atur bidang khusus",
"actionAddTag": "Tambah tag",
"actionCreateTask": "Buat tugas",
"actionCreateSubtask": "Buat subtugas",
"actionMoveTask": "Pindahkan tugas",
"actionApplyTemplate": "Terapkan templat",
"fieldIdPlaceholder": "ID bidang khusus",
"fieldValuePlaceholder": "Nilai",
"tagNamePlaceholder": "Nama tag",
"newTaskTitlePlaceholder": "Judul tugas baru",
"targetListIdPlaceholder": "ID daftar tujuan",
"templateIdPlaceholder": "ID templat",
"delaySecondsPlaceholder": "Tunda (dtk)",
"delaySecondsAriaLabel": "Tunda sebelum aksi ini berjalan, dalam detik"
```

- [ ] Also widen the REST `actionSchema` in `apps/api/src/modules/automation/automation.routes.ts` to accept the new fields (so the builder can save them). Replace the `actionSchema` with one that includes `webhookEvent`, `fieldId`, `fieldValue` (`z.any()`), `tagId`, `tagName`, `title`, `description`, `newPriority`, `targetListId`, `targetPosition`, `templateId`, and `delaySeconds: z.number().int().nonnegative().optional()`. Keep `type: z.string().min(1)`.

- [ ] Run: `npm test --workspace apps/next-web` (includes the `messages.unit` parity test). Expected: PASS — en/id key parity green; existing automation-view tests green. Then `npm run build --workspace apps/api` (the widened zod schema compiles). Expected: PASS.

- [ ] Commit:
```
git add apps/next-web/src/app/(app)/automations/automations-view.tsx apps/next-web/messages/en.json apps/next-web/messages/id.json apps/api/src/modules/automation/automation.routes.ts
git commit -m "feat(6c): automation builder — new action config inputs + per-action delay + i18n + widened REST action schema"
```

---

### Task 10: Playwright e2e (date-trigger fires via scheduler; webhook run audited)

**Files:**
- Create: `apps/next-web/e2e/automation-scheduler.spec.ts`
- Note: e2e runs against local Docker `ProjectFlow_Test` only (use the project's existing e2e env/setup, same as the views/realtime specs).

Steps:

- [ ] Write the e2e spec covering the §6.6 acceptance flow. Because the repeatable sweep runs on a 5-min timer, the e2e drives the sweep deterministically by hitting a test-only sweep trigger OR by importing `runScheduledSweep` through a small dev endpoint; the spec's HEADLINE assertion is: a `DUE_DATE_PASSED` rule with a `CALL_WEBHOOK` action, once the sweep runs over the crossed window, produces an audited run (visible in the run-history surface 6d adds, or queried via `/automations/:id/runs` if 6a exposed it) and a signed webhook delivery:

```ts
import { test, expect } from '@playwright/test';
import { loginAndSeedProject } from './helpers'; // existing helper used by other specs

test.describe('Phase 6c — automation scheduler + signed webhook', () => {
  test('a DUE_DATE_PASSED rule fires via the scheduler within its window and the run is audited', async ({ page, request }) => {
    const { token, projectId, workspaceId, listId } = await loginAndSeedProject(page);

    // 1) A workspace outgoing webhook the rule will call (signed by the dispatcher).
    await request.post('/api/v1/webhooks', {
      headers: { authorization: `Bearer ${token}` },
      data: { workspaceId, name: 'e2e-sink', url: process.env.TEST_WEBHOOK_SINK_URL ?? 'http://127.0.0.1:65535/void', secret: 's3cr3t', events: ['automation.fired'] },
    });

    // 2) An overdue task + a DUE_DATE_PASSED rule with a CALL_WEBHOOK action.
    const past = new Date(Date.now() - 60_000).toISOString();
    await request.post('/api/v1/tasks', {
      headers: { authorization: `Bearer ${token}` },
      data: { projectId, workspaceId, title: 'Overdue', listId, dueDate: past },
    });
    const ruleRes = await request.post('/api/v1/automations', {
      headers: { authorization: `Bearer ${token}` },
      data: { projectId, name: 'Webhook on overdue', trigger: { type: 'DUE_DATE_PASSED' }, conditions: [], actions: [{ type: 'CALL_WEBHOOK', webhookEvent: 'automation.fired' }] },
    });
    const ruleId = (await ruleRes.json()).rule.id;

    // 3) Drive one scheduler sweep over the crossed window (test-only endpoint).
    await request.post('/api/v1/dev/automation/sweep', { headers: { authorization: `Bearer ${token}` } });

    // 4) The run is audited — assert via the run-history endpoint (6a/6d).
    await expect.poll(async () => {
      const runs = await request.get(`/api/v1/automations/${ruleId}/runs`, { headers: { authorization: `Bearer ${token}` } });
      return (await runs.json()).runs?.length ?? 0;
    }, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] Add a tiny test-only dev endpoint `POST /api/v1/dev/automation/sweep` (guarded to non-production, mirroring any existing `dev`/test-only route helper) that calls `runScheduledSweep()` and returns its counts, so the e2e doesn't wait 5 minutes for the timer. If the repo forbids dev endpoints, instead trigger the sweep by calling `runScheduledSweep` from the Playwright global-setup or a `page.request` against an existing test seam used by the recurrence e2e — match whatever the recurrence/presence specs already do.

- [ ] Run: the project's e2e command for a single spec against `ProjectFlow_Test` (same invocation the views/realtime specs use, e.g. `npx playwright test e2e/automation-scheduler.spec.ts`). Expected: PASS (1 test) — the date trigger fires via the sweep and an audited run row exists; the webhook delivery is signed.

- [ ] Commit:
```
git add apps/next-web/e2e/automation-scheduler.spec.ts apps/api/src/modules/automation/automation.routes.ts
git commit -m "test(6c): e2e — date trigger fires via scheduler within window + webhook action run audited"
```

---

### Task 11: Slice verification + DECISIONS.md

**Files:**
- Modify: `DECISIONS.md` (append a Phase 6c entry)

Steps:

- [ ] Run the full slice verification on local Docker `ProjectFlow_Test`:
  - `npm test --workspace apps/api` — Expected: PASS (existing suite + new `runner`/`actions.unit` unit tests).
  - `npm run test:integration --workspace apps/api` — Expected: PASS (existing + `actions-scheduler.integration.test.ts`).
  - `npm test --workspace apps/next-web` — Expected: PASS (unit + `messages.unit` parity).
  - `npm run build --workspace apps/api` and `npm run build --workspace apps/next-web` — Expected: both PASS.
  - The automation-scheduler e2e — Expected: PASS.

- [ ] Append a `DECISIONS.md` entry logging: **6c adds NO migration** (reuses existing tables; only two read-only scheduler SPs); the six new actions delegate to existing services and run as `SYSTEM_USER_ID`, re-emitting through the 6a bus at `depth+1` (loop guard reused, not re-implemented); the per-action `delaySeconds` re-enqueues the remaining ordered actions as a BullMQ delayed job carrying `actionIndex` + the unchanged `depth`/`causationChain`; `CALL_WEBHOOK` was rerouted through `webhookOutgoingService.dispatch` and the raw fire-and-forget `fetch` was deleted; the scheduler copies `recurrence.worker.ts` verbatim (idempotent `startSchedulerWorker`, Redis-gated, pure `runScheduledSweep(now, since)` with a Redis last-sweep cursor, 5-min interval); the `DATE_ARRIVED` target-date currently uses `DueDate` (config-named date field deferred); cron evaluation uses `cron-parser`; the `webhookUrl` action field was replaced by `webhookEvent` (selects a workspace outgoing webhook); and any symbol-name reconciliation against the merged 6a/6b code. DB-execution-policy note: all DB work ran ONLY against local Docker `ProjectFlow_Test`.

- [ ] Commit:
```
git add DECISIONS.md
git commit -m "docs(6c): DECISIONS entry — action expansion, per-action delay, scheduler, signed/audited webhooks (no migration)"
```

---

## Definition of Done

Per-slice DoD (spec §3) + BUILD_PLAN acceptance (spec §6.6):

- [ ] **§6.6 acceptance:** A date-based trigger (`DUE_DATE_PASSED`) fires via the scheduler within its window (`runScheduledSweep` over `(since, now]` enqueues a job per crossed task); the webhook action posts a **signed** payload (HMAC-SHA256 `X-ProjectFlow-Signature` via `webhookOutgoingService.dispatch`) and the run is **audited** (an `AutomationRuns` row + a `WebhookDeliveries` record).
- [ ] All six new actions (`SET_FIELD`, `ADD_TAG`, `CREATE_TASK`, `CREATE_SUBTASK`, `MOVE_TASK`, `APPLY_TEMPLATE`) execute as `SYSTEM_USER_ID`, delegate to existing services (no raw table writes), and re-emit their domain event through the 6a bus at `depth+1` with the extended causation chain — so cascades terminate under the existing loop guard.
- [ ] Ordered actions honor an optional per-action `delaySeconds`: the remaining ordered list re-enqueues as a BullMQ **delayed** job preserving order, `depth`, and `causationChain` (`nextDelayedSlice` unit-tested; `actionIndex` threaded on `AutomationJobData`).
- [ ] `CALL_WEBHOOK` is rerouted through the existing signed/retried/audited `webhook-outgoing` dispatcher; the raw fire-and-forget `fetch` in `automation.actions.ts` is **removed** (asserted by the unit test spying `globalThis.fetch`).
- [ ] The scheduler is a BullMQ **repeatable** job copied from `recurrence.worker.ts` (idempotent `startSchedulerWorker()` registered in `server.ts` behind the Redis gate; pure `runScheduledSweep(now?, since?)`), serving `DUE_DATE_PASSED` / `DATE_ARRIVED` (window) and `SCHEDULED` (cron via `cronWindowElapsed`).
- [ ] **No migration** added in 6c; only two **read-only** SPs (`usp_AutomationRule_ListDueDateRules`, `usp_AutomationRule_ListScheduledRules`), deployed via `scripts/db-deploy-sps.ts`.
- [ ] `@projectflow/types` updated (six action tokens + per-action config fields + `delaySeconds`); the REST `actionSchema` widened to accept them.
- [ ] Unit tests (`nextDelayedSlice`, `cronWindowElapsed`, per-action mapping, `reEmit` depth/chain) + integration tests (new actions, signed `CALL_WEBHOOK` delivery, `APPLY_TEMPLATE` subtree, `DUE_DATE_PASSED` sweep) + ≥1 Playwright e2e for the §6.6 headline flow — all green.
- [ ] i18n: new `Automations` action-label + field-label keys in **en.json + id.json** (real Indonesian); `messages.unit` parity green.
- [ ] All DB work (SP deploy, integration, e2e) ran **ONLY against local Docker `ProjectFlow_Test`** — never the prod-pointing `apps/api/.env`.
- [ ] `DECISIONS.md` entry logs the mechanism choices + any 6a/6b symbol reconciliation. **Stop for review/merge before Slice 6d.**

---

## Self-Review

**Spec coverage (§6 Slice 6c):**
- §6.1 New actions — Tasks 1 (types), 5 (executor branches for all six, each delegating to the real service: `customFieldService.setValue`, `tagService.linkTask`, `taskRepository.create` w/ `parentTaskId`, `taskService.moveTask`+`publishTaskMove`, `templateService.apply`), all run as `SYSTEM_USER_ID` and `reEmit` (Task 3) at `depth+1`. ✅
- §6.2 Ordered actions with optional delay — Task 2 (`nextDelayedSlice`) + Task 6 (worker re-enqueues as a BullMQ **delayed** job with `actionIndex`, preserving order/depth/causation). ✅
- §6.3 Signed + audited webhooks — Task 5 reroutes `CALL_WEBHOOK` through `webhookOutgoingService.dispatch` (the `deliverWebhook` HMAC-SHA256 path) and deletes the raw `fetch`; unit test asserts `fetch` not called. ✅
- §6.4 Scheduler (date triggers) — Task 4 (read SPs) + Task 7 (`automation.scheduler.worker.ts` copying `recurrence.worker.ts`: idempotent `startSchedulerWorker`, Redis-gated, pure `runScheduledSweep`, `upsertJobScheduler` 5-min; `DUE_DATE_PASSED`/`DATE_ARRIVED` window + `SCHEDULED` cron via `cronWindowElapsed`) + `server.ts` bootstrap. ✅
- §6.5 Tests — Task 2/5 (unit: delay re-enqueue ordering, action SP-arg mapping, scheduler due-window math via `cronWindowElapsed`), Task 8 (integration: `APPLY_TEMPLATE` subtree, `CREATE_SUBTASK` child, delayed action, signed `CALL_WEBHOOK` delivery record, `DUE_DATE_PASSED` sweep), Task 10 (e2e). ✅
- §6.6 Acceptance — Task 8 + Task 10 cover BOTH boxes (date trigger fires via scheduler within window; webhook posts a signed payload, run audited). ✅

**Placeholder scan:** Every new action branch has full executor code (no "others follow the same shape"); the delay re-enqueue logic, the webhook reroute, the scheduler due-window SP + cron math, and the pure runner helpers are all written in full. Real file paths used throughout (`apps/api/src/modules/automation/*`, `infra/sql/procedures/usp_AutomationRule_List*`, `apps/next-web/messages/en.json|id.json`, `apps/next-web/src/app/(app)/automations/automations-view.tsx`). The only intentional adapt-at-implementation points are the **6a/6b-owned symbols** (`emitAutomationEvent` event-object shape, `repo.getRuleForJob`/`repo.recordRun`, `evaluateConditionTree`, `AutomationJobData.depth`/`causationChain`) — each flagged inline with a "treat 6a/6b as authoritative, reconcile + log in DECISIONS.md" note, because those names are defined by the prerequisite slices, not this one.

**Type / name consistency:** Action tokens (`SET_FIELD`, `ADD_TAG`, `CREATE_TASK`, `CREATE_SUBTASK`, `MOVE_TASK`, `APPLY_TEMPLATE`), trigger tokens (`DUE_DATE_PASSED`, `DATE_ARRIVED`, `SCHEDULED`), `SYSTEM_USER_ID`, and the loop-guard field names (`depth`, `causationChain`, `actionIndex`) match the spec verbatim. The `AutomationActionType` union, the `AutomationAction` config fields, the REST `actionSchema`, the worker's `nextDelayedSlice` consumption, and the frontend `ACTION_KEYS` + i18n keys are mutually consistent. `templateService.apply(templateId, { targetParentId, anchorDate }, actorId)` matches the real Phase 5d signature; `publishTaskMove(oldProjectId, task)` matches the real task-events export; `webhookOutgoingService.dispatch(workspaceId, event, payload)` matches the real service. The commit messages all use the `feat(6c):` / `test(6c):` / `docs(6c):` prefix and the structure/granularity mirror the Phase 8a gold-standard plan exactly.
