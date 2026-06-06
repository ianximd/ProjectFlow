# Phase 5c — Recurring Tasks Implementation Plan

> Execute via subagent-driven-development. Reference design spec
> `docs/superpowers/specs/2026-06-06-phase5-deps-relationships-recurring-templates-design.md` §5.
> Follow patterns from 5a/5b (DECISIONS.md §5a/§5b). DB only on local Docker `ProjectFlow_Test`.

**Goal:** Recurring tasks — a recurrence rule per task that regenerates the next occurrence **on completion**
AND on a **scheduled** BullMQ sweep.

**Architecture:** New `TaskRecurrences` table (rule JSON + mode + NextRunAt). Pure `computeNextOccurrence`.
Spawn = clone the task (via the service, reusing existing create/copy SPs) with remapped dates + reset status.
On-complete trigger in `task.service.transitionTask`; scheduled trigger via a BullMQ repeatable worker
(mirror `oauth-maintenance.worker.ts`). Dual REST + GraphQL; ACL = EDIT on the task's list.

---

## Batch 1 — Backend (DB + compute + spawn + triggers + worker + API)
**Migration `0036_recurrences.sql`** (+ rollback):
```
TaskRecurrences(
  Id PK DEFAULT NEWID(), TaskId UNIQUEIDENTIFIER NOT NULL, WorkspaceId UNIQUEIDENTIFIER NOT NULL,
  Rule NVARCHAR(MAX) NOT NULL,                 -- JSON
  RegenerateMode NVARCHAR(20) NOT NULL,        -- 'on_complete' | 'schedule' | 'both'
  NextRunAt DATETIME2 NULL, Active BIT NOT NULL DEFAULT 1,
  LastSpawnedTaskId UNIQUEIDENTIFIER NULL, IncludeDependencies BIT NOT NULL DEFAULT 0,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  DeletedAt DATETIME2 NULL
)
-- UNIQUE filtered index on TaskId WHERE DeletedAt IS NULL (one active recurrence per task);
-- index (Active, NextRunAt) for the scheduler sweep.
```

**`computeNextOccurrence(rule, from): Date | null`** (pure; `apps/api/src/modules/recurrence/recurrence.ts`):
Rule `{ freq:'daily'|'weekly'|'monthly'|'yearly', interval:number, byWeekday?:number[] (0=Sun), byMonthday?:number, endsAt?:ISO, count?:number }`. Compute the next date strictly after `from`. Handle: interval>1; weekly byWeekday (next matching weekday); monthly byMonthday with **month-end clamp** (e.g. day 31 → last day of short months); `endsAt` (return null past it). `count` is enforced by the caller via an occurrence counter (or store remaining count) — keep `computeNextOccurrence` pure on freq/interval/byX/endsAt; document count handling. **Unit-test heavily.**

**Spawn (service-composed; prefer reusing existing SPs over a monolith):** in `recurrence.service.spawnNext(recurrenceId)`:
- read the source task; create a clone via `usp_Task_Create` (same list/type/title/desc/priority/estimate) with the new start/due (shift by the rule from the source's dates); reset status to the list's default/first effective status.
- copy whatever task sub-objects EXIST (verify in the schema first): custom-field values, assignees, watchers, tags. Subtasks/checklists cloning is OPTIONAL — skip for v1 unless trivially available; note the deferral.
- `IncludeDependencies` (default off) controls whether dependency edges are cloned.
- update `TaskRecurrences.LastSpawnedTaskId` + advance `NextRunAt = computeNextOccurrence(rule, now)`; deactivate when the rule has ended (endsAt/count exhausted).
- publish `publishTaskEvent('created', { projectId, task })` for the new task.
A thin `usp_TaskRecurrence_*` set (Get/SetForTask/Clear/ListDue/AdvanceAfterSpawn) handles persistence.

**On-complete trigger:** in `task.service.transitionTask`, AFTER a successful transition to a DONE-group
status, if the task has an active recurrence with mode incl. `on_complete`, call `recurrence.service.spawnNext`
fire-and-forget (try/catch; never block/fault the transition). Reuse the 5a done-group gate.

**Scheduled trigger:** `apps/api/src/modules/recurrence/recurrence.worker.ts` — BullMQ Queue + repeatable
job (e.g. every 15 min via `upsertJobScheduler`) + Worker that sweeps `usp_TaskRecurrence_ListDue` (Active,
mode incl 'schedule', NextRunAt <= now) and spawns each. Bootstrap in the server start path next to the oauth
worker; conditional on Redis configured. Mirror `oauth-maintenance.worker.ts` exactly (connection,
removeOnComplete, registerCloser).

**API:** REST `GET/PUT/DELETE /tasks/:taskId/recurrence` (PUT body `{ rule, regenerateMode, includeDependencies? }`) + GraphQL `taskRecurrence`/`setTaskRecurrence`/`clearTaskRecurrence`. ACL: VIEW to read, `task.update`/EDIT to set. Validate the rule (freq/interval/etc.) → 422 on bad rule.

**Types** (`packages/types/index.ts`): `RecurrenceRule`, `RecurrenceMode`, `TaskRecurrence`.

**Verify (local Docker):** migrate + deploy SPs (0 failed); apps/api tsc clean; unit green (+ computeNextOccurrence tests); integration green.

## Batch 2 — Frontend
- Recurrence editor in `TaskDrawer` (freq / interval / weekday(s) / monthday / end-condition / mode) using server actions hitting the REST recurrence endpoints; a recurring badge on tasks that have an active recurrence. i18n `Recurrence` namespace en/id (parity). Verify web unit + parity + tsc/build.

## Batch 3 — Tests + close
- Integration: set a rule → transition the task to Done → a next occurrence is spawned with remapped dates + copied fields/assignees + reset status; scheduled sweep (`ListDue` + spawnNext) spawns due rows and advances `NextRunAt`; `endsAt`/`count` termination deactivates. Cross-workspace guards as applicable.
- e2e `recurring.spec.ts`: set a weekly recurrence on a task, complete it, assert a new instance exists (assert via the task list / API-then-UI).
- Consolidated review → fixes → full verify → `DECISIONS.md` §5c + memory → ff-merge to main locally.

## Acceptance (spec §5.7)
- [ ] Recurring task regenerates correctly with the chosen rule.

## Carry-forward guards
- Workspace-scope all recurrence SPs/queries; spawn within the source task's workspace only.
- No `export type` re-exports from `'use server'` files (Turbopack crash).
- Recursive CTEs (if any) use `UNION ALL`.
