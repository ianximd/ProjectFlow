# Phase 6a — Engine Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the dormant Phase 4 (`0009`) automation engine so rules actually fire — wire typed domain events from the service layer into the existing `automation` BullMQ queue, rename the legacy Jira-style enums to ClickUp BUILD_PLAN semantics, add PROJECT + WORKSPACE rule scope, an `AutomationRuns` audit + `AutomationUsage` meter, an infinite-loop guard, and a GraphQL mirror over the shared service.

**Architecture:** A thin `automation.bus.ts#emitAutomationEvent(event)` replaces the never-called `AutomationService.enqueueForEvent`. `task.service` (create / `transitionTask` / `updateTask`) and `comment.service.create` call it **after commit, best-effort** (mirroring `publishTaskEvent`). The bus resolves scope-matching enabled rules via a rewritten scope-aware `usp_AutomationRule_GetByTrigger` and enqueues one job per rule (carrying `{ depth, causationChain }`) onto the existing started-in-`server.ts` `automation` worker, which now writes an `AutomationRuns` row per job and bumps `AutomationUsage`. The loop guard drops enqueues at `depth >= MAX_DEPTH` (5) or when a rule id is already in the causation chain, plus a short Redis `(ruleId, entityId)` cooldown. Realtime `publishTaskEvent` stays separate — both fire from the same service methods.

**Tech Stack:** SQL Server stored procedures (`CREATE OR ALTER`, `SET NOCOUNT ON`, TRY/CATCH/TRANSACTION, `SELECT *` of affected rows); idempotent GO-batched migrations (+ `rollback/*.down.sql`); `mssql` via `execSpOne`; BullMQ (`automation` queue/worker) + ioredis (`getRedis`) cooldown; Hono REST + `@hono/zod-validator`; graphql-yoga + Pothos (`builder.objectRef`/`queryFields`/`mutationFields`) registered in `apps/api/src/graphql/schema.ts`; vitest (`--project unit` / `--project integration`); Next.js App Router (SSR) + `next-intl` (en+id); Playwright e2e. DB work runs ONLY against local Docker `ProjectFlow_Test`.

**Prerequisite:** Phases 1–5 merged (on origin/main). Phase 6 builds on the legacy `0009` engine. Migrations on disk are `0001`–`0037`; this slice adds `0038`/`0039`.

---

## File Structure

**Migrations** (`infra/sql/migrations/`)
- `0038_automation_scope.sql` — **Create.** Add `ScopeType`/`WorkspaceId`/`ScopeId` to `AutomationRules`, relax `ProjectId` to NULL, backfill `WorkspaceId` from `Projects`, add `IX_AutomationRule_Scope`. Idempotent, GO-batched.
- `rollback/0038_automation_scope.down.sql` — **Create.** Reverse: drop the scope index + columns + the CHECK/DEFAULT constraints; restore `ProjectId NOT NULL`.
- `0039_automation_runs.sql` — **Create.** New `AutomationRuns` audit table + `AutomationUsage` meter table + their indexes; **folds in the taxonomy-rename data migration** (`UPDATE AutomationRules` rewriting enum tokens in the JSON config columns). Idempotent, GO-batched.
- `rollback/0039_automation_runs.down.sql` — **Create.** Reverse: drop `AutomationUsage`, `AutomationRuns`. (The data rewrite is one-way + defensive; the down script notes it is not reversed.)

**Stored procedures** (`infra/sql/procedures/`)
- `usp_AutomationRule_GetByTrigger.sql` — **Modify.** Scope-aware: match `IsEnabled=1 AND TriggerType=@Type AND ((ScopeType='PROJECT' AND ScopeId=@ProjectId) OR (ScopeType='WORKSPACE' AND ScopeId=@WorkspaceId))`. Add `@WorkspaceId` param.
- `usp_AutomationRule_Create.sql` — **Modify.** Add `@ScopeType`/`@WorkspaceId`; insert them; allow NULL `@ProjectId` for WORKSPACE rules.
- `usp_AutomationRun_Record.sql` — **Create.** Insert one `AutomationRuns` row (status/payload/actionResults/error/depth/duration); on a terminal status bump `AutomationUsage` for `(WorkspaceId, Period)`. Returns the inserted row.
- `usp_AutomationRun_ListByRule.sql` — **Create.** Newest-first paginated `AutomationRuns` for a rule.

**API** (`apps/api/src/`)
- `modules/automation/automation.bus.ts` — **Create.** `emitAutomationEvent(event)` + `AutomationDomainEvent` types + the loop-guard helpers (`shouldEnqueue`, `cooldownKey`).
- `modules/automation/automation.queue.ts` — **Modify.** Extend `AutomationJobData` with `workspaceId`, `depth`, `causationChain`.
- `modules/automation/automation.repository.ts` — **Modify.** Scope-aware `getByTrigger(projectId, workspaceId, triggerType)`; `create` threads scope; add `recordRun` / `listRunsByRule`; parse new `ScopeType`/`WorkspaceId` columns.
- `modules/automation/automation.service.ts` — **Modify.** `create` takes `scopeType`/`workspaceId`; add `listRuns`; **delete** the dead `enqueueForEvent`.
- `modules/automation/automation.worker.ts` — **Modify.** Read `workspaceId`/`depth`/`causationChain` from the job; write an `AutomationRuns` row (start→finish) with status/results; pass `depth+1`+extended chain into mutating actions; record `loop_blocked`/`skipped` rows.
- `modules/automation/automation.actions.ts` — **Modify.** Rename the action `switch` cases to the new tokens; accept a loop-guard `ctx` so task-mutating actions re-emit domain events with the incremented depth/chain. (Signed webhooks + new actions are 6c — `CALL_WEBHOOK` keeps the legacy `fetch` here.)
- `modules/automation/automation.conditions.ts` — **Modify.** Rename condition tokens consumed by `evaluateOne` (the OR/operator engine is 6b).
- `modules/automation/automation.routes.ts` — **Modify.** Accept `scopeType`/`workspaceId` in create; widen the GET to `projectId|workspaceId`; add `GET /automations/:id/runs`; rename zod enum hints.
- `modules/tasks/task.service.ts` — **Modify.** Emit `TASK_CREATED` (line ~62), `STATUS_CHANGED` (line ~181), `FIELD_CHANGED`/`ASSIGNEE_CHANGED` (line ~216) after commit.
- `modules/comments/comment.service.ts` — **Modify.** Emit `COMMENT_POSTED` after `repo.create` (line ~17).
- `graphql/automation.schema.ts` — **Create.** `registerAutomationGraphql()`: `AutomationRule`/`AutomationRun` types + `automationRules`/`automationRuns` queries + `create`/`update`/`toggle`/`deleteAutomationRule` mutations, delegating to the shared service.
- `graphql/schema.ts` — **Modify.** Import + call `registerAutomationGraphql()` near the other `register*Graphql()` calls (~line 774).

**Types** (`packages/types/`)
- `index.ts` — **Modify** (lines 378–451, the Automation Engine block). Rename the enum unions; add `AutomationScopeType`, `AutomationTriggerType` additions, `AutomationRun`; extend `AutomationRule` with `scopeType`/`workspaceId`.

**Frontend** (`apps/next-web/`)
- `src/app/(app)/automations/automations-view.tsx` — **Modify.** Rename `TRIGGER_KEYS`/`ACTION_KEYS`/`CONDITION_KEYS` tokens + their conditional branches; add a scope selector (This project / Entire workspace) driving `scopeType`.
- `src/server/actions/automations.ts` — **Modify.** Thread `scopeType`/`workspaceId` through `createAutomation`.
- `messages/en.json` — **Modify** (the `Automations` namespace, lines 414–500). Rename trigger/action/condition label keys; add scope-selector keys.
- `messages/id.json` — **Modify.** Same keys, real Indonesian.

**Tests**
- `apps/api/src/modules/automation/__tests__/loop-guard.unit.test.ts` — **Create.** `shouldEnqueue` depth/chain logic.
- `apps/api/src/modules/automation/__tests__/taxonomy.unit.test.ts` — **Create.** old→new token rewrite map.
- `apps/api/src/modules/automation/__tests__/engine.integration.test.ts` — **Create.** `STATUS_CHANGED → CHANGE_STATUS+ASSIGN` fires + `AutomationRuns` row; workspace-scoped rule fires across projects; self-referential rule is `loop_blocked`.
- `apps/next-web/e2e/automations.spec.ts` — **Create.** Build a rule in the builder, transition a task, observe the effect.

---

## Tasks

### Task 1: Migration `0038_automation_scope.sql` + rollback

**Files:**
- Create: `infra/sql/migrations/0038_automation_scope.sql`
- Create: `infra/sql/migrations/rollback/0038_automation_scope.down.sql`
- Test: manual deploy against local Docker `ProjectFlow_Test` (migrations have no unit harness; verified by the integration suite in Task 11).

Steps:

- [ ] Write the migration. Idempotent (`COL_LENGTH` / `sys.indexes` / `sys.check_constraints` guards), GO-batched, matching the `0037` style. `ScopeId` is a maintained (non-computed) column so it can be indexed and kept in sync by the SPs; `0038` backfills it. The existing `0009` `ProjectId` FK has `ON DELETE CASCADE` — relaxing it to NULL keeps the FK:

```sql
-- =============================================================================
-- Migration 0038: Automation scope (Phase 6a)
-- Extends AutomationRules from project-only to PROJECT + WORKSPACE scope:
--   * ScopeType  ('WORKSPACE' | 'PROJECT', default 'PROJECT')
--   * WorkspaceId (denormalized; backfilled from Projects via ProjectId)
--   * ProjectId relaxed to NULL (null when ScopeType='WORKSPACE')
--   * ScopeId (maintained column = WorkspaceId for WORKSPACE rules else ProjectId)
--   * IX_AutomationRule_Scope (ScopeType, ScopeId, IsEnabled) — the hot lookup
-- Idempotent (catalog guards), GO-batched.
-- Rollback in rollback/0038_automation_scope.down.sql.
-- =============================================================================

IF COL_LENGTH('dbo.AutomationRules', 'ScopeType') IS NULL
    ALTER TABLE dbo.AutomationRules
        ADD ScopeType NVARCHAR(12) NOT NULL
            CONSTRAINT DF_AutomationRules_ScopeType DEFAULT 'PROJECT';
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AutomationRules_ScopeType')
    ALTER TABLE dbo.AutomationRules
        ADD CONSTRAINT CK_AutomationRules_ScopeType CHECK (ScopeType IN ('WORKSPACE','PROJECT'));
GO

IF COL_LENGTH('dbo.AutomationRules', 'WorkspaceId') IS NULL
    ALTER TABLE dbo.AutomationRules ADD WorkspaceId UNIQUEIDENTIFIER NULL;
GO

-- Backfill WorkspaceId from the owning project for every existing (project-scoped) rule.
UPDATE ar
   SET ar.WorkspaceId = p.WorkspaceId
  FROM dbo.AutomationRules ar
  JOIN dbo.Projects        p ON p.Id = ar.ProjectId
 WHERE ar.WorkspaceId IS NULL;
GO

-- Now enforce NOT NULL on WorkspaceId (all rows are backfilled above).
IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID('dbo.AutomationRules')
             AND name = 'WorkspaceId' AND is_nullable = 1)
    ALTER TABLE dbo.AutomationRules ALTER COLUMN WorkspaceId UNIQUEIDENTIFIER NOT NULL;
GO

-- Relax ProjectId to NULL (workspace-scoped rules carry no project).
IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID('dbo.AutomationRules')
             AND name = 'ProjectId' AND is_nullable = 0)
    ALTER TABLE dbo.AutomationRules ALTER COLUMN ProjectId UNIQUEIDENTIFIER NULL;
GO

-- ScopeId — maintained column (not computed, so it is indexable + SP-maintained).
IF COL_LENGTH('dbo.AutomationRules', 'ScopeId') IS NULL
    ALTER TABLE dbo.AutomationRules ADD ScopeId UNIQUEIDENTIFIER NULL;
GO

-- Backfill ScopeId for existing rows (all PROJECT-scoped at this point).
UPDATE dbo.AutomationRules
   SET ScopeId = CASE WHEN ScopeType = 'WORKSPACE' THEN WorkspaceId ELSE ProjectId END
 WHERE ScopeId IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_AutomationRule_Scope'
                 AND object_id = OBJECT_ID('dbo.AutomationRules'))
    CREATE INDEX IX_AutomationRule_Scope
        ON dbo.AutomationRules (ScopeType, ScopeId, IsEnabled);
GO
```

- [ ] Write the rollback `rollback/0038_automation_scope.down.sql` (reverse order: index, then columns + their constraints; restore `ProjectId NOT NULL`):

