# Phase 5a — Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add task dependencies (waiting-on / blocking) with always-on *Dependency Warning* (block closing a task with open blockers) and *Reschedule Dependencies* (shift dependents when a task's date moves), exposed via REST + GraphQL with hierarchy ACL.

**Architecture:** Reuse the legacy `TaskDependencies` table (migration `0007`) as a canonical directed edge `(TaskId waits_on DependsOn)`. New `dependencies` module (repository + service) with SP-per-op. Behavior hooks live in `task.service` (`transitionTask` for the warning, the update path for reschedule). Roadmap module delegates add/remove to the new service.

**Tech Stack:** SQL Server (T-SQL SPs), Node/TypeScript, Hono (REST), Pothos/graphql-yoga (GraphQL), Next.js 16 (SSR web), vitest, Playwright.

**Reference spec:** `docs/superpowers/specs/2026-06-06-phase5-deps-relationships-recurring-templates-design.md` §3.

**DB policy:** migrations / SP deploy / integration / e2e run ONLY against local Docker `ProjectFlow_Test` with explicit local DB env — NEVER the prod-pointing `apps/api/.env`. See `e2e/README.md`.

---

## File Structure

**Create:**
- `infra/sql/migrations/0034_dependencies.sql` — extend `TaskDependencies` (WorkspaceId, narrow Type, index).
- `infra/sql/migrations/rollback/0034_dependencies.down.sql` — reverse.
- `infra/sql/procedures/usp_TaskDependency_Add.sql` — REWRITE (transitive cycle check).
- `infra/sql/procedures/usp_TaskDependency_Remove.sql` — REWRITE (return affected count, tenant-safe).
- `infra/sql/procedures/usp_TaskDependency_ListForTask.sql` — new.
- `infra/sql/procedures/usp_Task_HasOpenBlockers.sql` — new.
- `infra/sql/procedures/usp_TaskDependency_RescheduleDependents.sql` — new.
- `apps/api/src/modules/dependencies/dependency.repository.ts` — new.
- `apps/api/src/modules/dependencies/dependency.service.ts` — new (+ `DependencyWarningError`).
- `apps/api/src/modules/dependencies/dependency.routes.ts` — new.
- `apps/api/src/modules/dependencies/cycle.ts` — pure transitive-reachability helper (for the picker / unit tests).
- `apps/api/src/modules/dependencies/__tests__/cycle.unit.test.ts` — new.
- `apps/api/src/modules/dependencies/__tests__/dependency.integration.test.ts` — new.
- `apps/api/src/graphql/dependencies.schema.ts` — new (GraphQL mirror).
- `apps/next-web/src/components/tasks/dependencies-section.tsx` — new (panel UI).
- `e2e/dependencies.spec.ts` — new.

**Modify:**
- `packages/types/index.ts` — add `TaskDependency`, `DependencyRelation`, list shape.
- `apps/api/src/modules/tasks/task.service.ts` — hook warning (transition) + reschedule (update).
- `apps/api/src/modules/tasks/task.repository.ts` — expose `getDates`/`getListId` if missing.
- `apps/api/src/app.ts` (or wherever routes mount) — mount dependency routes.
- `apps/api/src/graphql/schema.ts` (or schema index) — import `dependencies.schema.ts`.
- `apps/api/src/modules/roadmap/roadmap.service.ts` — delegate add/remove to `dependencyService`.
- `apps/api/src/shared/errors.ts` (or equivalent) — map `DependencyWarningError` → HTTP 409.
- web task panel container — render `<DependenciesSection>`; handle 409 on close.
- `apps/next-web/messages/en.json` + `id.json` — `Dependencies` namespace.

> **Implementer note:** Before each task, open the cited reference files to copy the exact local idiom (error helpers, `requireObjectLevel` import path, how routes are mounted, how SPs are called via the `mssql` pool wrapper). Do NOT invent new patterns.

---

## Task 1: Migration 0034 — extend `TaskDependencies`

