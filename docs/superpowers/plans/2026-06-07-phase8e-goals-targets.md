# Phase 8e — Goals & Targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up Goals & Targets greenfield — goal folders, goals, and number/boolean/currency/task targets with an equal-weighted progress rollup that advances automatically as task-linked targets' tasks complete.

**Architecture:** A new `goals` module (migration `0046_goals.sql` → SP-per-op → repository → service → REST routes + GraphQL mirror over one shared service), with the per-kind ratio and goal-average math isolated in a pure, unit-tested module `goal-progress.ts` (mirroring `recurrence.ts`). Task-linked target rollup is event-driven: `goalService.recomputeForTask(taskId)` is invoked best-effort after-commit from `TaskService.transitionTask` (the same fire-and-forget seam Phase 5c recurrence uses), so closing a task advances any task-linked target's `CurrentValue` without ever faulting the transition; goal progress is computed on read from current target values.

**Tech Stack:** Hono REST + graphql-yoga/Pothos GraphQL, SQL Server stored procedures (`mssql`, tsx), Vitest (api unit + integration projects), Next.js SSR (next-intl), Playwright e2e.

**Prerequisite:** Phases 1–7 merged. (Independent of 8a–8d.)

---

## File Structure

**Create**
- `infra/sql/migrations/0046_goals.sql` — idempotent, GO-batched DDL for `GoalFolders`, `Goals`, `Targets`.
- `infra/sql/migrations/rollback/0046_goals.down.sql` — drops the three tables.
- `infra/sql/procedures/usp_GoalFolder_Create.sql` — insert a goal folder, `SELECT *`.
- `infra/sql/procedures/usp_GoalFolder_List.sql` — list workspace goal folders.
- `infra/sql/procedures/usp_GoalFolder_Delete.sql` — soft-delete a goal folder.
- `infra/sql/procedures/usp_Goal_Create.sql` — insert a goal, `SELECT *`.
- `infra/sql/procedures/usp_Goal_Update.sql` — update goal name/desc/due/status/folder, `SELECT *`.
- `infra/sql/procedures/usp_Goal_Delete.sql` — soft-delete a goal (+ its targets).
- `infra/sql/procedures/usp_Goal_GetById.sql` — one goal row.
- `infra/sql/procedures/usp_Goal_ListByWorkspace.sql` — goals in a workspace (optionally folder-scoped).
- `infra/sql/procedures/usp_Goal_GetWorkspaceId.sql` — workspace lookup for RBAC resolveWorkspace.
- `infra/sql/procedures/usp_Target_Create.sql` — insert a target under a goal, `SELECT *`.
- `infra/sql/procedures/usp_Target_Update.sql` — update a target's editable fields incl. `CurrentValue`, `SELECT *`.
- `infra/sql/procedures/usp_Target_Delete.sql` — delete a target.
- `infra/sql/procedures/usp_Target_ListByGoal.sql` — targets for a goal (ordered by Position).
- `infra/sql/procedures/usp_Target_RecomputeTaskValue.sql` — for a `task`-kind target, set `CurrentValue = completed`, `TargetValue = total` over its `TaskFilter` task-id list.
- `infra/sql/procedures/usp_Target_ListTaskTargetsForTask.sql` — task-kind targets whose filter includes a given task id (drives the recompute hook).
- `apps/api/src/modules/goals/goal-progress.ts` — PURE math: per-kind `targetRatio`, `goalProgress` average. Unit-tested, no I/O.
- `apps/api/src/modules/goals/goal.repository.ts` — SP wrappers + PascalCase→camelCase row mappers.
- `apps/api/src/modules/goals/goal.service.ts` — CRUD, progress resolver, `recomputeForTask(taskId)` best-effort hook. Exports `goalService` singleton + `InvalidGoalError`.
- `apps/api/src/modules/goals/goal.routes.ts` — REST routes (primary), `requirePermission` gated.
- `apps/api/src/graphql/goals.schema.ts` — GraphQL mirror (`registerGoalsGraphql()`).
- `apps/api/src/modules/goals/__tests__/goal-progress.unit.test.ts` — pure-math unit tests.
- `apps/api/src/modules/goals/__tests__/goal.integration.test.ts` — REST + SP + recompute-hook integration.
- `apps/next-web/src/app/(app)/goals/page.tsx` — Goals route (folders → goals).
- `apps/next-web/src/features/goals/goals-view.tsx` — folders/goals/targets surface with progress bars.
- `apps/next-web/src/features/goals/target-editor.tsx` — add/edit a target of each kind + task picker.
- `apps/next-web/src/features/goals/goal-progress.ts` — client copy of the pure ratio/average math (shared shape).
- `apps/next-web/src/features/goals/__tests__/goal-progress.unit.test.ts` — client pure-math unit tests.
- `e2e/goals.spec.ts` — headline flow: create a goal + task-linked target, complete the tasks, progress reaches 100%.

**Modify**
- `packages/types/index.ts` — add `GoalFolder`, `Goal`, `Target`, `TargetKind`, `GoalStatus`, `GoalScopeType`, input types.
- `apps/api/src/modules/tasks/task.service.ts` — after-commit best-effort `goalService.recomputeForTask(taskId)` call in `transitionTask`.
- `apps/api/src/server.ts` — import + mount `goalRoutes` under `/goals` with `authMiddleware`.
- `apps/api/src/graphql/schema.ts` — import + call `registerGoalsGraphql()`.
- `apps/next-web/messages/en.json` — `Goals` namespace strings.
- `apps/next-web/messages/id.json` — `Goals` namespace strings (real Indonesian).

---

## Tasks

### Task 1: Migration `0046_goals.sql` + rollback

**Files:** `infra/sql/migrations/0046_goals.sql`, `infra/sql/migrations/rollback/0046_goals.down.sql`

- [ ] Write `infra/sql/migrations/0046_goals.sql` (idempotent sys-catalog guards, GO-batched), exactly:

```sql
-- =============================================================================
-- Migration 0046: Goals & Targets (Phase 8e, greenfield)
-- GoalFolders → Goals → Targets. A Target keeps CurrentValue (user-maintained
-- for number/currency/boolean, recomputed for kind='task' = completed over its
-- TaskFilter). Goal progress is computed on read (equal-weighted average of
-- target ratios) — no stored goal-progress column.
-- Idempotent (sys.tables / COL_LENGTH guards), GO-batched.
-- Rollback in rollback/0046_goals.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'GoalFolders')
BEGIN
    CREATE TABLE dbo.GoalFolders (
        Id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL,
        Name        NVARCHAR(200)    NOT NULL,
        OwnerId     UNIQUEIDENTIFIER NOT NULL,
        CreatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        DeletedAt   DATETIME2        NULL
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GoalFolder_Workspace' AND object_id = OBJECT_ID('dbo.GoalFolders'))
    CREATE NONCLUSTERED INDEX IX_GoalFolder_Workspace ON dbo.GoalFolders (WorkspaceId) WHERE DeletedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Goals')
BEGIN
    CREATE TABLE dbo.Goals (
        Id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL,
        ScopeType   NVARCHAR(12)     NOT NULL DEFAULT 'WORKSPACE',  -- WORKSPACE|SPACE|FOLDER|LIST
        ScopeId     UNIQUEIDENTIFIER NULL,
        FolderId    UNIQUEIDENTIFIER NULL REFERENCES dbo.GoalFolders(Id),
        Name        NVARCHAR(300)    NOT NULL,
        Description NVARCHAR(MAX)    NULL,
        OwnerId     UNIQUEIDENTIFIER NOT NULL,
        DueDate     DATE             NULL,
        Status      NVARCHAR(12)     NOT NULL DEFAULT 'active',     -- active|achieved|archived
        CreatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        DeletedAt   DATETIME2        NULL
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Goal_Workspace' AND object_id = OBJECT_ID('dbo.Goals'))
    CREATE NONCLUSTERED INDEX IX_Goal_Workspace ON dbo.Goals (WorkspaceId) WHERE DeletedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Goal_Folder' AND object_id = OBJECT_ID('dbo.Goals'))
    CREATE NONCLUSTERED INDEX IX_Goal_Folder ON dbo.Goals (FolderId) WHERE DeletedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Targets')
BEGIN
    CREATE TABLE dbo.Targets (
        Id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        GoalId       UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Goals(Id),
        Kind         NVARCHAR(10)     NOT NULL,                     -- number|boolean|currency|task
        Name         NVARCHAR(300)    NOT NULL,
        Unit         NVARCHAR(20)     NULL,
        CurrencyCode CHAR(3)          NULL,
        StartValue   FLOAT            NULL,
        TargetValue  FLOAT            NULL,
        CurrentValue FLOAT            NULL,
        TaskFilter   NVARCHAR(MAX)    NULL,                         -- JSON { taskIds:[...] } for Kind='task'
        Position     FLOAT            NOT NULL DEFAULT 0,
        CreatedAt    DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt    DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Target_Goal' AND object_id = OBJECT_ID('dbo.Targets'))
    CREATE NONCLUSTERED INDEX IX_Target_Goal ON dbo.Targets (GoalId);
GO
```

- [ ] Write `infra/sql/migrations/rollback/0046_goals.down.sql`, exactly:

```sql
-- Rollback 0046: Goals & Targets. Drop in FK order (Targets → Goals → GoalFolders).
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Targets')      DROP TABLE dbo.Targets;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Goals')        DROP TABLE dbo.Goals;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'GoalFolders')  DROP TABLE dbo.GoalFolders;
GO
```