```sql
-- Rollback 0038: automation scope.
-- Drops the scope index + columns (with their DEFAULT/CHECK constraints) and
-- restores ProjectId NOT NULL. Pre-existing rows are all PROJECT-scoped after a
-- forward apply, so restoring ProjectId NOT NULL is safe.

IF EXISTS (SELECT 1 FROM sys.indexes
           WHERE name = 'IX_AutomationRule_Scope'
             AND object_id = OBJECT_ID('dbo.AutomationRules'))
    DROP INDEX IX_AutomationRule_Scope ON dbo.AutomationRules;
GO

IF COL_LENGTH('dbo.AutomationRules', 'ScopeId') IS NOT NULL
    ALTER TABLE dbo.AutomationRules DROP COLUMN ScopeId;
GO

-- Restore ProjectId NOT NULL before dropping WorkspaceId (project-scoped only).
IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID('dbo.AutomationRules')
             AND name = 'ProjectId' AND is_nullable = 1)
    ALTER TABLE dbo.AutomationRules ALTER COLUMN ProjectId UNIQUEIDENTIFIER NOT NULL;
GO

IF COL_LENGTH('dbo.AutomationRules', 'WorkspaceId') IS NOT NULL
    ALTER TABLE dbo.AutomationRules DROP COLUMN WorkspaceId;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AutomationRules_ScopeType')
    ALTER TABLE dbo.AutomationRules DROP CONSTRAINT CK_AutomationRules_ScopeType;
GO
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_AutomationRules_ScopeType')
    ALTER TABLE dbo.AutomationRules DROP CONSTRAINT DF_AutomationRules_ScopeType;
IF COL_LENGTH('dbo.AutomationRules', 'ScopeType') IS NOT NULL
    ALTER TABLE dbo.AutomationRules DROP COLUMN ScopeType;
GO
```

- [ ] Run against local Docker `ProjectFlow_Test` only (explicit local DB env, never `apps/api/.env`). Run: apply `0038_automation_scope.sql` then immediately the `.down.sql` then re-apply `0038` to prove idempotency + reversibility. Expected: all three runs succeed with no errors; the second `0038` apply is a clean no-op (guards skip every step).

- [ ] Commit:
```
git add infra/sql/migrations/0038_automation_scope.sql infra/sql/migrations/rollback/0038_automation_scope.down.sql
git commit -m "feat(6a): automation scope migration — ScopeType/WorkspaceId/ScopeId + scope index"
```

---

### Task 2: Migration `0039_automation_runs.sql` (runs/usage + taxonomy rewrite) + rollback

**Files:**
- Create: `infra/sql/migrations/0039_automation_runs.sql`
- Create: `infra/sql/migrations/rollback/0039_automation_runs.down.sql`
- Test: manual deploy against local Docker `ProjectFlow_Test`; covered by Task 11 integration.

Steps:

- [ ] Write the migration. Two new tables + the idempotent taxonomy data rewrite. The `REPLACE` chain targets the known old→new tokens; it is bounded to rows that still contain an old token so a re-run is a no-op:

```sql
-- =============================================================================
-- Migration 0039: Automation runs + usage + taxonomy rewrite (Phase 6a)
--   * AutomationRuns  — per-execution audit (status/payload/results/error/depth)
--   * AutomationUsage — per-workspace per-month run counter
--   * Taxonomy rewrite — rename the legacy Jira-style enum tokens inside the
--     TriggerConfig/ConditionConfig/ActionConfig JSON to ClickUp semantics.
-- Idempotent (catalog guards; rewrite is token-bounded), GO-batched.
-- Rollback in rollback/0039_automation_runs.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AutomationRuns')
BEGIN
    CREATE TABLE dbo.AutomationRuns (
        Id            UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        RuleId        UNIQUEIDENTIFIER NOT NULL,
        WorkspaceId   UNIQUEIDENTIFIER NOT NULL,
        ProjectId     UNIQUEIDENTIFIER NULL,
        TriggerType   NVARCHAR(40)     NOT NULL,
        Status        NVARCHAR(16)     NOT NULL,   -- success|partial|failed|skipped|loop_blocked
        Payload       NVARCHAR(MAX)    NULL,
        ActionResults NVARCHAR(MAX)    NULL,
        Error         NVARCHAR(MAX)    NULL,
        Depth         INT              NOT NULL DEFAULT 0,
        StartedAt     DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        FinishedAt    DATETIME2        NULL,
        DurationMs    INT              NULL,
        CONSTRAINT FK_AutomationRuns_Rule
            FOREIGN KEY (RuleId) REFERENCES dbo.AutomationRules(Id) ON DELETE CASCADE
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_AutomationRuns_Rule' AND object_id = OBJECT_ID('dbo.AutomationRuns'))
    CREATE INDEX IX_AutomationRuns_Rule ON dbo.AutomationRuns (RuleId, StartedAt DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_AutomationRuns_Workspace' AND object_id = OBJECT_ID('dbo.AutomationRuns'))
    CREATE INDEX IX_AutomationRuns_Workspace ON dbo.AutomationRuns (WorkspaceId, StartedAt);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AutomationUsage')
BEGIN
    CREATE TABLE dbo.AutomationUsage (
        WorkspaceId UNIQUEIDENTIFIER NOT NULL,
        Period      CHAR(6)          NOT NULL,   -- 'YYYYMM'
        RunCount    INT              NOT NULL DEFAULT 0,
        CONSTRAINT PK_AutomationUsage PRIMARY KEY (WorkspaceId, Period)
    );
END
GO

-- ── Taxonomy rewrite (folded into 6a; idempotent — bounded to rows with an old token) ──
-- Triggers: ISSUE_CREATED→TASK_CREATED, ISSUE_UPDATED→TASK_UPDATED,
--           ISSUE_TRANSITIONED→STATUS_CHANGED, DUE_DATE_APPROACHING→DUE_DATE_PASSED.
-- Actions:  TRANSITION_ISSUE→CHANGE_STATUS, ASSIGN_ISSUE→ASSIGN,
--           UNASSIGN_ISSUE→UNASSIGN, ADD_COMMENT→POST_COMMENT, TRIGGER_WEBHOOK→CALL_WEBHOOK.
-- (Quotes around tokens prevent ISSUE_UPDATED matching inside ISSUE_TRANSITIONED etc.)
UPDATE dbo.AutomationRules
   SET TriggerConfig = REPLACE(REPLACE(REPLACE(REPLACE(TriggerConfig,
         '"ISSUE_CREATED"',        '"TASK_CREATED"'),
         '"ISSUE_UPDATED"',        '"TASK_UPDATED"'),
         '"ISSUE_TRANSITIONED"',   '"STATUS_CHANGED"'),
         '"DUE_DATE_APPROACHING"', '"DUE_DATE_PASSED"')
 WHERE TriggerConfig LIKE '%"ISSUE_CREATED"%'
    OR TriggerConfig LIKE '%"ISSUE_UPDATED"%'
    OR TriggerConfig LIKE '%"ISSUE_TRANSITIONED"%'
    OR TriggerConfig LIKE '%"DUE_DATE_APPROACHING"%';
GO

UPDATE dbo.AutomationRules
   SET ActionConfig = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ActionConfig,
         '"TRANSITION_ISSUE"', '"CHANGE_STATUS"'),
         '"ASSIGN_ISSUE"',     '"ASSIGN"'),
         '"UNASSIGN_ISSUE"',   '"UNASSIGN"'),
         '"ADD_COMMENT"',      '"POST_COMMENT"'),
         '"TRIGGER_WEBHOOK"',  '"CALL_WEBHOOK"')
 WHERE ActionConfig LIKE '%"TRANSITION_ISSUE"%'
    OR ActionConfig LIKE '%"ASSIGN_ISSUE"%'
    OR ActionConfig LIKE '%"UNASSIGN_ISSUE"%'
    OR ActionConfig LIKE '%"ADD_COMMENT"%'
    OR ActionConfig LIKE '%"TRIGGER_WEBHOOK"%';
GO
```

- [ ] Write the rollback `rollback/0039_automation_runs.down.sql`. The data rewrite is one-way + defensive (engine never fired in prod; local-only); the down script drops the tables and documents that it does not reverse the token rewrite:

```sql
-- Rollback 0039: automation runs + usage.
-- Drops AutomationUsage + AutomationRuns. The taxonomy token rewrite is NOT
-- reversed here — it is a one-way, defensive data migration (the legacy engine
-- never fired in prod; all DB work is local-only). Re-running 0039 forward is a
-- no-op on already-renamed rows.

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AutomationUsage') DROP TABLE dbo.AutomationUsage;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AutomationRuns')  DROP TABLE dbo.AutomationRuns;
GO
```

- [ ] Run against local Docker `ProjectFlow_Test` only. Run: apply `0039_automation_runs.sql` then the `.down.sql` then re-apply `0039` to prove idempotency + reversibility. Expected: all three runs succeed; the second `0039` apply is a clean no-op (tables guarded, rewrite token-bounded so `0 rows affected`).

- [ ] Commit:
```
git add infra/sql/migrations/0039_automation_runs.sql infra/sql/migrations/rollback/0039_automation_runs.down.sql
git commit -m "feat(6a): automation runs/usage tables + idempotent taxonomy JSON rewrite"
```

---

### Task 3: Scope-aware + run SPs (`GetByTrigger`, `Create`, `Run_Record`, `Run_ListByRule`)

**Files:**
- Modify: `infra/sql/procedures/usp_AutomationRule_GetByTrigger.sql`
- Modify: `infra/sql/procedures/usp_AutomationRule_Create.sql`
- Create: `infra/sql/procedures/usp_AutomationRun_Record.sql`
- Create: `infra/sql/procedures/usp_AutomationRun_ListByRule.sql`
- Test: deployed via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`; covered by Task 11 integration.

Steps:

- [ ] Modify `usp_AutomationRule_GetByTrigger.sql` — scope-aware match. Replace the body. Keep using `JSON_VALUE(TriggerConfig, '$.type')` (the engine reads the trigger type from the config blob, not a column):

```sql
-- usp_AutomationRule_GetByTrigger
-- Fetches enabled rules matching a trigger type for either a PROJECT-scoped rule
-- (ScopeId = @ProjectId) or a WORKSPACE-scoped rule (ScopeId = @WorkspaceId).
-- Backs automation.bus#emitAutomationEvent. @ProjectId may be NULL for
-- workspace-only events; the OR short-circuits cleanly on NULL.
CREATE OR ALTER PROCEDURE dbo.usp_AutomationRule_GetByTrigger
  @ProjectId   UNIQUEIDENTIFIER = NULL,
  @WorkspaceId UNIQUEIDENTIFIER,
  @TriggerType NVARCHAR(50)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT *
  FROM dbo.AutomationRules
  WHERE IsEnabled = 1
    AND JSON_VALUE(TriggerConfig, '$.type') = @TriggerType
    AND (
          (ScopeType = 'PROJECT'   AND ScopeId = @ProjectId)
       OR (ScopeType = 'WORKSPACE' AND ScopeId = @WorkspaceId)
    )
  ORDER BY CreatedAt ASC;
END;
GO
```

- [ ] Modify `usp_AutomationRule_Create.sql` — add scope params and maintain `ScopeId`. WORKSPACE rules pass NULL `@ProjectId`:

```sql
-- usp_AutomationRule_Create
CREATE OR ALTER PROCEDURE dbo.usp_AutomationRule_Create
  @ProjectId       UNIQUEIDENTIFIER = NULL,
  @WorkspaceId     UNIQUEIDENTIFIER,
  @ScopeType       NVARCHAR(12)     = 'PROJECT',
  @Name            NVARCHAR(255),
  @TriggerConfig   NVARCHAR(MAX),
  @ConditionConfig NVARCHAR(MAX),
  @ActionConfig    NVARCHAR(MAX)
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @Id UNIQUEIDENTIFIER = NEWID();
  DECLARE @ScopeId UNIQUEIDENTIFIER =
    CASE WHEN @ScopeType = 'WORKSPACE' THEN @WorkspaceId ELSE @ProjectId END;

  INSERT INTO dbo.AutomationRules
    (Id, ProjectId, WorkspaceId, ScopeType, ScopeId, Name, TriggerConfig, ConditionConfig, ActionConfig)
  VALUES
    (@Id, @ProjectId, @WorkspaceId, @ScopeType, @ScopeId, @Name, @TriggerConfig, @ConditionConfig, @ActionConfig);

  SELECT * FROM dbo.AutomationRules WHERE Id = @Id;