**Files:**
- Create: `infra/sql/migrations/0034_dependencies.sql`
- Create: `infra/sql/migrations/rollback/0034_dependencies.down.sql`

- [ ] **Step 1: Write the forward migration** (idempotent, GO-batched; model on `0033_collaboration.sql`)

```sql
-- Migration 0034: Phase 5a dependencies
-- Repurposes the legacy TaskDependencies (0007) to canonical (TaskId waits_on DependsOn).
-- Adds WorkspaceId (denormalized), narrows Type to 'waiting_on', adds index.

-- 1. Add WorkspaceId column if missing
IF COL_LENGTH('dbo.TaskDependencies', 'WorkspaceId') IS NULL
BEGIN
    ALTER TABLE dbo.TaskDependencies ADD WorkspaceId UNIQUEIDENTIFIER NULL;
END
GO

-- 2. Backfill WorkspaceId from the task's project workspace; convert legacy directions
UPDATE d
   SET d.WorkspaceId = p.WorkspaceId
  FROM dbo.TaskDependencies d
  JOIN dbo.Tasks t ON t.Id = d.TaskId
  JOIN dbo.Projects p ON p.Id = t.ProjectId
 WHERE d.WorkspaceId IS NULL;
GO

-- Legacy IS_BLOCKED_BY rows already mean "TaskId is blocked by DependsOn" = TaskId waits_on DependsOn (canonical) -> keep.
-- Legacy BLOCKS rows mean "TaskId blocks DependsOn" = DependsOn waits_on TaskId -> swap direction.
-- (No-op if table empty.)
;WITH flip AS (
    SELECT Id, TaskId, DependsOn FROM dbo.TaskDependencies WHERE Type = 'BLOCKS'
)
UPDATE d SET TaskId = f.DependsOn, DependsOn = f.TaskId
  FROM dbo.TaskDependencies d JOIN flip f ON f.Id = d.Id;
GO

-- Remove legacy relationship-kind rows (move to 5b); waiting/blocking become canonical 'waiting_on'.
DELETE FROM dbo.TaskDependencies WHERE Type IN ('RELATES_TO', 'DUPLICATES');
GO
UPDATE dbo.TaskDependencies SET Type = 'waiting_on';
GO

-- 3. Narrow the Type CHECK constraint
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TaskDependencies_Type')
    ALTER TABLE dbo.TaskDependencies DROP CONSTRAINT CK_TaskDependencies_Type;
GO
ALTER TABLE dbo.TaskDependencies WITH NOCHECK
    ADD CONSTRAINT CK_TaskDependencies_Type CHECK (Type = 'waiting_on');
GO
ALTER TABLE dbo.TaskDependencies ALTER COLUMN Type NVARCHAR(20) NOT NULL;
GO

-- 4. Index for tenant + reverse lookups
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_TaskDep_Workspace' AND object_id = OBJECT_ID('dbo.TaskDependencies'))
    CREATE INDEX IX_TaskDep_Workspace ON dbo.TaskDependencies (WorkspaceId);
GO
```

- [ ] **Step 2: Write the rollback** (`rollback/0034_dependencies.down.sql`)

```sql
-- Rollback 0034: dependencies
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_TaskDep_Workspace' AND object_id = OBJECT_ID('dbo.TaskDependencies'))
    DROP INDEX IX_TaskDep_Workspace ON dbo.TaskDependencies;
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TaskDependencies_Type')
    ALTER TABLE dbo.TaskDependencies DROP CONSTRAINT CK_TaskDependencies_Type;
GO
IF COL_LENGTH('dbo.TaskDependencies', 'WorkspaceId') IS NOT NULL
    ALTER TABLE dbo.TaskDependencies DROP COLUMN WorkspaceId;
GO
-- (Direction/type data conversion is not reversed — destructive; documented in DECISIONS.md.)
```

- [ ] **Step 3: Apply against local Docker `ProjectFlow_Test`** (explicit local env, never prod)