- [ ] Run (LOCAL DOCKER `ProjectFlow_Test` ONLY — set the local DB env, never use `apps/api/.env`):
  `npx tsx apps/api/scripts/db-migrate.ts` (or the repo's migrate script). Expected output: migration `0046_goals` applied with no error; `Targets`, `Goals`, `GoalFolders` exist.
- [ ] Verify rollback: apply the down script via the rollback runner; expected: the three tables drop with no error. Re-apply `0046` to leave the DB forward.
- [ ] Commit: `feat(8e): migration 0046 goals/targets + rollback`

### Task 2: Pure progress math `goal-progress.ts` (unit-test-first)

**Files:** `apps/api/src/modules/goals/__tests__/goal-progress.unit.test.ts`, `apps/api/src/modules/goals/goal-progress.ts`

- [ ] Write the failing unit test `apps/api/src/modules/goals/__tests__/goal-progress.unit.test.ts`, exactly:

```ts
import { describe, it, expect } from 'vitest';
import { targetRatio, goalProgress, type TargetShape } from '../goal-progress.js';

const t = (p: Partial<TargetShape>): TargetShape => ({
  kind: 'number', startValue: null, targetValue: null, currentValue: null, ...p,
});

describe('targetRatio', () => {
  it('number: (current - start) / (target - start), clamped 0..1', () => {
    expect(targetRatio(t({ kind: 'number', startValue: 0, targetValue: 100, currentValue: 25 }))).toBeCloseTo(0.25);
    expect(targetRatio(t({ kind: 'number', startValue: 10, targetValue: 20, currentValue: 15 }))).toBeCloseTo(0.5);
  });

  it('number: below start clamps to 0, above target clamps to 1', () => {
    expect(targetRatio(t({ kind: 'number', startValue: 10, targetValue: 20, currentValue: 5 }))).toBe(0);
    expect(targetRatio(t({ kind: 'number', startValue: 10, targetValue: 20, currentValue: 99 }))).toBe(1);
  });

  it('number: degenerate target===start → 0 (no progress definable)', () => {
    expect(targetRatio(t({ kind: 'number', startValue: 5, targetValue: 5, currentValue: 5 }))).toBe(0);
  });

  it('currency: same formula as number', () => {
    expect(targetRatio(t({ kind: 'currency', startValue: 0, targetValue: 1000, currentValue: 500 }))).toBeCloseTo(0.5);
  });

  it('boolean: 1 when current >= 1, else 0', () => {
    expect(targetRatio(t({ kind: 'boolean', currentValue: 1 }))).toBe(1);
    expect(targetRatio(t({ kind: 'boolean', currentValue: 0 }))).toBe(0);
    expect(targetRatio(t({ kind: 'boolean', currentValue: null }))).toBe(0);
  });

  it('task: completed (current) / total (target), clamped, 0 when no tasks', () => {
    expect(targetRatio(t({ kind: 'task', currentValue: 3, targetValue: 4 }))).toBeCloseTo(0.75);
    expect(targetRatio(t({ kind: 'task', currentValue: 4, targetValue: 4 }))).toBe(1);
    expect(targetRatio(t({ kind: 'task', currentValue: 0, targetValue: 0 }))).toBe(0);
  });

  it('null current → 0 for value kinds', () => {
    expect(targetRatio(t({ kind: 'number', startValue: 0, targetValue: 100, currentValue: null }))).toBe(0);
  });
});

describe('goalProgress', () => {
  it('equal-weighted average of target ratios', () => {
    const targets: TargetShape[] = [
      t({ kind: 'boolean', currentValue: 1 }),                                    // 1
      t({ kind: 'number', startValue: 0, targetValue: 100, currentValue: 50 }),   // 0.5
      t({ kind: 'task', currentValue: 0, targetValue: 4 }),                       // 0
    ];
    expect(goalProgress(targets)).toBeCloseTo((1 + 0.5 + 0) / 3);
  });

  it('no targets → 0', () => {
    expect(goalProgress([])).toBe(0);
  });

  it('all complete → 1', () => {
    expect(goalProgress([t({ kind: 'boolean', currentValue: 1 }), t({ kind: 'task', currentValue: 2, targetValue: 2 })])).toBe(1);
  });
});
```

- [ ] Run: `npm --workspace apps/api run test:unit -- goal-progress` (from repo root). Expected: FAIL — `Cannot find module '../goal-progress.js'`.
- [ ] Write `apps/api/src/modules/goals/goal-progress.ts`, exactly:

```ts
/**
 * Pure Goals progress math (Phase 8e). No I/O — heavily unit-tested.
 *
 * A Target's completion RATIO is in [0,1] and derived per kind:
 *   number/currency: (current - start) / (target - start)   (clamped 0..1)
 *   boolean:         1 when current >= 1, else 0
 *   task:            current (completed) / target (total)    (clamped 0..1)
 *
 * Goal PROGRESS is the equal-weighted average of its targets' ratios (no stored
 * goal-progress column — computed on read). An empty goal is 0.
 */

export type TargetKind = 'number' | 'boolean' | 'currency' | 'task';

export interface TargetShape {
  kind: TargetKind;
  startValue: number | null;
  targetValue: number | null;
  currentValue: number | null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Completion ratio in [0,1] for a single target. */
export function targetRatio(t: TargetShape): number {
  const cur = t.currentValue ?? 0;
  switch (t.kind) {
    case 'boolean':
      return cur >= 1 ? 1 : 0;
    case 'task': {
      const total = t.targetValue ?? 0;
      if (total <= 0) return 0;
      return clamp01(cur / total);
    }
    case 'number':
    case 'currency':
    default: {
      const start = t.startValue ?? 0;
      const target = t.targetValue ?? 0;
      const span = target - start;
      if (span === 0) return 0;
      return clamp01((cur - start) / span);
    }
  }
}

/** Equal-weighted average of target ratios; 0 when there are no targets. */
export function goalProgress(targets: TargetShape[]): number {
  if (!targets.length) return 0;
  const sum = targets.reduce((acc, t) => acc + targetRatio(t), 0);
  return sum / targets.length;
}
```

- [ ] Run: `npm --workspace apps/api run test:unit -- goal-progress`. Expected: PASS (all cases green).
- [ ] Commit: `feat(8e): pure goal-progress math (per-kind ratio + goal average)`

### Task 3: Goal-folder + goal + target CRUD SPs

**Files:** `infra/sql/procedures/usp_GoalFolder_Create.sql`, `usp_GoalFolder_List.sql`, `usp_GoalFolder_Delete.sql`, `usp_Goal_Create.sql`, `usp_Goal_Update.sql`, `usp_Goal_Delete.sql`, `usp_Goal_GetById.sql`, `usp_Goal_ListByWorkspace.sql`, `usp_Goal_GetWorkspaceId.sql`, `usp_Target_Create.sql`, `usp_Target_Update.sql`, `usp_Target_Delete.sql`, `usp_Target_ListByGoal.sql`

- [ ] Write `usp_GoalFolder_Create.sql`:

```sql
-- Phase 8e: create a goal folder. SELECT * of the new row.
CREATE OR ALTER PROCEDURE dbo.usp_GoalFolder_Create
    @WorkspaceId UNIQUEIDENTIFIER,
    @Name        NVARCHAR(200),
    @OwnerId     UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        DECLARE @Id UNIQUEIDENTIFIER = NEWID();
        INSERT INTO dbo.GoalFolders (Id, WorkspaceId, Name, OwnerId)
        VALUES (@Id, @WorkspaceId, @Name, @OwnerId);
        SELECT * FROM dbo.GoalFolders WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] Write `usp_GoalFolder_List.sql`:

```sql
-- Phase 8e: list non-deleted goal folders in a workspace.
CREATE OR ALTER PROCEDURE dbo.usp_GoalFolder_List
    @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        SELECT * FROM dbo.GoalFolders
        WHERE WorkspaceId = @WorkspaceId AND DeletedAt IS NULL
        ORDER BY CreatedAt ASC;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] Write `usp_GoalFolder_Delete.sql`:

```sql
-- Phase 8e: soft-delete a goal folder. Goals retain FolderId (orphaned folder ref
-- is tolerated by reads, which left-join). Idempotent.
CREATE OR ALTER PROCEDURE dbo.usp_GoalFolder_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        UPDATE dbo.GoalFolders
        SET DeletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
        WHERE Id = @Id AND DeletedAt IS NULL;
        SELECT @@ROWCOUNT AS Deleted;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] Write `usp_Goal_Create.sql`:

```sql
-- Phase 8e: create a goal. Defaults Status='active'. SELECT * of the new row.
CREATE OR ALTER PROCEDURE dbo.usp_Goal_Create
    @WorkspaceId UNIQUEIDENTIFIER,
    @ScopeType   NVARCHAR(12),
    @ScopeId     UNIQUEIDENTIFIER = NULL,
    @FolderId    UNIQUEIDENTIFIER = NULL,
    @Name        NVARCHAR(300),
    @Description NVARCHAR(MAX) = NULL,
    @OwnerId     UNIQUEIDENTIFIER,
    @DueDate     DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        DECLARE @Id UNIQUEIDENTIFIER = NEWID();
        INSERT INTO dbo.Goals (Id, WorkspaceId, ScopeType, ScopeId, FolderId, Name, Description, OwnerId, DueDate, Status)
        VALUES (@Id, @WorkspaceId, @ScopeType, @ScopeId, @FolderId, @Name, @Description, @OwnerId, @DueDate, 'active');
        SELECT * FROM dbo.Goals WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] Write `usp_Goal_Update.sql`:

```sql
-- Phase 8e: update editable goal fields (NULL @param = leave unchanged, except
-- @FolderId which is always assigned so a goal can be moved out of a folder by
-- passing NULL — callers that want "unchanged" must read+resend the current id).
CREATE OR ALTER PROCEDURE dbo.usp_Goal_Update
    @Id          UNIQUEIDENTIFIER,
    @Name        NVARCHAR(300) = NULL,
    @Description NVARCHAR(MAX) = NULL,
    @DueDate     DATE = NULL,
    @Status      NVARCHAR(12) = NULL,
    @FolderId    UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF @Status IS NOT NULL AND @Status NOT IN ('active','achieved','archived')
            THROW 52800, 'Invalid goal status', 1;
        UPDATE dbo.Goals
        SET Name        = COALESCE(@Name, Name),
            Description = COALESCE(@Description, Description),
            DueDate     = COALESCE(@DueDate, DueDate),
            Status      = COALESCE(@Status, Status),
            FolderId    = @FolderId,
            UpdatedAt   = SYSUTCDATETIME()
        WHERE Id = @Id AND DeletedAt IS NULL;
        SELECT * FROM dbo.Goals WHERE Id = @Id AND DeletedAt IS NULL;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] Write `usp_Goal_Delete.sql`:

```sql
-- Phase 8e: soft-delete a goal and hard-delete its targets (targets are leaf,
-- not referenced elsewhere). Transactional. Idempotent on the goal soft-delete.
CREATE OR ALTER PROCEDURE dbo.usp_Goal_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        DELETE FROM dbo.Targets WHERE GoalId = @Id;
        UPDATE dbo.Goals
        SET DeletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
        WHERE Id = @Id AND DeletedAt IS NULL;
        SELECT @@ROWCOUNT AS Deleted;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
```

- [ ] Write `usp_Goal_GetById.sql`:

```sql
-- Phase 8e: one non-deleted goal by id (0 rows when missing/deleted).
CREATE OR ALTER PROCEDURE dbo.usp_Goal_GetById
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        SELECT * FROM dbo.Goals WHERE Id = @Id AND DeletedAt IS NULL;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] Write `usp_Goal_ListByWorkspace.sql`:

```sql
-- Phase 8e: list non-deleted goals in a workspace; optional @FolderId filter
-- (NULL = all goals across folders + unfoldered).
CREATE OR ALTER PROCEDURE dbo.usp_Goal_ListByWorkspace
    @WorkspaceId UNIQUEIDENTIFIER,
    @FolderId    UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        SELECT * FROM dbo.Goals
        WHERE WorkspaceId = @WorkspaceId AND DeletedAt IS NULL
          AND (@FolderId IS NULL OR FolderId = @FolderId)
        ORDER BY CreatedAt ASC;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] Write `usp_Goal_GetWorkspaceId.sql`:

```sql
-- Phase 8e: resolve a goal's WorkspaceId for RBAC resolveWorkspace (0 rows when missing).
CREATE OR ALTER PROCEDURE dbo.usp_Goal_GetWorkspaceId
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        SELECT WorkspaceId FROM dbo.Goals WHERE Id = @Id AND DeletedAt IS NULL;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] Write `usp_Target_Create.sql`:

```sql
-- Phase 8e: create a target under a goal. Validates the goal exists + Kind.
-- Position defaults to the count of existing targets (append). SELECT * of the row.
CREATE OR ALTER PROCEDURE dbo.usp_Target_Create
    @GoalId       UNIQUEIDENTIFIER,
    @Kind         NVARCHAR(10),
    @Name         NVARCHAR(300),
    @Unit         NVARCHAR(20) = NULL,
    @CurrencyCode CHAR(3) = NULL,
    @StartValue   FLOAT = NULL,
    @TargetValue  FLOAT = NULL,
    @CurrentValue FLOAT = NULL,
    @TaskFilter   NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF @Kind NOT IN ('number','boolean','currency','task')
            THROW 52801, 'Invalid target kind', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.Goals WHERE Id = @GoalId AND DeletedAt IS NULL)
            THROW 52802, 'Goal not found', 1;

        DECLARE @Id UNIQUEIDENTIFIER = NEWID();
        DECLARE @Pos FLOAT = (SELECT ISNULL(MAX(Position), -1) + 1 FROM dbo.Targets WHERE GoalId = @GoalId);

        INSERT INTO dbo.Targets (Id, GoalId, Kind, Name, Unit, CurrencyCode, StartValue, TargetValue, CurrentValue, TaskFilter, Position)
        VALUES (@Id, @GoalId, @Kind, @Name, @Unit, @CurrencyCode, @StartValue, @TargetValue, @CurrentValue, @TaskFilter, @Pos);
        SELECT * FROM dbo.Targets WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] Write `usp_Target_Update.sql`:

```sql
-- Phase 8e: update a target's editable fields (NULL = leave unchanged). Used for
-- the user-maintained CurrentValue on number/currency/boolean targets and for
-- editing name/unit/start/target/filter. SELECT * of the updated row.
CREATE OR ALTER PROCEDURE dbo.usp_Target_Update
    @Id           UNIQUEIDENTIFIER,
    @Name         NVARCHAR(300) = NULL,
    @Unit         NVARCHAR(20) = NULL,
    @CurrencyCode CHAR(3) = NULL,
    @StartValue   FLOAT = NULL,
    @TargetValue  FLOAT = NULL,
    @CurrentValue FLOAT = NULL,
    @TaskFilter   NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        UPDATE dbo.Targets
        SET Name         = COALESCE(@Name, Name),
            Unit         = COALESCE(@Unit, Unit),
            CurrencyCode = COALESCE(@CurrencyCode, CurrencyCode),
            StartValue   = COALESCE(@StartValue, StartValue),
            TargetValue  = COALESCE(@TargetValue, TargetValue),
            CurrentValue = COALESCE(@CurrentValue, CurrentValue),
            TaskFilter   = COALESCE(@TaskFilter, TaskFilter),
            UpdatedAt    = SYSUTCDATETIME()
        WHERE Id = @Id;
        SELECT * FROM dbo.Targets WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] Write `usp_Target_Delete.sql`:

```sql
-- Phase 8e: hard-delete a target (leaf row). Idempotent.
CREATE OR ALTER PROCEDURE dbo.usp_Target_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        DELETE FROM dbo.Targets WHERE Id = @Id;
        SELECT @@ROWCOUNT AS Deleted;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] Write `usp_Target_ListByGoal.sql`:

```sql
-- Phase 8e: targets for a goal, ordered by Position then CreatedAt.
CREATE OR ALTER PROCEDURE dbo.usp_Target_ListByGoal
    @GoalId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        SELECT * FROM dbo.Targets WHERE GoalId = @GoalId ORDER BY Position ASC, CreatedAt ASC;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] Run (LOCAL DOCKER `ProjectFlow_Test` ONLY): `npx tsx apps/api/scripts/db-deploy-sps.ts`. Expected: all 13 `usp_Goal*`/`usp_GoalFolder*`/`usp_Target*` procedures deploy with no error.
- [ ] Commit: `feat(8e): goal-folder/goal/target CRUD stored procedures`

### Task 4: Task-target recompute SPs

**Files:** `infra/sql/procedures/usp_Target_RecomputeTaskValue.sql`, `infra/sql/procedures/usp_Target_ListTaskTargetsForTask.sql`

- [ ] Write `usp_Target_RecomputeTaskValue.sql`. A `task` target's `TaskFilter` is JSON `{ "taskIds": ["<guid>", ...] }`; completed = tasks with `ResolvedAt IS NOT NULL` (mirrors `usp_TaskCustomField_RecomputeProgressAuto`'s done test), total = count of non-deleted tasks in the id list. Sets `CurrentValue=completed`, `TargetValue=total`:

```sql
-- Phase 8e: recompute a task-kind target's CurrentValue (completed) + TargetValue
-- (total) over its TaskFilter task-id list. Done = ResolvedAt IS NOT NULL (same
-- "done" test as usp_TaskCustomField_RecomputeProgressAuto). No-op for non-task
-- targets. SELECT * of the (possibly updated) target row.
CREATE OR ALTER PROCEDURE dbo.usp_Target_RecomputeTaskValue
    @TargetId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        DECLARE @Kind NVARCHAR(10), @Filter NVARCHAR(MAX);
        SELECT @Kind = Kind, @Filter = TaskFilter FROM dbo.Targets WHERE Id = @TargetId;
        IF @Kind IS NULL RETURN;
        IF @Kind <> 'task' BEGIN SELECT * FROM dbo.Targets WHERE Id = @TargetId; RETURN; END

        DECLARE @Total INT = 0, @Done INT = 0;
        IF @Filter IS NOT NULL AND ISJSON(@Filter) = 1
        BEGIN
            ;WITH Ids AS (
                SELECT TRY_CONVERT(UNIQUEIDENTIFIER, value) AS TaskId
                FROM OPENJSON(@Filter, '$.taskIds')
            )
            SELECT @Total = COUNT(*),
                   @Done  = SUM(CASE WHEN t.ResolvedAt IS NOT NULL THEN 1 ELSE 0 END)
            FROM dbo.Tasks t
            JOIN Ids ON Ids.TaskId = t.Id
            WHERE t.DeletedAt IS NULL;
        END

        UPDATE dbo.Targets
        SET CurrentValue = ISNULL(@Done, 0),
            TargetValue  = ISNULL(@Total, 0),
            UpdatedAt    = SYSUTCDATETIME()
        WHERE Id = @TargetId;

        SELECT * FROM dbo.Targets WHERE Id = @TargetId;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] Write `usp_Target_ListTaskTargetsForTask.sql` — returns the ids of all task-kind targets whose `TaskFilter.taskIds` includes `@TaskId`, so the recompute hook knows which targets to refresh when a task completes:

```sql
-- Phase 8e: task-kind targets whose TaskFilter.taskIds includes @TaskId. Drives
-- goalService.recomputeForTask — when a task transitions, recompute only the
-- targets that actually count it. Returns Target Id + GoalId.
CREATE OR ALTER PROCEDURE dbo.usp_Target_ListTaskTargetsForTask
    @TaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        SELECT t.Id, t.GoalId
        FROM dbo.Targets t
        WHERE t.Kind = 'task'
          AND t.TaskFilter IS NOT NULL
          AND ISJSON(t.TaskFilter) = 1
          AND EXISTS (
              SELECT 1 FROM OPENJSON(t.TaskFilter, '$.taskIds') j
              WHERE TRY_CONVERT(UNIQUEIDENTIFIER, j.value) = @TaskId
          );
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] Run (LOCAL DOCKER `ProjectFlow_Test` ONLY): `npx tsx apps/api/scripts/db-deploy-sps.ts`. Expected: `usp_Target_RecomputeTaskValue` + `usp_Target_ListTaskTargetsForTask` deploy with no error.
- [ ] Commit: `feat(8e): task-target recompute + per-task target lookup SPs`