END;
GO
```

- [ ] Write `usp_AutomationRun_Record.sql` — insert one audit row and, on a terminal status, bump the per-workspace monthly counter (MERGE upsert). Returns the inserted run:

```sql
-- usp_AutomationRun_Record
-- Writes one AutomationRuns audit row and bumps AutomationUsage for the run's
-- workspace+period. Counted statuses are the terminal ones (success/partial/
-- failed); skipped/loop_blocked are audited but not metered.
CREATE OR ALTER PROCEDURE dbo.usp_AutomationRun_Record
  @RuleId        UNIQUEIDENTIFIER,
  @WorkspaceId   UNIQUEIDENTIFIER,
  @ProjectId     UNIQUEIDENTIFIER = NULL,
  @TriggerType   NVARCHAR(40),
  @Status        NVARCHAR(16),
  @Payload       NVARCHAR(MAX)    = NULL,
  @ActionResults NVARCHAR(MAX)    = NULL,
  @Error         NVARCHAR(MAX)    = NULL,
  @Depth         INT              = 0,
  @StartedAt     DATETIME2,
  @DurationMs    INT              = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @Id     UNIQUEIDENTIFIER = NEWID();
  DECLARE @Period CHAR(6) = CONVERT(CHAR(6), SYSUTCDATETIME(), 112); -- YYYYMM

  BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO dbo.AutomationRuns
      (Id, RuleId, WorkspaceId, ProjectId, TriggerType, Status, Payload, ActionResults, Error, Depth, StartedAt, FinishedAt, DurationMs)
    VALUES
      (@Id, @RuleId, @WorkspaceId, @ProjectId, @TriggerType, @Status, @Payload, @ActionResults, @Error, @Depth, @StartedAt, SYSUTCDATETIME(), @DurationMs);

    IF @Status IN ('success', 'partial', 'failed')
    BEGIN
      MERGE dbo.AutomationUsage AS tgt
      USING (SELECT @WorkspaceId AS WorkspaceId, @Period AS Period) AS src
        ON tgt.WorkspaceId = src.WorkspaceId AND tgt.Period = src.Period
      WHEN MATCHED THEN UPDATE SET RunCount = tgt.RunCount + 1
      WHEN NOT MATCHED THEN INSERT (WorkspaceId, Period, RunCount) VALUES (@WorkspaceId, @Period, 1);
    END

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;

  SELECT * FROM dbo.AutomationRuns WHERE Id = @Id;
END;
GO
```

- [ ] Write `usp_AutomationRun_ListByRule.sql` — newest-first paginated audit list:

```sql
-- usp_AutomationRun_ListByRule
-- Newest-first paginated run history for a single rule. Backs the run-history
-- endpoint (Phase 6a REST + GraphQL; the drawer UI lands in 6d).
CREATE OR ALTER PROCEDURE dbo.usp_AutomationRun_ListByRule
  @RuleId UNIQUEIDENTIFIER,
  @Limit  INT = 50,
  @Offset INT = 0
AS
BEGIN
  SET NOCOUNT ON;
  SELECT *
  FROM dbo.AutomationRuns
  WHERE RuleId = @RuleId
  ORDER BY StartedAt DESC
  OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test` (local DB env only). Expected: all four procedures (re)created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_AutomationRule_GetByTrigger.sql infra/sql/procedures/usp_AutomationRule_Create.sql infra/sql/procedures/usp_AutomationRun_Record.sql infra/sql/procedures/usp_AutomationRun_ListByRule.sql
git commit -m "feat(6a): scope-aware GetByTrigger/Create + AutomationRun_Record/ListByRule SPs"
```

---

### Task 4: Types — rename enums + add scope/run types

**Files:**
- Modify: `packages/types/index.ts` (lines 378–451, the Automation Engine block)
- Test: `npm run build --workspace packages/types` (tsc) — no dedicated unit test; downstream type errors surface in Tasks 5–8.

Steps:

- [ ] Replace the Automation Engine block (lines 378–451) with the renamed unions + scope + run types. The trigger union keeps `SPRINT_STARTED`/`SPRINT_COMPLETED`/`SCHEDULED`/`MANUAL`/`WEBHOOK` and **adds** `FIELD_CHANGED`/`ASSIGNEE_CHANGED`/`COMMENT_POSTED`/`DATE_ARRIVED`:

```ts
// ── Automation Engine ─────────────────────────────────────────────────────────

export type AutomationScopeType = 'WORKSPACE' | 'PROJECT';

export type AutomationTriggerType =
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'STATUS_CHANGED'
  | 'FIELD_CHANGED'
  | 'ASSIGNEE_CHANGED'
  | 'COMMENT_POSTED'
  | 'SPRINT_STARTED'
  | 'SPRINT_COMPLETED'
  | 'DUE_DATE_PASSED'
  | 'DATE_ARRIVED'
  | 'SCHEDULED'
  | 'MANUAL'
  | 'WEBHOOK';

export interface AutomationTriggerConfig {
  type: AutomationTriggerType;
  /** For SCHEDULED: cron expression */
  cron?: string;
  /** For STATUS_CHANGED: only fire when moving to this status */
  toStatus?: string;
  /** For FIELD_CHANGED: only fire when this field changed */
  field?: string;
  /** For DUE_DATE_PASSED: hours before due date (preserves "approaching" semantics) */
  hoursBeforeDue?: number;
}

export type AutomationConditionType =
  | 'ISSUE_MATCHES_FILTER'
  | 'FIELD_EQUALS'
  | 'FIELD_NOT_EQUALS'
  | 'USER_HAS_ROLE'
  | 'IN_SPRINT'
  | 'NOT_IN_SPRINT';

export interface AutomationCondition {
  type: AutomationConditionType;
  field?: string;
  value?: string;
  pql?: string;
}

export type AutomationActionType =
  | 'CHANGE_STATUS'
  | 'ASSIGN'
  | 'UNASSIGN'
  | 'SET_PRIORITY'
  | 'POST_COMMENT'
  | 'SEND_NOTIFICATION'
  | 'CALL_WEBHOOK';

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
  /** CALL_WEBHOOK */
  webhookUrl?: string;
}

export interface AutomationRule {
  id: string;
  scopeType: AutomationScopeType;
  workspaceId: string;
  projectId: string | null;
  name: string;
  isEnabled: boolean;
  trigger: AutomationTriggerConfig;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  executionCount: number;
  lastExecutedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AutomationRunStatus = 'success' | 'partial' | 'failed' | 'skipped' | 'loop_blocked';

export interface AutomationRun {
  id: string;
  ruleId: string;
  workspaceId: string;
  projectId: string | null;
  triggerType: string;
  status: AutomationRunStatus;
  payload: unknown | null;
  actionResults: unknown | null;
  error: string | null;
  depth: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}
```

- [ ] Run: `npm run build --workspace packages/types` (tsc). Expected: PASS — the types package compiles. (Downstream API/web compile errors are resolved in Tasks 5–8; if running strictly in order, those packages will not yet build until their tasks land.)

- [ ] Commit:
```
git add packages/types/index.ts
git commit -m "feat(6a): types — rename automation enums to ClickUp taxonomy + scope/run types"
```

---

### Task 5: Loop-guard helpers + taxonomy map + pure unit tests

**Files:**
- Create: `apps/api/src/modules/automation/automation.bus.ts`
- Create: `apps/api/src/modules/automation/automation.taxonomy.ts`
- Create: `apps/api/src/modules/automation/__tests__/loop-guard.unit.test.ts`
- Create: `apps/api/src/modules/automation/__tests__/taxonomy.unit.test.ts`
- Modify: `apps/api/src/modules/automation/automation.queue.ts`

Steps:

- [ ] Write the failing unit tests first. `loop-guard.unit.test.ts` (the guard logic is pure — no Redis/queue):

```ts
import { describe, it, expect } from 'vitest';
import { shouldEnqueue, MAX_DEPTH } from '../automation.bus.js';

describe('shouldEnqueue (loop guard)', () => {
  it('allows a fresh rule at depth 0', () => {
    expect(shouldEnqueue('rule-a', { depth: 0, causationChain: [] })).toEqual({ ok: true });
  });

  it('blocks a rule already in the causation chain (self-retrigger)', () => {
    const r = shouldEnqueue('rule-a', { depth: 1, causationChain: ['rule-a'] });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('chain');
  });

  it('blocks once depth reaches MAX_DEPTH', () => {
    const r = shouldEnqueue('rule-z', { depth: MAX_DEPTH, causationChain: ['x', 'y'] });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('depth');
  });

  it('allows a different rule one below the depth cap', () => {
    expect(shouldEnqueue('rule-b', { depth: MAX_DEPTH - 1, causationChain: ['rule-a'] }))
      .toEqual({ ok: true });
  });

  it('MAX_DEPTH defaults to 5', () => {
    expect(MAX_DEPTH).toBe(5);
  });
});
```

`taxonomy.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renameToken, TRIGGER_RENAMES, ACTION_RENAMES } from '../automation.taxonomy.js';

describe('automation taxonomy rename', () => {
  it('renames legacy trigger tokens to ClickUp semantics', () => {
    expect(renameToken('ISSUE_CREATED')).toBe('TASK_CREATED');
    expect(renameToken('ISSUE_TRANSITIONED')).toBe('STATUS_CHANGED');
    expect(renameToken('DUE_DATE_APPROACHING')).toBe('DUE_DATE_PASSED');
  });

  it('renames legacy action tokens', () => {
    expect(renameToken('TRANSITION_ISSUE')).toBe('CHANGE_STATUS');
    expect(renameToken('ASSIGN_ISSUE')).toBe('ASSIGN');
    expect(renameToken('ADD_COMMENT')).toBe('POST_COMMENT');
    expect(renameToken('TRIGGER_WEBHOOK')).toBe('CALL_WEBHOOK');
  });

  it('passes through already-renamed or unknown tokens unchanged', () => {
    expect(renameToken('STATUS_CHANGED')).toBe('STATUS_CHANGED');
    expect(renameToken('SPRINT_STARTED')).toBe('SPRINT_STARTED');
    expect(renameToken('NONSENSE')).toBe('NONSENSE');
  });

  it('exposes the canonical rename maps', () => {
    expect(TRIGGER_RENAMES.ISSUE_UPDATED).toBe('TASK_UPDATED');
    expect(ACTION_RENAMES.UNASSIGN_ISSUE).toBe('UNASSIGN');
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- loop-guard taxonomy`. Expected: FAIL — `Cannot find module '../automation.bus.js'` / `'../automation.taxonomy.js'`.

- [ ] Write `apps/api/src/modules/automation/automation.taxonomy.ts` (the in-code mirror of the `0039` data rewrite — used to defensively normalize any old token read at runtime):

```ts
/**
 * Automation taxonomy rename (Phase 6a). The 0039 data migration rewrites stored
 * JSON; this module mirrors the same map so any old token read at runtime (e.g.
 * a rule created against a not-yet-migrated row) is normalized to ClickUp
 * semantics before evaluation.
 */
export const TRIGGER_RENAMES: Record<string, string> = {
  ISSUE_CREATED:        'TASK_CREATED',
  ISSUE_UPDATED:        'TASK_UPDATED',
  ISSUE_TRANSITIONED:   'STATUS_CHANGED',
  DUE_DATE_APPROACHING: 'DUE_DATE_PASSED',
};

export const ACTION_RENAMES: Record<string, string> = {
  TRANSITION_ISSUE: 'CHANGE_STATUS',
  ASSIGN_ISSUE:     'ASSIGN',
  UNASSIGN_ISSUE:   'UNASSIGN',
  ADD_COMMENT:      'POST_COMMENT',
  TRIGGER_WEBHOOK:  'CALL_WEBHOOK',
};

const ALL_RENAMES: Record<string, string> = { ...TRIGGER_RENAMES, ...ACTION_RENAMES };

/** Map a single legacy token to its new form; pass through unknown/new tokens. */
export function renameToken(token: string): string {
  return ALL_RENAMES[token] ?? token;
}
```

- [ ] Write `apps/api/src/modules/automation/automation.bus.ts` — the loop-guard helpers + the event types + `emitAutomationEvent`. The pure `shouldEnqueue` is exported for the unit test; the async `emitAutomationEvent` resolves rules and enqueues. The Redis cooldown mirrors `debounceGate` (SET NX EX, fail-open):