Run (PowerShell, local DB env exported):
`$env:DB_SERVER='localhost'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD=<local>; npm run db:migrate`
Expected: migration `0034` applied, no error.

- [ ] **Step 4: Commit**

```bash
git add infra/sql/migrations/0034_dependencies.sql infra/sql/migrations/rollback/0034_dependencies.down.sql
git commit -m "feat(db): 0034 extend TaskDependencies to canonical waiting_on edge"
```

---

## Task 2: Stored procedures

**Files:**
- Create/rewrite the five SP files listed in File Structure.

- [ ] **Step 1: `usp_TaskDependency_Add` (transitive cycle detection)**

```sql
CREATE OR ALTER PROCEDURE usp_TaskDependency_Add
    @TaskId      UNIQUEIDENTIFIER,
    @DependsOn   UNIQUEIDENTIFIER,
    @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF @TaskId = @DependsOn
            THROW 51500, 'A task cannot depend on itself', 1;

        -- Transitive cycle: would adding (TaskId waits_on DependsOn) let DependsOn reach TaskId?
        DECLARE @cnt INT = 0;
        ;WITH reach AS (
            SELECT DependsOn AS NodeId FROM dbo.TaskDependencies WHERE TaskId = @DependsOn
            UNION ALL
            SELECT d.DependsOn FROM dbo.TaskDependencies d JOIN reach r ON d.TaskId = r.NodeId
        )
        SELECT @cnt = COUNT(*) FROM reach WHERE NodeId = @TaskId OPTION (MAXRECURSION 1000);
        IF @cnt > 0
            THROW 51501, 'Circular dependency detected', 1;

        IF NOT EXISTS (SELECT 1 FROM dbo.TaskDependencies WHERE TaskId = @TaskId AND DependsOn = @DependsOn)
            INSERT INTO dbo.TaskDependencies (Id, TaskId, DependsOn, Type, WorkspaceId)
            VALUES (NEWID(), @TaskId, @DependsOn, 'waiting_on', @WorkspaceId);

        SELECT * FROM dbo.TaskDependencies WHERE TaskId = @TaskId AND DependsOn = @DependsOn;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] **Step 2: `usp_TaskDependency_Remove`**

```sql
CREATE OR ALTER PROCEDURE usp_TaskDependency_Remove
    @TaskId    UNIQUEIDENTIFIER,
    @DependsOn UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM dbo.TaskDependencies WHERE TaskId = @TaskId AND DependsOn = @DependsOn;
    SELECT @@ROWCOUNT AS Removed;
END;
```

- [ ] **Step 3: `usp_TaskDependency_ListForTask`** (two recordsets: waiting-on, blocking)

```sql
CREATE OR ALTER PROCEDURE usp_TaskDependency_ListForTask
    @TaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    -- Waiting on: tasks @TaskId depends on
    SELECT d.DependsOn AS TaskId, t.Title, t.Status, t.IssueKey
      FROM dbo.TaskDependencies d JOIN dbo.Tasks t ON t.Id = d.DependsOn
     WHERE d.TaskId = @TaskId AND t.DeletedAt IS NULL;
    -- Blocking: tasks that depend on @TaskId
    SELECT d.TaskId AS TaskId, t.Title, t.Status, t.IssueKey
      FROM dbo.TaskDependencies d JOIN dbo.Tasks t ON t.Id = d.TaskId
     WHERE d.DependsOn = @TaskId AND t.DeletedAt IS NULL;