### Task 5: Repository

**Files:** `apps/api/src/modules/goals/goal.repository.ts`

- [ ] Write `apps/api/src/modules/goals/goal.repository.ts`, exactly:

```ts
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { GoalFolder, Goal, Target, GoalScopeType, GoalStatus, TargetKind } from '@projectflow/types';

/** Map a GoalFolders SP row (PascalCase, SELECT *) → camelCase contract. */
export function mapFolderRow(r: any): GoalFolder {
  return {
    id: r.Id, workspaceId: r.WorkspaceId, name: r.Name, ownerId: r.OwnerId,
    createdAt: String(r.CreatedAt), updatedAt: String(r.UpdatedAt),
  };
}

/** Map a Goals SP row → camelCase contract. */
export function mapGoalRow(r: any): Goal {
  return {
    id: r.Id, workspaceId: r.WorkspaceId,
    scopeType: r.ScopeType as GoalScopeType, scopeId: r.ScopeId ?? null,
    folderId: r.FolderId ?? null, name: r.Name, description: r.Description ?? null,
    ownerId: r.OwnerId, dueDate: r.DueDate ? String(r.DueDate) : null,
    status: r.Status as GoalStatus,
    createdAt: String(r.CreatedAt), updatedAt: String(r.UpdatedAt),
  };
}

/** Map a Targets SP row → camelCase contract. */
export function mapTargetRow(r: any): Target {
  return {
    id: r.Id, goalId: r.GoalId, kind: r.Kind as TargetKind, name: r.Name,
    unit: r.Unit ?? null, currencyCode: r.CurrencyCode ?? null,
    startValue: r.StartValue ?? null, targetValue: r.TargetValue ?? null,
    currentValue: r.CurrentValue ?? null,
    taskFilter: r.TaskFilter ?? null, position: Number(r.Position ?? 0),
    createdAt: String(r.CreatedAt), updatedAt: String(r.UpdatedAt),
  };
}

export class GoalRepository {
  // ── Folders ──
  async createFolder(p: { workspaceId: string; name: string; ownerId: string }): Promise<GoalFolder> {
    const rows = await execSpOne('usp_GoalFolder_Create', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: p.workspaceId },
      { name: 'Name', type: sql.NVarChar(200), value: p.name },
      { name: 'OwnerId', type: sql.UniqueIdentifier, value: p.ownerId },
    ]);
    return mapFolderRow(rows[0]);
  }
  async listFolders(workspaceId: string): Promise<GoalFolder[]> {
    const rows = await execSpOne('usp_GoalFolder_List', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    ]);
    return (rows as any[]).map(mapFolderRow);
  }
  async deleteFolder(id: string): Promise<number> {
    const rows = await execSpOne<{ Deleted: number }>('usp_GoalFolder_Delete', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0]?.Deleted ?? 0;
  }

  // ── Goals ──
  async createGoal(p: {
    workspaceId: string; scopeType: GoalScopeType; scopeId: string | null;
    folderId: string | null; name: string; description: string | null;
    ownerId: string; dueDate: string | null;
  }): Promise<Goal> {
    const rows = await execSpOne('usp_Goal_Create', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: p.workspaceId },
      { name: 'ScopeType', type: sql.NVarChar(12), value: p.scopeType },
      { name: 'ScopeId', type: sql.UniqueIdentifier, value: p.scopeId },
      { name: 'FolderId', type: sql.UniqueIdentifier, value: p.folderId },
      { name: 'Name', type: sql.NVarChar(300), value: p.name },
      { name: 'Description', type: sql.NVarChar(sql.MAX), value: p.description },
      { name: 'OwnerId', type: sql.UniqueIdentifier, value: p.ownerId },
      { name: 'DueDate', type: sql.Date, value: p.dueDate ? new Date(p.dueDate) : null },
    ]);
    return mapGoalRow(rows[0]);
  }
  async updateGoal(id: string, p: {
    name?: string | null; description?: string | null; dueDate?: string | null;
    status?: GoalStatus | null; folderId?: string | null;
  }): Promise<Goal | null> {
    const rows = await execSpOne('usp_Goal_Update', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
      { name: 'Name', type: sql.NVarChar(300), value: p.name ?? null },
      { name: 'Description', type: sql.NVarChar(sql.MAX), value: p.description ?? null },
      { name: 'DueDate', type: sql.Date, value: p.dueDate ? new Date(p.dueDate) : null },
      { name: 'Status', type: sql.NVarChar(12), value: p.status ?? null },
      { name: 'FolderId', type: sql.UniqueIdentifier, value: p.folderId ?? null },
    ]);
    return rows[0] ? mapGoalRow(rows[0]) : null;
  }
  async deleteGoal(id: string): Promise<number> {
    const rows = await execSpOne<{ Deleted: number }>('usp_Goal_Delete', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0]?.Deleted ?? 0;
  }
  async getGoal(id: string): Promise<Goal | null> {
    const rows = await execSpOne('usp_Goal_GetById', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ? mapGoalRow(rows[0]) : null;
  }
  async listGoals(workspaceId: string, folderId: string | null): Promise<Goal[]> {
    const rows = await execSpOne('usp_Goal_ListByWorkspace', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'FolderId', type: sql.UniqueIdentifier, value: folderId },
    ]);
    return (rows as any[]).map(mapGoalRow);
  }
  async getGoalWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_Goal_GetWorkspaceId', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0]?.WorkspaceId ?? null;
  }

  // ── Targets ──
  async createTarget(p: {
    goalId: string; kind: TargetKind; name: string; unit: string | null;
    currencyCode: string | null; startValue: number | null; targetValue: number | null;
    currentValue: number | null; taskFilter: string | null;
  }): Promise<Target> {
    const rows = await execSpOne('usp_Target_Create', [
      { name: 'GoalId', type: sql.UniqueIdentifier, value: p.goalId },
      { name: 'Kind', type: sql.NVarChar(10), value: p.kind },
      { name: 'Name', type: sql.NVarChar(300), value: p.name },
      { name: 'Unit', type: sql.NVarChar(20), value: p.unit },
      { name: 'CurrencyCode', type: sql.Char(3), value: p.currencyCode },
      { name: 'StartValue', type: sql.Float, value: p.startValue },
      { name: 'TargetValue', type: sql.Float, value: p.targetValue },
      { name: 'CurrentValue', type: sql.Float, value: p.currentValue },
      { name: 'TaskFilter', type: sql.NVarChar(sql.MAX), value: p.taskFilter },
    ]);
    return mapTargetRow(rows[0]);
  }
  async updateTarget(id: string, p: {
    name?: string | null; unit?: string | null; currencyCode?: string | null;
    startValue?: number | null; targetValue?: number | null; currentValue?: number | null;
    taskFilter?: string | null;
  }): Promise<Target | null> {
    const rows = await execSpOne('usp_Target_Update', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
      { name: 'Name', type: sql.NVarChar(300), value: p.name ?? null },
      { name: 'Unit', type: sql.NVarChar(20), value: p.unit ?? null },
      { name: 'CurrencyCode', type: sql.Char(3), value: p.currencyCode ?? null },
      { name: 'StartValue', type: sql.Float, value: p.startValue ?? null },
      { name: 'TargetValue', type: sql.Float, value: p.targetValue ?? null },
      { name: 'CurrentValue', type: sql.Float, value: p.currentValue ?? null },
      { name: 'TaskFilter', type: sql.NVarChar(sql.MAX), value: p.taskFilter ?? null },
    ]);
    return rows[0] ? mapTargetRow(rows[0]) : null;
  }
  async deleteTarget(id: string): Promise<number> {
    const rows = await execSpOne<{ Deleted: number }>('usp_Target_Delete', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0]?.Deleted ?? 0;
  }
  async listTargets(goalId: string): Promise<Target[]> {
    const rows = await execSpOne('usp_Target_ListByGoal', [
      { name: 'GoalId', type: sql.UniqueIdentifier, value: goalId },
    ]);
    return (rows as any[]).map(mapTargetRow);
  }
  async recomputeTaskValue(targetId: string): Promise<Target | null> {
    const rows = await execSpOne('usp_Target_RecomputeTaskValue', [
      { name: 'TargetId', type: sql.UniqueIdentifier, value: targetId },
    ]);
    return rows[0] ? mapTargetRow(rows[0]) : null;
  }
  async listTaskTargetsForTask(taskId: string): Promise<Array<{ id: string; goalId: string }>> {
    const rows = await execSpOne<{ Id: string; GoalId: string }>('usp_Target_ListTaskTargetsForTask', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
    ]);
    return (rows as any[]).map((r) => ({ id: r.Id, goalId: r.GoalId }));
  }
}

export const goalRepository = new GoalRepository();
```

- [ ] Run: `npm --workspace apps/api run build`. Expected: type errors only for the not-yet-added `@projectflow/types` exports (resolved in Task 9). To unblock locally, this task may be committed together with Task 9's type additions, or the types added first. Note the dependency in the commit.
- [ ] Commit: `feat(8e): goal repository (SP wrappers + row mappers)`

### Task 6: Service (CRUD + progress resolver + recompute hook)

**Files:** `apps/api/src/modules/goals/goal.service.ts`

- [ ] Write `apps/api/src/modules/goals/goal.service.ts`, exactly:

```ts
import { GoalRepository } from './goal.repository.js';
import { goalProgress, targetRatio, type TargetShape } from './goal-progress.js';
import { subLogger } from '../../shared/lib/logger.js';
import type { GoalFolder, Goal, Target, GoalWithProgress } from '@projectflow/types';

const log = subLogger('goals');

/** Thrown on invalid goal/target input → 422. Stable code. */
export class InvalidGoalError extends Error {
  code = 'INVALID_GOAL';
  constructor(message: string) { super(message); this.name = 'InvalidGoalError'; }
}

const VALID_KINDS = new Set(['number', 'boolean', 'currency', 'task']);
const VALID_STATUSES = new Set(['active', 'achieved', 'archived']);

/** A Target → the pure-math shape goal-progress.ts consumes. */
function toShape(t: Target): TargetShape {
  return { kind: t.kind, startValue: t.startValue, targetValue: t.targetValue, currentValue: t.currentValue };
}

export class GoalService {
  constructor(private repo = new GoalRepository()) {}

  // ── Folders ──
  createFolder(workspaceId: string, name: string, ownerId: string): Promise<GoalFolder> {
    if (!name?.trim()) throw new InvalidGoalError('Folder name is required');
    return this.repo.createFolder({ workspaceId, name: name.trim(), ownerId });
  }
  listFolders(workspaceId: string): Promise<GoalFolder[]> { return this.repo.listFolders(workspaceId); }
  async deleteFolder(id: string): Promise<void> { await this.repo.deleteFolder(id); }

  // ── Goals ──
  createGoal(input: {
    workspaceId: string; scopeType?: string; scopeId?: string | null; folderId?: string | null;
    name: string; description?: string | null; ownerId: string; dueDate?: string | null;
  }): Promise<Goal> {
    if (!input.name?.trim()) throw new InvalidGoalError('Goal name is required');
    const scopeType = (input.scopeType ?? 'WORKSPACE') as any;
    return this.repo.createGoal({
      workspaceId: input.workspaceId, scopeType, scopeId: input.scopeId ?? null,
      folderId: input.folderId ?? null, name: input.name.trim(),
      description: input.description ?? null, ownerId: input.ownerId, dueDate: input.dueDate ?? null,
    });
  }
  updateGoal(id: string, input: {
    name?: string; description?: string | null; dueDate?: string | null;
    status?: string; folderId?: string | null;
  }): Promise<Goal | null> {
    if (input.status !== undefined && input.status !== null && !VALID_STATUSES.has(input.status))
      throw new InvalidGoalError(`status must be one of active|achieved|archived (got ${input.status})`);
    return this.repo.updateGoal(id, {
      name: input.name ?? null, description: input.description ?? null,
      dueDate: input.dueDate ?? null, status: (input.status ?? null) as any,
      folderId: input.folderId ?? null,
    });
  }
  async deleteGoal(id: string): Promise<void> { await this.repo.deleteGoal(id); }
  getGoal(id: string): Promise<Goal | null> { return this.repo.getGoal(id); }
  listGoals(workspaceId: string, folderId: string | null = null): Promise<Goal[]> {
    return this.repo.listGoals(workspaceId, folderId);
  }
  getGoalWorkspaceId(id: string): Promise<string | null> { return this.repo.getGoalWorkspaceId(id); }

  /** A goal joined with its targets + computed progress (equal-weighted average). */
  async getGoalWithProgress(id: string): Promise<GoalWithProgress | null> {
    const goal = await this.repo.getGoal(id);
    if (!goal) return null;
    const targets = await this.repo.listTargets(id);
    return {
      ...goal,
      targets: targets.map((t) => ({ ...t, ratio: targetRatio(toShape(t)) })),
      progress: goalProgress(targets.map(toShape)),
    };
  }

  // ── Targets ──
  createTarget(goalId: string, input: {
    kind: string; name: string; unit?: string | null; currencyCode?: string | null;
    startValue?: number | null; targetValue?: number | null; currentValue?: number | null;
    taskFilter?: string | null;
  }): Promise<Target> {
    if (!VALID_KINDS.has(input.kind))
      throw new InvalidGoalError(`kind must be one of number|boolean|currency|task (got ${input.kind})`);
    if (!input.name?.trim()) throw new InvalidGoalError('Target name is required');
    if (input.taskFilter != null) {
      try { JSON.parse(input.taskFilter); }
      catch { throw new InvalidGoalError('taskFilter must be a JSON string'); }
    }
    return this.repo.createTarget({
      goalId, kind: input.kind as any, name: input.name.trim(),
      unit: input.unit ?? null, currencyCode: input.currencyCode ?? null,
      startValue: input.startValue ?? null, targetValue: input.targetValue ?? null,
      currentValue: input.currentValue ?? null, taskFilter: input.taskFilter ?? null,
    });
  }
  updateTarget(id: string, input: {
    name?: string; unit?: string | null; currencyCode?: string | null;
    startValue?: number | null; targetValue?: number | null; currentValue?: number | null;
    taskFilter?: string | null;
  }): Promise<Target | null> {
    if (input.taskFilter != null) {
      try { JSON.parse(input.taskFilter); }
      catch { throw new InvalidGoalError('taskFilter must be a JSON string'); }
    }
    return this.repo.updateTarget(id, input);
  }
  async deleteTarget(id: string): Promise<void> { await this.repo.deleteTarget(id); }
  listTargets(goalId: string): Promise<Target[]> { return this.repo.listTargets(goalId); }

  /**
   * Auto-rollup hook: when a task transitions, recompute every task-kind target
   * that counts it. BEST-EFFORT — invoked fire-and-forget after-commit from
   * TaskService.transitionTask; every error is swallowed here so a goal-rollup
   * failure can never fault the task transition the user asked for.
   */
  async recomputeForTask(taskId: string): Promise<void> {
    try {
      const targets = await this.repo.listTaskTargetsForTask(taskId);
      for (const tgt of targets) {
        await this.repo.recomputeTaskValue(tgt.id).catch((err: any) =>
          log.warn({ err: err?.message, targetId: tgt.id, taskId }, 'recomputeForTask: target recompute failed'));
      }
    } catch (err: any) {
      log.warn({ err: err?.message, taskId }, 'recomputeForTask: lookup failed');
    }
  }
}

export const goalService = new GoalService();
```

- [ ] Run: `npm --workspace apps/api run build`. Expected: type errors only for the not-yet-added `@projectflow/types` exports (`GoalWithProgress` etc., added in Task 9).
- [ ] Commit: `feat(8e): goal service (CRUD + progress resolver + recomputeForTask hook)`

### Task 7: After-commit recompute hook in task completion

**Files:** `apps/api/src/modules/tasks/task.service.ts`

- [ ] In `apps/api/src/modules/tasks/task.service.ts`, add the import alongside the recurrence import (after line 8 `import { recurrenceService } ...`):

```ts
import { goalService } from '../goals/goal.service.js';
```