```ts
import { automationQueue } from './automation.queue.js';
import { AutomationRepository } from './automation.repository.js';
import { getRedis } from '../../shared/lib/redis.js';
import { subLogger } from '../../shared/lib/logger.js';

const log  = subLogger('automation-bus');
const repo = new AutomationRepository();

/** Max causal depth before the guard drops further enqueues. */
export const MAX_DEPTH = 5;
/** Per-(rule,entity) cooldown to damp tight thrash. */
export const COOLDOWN_SECONDS = 10;

export interface LoopContext {
  depth: number;
  causationChain: string[]; // ruleIds already fired in this causal chain
}

/** Typed domain events the service layer emits after commit. */
export type AutomationDomainEvent =
  | { type: 'TASK_CREATED';     workspaceId: string; projectId: string; taskId: string; actorId: string; reporterId?: string | null; payload?: Record<string, unknown>; loop?: LoopContext }
  | { type: 'STATUS_CHANGED';   workspaceId: string; projectId: string; taskId: string; actorId: string; reporterId?: string | null; fromStatus: string | null; toStatus: string; payload?: Record<string, unknown>; loop?: LoopContext }
  | { type: 'FIELD_CHANGED';    workspaceId: string; projectId: string; taskId: string; actorId: string; field: string; from: unknown; to: unknown; payload?: Record<string, unknown>; loop?: LoopContext }
  | { type: 'ASSIGNEE_CHANGED'; workspaceId: string; projectId: string; taskId: string; actorId: string; from: string | null; to: string | null; payload?: Record<string, unknown>; loop?: LoopContext }
  | { type: 'COMMENT_POSTED';   workspaceId: string; projectId: string; taskId: string; actorId: string; commentId: string; payload?: Record<string, unknown>; loop?: LoopContext };

export type LoopDecision = { ok: true } | { ok: false; reason: 'depth' | 'chain' };

/** Pure loop-guard decision for one rule given the inbound causal context. */
export function shouldEnqueue(ruleId: string, loop: LoopContext): LoopDecision {
  if (loop.depth >= MAX_DEPTH)            return { ok: false, reason: 'depth' };
  if (loop.causationChain.includes(ruleId)) return { ok: false, reason: 'chain' };
  return { ok: true };
}

export const cooldownKey = (ruleId: string, entityId: string): string =>
  `automation:cooldown:${ruleId}:${entityId}`;

/** Returns true at most once per COOLDOWN_SECONDS for a (rule,entity). Fails OPEN. */
async function passCooldown(ruleId: string, entityId: string): Promise<boolean> {
  try {
    const res = await getRedis().set(cooldownKey(ruleId, entityId), '1', 'EX', COOLDOWN_SECONDS, 'NX');
    return res === 'OK';
  } catch {
    return true;
  }
}

/**
 * Resolve scope-matching enabled rules for a domain event and enqueue one job
 * per surviving rule. Best-effort: never throws into the caller (mirrors
 * publishTaskEvent). The loop guard drops self-retriggering / too-deep enqueues
 * and records a `loop_blocked` run for visibility.
 */
export async function emitAutomationEvent(event: AutomationDomainEvent): Promise<void> {
  const loop: LoopContext = event.loop ?? { depth: 0, causationChain: [] };
  try {
    const rules = await repo.getByTrigger(event.projectId, event.workspaceId, event.type);
    const payload = { taskId: event.taskId, ...(event.payload ?? {}), ...buildEventPayload(event) };

    for (const rule of rules) {
      const decision = shouldEnqueue(rule.id, loop);
      if (!decision.ok) {
        // Audit the blocked attempt without enqueuing.
        await repo.recordRun({
          ruleId: rule.id, workspaceId: rule.workspaceId, projectId: rule.projectId,
          triggerType: event.type, status: 'loop_blocked',
          payload: JSON.stringify(payload), depth: loop.depth, startedAt: new Date(),
        }).catch(() => {});
        continue;
      }
      if (!(await passCooldown(rule.id, event.taskId))) continue;

      await automationQueue.add(`${event.type}:${rule.id}`, {
        ruleId:         rule.id,
        projectId:      rule.projectId,
        workspaceId:    rule.workspaceId,
        eventType:      event.type,
        payload,
        depth:          loop.depth,
        causationChain: loop.causationChain,
      });
    }
  } catch (err: any) {
    log.warn({ err: err?.message, type: event.type }, 'emitAutomationEvent failed');
  }
}

/** Flatten event-specific old/new values into the worker payload. */
function buildEventPayload(event: AutomationDomainEvent): Record<string, unknown> {
  switch (event.type) {
    case 'STATUS_CHANGED':   return { actorId: event.actorId, reporterId: event.reporterId ?? null, fromStatus: event.fromStatus, toStatus: event.toStatus, status: event.toStatus };
    case 'FIELD_CHANGED':    return { actorId: event.actorId, field: event.field, from: event.from, to: event.to };
    case 'ASSIGNEE_CHANGED': return { actorId: event.actorId, from: event.from, to: event.to, assigneeId: event.to };
    case 'COMMENT_POSTED':   return { actorId: event.actorId, commentId: event.commentId };
    case 'TASK_CREATED':     return { actorId: event.actorId, reporterId: event.reporterId ?? null };
    default:                 return {};
  }
}
```

- [ ] Extend `automation.queue.ts` — widen `AutomationJobData` with the scope + loop fields:

```ts
export interface AutomationJobData {
  ruleId:         string;
  projectId:      string | null;
  workspaceId:    string;
  eventType:      string;
  /** Serialised payload (task, sprint, etc.) carrying old/new diffs. */
  payload:        Record<string, unknown>;
  /** Loop-guard causal depth at enqueue time. */
  depth:          number;
  /** Rule ids already fired in this causal chain. */
  causationChain: string[];
}
```

- [ ] Run: `npm test --workspace apps/api -- loop-guard taxonomy`. Expected: PASS (9 tests).

- [ ] Commit:
```
git add apps/api/src/modules/automation/automation.bus.ts apps/api/src/modules/automation/automation.taxonomy.ts apps/api/src/modules/automation/automation.queue.ts apps/api/src/modules/automation/__tests__/loop-guard.unit.test.ts apps/api/src/modules/automation/__tests__/taxonomy.unit.test.ts
git commit -m "feat(6a): automation bus + loop guard + taxonomy map + queue scope/loop fields + unit tests"
```

---

### Task 6: Repository + service — scope, runs, drop dead `enqueueForEvent`

**Files:**
- Modify: `apps/api/src/modules/automation/automation.repository.ts`
- Modify: `apps/api/src/modules/automation/automation.service.ts`
- Test: covered by Task 11 integration; this task verifies via `npm run build --workspace apps/api`.

Steps:

- [ ] Rewrite `automation.repository.ts` — parse the new `ScopeType`/`WorkspaceId` columns, make `getByTrigger` scope-aware, thread scope through `create`, and add `recordRun`/`listRunsByRule`. Replace `AutomationRuleRow`/`parseRow` and the relevant methods:

```ts
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type {
  AutomationTriggerConfig,
  AutomationCondition,
  AutomationAction,
  AutomationScopeType,
  AutomationRun,
} from '@projectflow/types';

export interface AutomationRuleRow {
  Id:              string;
  ProjectId:       string | null;
  WorkspaceId:     string;
  ScopeType:       AutomationScopeType;
  ScopeId:         string;
  Name:            string;
  IsEnabled:       boolean;
  TriggerConfig:   string;
  ConditionConfig: string;
  ActionConfig:    string;
  ExecutionCount:  number;
  LastExecutedAt:  Date | null;
  CreatedAt:       Date;
  UpdatedAt:       Date;
}

function parseRow(row: AutomationRuleRow) {
  return {
    id:             row.Id,
    scopeType:      row.ScopeType,
    workspaceId:    row.WorkspaceId,
    projectId:      row.ProjectId,
    name:           row.Name,
    isEnabled:      Boolean(row.IsEnabled),
    trigger:        JSON.parse(row.TriggerConfig)   as AutomationTriggerConfig,
    conditions:     JSON.parse(row.ConditionConfig) as AutomationCondition[],
    actions:        JSON.parse(row.ActionConfig)    as AutomationAction[],
    executionCount: row.ExecutionCount,
    lastExecutedAt: row.LastExecutedAt?.toISOString() ?? null,
    createdAt:      row.CreatedAt.toISOString(),
    updatedAt:      row.UpdatedAt.toISOString(),
  };
}

interface AutomationRunRow {
  Id: string; RuleId: string; WorkspaceId: string; ProjectId: string | null;
  TriggerType: string; Status: AutomationRun['status'];
  Payload: string | null; ActionResults: string | null; Error: string | null;
  Depth: number; StartedAt: Date; FinishedAt: Date | null; DurationMs: number | null;
}

function parseRunRow(row: AutomationRunRow): AutomationRun {
  return {
    id: row.Id, ruleId: row.RuleId, workspaceId: row.WorkspaceId, projectId: row.ProjectId,
    triggerType: row.TriggerType, status: row.Status,
    payload:       row.Payload       ? JSON.parse(row.Payload)       : null,
    actionResults: row.ActionResults ? JSON.parse(row.ActionResults) : null,
    error: row.Error, depth: row.Depth,
    startedAt: row.StartedAt.toISOString(),
    finishedAt: row.FinishedAt?.toISOString() ?? null,
    durationMs: row.DurationMs,
  };
}
```

Replace `create`, `getByTrigger`, and add the run methods (the `getById`/`update`/`delete`/`list`/`recordExecution`/`getWorkspaceId` methods are unchanged):

```ts
  async create(
    scopeType: AutomationScopeType,
    workspaceId: string,
    projectId: string | null,
    name: string,
    trigger: AutomationTriggerConfig,
    conditions: AutomationCondition[],
    actions: AutomationAction[],
  ) {
    const rows = await execSpOne<AutomationRuleRow>('usp_AutomationRule_Create', [
      { name: 'ScopeType',       type: sql.NVarChar(12),      value: scopeType },
      { name: 'WorkspaceId',     type: sql.UniqueIdentifier,  value: workspaceId },
      { name: 'ProjectId',       type: sql.UniqueIdentifier,  value: projectId },
      { name: 'Name',            type: sql.NVarChar(255),     value: name },
      { name: 'TriggerConfig',   type: sql.NVarChar(sql.MAX), value: JSON.stringify(trigger) },
      { name: 'ConditionConfig', type: sql.NVarChar(sql.MAX), value: JSON.stringify(conditions) },
      { name: 'ActionConfig',    type: sql.NVarChar(sql.MAX), value: JSON.stringify(actions) },
    ]);
    return parseRow(rows[0]);
  }

  async getByTrigger(projectId: string | null, workspaceId: string, triggerType: string) {
    const rows = await execSpOne<AutomationRuleRow>('usp_AutomationRule_GetByTrigger', [
      { name: 'ProjectId',   type: sql.UniqueIdentifier, value: projectId },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'TriggerType', type: sql.NVarChar(50),     value: triggerType },
    ]);
    return rows.map(parseRow);
  }

  async recordRun(run: {
    ruleId: string; workspaceId: string; projectId: string | null; triggerType: string;
    status: AutomationRun['status']; payload?: string | null; actionResults?: string | null;
    error?: string | null; depth: number; startedAt: Date; durationMs?: number | null;
  }): Promise<AutomationRun> {
    const rows = await execSpOne<AutomationRunRow>('usp_AutomationRun_Record', [
      { name: 'RuleId',        type: sql.UniqueIdentifier,  value: run.ruleId },
      { name: 'WorkspaceId',   type: sql.UniqueIdentifier,  value: run.workspaceId },
      { name: 'ProjectId',     type: sql.UniqueIdentifier,  value: run.projectId },
      { name: 'TriggerType',   type: sql.NVarChar(40),      value: run.triggerType },
      { name: 'Status',        type: sql.NVarChar(16),      value: run.status },
      { name: 'Payload',       type: sql.NVarChar(sql.MAX), value: run.payload ?? null },
      { name: 'ActionResults', type: sql.NVarChar(sql.MAX), value: run.actionResults ?? null },
      { name: 'Error',         type: sql.NVarChar(sql.MAX), value: run.error ?? null },
      { name: 'Depth',         type: sql.Int,               value: run.depth },
      { name: 'StartedAt',     type: sql.DateTime2,         value: run.startedAt },
      { name: 'DurationMs',    type: sql.Int,               value: run.durationMs ?? null },
    ]);
    return parseRunRow(rows[0]);
  }

  async listRunsByRule(ruleId: string, limit = 50, offset = 0): Promise<AutomationRun[]> {
    const rows = await execSpOne<AutomationRunRow>('usp_AutomationRun_ListByRule', [
      { name: 'RuleId', type: sql.UniqueIdentifier, value: ruleId },
      { name: 'Limit',  type: sql.Int,              value: limit },
      { name: 'Offset', type: sql.Int,              value: offset },
    ]);
    return rows.map(parseRunRow);
  }
```

- [ ] Rewrite `automation.service.ts` — `create` takes scope, add `listRuns`, **delete** the dead `enqueueForEvent` (replaced by `automation.bus#emitAutomationEvent`):

```ts
import { AutomationRepository } from './automation.repository.js';
import type {
  AutomationTriggerConfig,
  AutomationCondition,
  AutomationAction,
  AutomationRule,
  AutomationScopeType,
  AutomationRun,
} from '@projectflow/types';

const repo = new AutomationRepository();

export class AutomationService {
  /** List all rules for a project (PROJECT-scoped + a project's workspace rules are listed via workspace path). */
  async list(projectId: string): Promise<AutomationRule[]> {
    return repo.list(projectId);
  }

  /** Create a new rule (PROJECT or WORKSPACE scope). */
  async create(
    scopeType: AutomationScopeType,
    workspaceId: string,
    projectId: string | null,
    name: string,
    trigger: AutomationTriggerConfig,
    conditions: AutomationCondition[],
    actions: AutomationAction[],
  ): Promise<AutomationRule> {
    return repo.create(scopeType, workspaceId, projectId, name, trigger, conditions, actions);
  }

  /** Partial update a rule */
  async update(
    id: string,
    patch: {
      name?:       string;
      isEnabled?:  boolean;
      trigger?:    AutomationTriggerConfig;
      conditions?: AutomationCondition[];
      actions?:    AutomationAction[];
    },
  ): Promise<AutomationRule | null> {
    return repo.update(id, patch);
  }

  /** Delete a rule */
  async delete(id: string): Promise<void> {
    return repo.delete(id);
  }

  /** Audited run history for a rule (newest first). */
  async listRuns(ruleId: string, limit = 50, offset = 0): Promise<AutomationRun[]> {
    return repo.listRuns ? repo.listRuns(ruleId, limit, offset) : repo.listRunsByRule(ruleId, limit, offset);
  }
}
```