END;
```
> Implementer: confirm the `Tasks` display columns actually exist (`Title`, `Status`, `IssueKey`) — adapt to the real schema (`usp_Task_GetById` is `SELECT *`; check column names there).

- [ ] **Step 4: `usp_Task_HasOpenBlockers`** (status-group resolution mirrors `usp_Task_Transition`)

```sql
CREATE OR ALTER PROCEDURE usp_Task_HasOpenBlockers
    @TaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    -- A blocker is "open" if its status is NOT in a DONE/closed group.
    SELECT b.Id AS TaskId, b.Title, b.Status
      FROM dbo.TaskDependencies d
      JOIN dbo.Tasks b ON b.Id = d.DependsOn
      LEFT JOIN dbo.WorkflowStatuses ws ON ws.WorkflowId = b.WorkflowId AND ws.Name = b.Status
     WHERE d.TaskId = @TaskId
       AND b.DeletedAt IS NULL
       AND ( (ws.Category IS NOT NULL AND ws.Category <> 'DONE')
             OR (ws.Category IS NULL AND b.Status NOT IN ('Done','Resolved','Closed','Completed')) );
END;
```
> Implementer: verify the workflow join columns (`b.WorkflowId`, `ws.WorkflowId`, `ws.Name`, `ws.Category`) against the real schema used in `usp_Task_Transition.sql`; copy its exact join.

- [ ] **Step 5: `usp_TaskDependency_RescheduleDependents`** (cascade shift with visited guard)

```sql
CREATE OR ALTER PROCEDURE usp_TaskDependency_RescheduleDependents
    @TaskId       UNIQUEIDENTIFIER,
    @DeltaSeconds BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    IF @DeltaSeconds = 0 RETURN;

    DECLARE @dependents TABLE (Id UNIQUEIDENTIFIER PRIMARY KEY);
    ;WITH deps AS (
        SELECT TaskId AS Id FROM dbo.TaskDependencies WHERE DependsOn = @TaskId
        UNION                                  -- UNION (not ALL) collapses cycles/diamonds
        SELECT d.TaskId FROM dbo.TaskDependencies d JOIN deps x ON d.DependsOn = x.Id
    )
    INSERT INTO @dependents (Id) SELECT Id FROM deps WHERE Id <> @TaskId OPTION (MAXRECURSION 1000);

    UPDATE t
       SET StartDate = DATEADD(SECOND, @DeltaSeconds, t.StartDate),
           DueDate   = DATEADD(SECOND, @DeltaSeconds, t.DueDate),
           UpdatedAt = SYSUTCDATETIME()
      FROM dbo.Tasks t JOIN @dependents dd ON dd.Id = t.Id
     WHERE t.DeletedAt IS NULL AND (t.StartDate IS NOT NULL OR t.DueDate IS NOT NULL);

    SELECT Id AS TaskId FROM @dependents;  -- for event emission
END;
```

- [ ] **Step 6: Deploy SPs to local `ProjectFlow_Test`** (explicit local env)

Run: `npm run db:deploy-sps` (with local DB env exported)
Expected: all SPs deploy, 0 failed.

- [ ] **Step 7: Commit**

```bash
git add infra/sql/procedures/usp_TaskDependency_*.sql infra/sql/procedures/usp_Task_HasOpenBlockers.sql
git commit -m "feat(db): dependency SPs (add/remove/list/has-open-blockers/reschedule)"
```

---

## Task 3: Shared types

**Files:**
- Modify: `packages/types/index.ts`

- [ ] **Step 1: Add types** (place near other task-related types; match existing export style)

```ts
export type DependencyRelation = 'waiting_on' | 'blocking';

export interface TaskDependency {
  taskId: string;
  title: string;
  status: string;
  issueKey?: string | null;
}

export interface TaskDependencies {
  waitingOn: TaskDependency[];   // tasks this task waits on (blockers)
  blocking: TaskDependency[];    // tasks blocked by this task
}
```

- [ ] **Step 2: Build types package** — `npm run build` (turbo) or `tsc` in packages/types
Expected: PASS.

- [ ] **Step 3: Commit**
```bash
git add packages/types/index.ts
git commit -m "feat(types): TaskDependency / DependencyRelation"
```

---

## Task 4: Pure cycle helper + unit test (TDD)

**Files:**
- Create: `apps/api/src/modules/dependencies/cycle.ts`
- Test: `apps/api/src/modules/dependencies/__tests__/cycle.unit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { wouldCreateCycle } from '../cycle';