- [ ] In `transitionTask`, immediately AFTER the recurrence spawn-on-complete block (after the `if (isDoneGroupStatus(newStatus) && !isDoneGroupStatus(previousStatus ?? '')) { ... }` block and before `return task;`), insert the best-effort goal rollup (fires on any transition — completing OR re-opening both change completed/total over a task target's filter):

```ts
    // Goals (Phase 8e): a task transition can change a task-linked target's
    // completed/total — recompute any target that counts this task. BEST-EFFORT,
    // fire-and-forget AFTER the transition committed; recomputeForTask swallows
    // its own errors, but guard the dispatch too so nothing faults the transition.
    void goalService.recomputeForTask(taskId).catch((err: any) =>
      log.error({ err: err?.message, taskId }, 'goal recompute-on-transition failed'));
```

- [ ] Write/extend the integration coverage in `apps/api/src/modules/goals/__tests__/goal.integration.test.ts` — the acceptance test (full file authored in Task 11; this step asserts the hook seam exists). Run after Task 11.
- [ ] Run: `npm --workspace apps/api run build`. Expected: compiles (pending the Task 9 types). The `goalService` import resolves.
- [ ] Commit: `feat(8e): wire best-effort goal recompute into task transition (after-commit)`

### Task 8: REST routes

**Files:** `apps/api/src/modules/goals/goal.routes.ts`, `apps/api/src/server.ts`

- [ ] Write `apps/api/src/modules/goals/goal.routes.ts`, exactly:

```ts
import { Hono } from 'hono';
import { goalService, InvalidGoalError } from './goal.service.js';
import { GoalRepository } from './goal.repository.js';
import { WorkspaceRepository } from '../workspaces/workspace.repository.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';

export const goalRoutes = new Hono();

const goalRepoForLookup = new GoalRepository();
const workspaceRepoForLookup = new WorkspaceRepository();

const resolveGoalWorkspace = (c: any) => goalRepoForLookup.getGoalWorkspaceId(c.req.param('id'));
const resolveTargetGoalWorkspace = (c: any) => goalRepoForLookup.getGoalWorkspaceId(c.req.param('goalId'));
const resolveBodyWorkspace = async (c: any) => {
  try {
    const body = await c.req.json();
    const wid = body?.workspaceId;
    if (!wid) return null;
    return (await workspaceRepoForLookup.getStatus(wid)) ? wid : null;
  } catch { return null; }
};

function actor(c: any): string {
  const u = c.get('user');
  return u?.userId ?? u?.id;
}

// ── Goal folders ──
// GET /api/v1/goals/folders?workspaceId=
goalRoutes.get('/folders', async (c) => {
  const workspaceId = c.req.query('workspaceId');
  if (!workspaceId) return c.json({ error: { message: 'workspaceId is required' } }, 400);
  return c.json({ data: await goalService.listFolders(workspaceId) });
});

// POST /api/v1/goals/folders
goalRoutes.post('/folders',
  requirePermission('goal.create', { resolveWorkspace: resolveBodyWorkspace }),
  async (c) => {
    const { workspaceId, name } = await c.req.json();
    try {
      const folder = await goalService.createFolder(workspaceId, name, actor(c));
      return c.json({ data: folder }, 201);
    } catch (err: any) {
      if (err instanceof InvalidGoalError) return c.json({ error: { code: err.code, message: err.message } }, 422);
      throw err;
    }
  });

// DELETE /api/v1/goals/folders/:id  (workspace via the goal? no — folder; use body? Folders carry workspace
// only on read. Gate on workspace.read-equivalent goal.delete with explicit workspaceParam from query.)
goalRoutes.delete('/folders/:id',
  requirePermission('goal.delete', { workspaceParam: 'workspaceId' }),
  async (c) => {
    await goalService.deleteFolder(c.req.param('id')!);
    return c.json({ data: { deleted: true } });
  });

// ── Goals ──
// GET /api/v1/goals?workspaceId=&folderId=
goalRoutes.get('/', async (c) => {
  const workspaceId = c.req.query('workspaceId');
  if (!workspaceId) return c.json({ error: { message: 'workspaceId is required' } }, 400);
  const folderId = c.req.query('folderId') ?? null;
  return c.json({ data: await goalService.listGoals(workspaceId, folderId) });
});

// GET /api/v1/goals/:id  (goal joined with targets + computed progress)
goalRoutes.get('/:id', async (c) => {
  const goal = await goalService.getGoalWithProgress(c.req.param('id')!);
  if (!goal) return c.json({ error: { code: 'NOT_FOUND', message: 'Goal not found' } }, 404);
  return c.json({ data: goal });
});

// POST /api/v1/goals
goalRoutes.post('/',
  requirePermission('goal.create', { resolveWorkspace: resolveBodyWorkspace }),
  async (c) => {
    const body = await c.req.json();
    try {
      const goal = await goalService.createGoal({ ...body, ownerId: actor(c) });
      return c.json({ data: goal }, 201);
    } catch (err: any) {
      if (err instanceof InvalidGoalError) return c.json({ error: { code: err.code, message: err.message } }, 422);
      throw err;
    }
  });

// PATCH /api/v1/goals/:id
goalRoutes.patch('/:id',
  requirePermission('goal.update', { resolveWorkspace: resolveGoalWorkspace }),
  async (c) => {
    const body = await c.req.json();
    try {
      const goal = await goalService.updateGoal(c.req.param('id')!, body);
      if (!goal) return c.json({ error: { code: 'NOT_FOUND', message: 'Goal not found' } }, 404);
      return c.json({ data: goal });
    } catch (err: any) {
      if (err instanceof InvalidGoalError) return c.json({ error: { code: err.code, message: err.message } }, 422);
      throw err;
    }
  });

// DELETE /api/v1/goals/:id
goalRoutes.delete('/:id',
  requirePermission('goal.delete', { resolveWorkspace: resolveGoalWorkspace }),
  async (c) => {
    await goalService.deleteGoal(c.req.param('id')!);
    return c.json({ data: { deleted: true } });
  });

// ── Targets ──
// GET /api/v1/goals/:goalId/targets
goalRoutes.get('/:goalId/targets', async (c) => {
  return c.json({ data: await goalService.listTargets(c.req.param('goalId')!) });
});

// POST /api/v1/goals/:goalId/targets
goalRoutes.post('/:goalId/targets',
  requirePermission('goal.update', { resolveWorkspace: resolveTargetGoalWorkspace }),
  async (c) => {
    const body = await c.req.json();
    try {
      const target = await goalService.createTarget(c.req.param('goalId')!, body);
      return c.json({ data: target }, 201);
    } catch (err: any) {
      if (err instanceof InvalidGoalError) return c.json({ error: { code: err.code, message: err.message } }, 422);
      throw err;
    }
  });

// PATCH /api/v1/goals/:goalId/targets/:targetId
goalRoutes.patch('/:goalId/targets/:targetId',
  requirePermission('goal.update', { resolveWorkspace: resolveTargetGoalWorkspace }),
  async (c) => {
    const body = await c.req.json();
    try {
      const target = await goalService.updateTarget(c.req.param('targetId')!, body);
      if (!target) return c.json({ error: { code: 'NOT_FOUND', message: 'Target not found' } }, 404);
      return c.json({ data: target });
    } catch (err: any) {
      if (err instanceof InvalidGoalError) return c.json({ error: { code: err.code, message: err.message } }, 422);
      throw err;
    }
  });

// DELETE /api/v1/goals/:goalId/targets/:targetId
goalRoutes.delete('/:goalId/targets/:targetId',
  requirePermission('goal.update', { resolveWorkspace: resolveTargetGoalWorkspace }),
  async (c) => {
    await goalService.deleteTarget(c.req.param('targetId')!);
    return c.json({ data: { deleted: true } });
  });
```

- [ ] Mount in `apps/api/src/server.ts`: add the import next to the other module route imports:

```ts
import { goalRoutes } from './modules/goals/goal.routes.js';
```

- [ ] Add the auth guard alongside the other `app.use(...authMiddleware)` lines:

```ts
app.use('/goals/*', authMiddleware);
```

- [ ] Add the route mount alongside the other `app.route(...)` lines:

```ts
app.route('/goals', goalRoutes);
```

- [ ] Ensure the `goal.create`, `goal.update`, `goal.delete` permission slugs are seeded. Add them to the RBAC permission seed (the file that seeds `sprint.create`/`worklog.create` etc. — Glob `infra/sql/**` for the permissions seed migration or `apps/api/src/**` for the permission seeding script, and append the three `goal.*` workspace-scoped slugs to the default workspace role grants the same way `sprint.*` are granted). Run the seed against LOCAL DOCKER `ProjectFlow_Test`.
- [ ] Run: `npm --workspace apps/api run build`. Expected: compiles (pending Task 9 types).
- [ ] Commit: `feat(8e): goals REST routes + server mount + goal.* permission seeds`

### Task 9: Shared types

**Files:** `packages/types/index.ts`

- [ ] Append to `packages/types/index.ts` (after the Templates section), exactly:

```ts
// ─────────────────────────── Goals & Targets (Phase 8e) ────────────────────
export type GoalScopeType = 'WORKSPACE' | 'SPACE' | 'FOLDER' | 'LIST';
export type GoalStatus = 'active' | 'achieved' | 'archived';
export type TargetKind = 'number' | 'boolean' | 'currency' | 'task';

export interface GoalFolder {
  id: string;
  workspaceId: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Goal {
  id: string;
  workspaceId: string;
  scopeType: GoalScopeType;
  scopeId: string | null;
  folderId: string | null;
  name: string;
  description: string | null;
  ownerId: string;
  dueDate: string | null;     // ISO date (DATE)
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Target {
  id: string;
  goalId: string;
  kind: TargetKind;
  name: string;
  unit: string | null;
  currencyCode: string | null;
  startValue: number | null;
  targetValue: number | null;
  currentValue: number | null;
  taskFilter: string | null;  // JSON: { taskIds: string[] } for kind='task'
  position: number;
  createdAt: string;
  updatedAt: string;
}

/** A target joined with its computed completion ratio (0..1). */
export interface TargetWithRatio extends Target {
  ratio: number;
}

/** A goal joined with its targets and equal-weighted progress (0..1, computed on read). */
export interface GoalWithProgress extends Goal {
  targets: TargetWithRatio[];
  progress: number;
}

export interface CreateGoalInput {
  workspaceId: string;
  scopeType?: GoalScopeType;
  scopeId?: string | null;
  folderId?: string | null;
  name: string;
  description?: string | null;
  dueDate?: string | null;
}

export interface CreateTargetInput {
  kind: TargetKind;
  name: string;
  unit?: string | null;
  currencyCode?: string | null;
  startValue?: number | null;
  targetValue?: number | null;
  currentValue?: number | null;
  taskFilter?: string | null;
}
```

- [ ] Run: `npm --workspace apps/api run build`. Expected: PASS — repository, service, routes now type-check (no missing-export errors).
- [ ] Commit: `feat(8e): @projectflow/types Goal/GoalFolder/Target + progress shapes`

### Task 10: GraphQL mirror

**Files:** `apps/api/src/graphql/goals.schema.ts`, `apps/api/src/graphql/schema.ts`

- [ ] Write `apps/api/src/graphql/goals.schema.ts`, exactly:

```ts
import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { goalService, InvalidGoalError } from '../modules/goals/goal.service.js';
import { requireWorkspacePermission } from './authz.js';
import type { Goal, Target, GoalWithProgress } from '@projectflow/types';

export function registerGoalsGraphql(): void {
  const TargetType = builder.objectRef<Target & { ratio?: number }>('Target');
  TargetType.implement({ fields: (t) => ({
    id:           t.exposeString('id'),
    goalId:       t.exposeString('goalId'),
    kind:         t.exposeString('kind'),
    name:         t.exposeString('name'),
    unit:         t.string({ nullable: true, resolve: (r) => r.unit ?? null }),
    currencyCode: t.string({ nullable: true, resolve: (r) => r.currencyCode ?? null }),
    startValue:   t.float({ nullable: true, resolve: (r) => r.startValue ?? null }),
    targetValue:  t.float({ nullable: true, resolve: (r) => r.targetValue ?? null }),
    currentValue: t.float({ nullable: true, resolve: (r) => r.currentValue ?? null }),
    taskFilter:   t.string({ nullable: true, resolve: (r) => r.taskFilter ?? null }),
    position:     t.float({ resolve: (r) => r.position }),
    ratio:        t.float({ nullable: true, resolve: (r) => r.ratio ?? null }),
  }) });

  const GoalType = builder.objectRef<GoalWithProgress | Goal>('Goal');
  GoalType.implement({ fields: (t) => ({
    id:          t.exposeString('id'),
    workspaceId: t.exposeString('workspaceId'),
    scopeType:   t.exposeString('scopeType'),
    scopeId:     t.string({ nullable: true, resolve: (g) => g.scopeId ?? null }),
    folderId:    t.string({ nullable: true, resolve: (g) => g.folderId ?? null }),
    name:        t.exposeString('name'),
    description: t.string({ nullable: true, resolve: (g) => g.description ?? null }),
    status:      t.exposeString('status'),
    dueDate:     t.string({ nullable: true, resolve: (g) => g.dueDate ?? null }),
    progress:    t.float({ nullable: true, resolve: (g) => (g as GoalWithProgress).progress ?? null }),
    targets:     t.field({ type: [TargetType], nullable: true, resolve: (g) => (g as GoalWithProgress).targets ?? null }),
  }) });

  builder.queryFields((t) => ({
    goals: t.field({
      type: [GoalType],
      args: { workspaceId: t.arg.string({ required: true }), folderId: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, ['goal.create', 'goal.update', 'goal.delete']);
        return (await goalService.listGoals(a.workspaceId, a.folderId ?? null)) as any;
      },
    }),
    goal: t.field({
      type: GoalType,
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const wid = await goalService.getGoalWorkspaceId(a.id);
        await requireWorkspacePermission(ctx, wid, ['goal.create', 'goal.update', 'goal.delete']);
        return (await goalService.getGoalWithProgress(a.id)) as any;
      },
    }),
  }));

  builder.mutationFields((t) => ({
    createGoal: t.field({
      type: GoalType,
      args: {
        workspaceId: t.arg.string({ required: true }),
        name:        t.arg.string({ required: true }),
        folderId:    t.arg.string({ required: false }),
        description: t.arg.string({ required: false }),
        dueDate:     t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'goal.create');
        try {
          return (await goalService.createGoal({
            workspaceId: a.workspaceId, name: a.name, folderId: a.folderId ?? null,
            description: a.description ?? null, dueDate: a.dueDate ?? null,
            ownerId: (ctx.user as any).userId,
          })) as any;
        } catch (err: any) {
          if (err instanceof InvalidGoalError) throw new GraphQLError(err.message, { extensions: { code: err.code } });
          throw err;
        }
      },
    }),
    updateGoal: t.field({
      type: GoalType,
      nullable: true,
      args: {
        id:     t.arg.string({ required: true }),
        name:   t.arg.string({ required: false }),
        status: t.arg.string({ required: false }),
        dueDate: t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        const wid = await goalService.getGoalWorkspaceId(a.id);
        await requireWorkspacePermission(ctx, wid, 'goal.update');
        try {
          return (await goalService.updateGoal(a.id, {
            name: a.name ?? undefined, status: a.status ?? undefined, dueDate: a.dueDate ?? undefined,
          })) as any;
        } catch (err: any) {
          if (err instanceof InvalidGoalError) throw new GraphQLError(err.message, { extensions: { code: err.code } });
          throw err;
        }
      },
    }),
    deleteGoal: t.field({
      type: 'Boolean',
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const wid = await goalService.getGoalWorkspaceId(a.id);
        await requireWorkspacePermission(ctx, wid, 'goal.delete');
        await goalService.deleteGoal(a.id);
        return true;
      },
    }),
    createTarget: t.field({
      type: TargetType,
      args: {
        goalId:      t.arg.string({ required: true }),
        kind:        t.arg.string({ required: true }),
        name:        t.arg.string({ required: true }),
        unit:        t.arg.string({ required: false }),
        currencyCode: t.arg.string({ required: false }),
        startValue:  t.arg.float({ required: false }),
        targetValue: t.arg.float({ required: false }),
        currentValue: t.arg.float({ required: false }),
        taskFilter:  t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        const wid = await goalService.getGoalWorkspaceId(a.goalId);
        await requireWorkspacePermission(ctx, wid, 'goal.update');
        try {
          return (await goalService.createTarget(a.goalId, {
            kind: a.kind, name: a.name, unit: a.unit ?? null, currencyCode: a.currencyCode ?? null,
            startValue: a.startValue ?? null, targetValue: a.targetValue ?? null,
            currentValue: a.currentValue ?? null, taskFilter: a.taskFilter ?? null,
          })) as any;
        } catch (err: any) {
          if (err instanceof InvalidGoalError) throw new GraphQLError(err.message, { extensions: { code: err.code } });
          throw err;
        }
      },
    }),
  }));
}
```

- [ ] Register in `apps/api/src/graphql/schema.ts`: add the import near the other `register*Graphql` imports:

```ts
import { registerGoalsGraphql } from './goals.schema.js';
```

- [ ] Add the call near the other registrations (after `registerPresenceGraphql();`):

```ts
// ─────────────────────────────────────────
// Goals & Targets (Phase 8e) — Goal/Target types + goals/goal queries +
// createGoal/updateGoal/deleteGoal/createTarget mutations.
// ─────────────────────────────────────────
registerGoalsGraphql();
```

- [ ] Run: `npm --workspace apps/api run build`. Expected: PASS.
- [ ] Commit: `feat(8e): GraphQL mirror for goals/targets (register + schema wiring)`

### Task 11: API integration test (CRUD + auto-rollup acceptance)

**Files:** `apps/api/src/modules/goals/__tests__/goal.integration.test.ts`

- [ ] Write `apps/api/src/modules/goals/__tests__/goal.integration.test.ts`, exactly:

```ts
/**
 * Phase 8e — Goals & Targets integration coverage.
 *
 * Exercises the goals service + SPs + REST + the after-commit recompute hook
 * against the REAL SQL Server stack:
 *   - CRUD: create folder/goal/target; getGoalWithProgress returns targets + an
 *     equal-weighted progress; number/boolean/currency targets compute correctly.
 *   - ACCEPTANCE: a task-linked target's progress advances automatically as its
 *     tasks complete (via taskService.transitionTask → goalService.recomputeForTask).
 *
 * DB SAFETY: must target the local Docker ProjectFlow_Test DB (see e2e/README).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool, getPool } from '../../../shared/lib/db.js';
import { goalService } from '../goal.service.js';
import { TaskService } from '../../tasks/task.service.js';
import { TaskRepository } from '../../tasks/task.repository.js';

const taskService = new TaskService(new TaskRepository());

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

let seq = 0;
async function seedGraph() {
  seq += 1;
  const owner = await createTestUser({ email: `goal-${Date.now()}-${seq}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'Goal Space', key: `GL${(Date.now() + seq) % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Default', position: 0 },
  }), 201)).data;
  return { owner, token, ws, space, listId: String(list.id ?? list.Id) };
}
type Ctx = Awaited<ReturnType<typeof seedGraph>>;

async function makeTask(ctx: Ctx, title: string): Promise<string> {
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token: ctx.token, json: { workspaceId: ctx.ws.Id, listId: ctx.listId, title },
  }), 201)).data;
  return String(task.Id ?? task.id);
}
const actorIdOf = (ctx: Ctx) => ctx.owner.user.Id;

describe('Phase 8e — goals & targets (integration)', () => {
  it('CRUD: create goal + number/boolean targets → progress is the equal-weighted average', async () => {
    const ctx = await seedGraph();
    const goal = await goalService.createGoal({ workspaceId: ctx.ws.Id, name: 'Q3 OKR', ownerId: actorIdOf(ctx) });

    await goalService.createTarget(goal.id, { kind: 'number', name: 'Signups', startValue: 0, targetValue: 100, currentValue: 50 }); // 0.5
    await goalService.createTarget(goal.id, { kind: 'boolean', name: 'Launch', currentValue: 1 });                                   // 1

    const withProgress = await goalService.getGoalWithProgress(goal.id);
    expect(withProgress).not.toBeNull();
    expect(withProgress!.targets).toHaveLength(2);
    expect(withProgress!.progress).toBeCloseTo((0.5 + 1) / 2);
  });

  it('REST: full goal lifecycle via the API', async () => {
    const ctx = await seedGraph();
    const created = (await json<{ data: any }>(await request('/goals', {
      method: 'POST', token: ctx.token, json: { workspaceId: ctx.ws.Id, name: 'Ship v2' },
    }), 201)).data;
    expect(created.status).toBe('active');

    const patched = (await json<{ data: any }>(await request(`/goals/${created.id}`, {
      method: 'PATCH', token: ctx.token, json: { status: 'achieved' },
    }), 200)).data;
    expect(patched.status).toBe('achieved');

    const list = (await json<{ data: any[] }>(await request(`/goals?workspaceId=${ctx.ws.Id}`, { token: ctx.token }), 200)).data;
    expect(list.map((g) => g.id)).toContain(created.id);
  });

  it('ACCEPTANCE: a task-linked target advances automatically as its tasks complete', async () => {
    const ctx = await seedGraph();
    const t1 = await makeTask(ctx, 'Task A');
    const t2 = await makeTask(ctx, 'Task B');

    const goal = await goalService.createGoal({ workspaceId: ctx.ws.Id, name: 'Done all', ownerId: actorIdOf(ctx) });
    const target = await goalService.createTarget(goal.id, {
      kind: 'task', name: 'Close tasks', taskFilter: JSON.stringify({ taskIds: [t1, t2] }),
    });

    // Seed the totals (TaskFilter set; nothing done yet → 0/2 = 0).
    await goalService['repo'].recomputeTaskValue(target.id);
    let wp = await goalService.getGoalWithProgress(goal.id);
    expect(wp!.progress).toBe(0);

    // Complete the first task → recomputeForTask fires after-commit (fire-and-forget).
    await taskService.transitionTask(t1, 'Done', actorIdOf(ctx));
    await waitForProgress(goal.id, 0.5);

    // Complete the second → progress reaches 100%.
    await taskService.transitionTask(t2, 'Done', actorIdOf(ctx));
    await waitForProgress(goal.id, 1);
  });
});

/** Poll getGoalWithProgress until progress reaches `target` (the hook is fire-and-forget). */
async function waitForProgress(goalId: string, target: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const wp = await goalService.getGoalWithProgress(goalId);
    if (wp && Math.abs(wp.progress - target) < 1e-6) return;
    if (Date.now() > deadline) throw new Error(`goal ${goalId} progress did not reach ${target} (last ${wp?.progress}) after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
```

- [ ] Run (LOCAL DOCKER `ProjectFlow_Test` ONLY, with the local DB env set): `npm --workspace apps/api run test:integration -- goal.integration`. Expected: PASS — 3/3 (CRUD average, REST lifecycle, and the task-linked auto-rollup acceptance reaching 0.5 then 1).
- [ ] Run the full API suites to confirm no regression: `npm --workspace apps/api run test:unit` and `npm --workspace apps/api run test:integration`. Expected: all green.
- [ ] Commit: `test(8e): goals integration — CRUD, progress average, task-target auto-rollup acceptance`

### Task 12: Frontend Goals UI + i18n

**Files:** `apps/next-web/src/features/goals/goal-progress.ts`, `apps/next-web/src/features/goals/__tests__/goal-progress.unit.test.ts`, `apps/next-web/src/features/goals/goals-view.tsx`, `apps/next-web/src/features/goals/target-editor.tsx`, `apps/next-web/src/app/(app)/goals/page.tsx`, `apps/next-web/messages/en.json`, `apps/next-web/messages/id.json`

- [ ] FIRST read `apps/next-web/node_modules/next/dist/docs/` for the current routing/server-component conventions (per `apps/next-web/AGENTS.md` — this Next.js has breaking changes). Also read one existing feature surface (e.g. `apps/next-web/src/features/views/view-surface.tsx`) and the data-fetch helper it uses, to copy the SSR + REST-client idiom exactly.
- [ ] Write `apps/next-web/src/features/goals/goal-progress.ts` — a client copy of the pure math (identical formulas to the API module so the UI can render ratios without a round-trip):

```ts
// Client mirror of apps/api/.../goal-progress.ts (Phase 8e). Keep in sync.
export type TargetKind = 'number' | 'boolean' | 'currency' | 'task';

export interface TargetShape {
  kind: TargetKind;
  startValue: number | null;
  targetValue: number | null;
  currentValue: number | null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function targetRatio(t: TargetShape): number {
  const cur = t.currentValue ?? 0;
  if (t.kind === 'boolean') return cur >= 1 ? 1 : 0;
  if (t.kind === 'task') {
    const total = t.targetValue ?? 0;
    return total <= 0 ? 0 : clamp01(cur / total);
  }
  const start = t.startValue ?? 0;
  const span = (t.targetValue ?? 0) - start;
  return span === 0 ? 0 : clamp01((cur - start) / span);
}

export function goalProgress(targets: TargetShape[]): number {
  if (!targets.length) return 0;
  return targets.reduce((acc, t) => acc + targetRatio(t), 0) / targets.length;
}
```

- [ ] Write `apps/next-web/src/features/goals/__tests__/goal-progress.unit.test.ts` (mirror the API unit test cases for `targetRatio` + `goalProgress`, importing from `../goal-progress`): cover number ratio + clamp, boolean 0/1, task completed/total, and the equal-weighted average + empty-goal-0 cases (the same assertions as Task 2's test, importing the client module).
- [ ] Run: `npm --workspace apps/next-web run test:unit -- goal-progress`. Expected: PASS.
- [ ] Build `goals-view.tsx` (client component): renders goal folders → goals; each goal shows a progress bar (use `goalProgress` over its targets) and its status (`active`/`achieved`/`archived`); each target shows its own progress bar (`targetRatio`) + current/target value with `Unit`/`CurrencyCode`. Wire create-folder, create-goal, edit-goal-status, and per-target add/edit/delete to the REST endpoints (`/goals/folders`, `/goals`, `/goals/:id`, `/goals/:goalId/targets/...`) via the repo's existing authed fetch client. All visible strings via `useTranslations('Goals')`.
- [ ] Build `target-editor.tsx`: a form to add/edit a target of each kind. Kind selector switches fields — `number`/`currency` show start/target/current (+ unit, currency code for `currency`); `boolean` shows a single done checkbox (writes `currentValue` 0/1); `task` shows a task-linked picker that builds `taskFilter = JSON.stringify({ taskIds })` and hides the manual value fields (value is recomputed server-side). All strings via `useTranslations('Goals')`.
- [ ] Add `apps/next-web/src/app/(app)/goals/page.tsx` — the route that loads the active workspace's folders + goals (SSR per the docs you read) and renders `goals-view.tsx`.
- [ ] Add a `Goals` namespace to `apps/next-web/messages/en.json` with keys used by the components, e.g. `title`, `newFolder`, `newGoal`, `newTarget`, `status.active`, `status.achieved`, `status.archived`, `kind.number`, `kind.boolean`, `kind.currency`, `kind.task`, `field.name`, `field.unit`, `field.currencyCode`, `field.startValue`, `field.targetValue`, `field.currentValue`, `taskPicker.label`, `progress`, `save`, `delete`, `empty`. Add the SAME keys to `id.json` with real Indonesian translations (e.g. `title: "Sasaran"`, `newGoal: "Sasaran baru"`, `newTarget: "Target baru"`, `progress: "Kemajuan"`, `status.active: "Aktif"`, `status.achieved: "Tercapai"`, `status.archived: "Diarsipkan"`, `kind.task: "Berbasis tugas"`).
- [ ] Run i18n parity: `npm --workspace apps/next-web run test:unit -- messages.unit`. Expected: PASS (en/id key sets identical, no empty values).
- [ ] Run: `npm --workspace apps/next-web run test:unit` then `npm --workspace apps/next-web run build`. Expected: unit suite green; Next build succeeds.
- [ ] Commit: `feat(8e): Goals UI (folders/goals/targets + progress bars + task picker) + i18n en/id`

### Task 13: E2E headline flow

**Files:** `e2e/goals.spec.ts`

- [ ] Read `e2e/README.md` + `e2e/recurring.spec.ts` for the seed-over-REST + UI-login + polling idioms, and confirm the local Docker test DB env is in use.
- [ ] Write `e2e/goals.spec.ts` proving the acceptance box: seed (over REST, with an authed token) a workspace → Space → list → two tasks; create a goal and a `task`-kind target whose `taskFilter` lists both task ids (`POST /goals` then `POST /goals/:goalId/targets`); seed the totals by reading `GET /goals/:id` (server returns computed progress). Then transition both tasks to `Done` via `POST /tasks/:id/transition` and POLL `GET /goals/:id` until `data.progress === 1`. Finally log in through the UI, navigate to `/goals`, and assert (auto-retrying) the goal's progress bar renders at 100% and status controls are visible. Mirror `recurring.spec.ts`'s `API_BASE`, `uiLogin`, and polling helpers.
- [ ] Run (LOCAL DOCKER `ProjectFlow_Test` ONLY, API + web running): `npx playwright test e2e/goals.spec.ts`. Expected: PASS — progress reaches 100% via REST polling and the UI shows the completed goal.
- [ ] Commit: `test(8e): e2e — task-linked goal target reaches 100% as tasks complete`

---

## Definition of Done

- [ ] All acceptance boxes pass — headline: **"A task-linked Goal target updates progress automatically as tasks complete"** (Task 11 integration + Task 13 e2e green).
- [ ] Migration `0046_goals.sql` is idempotent + GO-batched and **reversible** via `rollback/0046_goals.down.sql` (apply → rollback → re-apply verified on local Docker `ProjectFlow_Test`).
- [ ] SP-per-op throughout (`CREATE OR ALTER`, `SET NOCOUNT ON`, TRY/CATCH + TRANSACTION where multi-statement, `SELECT *` of affected rows); `usp_Target_RecomputeTaskValue` counts done = `ResolvedAt IS NOT NULL` over `TaskFilter.taskIds`.
- [ ] Per-kind ratio + goal-average math lives in a **pure, unit-tested** module (`goal-progress.ts`, API + client copies), with unit tests for every kind + the average + empty-goal cases.
- [ ] REST is the primary surface with a GraphQL mirror, both delegating to one shared `goalService`; `requirePermission('goal.create'|'goal.update'|'goal.delete')` fail-closed on every write (REST + GraphQL `requireWorkspacePermission`), `goal.*` slugs seeded.
- [ ] The `recomputeForTask(taskId)` hook is invoked **best-effort, after-commit, fire-and-forget** from `TaskService.transitionTask` and never throws into the task path (errors swallowed/logged).
- [ ] `@projectflow/types` updated (`GoalFolder`, `Goal`, `Target`, `TargetKind`, `GoalStatus`, `GoalScopeType`, `GoalWithProgress`, input types).
- [ ] Frontend Goals UI delivered: folders → goals → targets with progress bars, add/edit targets of each kind, task-linked target picker, goal status active/achieved/archived.
- [ ] i18n parity green (`messages.unit` — en/id identical key sets, no empties); new strings under the `Goals` namespace in `en.json` + real Indonesian `id.json`.
- [ ] Unit + integration tests for the new behavior pass; ≥1 Playwright e2e for the headline flow passes; `npm --workspace apps/api run build` and `npm --workspace apps/next-web run build` succeed.
- [ ] All DB work (migrate / SP-deploy / integration / e2e) ran **ONLY** against local Docker `ProjectFlow_Test` — never the prod-pointing `apps/api/.env`.
- [ ] A `DECISIONS.md` entry logs any deviations (e.g. `TaskFilter` as a `{taskIds:[]}` id-list rather than a full query-compiler filter; the optional low-frequency reconcile sweep intentionally **not built** in v1 — the after-commit hook is the sole rollup path).