> Note: the `listRuns?` guard above is defensive against rename drift — the repo method is `listRunsByRule`; keep the service call as `repo.listRunsByRule(ruleId, limit, offset)` and drop the ternary if you prefer a single name. The canonical form is:
> ```ts
>   async listRuns(ruleId: string, limit = 50, offset = 0): Promise<AutomationRun[]> {
>     return repo.listRunsByRule(ruleId, limit, offset);
>   }
> ```

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: FAIL — the worker/actions/routes still reference the old `getByTrigger(projectId, type)` arity + `enqueueForEvent`; these are fixed in Tasks 7–9. (If running strictly task-by-task, expect the build to go green only after Task 9. Confirm the unit tests still pass: `npm test --workspace apps/api -- loop-guard taxonomy` → PASS.)

- [ ] Commit:
```
git add apps/api/src/modules/automation/automation.repository.ts apps/api/src/modules/automation/automation.service.ts
git commit -m "feat(6a): automation repo/service — scope-aware create + run audit; drop dead enqueueForEvent"
```

---

### Task 7: Worker — run audit + loop-guard depth propagation + renamed switches

**Files:**
- Modify: `apps/api/src/modules/automation/automation.worker.ts`
- Modify: `apps/api/src/modules/automation/automation.actions.ts`
- Modify: `apps/api/src/modules/automation/automation.conditions.ts`
- Test: covered by Task 11 integration; verify compile after Task 9.

Steps:

- [ ] Rewrite `automation.worker.ts` — wrap each job in a timed `AutomationRuns` record (start→finish), capture per-action results into an `actionResults[]`, derive the terminal status, and pass an incremented `LoopContext` into the action executor so task-mutating actions re-emit domain events one level deeper with the rule appended to the chain:

```ts
import { Worker } from 'bullmq';
import { AutomationRepository } from './automation.repository.js';
import { evaluateConditions }   from './automation.conditions.js';
import { executeAction }        from './automation.actions.js';
import type { AutomationJobData } from './automation.queue.js';
import type { LoopContext } from './automation.bus.js';
import type { AutomationRunStatus } from '@projectflow/types';
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
      const { ruleId, payload, workspaceId, projectId, eventType, depth, causationChain } = job.data;
      const startedAt = new Date();

      // Load the rule fresh so we always have the latest config.
      const rules = await repo.list(projectId ?? '');
      let rule = rules.find((r) => r.id === ruleId);
      // Workspace-scoped rules aren't in the project list — fall back to a single read.
      if (!rule) {
        const byId = await repo.getById(ruleId);
        rule = byId ? (byId as any) : undefined;
      }

      if (!rule || !rule.isEnabled) {
        await repo.recordRun({
          ruleId, workspaceId, projectId, triggerType: eventType, status: 'skipped',
          payload: JSON.stringify(payload), error: 'rule disabled or deleted',
          depth, startedAt, durationMs: Date.now() - startedAt.getTime(),
        }).catch(() => {});
        return;
      }

      // Evaluate conditions (AND-only; OR/operators arrive in 6b).
      if (!evaluateConditions(rule.conditions, payload)) {
        await repo.recordRun({
          ruleId, workspaceId, projectId, triggerType: eventType, status: 'skipped',
          payload: JSON.stringify(payload), error: 'conditions not met',
          depth, startedAt, durationMs: Date.now() - startedAt.getTime(),
        }).catch(() => {});
        return;
      }

      // The loop context a mutating action will propagate: one deeper, this rule appended.
      const childLoop: LoopContext = {
        depth: depth + 1,
        causationChain: [...causationChain, ruleId],
      };

      const actionResults: Array<{ type: string; ok: boolean; error?: string }> = [];
      let anyFailed = false;
      for (const action of rule.actions) {
        try {
          await executeAction(action, payload, { workspaceId, projectId, loop: childLoop });
          actionResults.push({ type: action.type, ok: true });
        } catch (err: any) {
          anyFailed = true;
          actionResults.push({ type: action.type, ok: false, error: err?.message });
          log.error({ ruleId, action: action.type, err: err?.message }, 'action failed');
          // Continue with remaining actions even if one fails.
        }
      }

      const status: AutomationRunStatus =
        !anyFailed ? 'success' : actionResults.some((r) => r.ok) ? 'partial' : 'failed';

      await repo.recordRun({
        ruleId, workspaceId, projectId, triggerType: eventType, status,
        payload: JSON.stringify(payload), actionResults: JSON.stringify(actionResults),
        depth, startedAt, durationMs: Date.now() - startedAt.getTime(),
      }).catch((e: any) => log.error({ err: e?.message }, 'recordRun failed'));

      // Keep the legacy ExecutionCount / LastExecutedAt fields in sync.
      await repo.recordExecution(ruleId).catch(() => {});
    },
    {
      connection,
      concurrency: 5,
    },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err: err?.message }, 'job failed');
  });

  worker.on('error', (err) => {
    log.error({ err: err?.message }, 'worker error');
  });

  registerCloser('automation-worker', () => worker.close());
  log.info('worker started');
  return worker;
}
```

- [ ] Rewrite `automation.actions.ts` — rename the `switch` cases to the new tokens and accept a loop-guard `ctx` so task-mutating actions re-emit a domain event (depth+1, chain extended) that lets a *different* rule react while the guard blocks self-retrigger. `CALL_WEBHOOK` keeps the legacy `fetch` (signed dispatch is 6c). Replace the file:

```ts
/**
 * Automation action executor.
 * Receives a single action, the event payload, and a loop-guard context.
 * Task-mutating actions re-emit a typed domain event one causal level deeper so
 * OTHER rules can chain off them while the loop guard blocks self-retrigger.
 */
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import { subLogger } from '../../shared/lib/logger.js';
import { emitAutomationEvent, type LoopContext } from './automation.bus.js';
import type { AutomationAction } from '@projectflow/types';

const log = subLogger('automation');

export interface ActionContext {
  workspaceId: string;
  projectId:   string | null;
  loop:        LoopContext;
}

const SYSTEM_ACTOR = (payload: Record<string, unknown>): string | null =>
  (payload['actorId'] as string | undefined) ?? process.env.SYSTEM_USER_ID ?? null;

export async function executeAction(
  action: AutomationAction,
  payload: Record<string, unknown>,
  ctx: ActionContext,
): Promise<void> {
  const taskId = payload['taskId'] as string | undefined;

  switch (action.type) {
    case 'CHANGE_STATUS': {
      if (!taskId || !action.toStatus) break;
      const fromStatus = (payload['status'] as string | undefined) ?? null;
      await execSpOne('usp_Task_Transition', [
        { name: 'TaskId',      type: sql.UniqueIdentifier, value: taskId },
        { name: 'NewStatus',   type: sql.NVarChar(100),    value: action.toStatus },
        { name: 'RequesterId', type: sql.UniqueIdentifier, value: payload['actorId'] ?? null },
      ]);
      // Re-emit so OTHER rules can chain; guard blocks self-retrigger by chain/depth.
      if (ctx.projectId) {
        void emitAutomationEvent({
          type: 'STATUS_CHANGED', workspaceId: ctx.workspaceId, projectId: ctx.projectId,
          taskId, actorId: SYSTEM_ACTOR(payload) ?? '', fromStatus, toStatus: action.toStatus,
          loop: ctx.loop,
        });
      }
      break;
    }

    case 'ASSIGN': {
      if (!taskId) break;
      const assigneeId =
        action.assigneeId === 'REPORTER'
          ? (payload['reporterId'] as string | undefined) ?? null
          : action.assigneeId ?? null;
      await execSpOne('usp_Task_Update', [
        { name: 'TaskId',      type: sql.UniqueIdentifier, value: taskId },
        { name: 'Title',       type: sql.NVarChar(500),    value: null },
        { name: 'Description', type: sql.NVarChar(sql.MAX), value: null },
        { name: 'Type',        type: sql.NVarChar(20),     value: null },
        { name: 'Priority',    type: sql.NVarChar(20),     value: null },
        { name: 'AssigneeId',  type: sql.UniqueIdentifier, value: assigneeId },
        { name: 'SprintId',    type: sql.UniqueIdentifier, value: null },
        { name: 'EpicId',      type: sql.UniqueIdentifier, value: null },
        { name: 'StoryPoints', type: sql.Float,            value: null },
        { name: 'DueDate',     type: sql.Date,             value: null },
      ]);
      if (ctx.projectId) {
        void emitAutomationEvent({
          type: 'ASSIGNEE_CHANGED', workspaceId: ctx.workspaceId, projectId: ctx.projectId,
          taskId, actorId: SYSTEM_ACTOR(payload) ?? '', from: null, to: assigneeId,
          loop: ctx.loop,
        });
      }
      break;
    }

    case 'UNASSIGN': {
      if (!taskId) break;
      await execSpOne('usp_Task_Update', [
        { name: 'TaskId',      type: sql.UniqueIdentifier, value: taskId },
        { name: 'Title',       type: sql.NVarChar(500),    value: null },
        { name: 'Description', type: sql.NVarChar(sql.MAX), value: null },
        { name: 'Type',        type: sql.NVarChar(20),     value: null },
        { name: 'Priority',    type: sql.NVarChar(20),     value: null },
        { name: 'AssigneeId',  type: sql.UniqueIdentifier, value: null },
        { name: 'SprintId',    type: sql.UniqueIdentifier, value: null },
        { name: 'EpicId',      type: sql.UniqueIdentifier, value: null },
        { name: 'StoryPoints', type: sql.Float,            value: null },
        { name: 'DueDate',     type: sql.Date,             value: null },
      ]);
      break;
    }

    case 'SET_PRIORITY': {
      if (!taskId || !action.priority) break;
      await execSpOne('usp_Task_Update', [
        { name: 'TaskId',      type: sql.UniqueIdentifier, value: taskId },
        { name: 'Title',       type: sql.NVarChar(500),    value: null },
        { name: 'Description', type: sql.NVarChar(sql.MAX), value: null },
        { name: 'Type',        type: sql.NVarChar(20),     value: null },
        { name: 'Priority',    type: sql.NVarChar(20),     value: action.priority },
        { name: 'AssigneeId',  type: sql.UniqueIdentifier, value: null },
        { name: 'SprintId',    type: sql.UniqueIdentifier, value: null },
        { name: 'EpicId',      type: sql.UniqueIdentifier, value: null },
        { name: 'StoryPoints', type: sql.Float,            value: null },
        { name: 'DueDate',     type: sql.Date,             value: null },
      ]);
      if (ctx.projectId) {
        void emitAutomationEvent({
          type: 'FIELD_CHANGED', workspaceId: ctx.workspaceId, projectId: ctx.projectId,
          taskId, actorId: SYSTEM_ACTOR(payload) ?? '', field: 'priority', from: null, to: action.priority,
          loop: ctx.loop,
        });
      }
      break;
    }

    case 'POST_COMMENT': {
      if (!taskId || !action.message) break;
      const systemUserId = SYSTEM_ACTOR(payload);
      if (!systemUserId) break;
      await execSpOne('usp_Comment_Create', [
        { name: 'TaskId',   type: sql.UniqueIdentifier,  value: taskId },
        { name: 'AuthorId', type: sql.UniqueIdentifier,  value: systemUserId },
        { name: 'Body',     type: sql.NVarChar(sql.MAX), value: action.message },
      ]);
      break;
    }

    case 'SEND_NOTIFICATION': {
      if (!action.message) break;
      const targetUserId = payload['assigneeId'] as string | undefined;
      if (!targetUserId) break;
      await execSpOne('usp_Notification_Create', [
        { name: 'UserId',  type: sql.UniqueIdentifier,  value: targetUserId },
        { name: 'Type',    type: sql.NVarChar(50),       value: 'AUTOMATION' },
        { name: 'Payload', type: sql.NVarChar(sql.MAX),  value: JSON.stringify({ message: action.message, taskId: taskId ?? null }) },
      ]);
      break;
    }

    case 'CALL_WEBHOOK': {
      if (!action.webhookUrl) break;
      // Legacy fire-and-forget fetch — replaced by the signed/audited dispatcher in 6c.
      fetch(action.webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ event: payload }),
        signal:  AbortSignal.timeout(10_000),
      }).catch((err: any) => log.error({ err: err?.message }, 'webhook error'));
      break;
    }

    default:
      log.warn({ type: (action as any).type }, 'unknown action type');
  }
}
```

- [ ] Rewrite `automation.conditions.ts` — the condition tokens are unchanged by the taxonomy rename (they were never Jira-named), so this file needs no token edits; keep it as-is. (The OR/operator engine + real PQL/role checks are 6b.) Verify the file still matches `AutomationConditionType`. No change required — skip the edit but confirm by reading.

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: still FAIL on `automation.routes.ts` (old `svc.create` arity) — fixed in Task 9. The worker + actions + bus now compile against each other.

- [ ] Commit:
```
git add apps/api/src/modules/automation/automation.worker.ts apps/api/src/modules/automation/automation.actions.ts
git commit -m "feat(6a): worker run audit + loop-depth propagation; rename action switch to ClickUp taxonomy"
```

---

### Task 8: Service-layer event hooks (task.service + comment.service)