// edges: Map<taskId, Set<dependsOn>>  (taskId waits_on dependsOn)
describe('wouldCreateCycle', () => {
  it('rejects self-edge', () => {
    expect(wouldCreateCycle(new Map(), 'a', 'a')).toBe(true);
  });
  it('detects direct cycle A->B when B->A exists', () => {
    const e = new Map([['b', new Set(['a'])]]);     // b waits_on a
    expect(wouldCreateCycle(e, 'a', 'b')).toBe(true); // adding a waits_on b closes the loop
  });
  it('detects transitive cycle', () => {
    const e = new Map([['b', new Set(['c'])], ['c', new Set(['a'])]]); // b->c->a
    expect(wouldCreateCycle(e, 'a', 'b')).toBe(true);
  });
  it('allows a DAG edge', () => {
    const e = new Map([['a', new Set(['b'])]]);
    expect(wouldCreateCycle(e, 'b', 'c')).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`wouldCreateCycle` not defined)
Run: `cd apps/api && npx vitest run src/modules/dependencies/__tests__/cycle.unit.test.ts`

- [ ] **Step 3: Implement**

```ts
// Edge semantics: edges.get(t) = set of tasks t waits_on. Adding (taskId waits_on dependsOn)
// creates a cycle iff dependsOn can already reach taskId.
export function wouldCreateCycle(
  edges: Map<string, Set<string>>,
  taskId: string,
  dependsOn: string,
): boolean {
  if (taskId === dependsOn) return true;
  const seen = new Set<string>();
  const stack = [dependsOn];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === taskId) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const next of edges.get(n) ?? []) stack.push(next);
  }
  return false;
}
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**
```bash
git add apps/api/src/modules/dependencies/cycle.ts apps/api/src/modules/dependencies/__tests__/cycle.unit.test.ts
git commit -m "feat(api): pure dependency cycle-detection helper + tests"
```

---

## Task 5: Repository + service (+ DependencyWarningError)

**Files:**
- Create: `apps/api/src/modules/dependencies/dependency.repository.ts`
- Create: `apps/api/src/modules/dependencies/dependency.service.ts`

> Pattern source: copy SP-call wiring from `apps/api/src/modules/comments/comment.repository.ts` (how the `mssql` pool/request is obtained and params bound) and error-class style from the existing custom-field `RequiredFieldsUnmetError`.

- [ ] **Step 1: Repository** — methods, each calling one SP:

```ts
// dependency.repository.ts (shape — bind params exactly like sibling repos)
export class DependencyRepository {
  async add(taskId: string, dependsOn: string, workspaceId: string) { /* EXEC usp_TaskDependency_Add */ }
  async remove(taskId: string, dependsOn: string): Promise<number> { /* usp_TaskDependency_Remove -> Removed */ }
  async listForTask(taskId: string): Promise<{ waitingOn: any[]; blocking: any[] }> { /* two recordsets */ }
  async openBlockers(taskId: string): Promise<{ taskId: string; title: string; status: string }[]> { /* usp_Task_HasOpenBlockers */ }
  async rescheduleDependents(taskId: string, deltaSeconds: number): Promise<string[]> { /* returns shifted ids */ }
}
```

- [ ] **Step 2: Service + error**

```ts
// dependency.service.ts
import type { DependencyRelation, TaskDependencies } from '@projectflow/types';

export class DependencyWarningError extends Error {
  code = 'DEPENDENCY_BLOCKED';
  constructor(public blockers: { taskId: string; title: string; status: string }[]) {
    super('Task has open blockers'); this.name = 'DependencyWarningError';
  }
}

export class DependencyService {
  constructor(private repo = new DependencyRepository()) {}

  // relation 'waiting_on': (taskId waits_on otherId). 'blocking': (otherId waits_on taskId).
  async add(taskId: string, otherId: string, relation: DependencyRelation, workspaceId: string) {
    const [w, d] = relation === 'waiting_on' ? [taskId, otherId] : [otherId, taskId];
    return this.repo.add(w, d, workspaceId);
  }
  async remove(taskId: string, otherId: string, relation: DependencyRelation) {
    const [w, d] = relation === 'waiting_on' ? [taskId, otherId] : [otherId, taskId];
    return this.repo.remove(w, d);
  }
  async list(taskId: string): Promise<TaskDependencies> {
    const r = await this.repo.listForTask(taskId);
    return { waitingOn: r.waitingOn.map(mapDep), blocking: r.blocking.map(mapDep) };
  }
  async assertNoOpenBlockers(taskId: string) {
    const open = await this.repo.openBlockers(taskId);
    if (open.length) throw new DependencyWarningError(open);
  }
  async rescheduleDependents(taskId: string, deltaSeconds: number) {
    return this.repo.rescheduleDependents(taskId, deltaSeconds);
  }
}
export const dependencyService = new DependencyService();
```
> `mapDep` maps a PascalCase SP row `{ TaskId, Title, Status, IssueKey }` → the camelCase `TaskDependency`.

- [ ] **Step 3: typecheck** — `cd apps/api && npx tsc --noEmit` → PASS
- [ ] **Step 4: Commit**
```bash
git add apps/api/src/modules/dependencies/dependency.repository.ts apps/api/src/modules/dependencies/dependency.service.ts
git commit -m "feat(api): dependency repository + service"
```

---

## Task 6: Wire Dependency Warning into transitionTask

**Files:**
- Modify: `apps/api/src/modules/tasks/task.service.ts` (transitionTask, ~line 114)

- [ ] **Step 1: Add the guard** immediately after `assertRequiredMetForStatus`, gated on DONE-group target.

```ts
// in transitionTask, before this.repo.transition(...)
await customFieldService.assertRequiredMetForStatus(taskId, newStatus);
if (isDoneGroupStatus(newStatus)) {            // see note
  await dependencyService.assertNoOpenBlockers(taskId);
}
const task = await this.repo.transition(taskId, newStatus, actorId);
```
> Note on `isDoneGroupStatus`: `transitionTask` receives a status NAME. Prefer reading the target status' group via the existing status/workflow read used elsewhere; if none is cheaply available, gate on the hardcoded set `['Done','Resolved','Closed','Completed']` to match the SP. (`usp_Task_HasOpenBlockers` only returns rows when blockers are open, so the guard is safe even if called slightly too broadly.)

- [ ] **Step 2: Map the error to HTTP 409** in the REST error handler (where `RequiredFieldsUnmetError` is mapped). Find that mapping and add:

```ts
if (err instanceof DependencyWarningError)
  return c.json({ error: { code: err.code, message: err.message, details: { blockers: err.blockers } } }, 409);
```

- [ ] **Step 3: typecheck** → PASS
- [ ] **Step 4: Commit**
```bash
git add apps/api/src/modules/tasks/task.service.ts <error-handler-file>
git commit -m "feat(api): block closing a task with open blockers (Dependency Warning)"
```

---

## Task 7: Wire Reschedule Dependencies into the update path

**Files:**
- Modify: `apps/api/src/modules/tasks/task.service.ts` (updateTask)
- Modify: `apps/api/src/modules/tasks/task.repository.ts` (add `getDates(taskId)` if absent)

- [ ] **Step 1: Capture old dates, compute delta, cascade** in `updateTask`:

```ts
async updateTask(taskId: string, input: UpdateTaskInput, actorId: string): Promise<Task> {
  const before = await this.repo.getDates(taskId);            // { startDate, dueDate }
  const task = await this.repo.update(taskId, input, actorId);
  const delta = computeDateDelta(before, task);               // seconds; 0 if no date change
  if (delta !== 0) {
    const shifted = await dependencyService.rescheduleDependents(taskId, delta);
    const projectId = (task as any).projectId ?? (task as any).ProjectId;
    for (const id of shifted) await publishTaskEvent('updated', { projectId, taskId: id });
  }
  await publishTaskEvent('updated', { projectId: (task as any).projectId ?? (task as any).ProjectId, task });
  return task;
}
```
> `computeDateDelta(before, after)`: pure helper — return whole seconds between `before.dueDate` and `after.dueDate` (fallback to startDate); `0` if either is null or unchanged. Add it next to the service and unit-test it.

- [ ] **Step 2: Unit-test `computeDateDelta`** (before→after due shift = N days → N*86400; null → 0).
- [ ] **Step 3: typecheck + unit** → PASS
- [ ] **Step 4: Commit**
```bash
git commit -am "feat(api): reschedule dependents when a task date moves"
```

---

## Task 8: REST routes + mount + roadmap delegation

**Files:**
- Create: `apps/api/src/modules/dependencies/dependency.routes.ts`
- Modify: route mount file; `apps/api/src/modules/roadmap/roadmap.service.ts`

> Pattern source: `apps/api/src/modules/comments/comment.routes.ts` for `requirePermission`/`requireObjectLevel` usage, body parsing, and JSON envelopes.

- [ ] **Step 1: Routes**

```ts
const r = new Hono();
// GET /api/v1/tasks/:taskId/dependencies
r.get('/:taskId/dependencies', /* VIEW on task's list */ async (c) => {
  return c.json({ data: await dependencyService.list(c.req.param('taskId')!) });
});
// POST /api/v1/tasks/:taskId/dependencies  body { dependsOnId, relation }
r.post('/:taskId/dependencies', /* EDIT on task's list + VIEW on other */ async (c) => {
  const { dependsOnId, relation } = await c.req.json();
  const taskId = c.req.param('taskId')!;
  const wsId = await taskRepo.getWorkspaceId(taskId);
  const row = await dependencyService.add(taskId, dependsOnId, relation ?? 'waiting_on', wsId);
  return c.json({ data: row }, 201);
});
// DELETE /api/v1/tasks/:taskId/dependencies/:otherId?relation=waiting_on
r.delete('/:taskId/dependencies/:otherId', /* EDIT */ async (c) => {
  await dependencyService.remove(c.req.param('taskId')!, c.req.param('otherId')!, (c.req.query('relation') as any) ?? 'waiting_on');
  return c.body(null, 204);
});
```
> ACL: resolve the task's `listId` (add `taskRepo.getListId` if absent) and call `requireObjectLevel`-equivalent for REST (use the same middleware sibling task routes use). Map SP THROWs: 51500/51501 → 422 `INVALID_DEPENDENCY` / `CIRCULAR_DEPENDENCY`.

- [ ] **Step 2: Mount** the routes where other `/api/v1/tasks` sub-routes mount.
- [ ] **Step 3: Roadmap delegation** — `roadmap.service.addDependency/removeDependency` call `dependencyService` (canonical edge); keep `getItems` unchanged.
- [ ] **Step 4: typecheck** → PASS
- [ ] **Step 5: Commit**
```bash
git commit -am "feat(api): dependency REST routes + roadmap delegation"
```

---

## Task 9: GraphQL mirror

**Files:**
- Create: `apps/api/src/graphql/dependencies.schema.ts`
- Modify: GraphQL schema index/import.

> Pattern source: `apps/api/src/graphql/watchers.schema.ts` (query + mutation fields, `requireObjectLevel`/`requireWorkspacePermission`, `taskListId(taskId)` helper).

- [ ] **Step 1:** `taskDependencies(taskId): TaskDependenciesType` query (VIEW-gated); `addTaskDependency(taskId, dependsOnId, relation)` + `removeTaskDependency(...)` mutations (EDIT/`task.update`-gated), returning the updated dependency lists. Reuse `dependencyService`.
- [ ] **Step 2: typecheck** → PASS
- [ ] **Step 3: Commit**
```bash
git commit -am "feat(api): GraphQL dependency queries + mutations"
```

---

## Task 10: Frontend — dependencies section + warning + i18n

**Files:**
- Create: `apps/next-web/src/components/tasks/dependencies-section.tsx`
- Modify: task panel container; `messages/en.json` + `id.json`.

> Pattern source: the watchers/assignee section in the existing task slide-over for data-loading + add/remove server actions; `apiErrorToast` for surfacing the 409.

- [ ] **Step 1:** Render "Waiting on" + "Blocking" lists with a task-picker add and a remove (server actions hitting the REST routes). Add a `Dependencies` i18n namespace (en + id parity).
- [ ] **Step 2:** On task close, catch the 409 `DEPENDENCY_BLOCKED` and show a warning modal listing `details.blockers`.
- [ ] **Step 3: unit + parity** — `cd apps/next-web && npx vitest run` (messages parity green); build.
- [ ] **Step 4: Commit**
```bash
git commit -am "feat(web): task dependencies section + blocker warning (i18n en/id)"
```

---

## Task 11: Integration + e2e tests

**Files:**
- Create: `apps/api/src/modules/dependencies/__tests__/dependency.integration.test.ts`
- Create: `e2e/dependencies.spec.ts`

> Pattern source: an existing `*.integration.test.ts` (DB fixtures/truncate via `apps/api/src/__tests__/fixtures/`), and `e2e/live-board.spec.ts` for two-context auth setup.

- [ ] **Step 1: Integration tests** (run against local Docker `ProjectFlow_Test`):
  - add edge → list shows it under waitingOn (and reverse under the other task's blocking);
  - direct cycle rejected; transitive cycle rejected;
  - close a task with an open blocker → `assertNoOpenBlockers` throws / route returns 409;
  - move a blocker's due date → dependent's dates shift by the same delta.
- [ ] **Step 2: e2e** — add a "waiting on" dependency in the panel, attempt to close the blocked task, assert the warning modal with the blocker appears.
- [ ] **Step 3: Run** (explicit local DB env): `cd apps/api && npx vitest run --project integration`; `npm run test:e2e -- dependencies` (local webServer env).
Expected: all green.
- [ ] **Step 4: Commit**
```bash
git commit -am "test(phase5a): dependency integration + e2e"
```

---

## Task 12: Verify + document + checkpoint

- [ ] **Step 1: Full verification** (local Docker DB):
  - `npm test` (API unit + web unit) → green
  - `cd apps/api && npx vitest run --project integration` → green
  - `npm run build` → green
  - `npm run test:e2e -- dependencies` → green
- [ ] **Step 2:** Add a `DECISIONS.md` §"2026-06-06 — Phase 5a Dependencies" entry: canonical edge direction, Type narrowing + legacy data conversion, always-on warning/reschedule, synchronous reschedule deferral, error code 409.
- [ ] **Step 3:** Update memory (`MEMORY.md` + a phase5 status file) per the project's memory convention.
- [ ] **Step 4: Final commit + stop for review/merge** before slice 5b.
```bash
git commit -am "docs(phase5a): decisions + status"
```

---

## Self-Review (against spec §3)

- **Spec coverage:** canonical edge (T1), transitive cycle (T2/T4), warning hook (T6), reschedule (T7), REST+GraphQL (T8/T9), roadmap delegation (T8), frontend (T10), tests + acceptance (T11). All §3 items mapped. ✓
- **Acceptance §3.7:** "closing a blocked task triggers warning" → T6+T11; "moving a date reschedules dependents" → T7+T11. ✓
- **Placeholders:** SP/TS/test code provided; boilerplate routes/GraphQL/UI reference exact sibling files to copy (acceptable — implementer has codebase access; signatures + ACL + error-mapping specified). The flagged SP risks (display column names; workflow join) carry explicit verification notes.
- **Type consistency:** `DependencyRelation`/`TaskDependencies` defined in T3 and used consistently in T5/T8/T9/T10. `DependencyWarningError.code='DEPENDENCY_BLOCKED'` consistent between T5 and T6.
- **Deferral logged:** synchronous reschedule (spec §8.1) noted in T7 + T12 decisions.