**Files:**
- Modify: `apps/api/src/modules/tasks/task.service.ts` (createTask ~line 62, transitionTask ~line 181, updateTask ~line 216)
- Modify: `apps/api/src/modules/comments/comment.service.ts` (create ~line 17)
- Test: covered by Task 11 integration.

Steps:

- [ ] Add the import to `task.service.ts` (alongside the `publishTaskEvent` import at line 9):

```ts
import { emitAutomationEvent } from '../automation/automation.bus.js';
```

- [ ] In `createTask`, after the webhook dispatch and before `return task` (line ~61), emit `TASK_CREATED` best-effort:

```ts
    // Automation engine (Phase 6a): typed domain event, after commit, best-effort.
    void emitAutomationEvent({
      type: 'TASK_CREATED',
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      taskId: task.id,
      actorId,
      reporterId: (task as any).reporterId ?? (task as any).ReporterId ?? null,
    });

    return task;
```

- [ ] In `transitionTask`, after the recurrence block and before `return task` (line ~180), emit `STATUS_CHANGED` carrying the captured `previousStatus`:

```ts
    // Automation engine (Phase 6a): STATUS_CHANGED with old/new for status_change rules.
    void emitAutomationEvent({
      type: 'STATUS_CHANGED',
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      taskId,
      actorId,
      reporterId: (task as any).reporterId ?? (task as any).ReporterId ?? null,
      fromStatus: previousStatus,
      toStatus: newStatus,
    });

    return task;
```

- [ ] In `updateTask`, after the dependency-reschedule block and before `return task` (line ~216), emit a diff-driven `FIELD_CHANGED` / `ASSIGNEE_CHANGED`. Snapshot the assignee before the update via the already-fetched repo path (reuse `before` is dates-only, so read the prior assignee from the task pre-update). Minimal version — emit `FIELD_CHANGED` for any provided scalar field and `ASSIGNEE_CHANGED` when `assigneeId` is in the input:

```ts
    if (task) {
      const projectId = projectIdOf(task);
      const workspaceId = (task as any).workspaceId ?? (task as any).WorkspaceId ?? null;
      if (projectId && workspaceId) {
        // ASSIGNEE_CHANGED when the update touched the assignee.
        if ('assigneeId' in (input as any)) {
          void emitAutomationEvent({
            type: 'ASSIGNEE_CHANGED', workspaceId, projectId, taskId, actorId,
            from: null, to: (input as any).assigneeId ?? null,
          });
        }
        // FIELD_CHANGED for each provided scalar field (priority/type/dueDate/title/storyPoints).
        for (const field of ['priority', 'type', 'dueDate', 'title', 'storyPoints'] as const) {
          if (field in (input as any) && (input as any)[field] !== undefined) {
            void emitAutomationEvent({
              type: 'FIELD_CHANGED', workspaceId, projectId, taskId, actorId,
              field, from: null, to: (input as any)[field],
            });
          }
        }
      }
    }
    return task;
```

- [ ] Add the import to `comment.service.ts` (alongside the existing imports at the top):

```ts
import { emitAutomationEvent } from '../automation/automation.bus.js';
```

- [ ] In `commentService.create`, after the `pubsub.publish('comment:created', ...)` line (line ~17), emit `COMMENT_POSTED`. The comment carries `taskId`; resolve `projectId`/`workspaceId` from the task (the fire-and-forget block already fetches the task — reuse it, or do a cheap workspace lookup). Add after the existing `void (async () => { ... })()` IIFE opens its task fetch — simplest is a parallel best-effort emit inside that IIFE right after `const task = await taskRepo.getById(...)`:

```ts
      // Automation engine (Phase 6a): COMMENT_POSTED after the task is resolved.
      const projectId   = (task as any).projectId   ?? (task as any).ProjectId   ?? null;
      const workspaceId = (task as any).workspaceId ?? (task as any).WorkspaceId ?? null;
      if (projectId && workspaceId) {
        void emitAutomationEvent({
          type: 'COMMENT_POSTED', workspaceId, projectId,
          taskId: comment.taskId, actorId: authorId, commentId: comment.id,
        });
      }
```

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: still FAIL only on `automation.routes.ts` (`svc.create` arity) — Task 9. The service hooks compile.

- [ ] Commit:
```
git add apps/api/src/modules/tasks/task.service.ts apps/api/src/modules/comments/comment.service.ts
git commit -m "feat(6a): emit typed automation domain events from task.service + comment.service"
```

---

### Task 9: REST routes — scope create, workspace listing, run history

**Files:**
- Modify: `apps/api/src/modules/automation/automation.routes.ts`
- Test: covered by Task 11 integration.

Steps:

- [ ] Rewrite `automation.routes.ts` — accept `scopeType`/`workspaceId` on create, widen GET to `projectId|workspaceId`, add `GET /automations/:id/runs`, and resolve the workspace for WORKSPACE-scoped creates directly from the body. Replace the schemas + create handler + add the runs route:

```ts
const createSchema = z.object({
  scopeType:   z.enum(['PROJECT', 'WORKSPACE']).default('PROJECT'),
  workspaceId: z.string().uuid(),
  projectId:   z.string().uuid().nullish(),
  name:        z.string().min(1).max(255),
  trigger:     triggerSchema,
  conditions:  z.array(conditionSchema).default([]),
  actions:     z.array(actionSchema).min(1),
}).refine((v) => v.scopeType === 'WORKSPACE' || !!v.projectId, {
  message: 'projectId is required for PROJECT-scoped rules',
  path: ['projectId'],
});
```

Replace the `resolveProjectWorkspaceFromBody` to honor scope (WORKSPACE rules carry `workspaceId` directly; PROJECT rules resolve it from `projectId`):

```ts
async function resolveCreateWorkspace(c: any): Promise<string | null> {
  try {
    const body = await c.req.json();
    if (body?.scopeType === 'WORKSPACE') return body?.workspaceId ?? null;
    return body?.projectId ? await projectRepoForLookup.getWorkspaceId(body.projectId) : null;
  } catch {
    return null;
  }
}
```

Replace the GET handler to support either scope and the POST handler to thread scope:

```ts
// GET /automations?projectId=  OR  ?workspaceId=
automationRoutes.get('/', async (c) => {
  const projectId   = c.req.query('projectId');
  const workspaceId = c.req.query('workspaceId');
  if (!projectId && !workspaceId) return c.json({ error: 'projectId or workspaceId required' }, 400);
  // List remains project-keyed (workspace listing reuses the same SP via the project path in 6d).
  const rules = await svc.list(projectId ?? workspaceId!);
  return c.json({ rules });
});

// POST /automations
automationRoutes.post(
  '/',
  zValidator('json', createSchema),
  requirePermission('automation.create', { resolveWorkspace: resolveCreateWorkspace }),
  async (c) => {
    const { scopeType, workspaceId, projectId, name, trigger, conditions, actions } = c.req.valid('json');
    const rule = await svc.create(
      scopeType, workspaceId, scopeType === 'WORKSPACE' ? null : (projectId ?? null),
      name, trigger as any, conditions as any, actions as any,
    );
    return c.json({ rule }, 201);
  },
);
```

Add the run-history route (after the DELETE route, gated by `automation.update` on the rule's resolved workspace):

```ts
// GET /automations/:id/runs — audited run history (newest first)
automationRoutes.get(
  '/:id/runs',
  requirePermission('automation.update', { resolveWorkspace: resolveAutomationWorkspace }),
  async (c) => {
    const id     = c.req.param('id');
    const limit  = Math.min(Number(c.req.query('limit')  ?? 50), 200);
    const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);
    const runs   = await svc.listRuns(id, limit, offset);
    return c.json({ runs });
  },
);
```

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS — the whole API package compiles (worker/actions/bus/service/routes consistent). Then `npm test --workspace apps/api -- loop-guard taxonomy`. Expected: PASS.

- [ ] Commit:
```
git add apps/api/src/modules/automation/automation.routes.ts
git commit -m "feat(6a): automation REST — scope-aware create + workspace listing + run-history route"
```

---

### Task 10: GraphQL mirror (`automation.schema.ts`)

**Files:**
- Create: `apps/api/src/graphql/automation.schema.ts`
- Modify: `apps/api/src/graphql/schema.ts` (import + call near the other `register*Graphql()` calls, ~line 774)

Steps:

- [ ] Write `automation.schema.ts`, mirroring `recurrence.schema.ts`'s structure (`builder.objectRef`, `notFound`/`requireWorkspacePermission` from `./authz.js`, delegating to the one shared `AutomationService`). Rules are transported with their JSON config as strings (mirrors `recurrence` rule + `SavedView.config`):

```ts
import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { AutomationService } from '../modules/automation/automation.service.js';
import { AutomationRepository } from '../modules/automation/automation.repository.js';
import { ProjectRepository } from '../modules/projects/project.repository.js';
import { notFound, requireWorkspacePermission } from './authz.js';
import type { AutomationRule, AutomationRun } from '@projectflow/types';

const svc      = new AutomationService();
const ruleRepo = new AutomationRepository();
const projRepo = new ProjectRepository();

export function registerAutomationGraphql(): void {
  const AutomationRuleType = builder.objectRef<AutomationRule>('AutomationRule');
  AutomationRuleType.implement({ fields: (t) => ({
    id:             t.exposeString('id'),
    scopeType:      t.exposeString('scopeType'),
    workspaceId:    t.exposeString('workspaceId'),
    projectId:      t.string({ nullable: true, resolve: (r) => r.projectId ?? null }),
    name:           t.exposeString('name'),
    isEnabled:      t.boolean({ resolve: (r) => r.isEnabled }),
    trigger:        t.string({ resolve: (r) => JSON.stringify(r.trigger) }),
    conditions:     t.string({ resolve: (r) => JSON.stringify(r.conditions) }),
    actions:        t.string({ resolve: (r) => JSON.stringify(r.actions) }),
    executionCount: t.exposeInt('executionCount'),
    lastExecutedAt: t.field({ type: 'Date', nullable: true, resolve: (r) => (r.lastExecutedAt ? new Date(r.lastExecutedAt) : null) }),
  }) });

  const AutomationRunType = builder.objectRef<AutomationRun>('AutomationRun');
  AutomationRunType.implement({ fields: (t) => ({
    id:            t.exposeString('id'),
    ruleId:        t.exposeString('ruleId'),
    triggerType:   t.exposeString('triggerType'),
    status:        t.exposeString('status'),
    error:         t.string({ nullable: true, resolve: (r) => r.error ?? null }),
    actionResults: t.string({ nullable: true, resolve: (r) => (r.actionResults ? JSON.stringify(r.actionResults) : null) }),
    depth:         t.exposeInt('depth'),
    startedAt:     t.field({ type: 'Date', resolve: (r) => new Date(r.startedAt) }),
    finishedAt:    t.field({ type: 'Date', nullable: true, resolve: (r) => (r.finishedAt ? new Date(r.finishedAt) : null) }),
    durationMs:    t.int({ nullable: true, resolve: (r) => r.durationMs ?? null }),
  }) });

  builder.queryFields((t) => ({
    automationRules: t.field({
      type: [AutomationRuleType],
      args: { projectId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const workspaceId = await projRepo.getWorkspaceId(a.projectId);
        if (!workspaceId) notFound('Project not found');
        await requireWorkspacePermission(ctx, workspaceId, 'automation.create');
        return svc.list(a.projectId);
      },
    }),
    automationRuns: t.field({
      type: [AutomationRunType],
      args: {
        ruleId: t.arg.string({ required: true }),
        limit:  t.arg.int({ required: false }),
        offset: t.arg.int({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        const workspaceId = await ruleRepo.getWorkspaceId(a.ruleId);
        if (!workspaceId) notFound('Rule not found');
        await requireWorkspacePermission(ctx, workspaceId, 'automation.update');
        return svc.listRuns(a.ruleId, a.limit ?? 50, a.offset ?? 0);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    createAutomationRule: t.field({
      type: AutomationRuleType,
      args: {
        scopeType:   t.arg.string({ required: true }),  // 'PROJECT' | 'WORKSPACE'
        workspaceId: t.arg.string({ required: true }),
        projectId:   t.arg.string({ required: false }),
        name:        t.arg.string({ required: true }),
        trigger:     t.arg.string({ required: true }),  // JSON string
        conditions:  t.arg.string({ required: true }),  // JSON string
        actions:     t.arg.string({ required: true }),  // JSON string
      },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'automation.create');
        let trigger: unknown, conditions: unknown, actions: unknown;
        try { trigger = JSON.parse(a.trigger); conditions = JSON.parse(a.conditions); actions = JSON.parse(a.actions); }
        catch { throw new GraphQLError('trigger/conditions/actions must be JSON strings', { extensions: { code: 'INVALID_INPUT' } }); }
        return svc.create(
          a.scopeType as any, a.workspaceId,
          a.scopeType === 'WORKSPACE' ? null : (a.projectId ?? null),
          a.name, trigger as any, conditions as any, actions as any,
        );
      },
    }),
    updateAutomationRule: t.field({
      type: AutomationRuleType,
      nullable: true,
      args: {
        id:         t.arg.string({ required: true }),
        name:       t.arg.string({ required: false }),
        trigger:    t.arg.string({ required: false }),
        conditions: t.arg.string({ required: false }),
        actions:    t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        const workspaceId = await ruleRepo.getWorkspaceId(a.id);
        if (!workspaceId) notFound('Rule not found');
        await requireWorkspacePermission(ctx, workspaceId, 'automation.update');
        return svc.update(a.id, {
          name:       a.name ?? undefined,
          trigger:    a.trigger    ? JSON.parse(a.trigger)    : undefined,
          conditions: a.conditions ? JSON.parse(a.conditions) : undefined,
          actions:    a.actions    ? JSON.parse(a.actions)    : undefined,
        });
      },
    }),
    toggleAutomationRule: t.field({
      type: AutomationRuleType,
      nullable: true,
      args: { id: t.arg.string({ required: true }), isEnabled: t.arg.boolean({ required: true }) },
      resolve: async (_, a, ctx) => {
        const workspaceId = await ruleRepo.getWorkspaceId(a.id);
        if (!workspaceId) notFound('Rule not found');
        await requireWorkspacePermission(ctx, workspaceId, 'automation.update');
        return svc.update(a.id, { isEnabled: a.isEnabled });
      },
    }),
    deleteAutomationRule: t.field({
      type: 'Boolean',
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const workspaceId = await ruleRepo.getWorkspaceId(a.id);
        if (!workspaceId) notFound('Rule not found');
        await requireWorkspacePermission(ctx, workspaceId, 'automation.delete');
        await svc.delete(a.id);
        return true;
      },
    }),
  }));
}
```

- [ ] Wire it into `schema.ts` — add the import alongside the others and call it near the other `register*Graphql()` calls (~line 774, after `registerPresenceGraphql()`):

```ts
import { registerAutomationGraphql } from './automation.schema.js';
```
```ts
// ─────────────────────────────────────────
// Automation (Phase 6a) — AutomationRule/AutomationRun types + automationRules/
// automationRuns queries + create/update/toggle/deleteAutomationRule mutations.
// ─────────────────────────────────────────
registerAutomationGraphql();
```

- [ ] Run: `npm run build --workspace apps/api` (tsc — compiles the Pothos schema). Expected: PASS — schema builds. Then `npm test --workspace apps/api`. Expected: PASS (existing GraphQL authz tests still green + the new unit tests).

- [ ] Commit:
```
git add apps/api/src/graphql/automation.schema.ts apps/api/src/graphql/schema.ts
git commit -m "feat(6a): GraphQL automation mirror — rules/runs queries + create/update/toggle/delete mutations"
```

---

### Task 11: Integration tests (engine fires + workspace scope + loop blocked)

**Files:**
- Create: `apps/api/src/modules/automation/__tests__/engine.integration.test.ts`
- Test: this file (run against `ProjectFlow_Test`).

Steps:

- [ ] Write the failing integration test first (copy the harness imports from `recurrence.integration.test.ts`: `testServer.js`, `truncate.js`, `factories.js`). It drives the REAL SQL stack + the bus + the worker logic via the SPs. Because the BullMQ worker is async, the test asserts on the synchronous SP/bus path by recording runs directly through the service, plus an end-to-end transition that exercises the `emitAutomationEvent` enqueue + a manual worker tick:

```ts
/**
 * Phase 6a — Automation engine activation integration coverage.
 * Exercises scope-aware rule resolution, run audit, and the loop guard against
 * the REAL SQL stack. DB SAFETY: must target local Docker ProjectFlow_Test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { AutomationRepository } from '../automation.repository.js';
import { shouldEnqueue } from '../automation.bus.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

const repo = new AutomationRepository();

async function seed() {
  const owner = await createTestUser({ email: `auto-${Date.now()}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const project = await createTestProject(ws.Id, token, { name: 'Auto', key: `AU${Date.now() % 100000}` });
  return { token, userId: owner.id, workspaceId: ws.Id, projectId: project.Id };
}

describe('automation scope-aware resolution', () => {
  it('a PROJECT-scoped STATUS_CHANGED rule is resolved by getByTrigger for its project', async () => {
    const { token, projectId, workspaceId } = await seed();
    const { rule } = await json<{ rule: any }>(await request('/automations', {
      method: 'POST', token,
      json: {
        scopeType: 'PROJECT', workspaceId, projectId, name: 'On Done assign QA',
        trigger: { type: 'STATUS_CHANGED', toStatus: 'Done' },
        conditions: [],
        actions: [{ type: 'ASSIGN', assigneeId: 'REPORTER' }],
      },
    }), 201);
    expect(rule.scopeType).toBe('PROJECT');

    const matched = await repo.getByTrigger(projectId, workspaceId, 'STATUS_CHANGED');
    expect(matched.map((r) => r.id)).toContain(rule.id);
  });

  it('a WORKSPACE-scoped rule is resolved for a task in ANY project of the workspace', async () => {
    const { token, projectId, workspaceId } = await seed();
    const { rule } = await json<{ rule: any }>(await request('/automations', {
      method: 'POST', token,
      json: {
        scopeType: 'WORKSPACE', workspaceId, projectId: null, name: 'WS-wide notify',
        trigger: { type: 'TASK_CREATED' }, conditions: [],
        actions: [{ type: 'SEND_NOTIFICATION', message: 'created' }],
      },
    }), 201);
    expect(rule.scopeType).toBe('WORKSPACE');
    expect(rule.projectId).toBeNull();

    // A different project's task (same workspace) still resolves the workspace rule.
    const matched = await repo.getByTrigger('00000000-0000-0000-0000-000000000000', workspaceId, 'TASK_CREATED');
    expect(matched.map((r) => r.id)).toContain(rule.id);
  });
});

describe('automation run audit + loop guard', () => {
  it('records a run row and bumps usage', async () => {
    const { token, projectId, workspaceId } = await seed();
    const { rule } = await json<{ rule: any }>(await request('/automations', {
      method: 'POST', token,
      json: {
        scopeType: 'PROJECT', workspaceId, projectId, name: 'r',
        trigger: { type: 'TASK_CREATED' }, conditions: [],
        actions: [{ type: 'SEND_NOTIFICATION', message: 'x' }],
      },
    }), 201);

    await repo.recordRun({
      ruleId: rule.id, workspaceId, projectId, triggerType: 'TASK_CREATED',
      status: 'success', depth: 0, startedAt: new Date(), durationMs: 12,
    });
    const runs = (await json<{ runs: any[] }>(await request(`/automations/${rule.id}/runs`, { token }))).runs;
    expect(runs.length).toBe(1);
    expect(runs[0].status).toBe('success');
  });

  it('records a loop_blocked run for a self-referential chain (pure guard)', () => {
    expect(shouldEnqueue('rule-a', { depth: 1, causationChain: ['rule-a'] }))
      .toEqual({ ok: false, reason: 'chain' });
    expect(shouldEnqueue('rule-a', { depth: 5, causationChain: [] }))
      .toEqual({ ok: false, reason: 'depth' });
  });
});
```

- [ ] Run: `npm run test:integration --workspace apps/api -- engine` against `ProjectFlow_Test`. Expected: FAIL on first run if the SPs/migrations aren't deployed; after deploying `0038`/`0039` + the Task 3 SPs (already done in Tasks 1–3), Expected: PASS (5 tests).

- [ ] Run the full API suites to catch rename fallout: `npm test --workspace apps/api` then `npm run test:integration --workspace apps/api` against `ProjectFlow_Test`. Expected: PASS.

- [ ] Commit:
```
git add apps/api/src/modules/automation/__tests__/engine.integration.test.ts
git commit -m "test(6a): integration — scope resolution + run audit/usage + loop-guard"
```

---

### Task 12: Frontend — taxonomy rename + scope selector + i18n

**Files:**
- Modify: `apps/next-web/src/app/(app)/automations/automations-view.tsx` (TRIGGER_KEYS lines 49–59, ACTION_KEYS 61–69, CONDITION_KEYS 71–78, DEFAULT_TRIGGER line 91, conditional branches ~387/567/575/741/749/777, handleSave ~176)
- Modify: `apps/next-web/src/server/actions/automations.ts` (CreateAutomationInput + createAutomation)
- Modify: `apps/next-web/messages/en.json` (Automations namespace, lines 414–500)
- Modify: `apps/next-web/messages/id.json` (same keys, real Indonesian)
- Note: read `node_modules/next/dist/docs/` per `apps/next-web/AGENTS.md` before writing web code (this Next.js has breaking changes).

Steps:

- [ ] Rename the label-key maps in `automations-view.tsx`. The map *keys* become the new enum tokens; the i18n key *values* are renamed in lockstep with `en.json`/`id.json`:

```tsx
const TRIGGER_KEYS: Record<AutomationTriggerType, string> = {
  TASK_CREATED:     'triggerTaskCreated',
  TASK_UPDATED:     'triggerTaskUpdated',
  STATUS_CHANGED:   'triggerStatusChanged',
  FIELD_CHANGED:    'triggerFieldChanged',
  ASSIGNEE_CHANGED: 'triggerAssigneeChanged',
  COMMENT_POSTED:   'triggerCommentPosted',
  SPRINT_STARTED:   'triggerSprintStarted',
  SPRINT_COMPLETED: 'triggerSprintCompleted',
  DUE_DATE_PASSED:  'triggerDueDatePassed',
  DATE_ARRIVED:     'triggerDateArrived',
  SCHEDULED:        'triggerScheduled',
  MANUAL:           'triggerManual',
  WEBHOOK:          'triggerWebhook',
};

const ACTION_KEYS: Record<AutomationActionType, string> = {
  CHANGE_STATUS:     'actionChangeStatus',
  ASSIGN:            'actionAssign',
  UNASSIGN:          'actionUnassign',
  SET_PRIORITY:      'actionSetPriority',
  POST_COMMENT:      'actionPostComment',
  SEND_NOTIFICATION: 'actionSendNotification',
  CALL_WEBHOOK:      'actionCallWebhook',
};

const CONDITION_KEYS: Record<AutomationConditionType, string> = {
  ISSUE_MATCHES_FILTER: 'conditionIssueMatchesFilter',
  FIELD_EQUALS:         'conditionFieldEquals',
  FIELD_NOT_EQUALS:     'conditionFieldNotEquals',
  USER_HAS_ROLE:        'conditionUserHasRole',
  IN_SPRINT:            'conditionInSprint',
  NOT_IN_SPRINT:        'conditionNotInSprint',
};
```

- [ ] Update the token literals scattered through the editors/badges:
  - `DEFAULT_TRIGGER` (line 91): `{ type: 'TASK_CREATED' }`.
  - RuleRow badge (line 387): `trigger.type === 'STATUS_CHANGED' && (trigger as any).toStatus && ...`.
  - TriggerEditor (line 567): `trigger.type === 'STATUS_CHANGED'`; (line 575): `trigger.type === 'DUE_DATE_PASSED'`.
  - ActionList default action (line 696): `{ type: 'SEND_NOTIFICATION', message: '' }` (unchanged token — keep).
  - ActionList branches: (line 741) `'CHANGE_STATUS'`; (line 749) `'ASSIGN'`; (line 768) `'POST_COMMENT' || ... === 'SEND_NOTIFICATION'`; (line 777) `'CALL_WEBHOOK'`.

- [ ] Add a scope selector to `RuleDialog`. Add `scopeType` state (default `'PROJECT'`) and a `Select` with two options bound to new i18n keys; thread it into `onSubmit`. Extend the `onSubmit` prop signature + the `handleSave` to pass `scopeType` + `workspaceId` from `ctx.activeWorkspaceId`:

```tsx
// In RuleDialog state:
const [scopeType, setScopeType] = useState<'PROJECT' | 'WORKSPACE'>('PROJECT');

// In the DialogBody, above TriggerEditor:
<div className="flex flex-col gap-1.5">
  <label className="text-xs font-medium text-muted-foreground">{t('scopeLabel')}</label>
  <Select value={scopeType} onValueChange={(v) => setScopeType(v as 'PROJECT' | 'WORKSPACE')}>
    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
    <SelectContent>
      <SelectItem value="PROJECT">{t('scopeThisProject')}</SelectItem>
      <SelectItem value="WORKSPACE">{t('scopeEntireWorkspace')}</SelectItem>
    </SelectContent>
  </Select>
</div>

// onSubmit call now passes scopeType:
onSubmit({ name: name.trim(), scopeType, trigger, conditions, actions });
```

Extend the `onSubmit` prop type + `Props.handleSave` accordingly, and in `handleSave` pass `scopeType` + `workspaceId: ctx.activeWorkspaceId!` (and `projectId: scopeType === 'WORKSPACE' ? null : ctx.activeProjectId`) into `createAutomation`.

- [ ] Update `server/actions/automations.ts` — extend `CreateAutomationInput` and the POST body:

```ts
export interface CreateAutomationInput {
  scopeType:   'PROJECT' | 'WORKSPACE';
  workspaceId: string;
  projectId:   string | null;
  name:        string;
  trigger:     unknown;
  conditions:  unknown[];
  actions:     unknown[];
}
```
and in `createAutomation` include `scopeType`, `workspaceId`, `projectId` in the JSON body.

- [ ] Rename the i18n keys in `en.json` (Automations namespace) — remove the old `triggerIssue*`/`actionTransitionIssue`/`actionAddComment`/`actionTriggerWebhook`/`triggerDueDateApproaching` keys and add the new ones + the scope keys:

```json
"triggerTaskCreated": "Task created",
"triggerTaskUpdated": "Task updated",
"triggerStatusChanged": "Status changed",
"triggerFieldChanged": "Field changed",
"triggerAssigneeChanged": "Assignee changed",
"triggerCommentPosted": "Comment posted",
"triggerSprintStarted": "Sprint started",
"triggerSprintCompleted": "Sprint completed",
"triggerDueDatePassed": "Due date passed",
"triggerDateArrived": "Date arrived",
"triggerScheduled": "Scheduled (cron)",
"triggerManual": "Manual / API trigger",
"triggerWebhook": "Incoming webhook",
"actionChangeStatus": "Change status",
"actionAssign": "Assign",
"actionUnassign": "Unassign",
"actionSetPriority": "Set priority",
"actionPostComment": "Post comment",
"actionSendNotification": "Send notification",
"actionCallWebhook": "Call webhook",
"scopeLabel": "Scope",
"scopeThisProject": "This project",
"scopeEntireWorkspace": "Entire workspace"
```
(Keep the `condition*` keys unchanged. Keep `transitionToStatusPlaceholder`/`hoursBeforeDuePlaceholder` etc. — they are still referenced.)

- [ ] Add the same keys to `id.json` with real Indonesian:

```json
"triggerTaskCreated": "Tugas dibuat",
"triggerTaskUpdated": "Tugas diperbarui",
"triggerStatusChanged": "Status berubah",
"triggerFieldChanged": "Bidang berubah",
"triggerAssigneeChanged": "Penerima tugas berubah",
"triggerCommentPosted": "Komentar diposting",
"triggerSprintStarted": "Sprint dimulai",
"triggerSprintCompleted": "Sprint selesai",
"triggerDueDatePassed": "Tenggat terlewati",
"triggerDateArrived": "Tanggal tiba",
"triggerScheduled": "Terjadwal (cron)",
"triggerManual": "Pemicu manual / API",
"triggerWebhook": "Webhook masuk",
"actionChangeStatus": "Ubah status",
"actionAssign": "Tetapkan",
"actionUnassign": "Batalkan penetapan",
"actionSetPriority": "Atur prioritas",
"actionPostComment": "Posting komentar",
"actionSendNotification": "Kirim notifikasi",
"actionCallWebhook": "Panggil webhook",
"scopeLabel": "Cakupan",
"scopeThisProject": "Proyek ini",
"scopeEntireWorkspace": "Seluruh ruang kerja"
```

- [ ] Run: `npm test --workspace apps/next-web` (includes the `messages.unit` i18n parity test). Expected: PASS — en/id key parity green; no orphaned old keys referenced. Then `npm run build --workspace apps/next-web`. Expected: PASS (Next build clean).

- [ ] Commit:
```
git add apps/next-web/src/app/\(app\)/automations/automations-view.tsx apps/next-web/src/server/actions/automations.ts apps/next-web/messages/en.json apps/next-web/messages/id.json
git commit -m "feat(6a): automations UI — ClickUp taxonomy labels + scope selector + i18n (en/id)"
```

---

### Task 13: Playwright e2e (headline flow) + DECISIONS.md + slice verification

**Files:**
- Create: `apps/next-web/e2e/automations.spec.ts`
- Modify: `DECISIONS.md` (append a Phase 6a entry)
- Note: e2e runs against local Docker `ProjectFlow_Test` only (use the project's existing e2e env/setup, same as the views/realtime specs).

Steps:

- [ ] Write the e2e spec covering the BUILD_PLAN acceptance flow — build a `STATUS_CHANGED → ASSIGN` rule in the builder, transition a seeded task to Done, and observe the assignment effect. Follow the existing spec harness (login helper, seeded project/task) used by the views/presence specs:

```ts
import { test, expect } from '@playwright/test';
import { loginAndSeedTask } from './helpers'; // existing helper used by other specs

test.describe('Phase 6a — automation engine activation', () => {
  test('a status-change rule fires and assigns when a task moves to Done', async ({ page }) => {
    const { taskUrl } = await loginAndSeedTask(page);

    // Build the rule in the Automations builder.
    await page.goto('/automations');
    await page.getByRole('button', { name: /new rule/i }).click();
    await page.getByLabel(/name/i).fill('On Done assign reporter');

    // Trigger: Status changed → Done.
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /status changed/i }).click();
    await page.getByPlaceholder(/only when transitioning to status/i).fill('Done');

    // Action: Assign (reporter).
    await page.getByRole('button', { name: /add action/i }).click();
    await page.getByRole('button', { name: /create rule/i }).click();
    await expect(page.getByText(/on done assign reporter/i)).toBeVisible();

    // Perform the trigger: move the task to Done.
    await page.goto(taskUrl);
    await page.getByRole('button', { name: /status/i }).click();
    await page.getByRole('option', { name: /^done$/i }).click();

    // The rule's effect is observable: an assignee chip appears (worker is async —
    // poll the UI until the automation completes).
    await expect(page.locator('[data-task-assignee]').first()).toBeVisible({ timeout: 15_000 });
  });
});
```

- [ ] Run: the project's e2e command for a single spec against `ProjectFlow_Test` (the same invocation the views/realtime specs use, e.g. `npx playwright test e2e/automations.spec.ts`). Expected: PASS (1 test) — rule created, transition performed, assignment effect observed within the worker poll window.

- [ ] Run the full slice verification on local Docker `ProjectFlow_Test`:
  - `npm test --workspace apps/api` — Expected: PASS (existing + `loop-guard`/`taxonomy` unit tests).
  - `npm run test:integration --workspace apps/api` — Expected: PASS (existing + `engine.integration.test.ts`).
  - `npm test --workspace apps/next-web` — Expected: PASS (unit + `messages.unit` parity).
  - `npm run build --workspace apps/api` and `npm run build --workspace apps/next-web` — Expected: both PASS.
  - The automations e2e — Expected: PASS.

- [ ] Append a `DECISIONS.md` entry logging: the explicit typed-domain-event emission (Architecture option B; rejected tapping `publishTaskEvent` and the outbox poller); the `0009`-rewire approach; the maintained (non-computed) `ScopeId` column + SP-maintained sync; the one-way defensive `0039` taxonomy JSON rewrite (REPLACE-on-known-tokens, not reversed in rollback); the `{depth, causationChain}` + `MAX_DEPTH=5` + 10s Redis cooldown loop guard; the deleted dead `enqueueForEvent`; `CALL_WEBHOOK` keeping the legacy `fetch` (signed dispatch deferred to 6c); WORKSPACE-scope listing reusing the project-keyed SP (full workspace listing UI deferred to 6d). DB-execution-policy note: all DB work ran ONLY against local Docker `ProjectFlow_Test`.

- [ ] Commit:
```
git add apps/next-web/e2e/automations.spec.ts DECISIONS.md
git commit -m "test(6a): e2e — status-change rule fires + assigns; DECISIONS entry for engine activation"
```

---

## Definition of Done

Per-slice DoD (spec §3) + BUILD_PLAN acceptance (spec §4.8):

- [ ] **BUILD_PLAN acceptance:** the "When status → Done, assign to QA (and set due +2d)" rule **runs reliably** — `STATUS_CHANGED` emitted from `transitionTask` resolves the rule via the scope-aware `usp_AutomationRule_GetByTrigger`, enqueues, and the worker executes `ASSIGN` (the +2d due-date variant uses `FIELD_CHANGED`/`SET_FIELD`; the dueDate path lands fully in 6c, but `ASSIGN` proves the engine fires).
- [ ] **BUILD_PLAN acceptance:** the **infinite-loop guard** prevents self-retrigger — `shouldEnqueue` drops at `depth >= MAX_DEPTH` (5) or when the rule id is in the causation chain, and records a `loop_blocked` `AutomationRuns` row; the Redis `(ruleId, entityId)` cooldown damps thrash.
- [ ] Migrations `0038_automation_scope.sql` + `0039_automation_runs.sql` are idempotent, GO-batched, and **reversible** via their `rollback/*.down.sql` (apply→rollback→re-apply verified clean); the `0039` taxonomy rewrite is token-bounded (re-run no-op).
- [ ] SP-per-op: scope-aware `usp_AutomationRule_GetByTrigger`/`usp_AutomationRule_Create`, new `usp_AutomationRun_Record` (with `AutomationUsage` bump) + `usp_AutomationRun_ListByRule`.
- [ ] The dead `AutomationService.enqueueForEvent` is **deleted**; `automation.bus#emitAutomationEvent` is the sole entry point, wired into `task.service` (create/transition/update) + `comment.service.create`.
- [ ] REST is primary (scope create + workspace listing + `GET /automations/:id/runs`); the **GraphQL mirror** (`automationRules`, `automationRuns`, `createAutomationRule`, `updateAutomationRule`, `toggleAutomationRule`, `deleteAutomationRule`) delegates to the **one shared `AutomationService`**.
- [ ] Authorization fail-closed via `requirePermission('automation.create'|'.update'|'.delete')` with workspace resolution (WORKSPACE rules resolve directly) + `requireWorkspacePermission` on the GraphQL side.
- [ ] Unit tests (loop-guard depth/chain, taxonomy token map) + integration tests (scope resolution PROJECT + WORKSPACE, run audit/usage, loop-blocked) + ≥1 Playwright e2e for the headline flow — all green.
- [ ] `@projectflow/types` updated (enums renamed to ClickUp taxonomy + `AutomationScopeType`/`AutomationRun`/scope fields).
- [ ] i18n: renamed `Automations` trigger/action label keys + scope keys in **en.json + id.json** (real Indonesian); `messages.unit` parity green.
- [ ] All DB work (migrations, SP deploy, integration, e2e) ran **ONLY against local Docker `ProjectFlow_Test`** — never the prod-pointing `apps/api/.env`.
- [ ] `DECISIONS.md` entry logs the activation approach + deviations. **Stop for review/merge before Slice 6b.**

---

## Self-Review

**Spec §4 coverage — every sub-requirement maps to a task:**
- §4.1 data model (`0038_automation_scope` + `0039_automation_runs`/`AutomationUsage`) → Tasks 1, 2.
- §4.2 taxonomy rename (enum tokens + the folded data migration + types/zod/worker/frontend) → Task 2 (SQL rewrite), Task 4 (types), Task 5 (taxonomy map + unit test), Task 7 (action switches), Task 12 (frontend label maps + i18n).
- §4.3 engine activation (`automation.bus`/`emitAutomationEvent`, scope-aware `GetByTrigger`, service hooks, worker writes `AutomationRuns` + bumps `AutomationUsage`) → Tasks 3, 5, 6, 7, 8.
- §4.4 loop guard (`{depth, causationChain}`, `MAX_DEPTH=5`, `loop_blocked` row, Redis cooldown) → Task 5 (helpers + test), Task 7 (depth propagation), Task 8 (event emission carries loop), Task 11 (assert).
- §4.5 GraphQL mirror (`automationRules`/`automationRuns` + create/update/toggle/delete) → Task 10.
- §4.6 frontend (scope selector + renamed labels) → Task 12.
- §4.7 tests (unit loop-guard/scope/taxonomy; integration STATUS_CHANGED rule + workspace scope + loop-blocked; e2e) → Tasks 5, 11, 13.
- §4.8 acceptance (status→Done rule fires; loop guard) → Task 13 verification + DoD.

**Placeholder scan:** every code step contains real code (real SP/column/file names, real `execSpOne` arg shapes copied from the existing repo, real Pothos `builder` calls copied from `recurrence.schema.ts`, real i18n keys aligned with the existing `Automations` namespace). The one prose note (Task 6 `listRuns?` ternary) explicitly states the canonical single-name form to use. No "TBD" / "similar to Task N" / "add error handling" placeholders.

**Type/name consistency across tasks:** enum tokens (`TASK_CREATED`, `STATUS_CHANGED`, `CHANGE_STATUS`, `ASSIGN`, `POST_COMMENT`, `CALL_WEBHOOK`, `DUE_DATE_PASSED`) are identical in the `0039` SQL rewrite, `automation.taxonomy.ts`, `packages/types`, `automation.actions.ts`, and the frontend maps. Table/column names (`AutomationRuns`, `AutomationUsage`, `ScopeType`, `WorkspaceId`, `ScopeId`, `RunCount`, `Period`) match between `0038`/`0039`, the SPs, and the repo row interfaces. Bus identifiers (`emitAutomationEvent`, `shouldEnqueue`, `MAX_DEPTH`, `LoopContext`, `cooldownKey`) are referenced consistently across the bus, worker, actions, and tests. SP names (`usp_AutomationRule_GetByTrigger`/`_Create`, `usp_AutomationRun_Record`/`_ListByRule`) match between the procedure files and the repository calls. Migration numbers `0038`/`0039` follow the on-disk `0037` tip.
