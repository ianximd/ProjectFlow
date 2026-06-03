# ClickUp Hierarchy — Phase 1 (Nesting Hierarchy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a Space → Folder → List container layer above Tasks, re-home every existing task into its Space's default List via a safe idempotent backfill (keeping `Tasks.ProjectId` as a compatibility bridge), with a materialized `Path` for "everything under node X", per-object permission ACL with ancestry inheritance, Space-level statuses inherited/overridable at List level, and configurable subtask depth — without breaking existing board/backlog/roadmap pages.

**Architecture:** Adapt to the existing stack (no rewrite). `Projects` table stays physically named but is relabeled "Space" in API/UI. Two new tables (`Folders`, `Lists`) + one new ACL table (`ObjectPermissions`) + columns on `Tasks`/`Projects`/`Workflows`. Data access = one stored-proc-per-operation (house style: `CREATE OR ALTER`, `SET NOCOUNT ON`, `BEGIN TRY/CATCH`, `THROW` with custom codes, `SELECT *` return). Repositories call `execSpOne`; services hold business logic + fire-and-forget side effects; **both** a REST surface (`modules/*/*.routes.ts`, consumed by the SSR Next.js frontend) **and** the parallel Pothos GraphQL schema (`graphql/schema.ts`) delegate to the same services. Frontend uses server queries (`serverFetch`) + server actions (`revalidatePath`) + dnd-kit.

**Tech Stack:** TypeScript, Hono, Pothos + graphql-yoga, MSSQL (stored procedures), BullMQ/Redis, Next.js 16 (App Router, SSR), dnd-kit, Vitest (unit + integration), Playwright.

---

## Decisions recorded (write these into `DECISIONS.md` in Task 0)

These were confirmed before planning and **deviate from or extend** the design doc; they MUST be logged:

1. **Dual API surface.** The design doc specs GraphQL only, but the SSR frontend consumes REST (`/api/v1/*`) via `serverFetch`, and `@projectflow/types` is hand-written (no codegen). Phase 1 builds **REST routes (primary, frontend-facing) + a GraphQL mirror** in `graphql/schema.ts`; both delegate to one shared service per entity.
2. **Full per-object ACL now.** Existing RBAC (`usp_UserPermissions_Get`) is a flat workspace-scoped slug union with no object-level rows. Phase 1 adds a net-new `ObjectPermissions` table + `usp_ObjectAccess_Resolve` ancestry-walk resolver (List→Folder→Space→Workspace, most-specific wins, role floor).
3. **Idempotency-Key deferred.** No existing mutation honors it; it is not a Phase 1 acceptance criterion. Rely on natural idempotency (re-runnable backfill, unique constraints). Deferred to a later cross-cutting pass.
4. **Reversible migration via committed down script.** The migrate runner (`scripts/db-migrate.ts`) is forward-only and records applied migrations; it has no down command. "Reversible" is satisfied by a committed `infra/sql/migrations/rollback/0029_hierarchy.down.sql` with documented manual invocation. (Confirm runner behavior in Task 1, Step 0.)

---

## File Structure

### Backend — `apps/api/src/`
- **Create** `modules/hierarchy/path.ts` — pure path helpers (build/validate/prefix). Unit-testable, no DB.
- **Create** `modules/hierarchy/folder.repository.ts` / `folder.service.ts` / `folder.routes.ts` — Folder CRUD + move.
- **Create** `modules/hierarchy/list.repository.ts` / `list.service.ts` / `list.routes.ts` — List CRUD + move + effectiveStatuses.
- **Create** `modules/hierarchy/hierarchy.repository.ts` / `hierarchy.routes.ts` — `everythingUnder` descendant-task query.
- **Create** `modules/access/access.repository.ts` / `access.service.ts` — object-permission ACL + `resolveAccess`.
- **Create** `modules/access/access.middleware.ts` — `requireObjectAccess(minLevel, resolveObject)` Hono middleware.
- **Modify** `modules/tasks/task.repository.ts` / `task.service.ts` / `task.routes.ts` — add `listId` to create, add `moveTask`, subtask-depth guard.
- **Modify** `graphql/schema.ts` — `Space` relabel (+visibility/maxSubtaskDepth), new `Folder`/`List` types, queries/mutations/subscriptions.
- **Modify** `graphql/pubsub.ts` — register `space:updated` / `folder:updated` / `list:updated` channels.
- **Modify** `server.ts` (or the route registrar) — mount new route groups.

### SQL — `infra/sql/`
- **Create** `migrations/0029_hierarchy.sql` — tables + columns + indexes + idempotent backfill.
- **Create** `migrations/rollback/0029_hierarchy.down.sql` — reverse drop.
- **Create** procedures: `usp_Folder_Create/_Update/_Move/_Delete/_List/_GetWorkspaceId/_GetById.sql`, `usp_List_Create/_Update/_Move/_Delete/_List/_GetWorkspaceId/_EffectiveStatuses.sql`, `usp_Hierarchy_DescendantTasks.sql`, `usp_ObjectAccess_Resolve.sql`, `usp_ObjectPermission_Set/_Unset.sql`.
- **Modify** procedures: `usp_Task_Create.sql` (+`@ListId`, derive Space, set `ListPath`), **Create** `usp_Task_Move.sql`.

### Frontend — `apps/next-web/src/`
- **Create** `config/hierarchy.config.ts` — Space/Folder/List label + icon constants (single source for relabel).
- **Create** `server/queries/hierarchy.ts` — `getFolders`/`getLists`/`getEverythingUnder`.
- **Modify** `server/queries/normalize.ts` — add `normalizeFolder`/`normalizeList`.
- **Create** `server/actions/hierarchy.ts` — create/update/move/delete folder+list, `moveTaskToList`.
- **Create** `components/hierarchy/SidebarTree.tsx` (+ `SidebarTreeNode.tsx`) — collapsible tree, dnd-kit reorder/reparent.
- **Modify** `components/layouts/layout-1/components/sidebar-menu.tsx` — mount `SidebarTree` data-driven section.
- **Create** `app/(app)/lists/[listId]/page.tsx` + `list-view.tsx` — List view (reuse task list rendering, keyed by `listId`).
- **Modify** `components/TaskDrawer.tsx` — add Space / Folder / List breadcrumb.

### Types — `packages/types/`
- **Modify** `index.ts` — add `Folder`, `List`, `Space` extras, `ObjectPermissionLevel`, `Visibility`, `HierarchyNodeType`; extend `Task` with `listId`/`listPath`/`archivedAt`.

### Tests
- Backend unit: `modules/hierarchy/__tests__/path.unit.test.ts`, `modules/access/__tests__/access.service.unit.test.ts`, `modules/hierarchy/__tests__/list-status.unit.test.ts`, `modules/tasks/__tests__/subtask-depth.unit.test.ts`.
- Backend integration: `modules/hierarchy/__tests__/hierarchy.integration.test.ts`, `modules/access/__tests__/object-access.integration.test.ts`, `modules/hierarchy/__tests__/backfill.integration.test.ts`, `modules/hierarchy/__tests__/multitenancy.integration.test.ts`.
- E2E: `e2e/hierarchy.spec.ts`.

---

## Task 0: Bootstrap DECISIONS.md + branch

**Files:**
- Create/Modify: `DECISIONS.md` (repo root)

- [ ] **Step 1: Create the working branch**

```bash
git checkout -b feat/hierarchy-phase1
```

- [ ] **Step 2: Append the decisions to `DECISIONS.md`**

If `DECISIONS.md` does not exist, create it with a `# Decisions Log` header. Append:

```markdown
## 2026-06-03 — Phase 1 Hierarchy

1. Dual API surface (REST primary + GraphQL mirror) — frontend is REST/SSR; @projectflow/types is hand-written. Both delegate to shared services.
2. Full per-object ACL implemented now via new ObjectPermissions table + usp_ObjectAccess_Resolve (existing RBAC has no object rows).
3. Idempotency-Key deferred (no existing mutation honors it; not a Phase 1 acceptance criterion).
4. Migration reversibility via committed rollback script infra/sql/migrations/rollback/0029_hierarchy.down.sql (runner is forward-only).
5. Projects table physically retained; relabeled "Space" only in API/UI via a single label constant.
```

- [ ] **Step 3: Commit**

```bash
git add DECISIONS.md
git commit -m "docs(decisions): record Phase 1 hierarchy deviations"
```

---

## Task 1: Migration 0029 — schema + indexes (no backfill yet)

**Files:**
- Create: `infra/sql/migrations/0029_hierarchy.sql`
- Reference: `infra/sql/migrations/0001_init.sql`, `0008_workflows.sql`, `0023_workspace_deletedat.sql`, `scripts/db-migrate.ts`

- [ ] **Step 0: Confirm the migrate runner's batch + tracking behavior**

Read `scripts/db-migrate.ts`. Confirm: files in `infra/sql/migrations/*.sql` are sorted numerically, split on `GO`, each batch run in a transaction, recorded in `dbo.MigrationHistory` by filename + SHA256, never re-run. Confirm the runner ignores subdirectories (so `rollback/` is safe). If it recurses into subdirectories, place the down script outside `migrations/` (e.g. `infra/sql/rollback/`) instead and note the path change. Also note the exact `MigrationHistory` filename column name (used by the down script in Task 3).

- [ ] **Step 1: Write the migration file (schema only — DDL, indexes; backfill comes in Task 2)**

Create `infra/sql/migrations/0029_hierarchy.sql`:

```sql
-- =============================================================================
-- Migration 0029: ClickUp-style nesting hierarchy (Phase 1)
-- Adds Folders + Lists under the existing Projects("Space") table, an object
-- permission ACL, materialized Path columns, and Task re-homing columns.
-- Idempotent. Backfill lives in a later batch of this same file (Task 2).
-- =============================================================================

-- ── Projects (= Space): visibility + subtask depth ──────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Projects') AND name = 'Visibility')
BEGIN
    ALTER TABLE dbo.Projects ADD Visibility NVARCHAR(10) NOT NULL DEFAULT 'PUBLIC';
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Projects_Visibility' AND parent_object_id = OBJECT_ID('dbo.Projects'))
BEGIN
    ALTER TABLE dbo.Projects ADD CONSTRAINT CK_Projects_Visibility CHECK (Visibility IN ('PUBLIC','PRIVATE'));
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Projects') AND name = 'MaxSubtaskDepth')
BEGIN
    ALTER TABLE dbo.Projects ADD MaxSubtaskDepth INT NULL;   -- NULL = unlimited
END
GO

-- ── Folders ─────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Folders')
BEGIN
    CREATE TABLE dbo.Folders (
        Id             UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId    UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Workspaces(Id),
        SpaceId        UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Projects(Id),
        ParentFolderId UNIQUEIDENTIFIER NULL     REFERENCES dbo.Folders(Id),
        Name           NVARCHAR(255)    NOT NULL,
        Position       FLOAT            NOT NULL DEFAULT 0,
        Path           NVARCHAR(900)    NOT NULL,
        WorkflowId     UNIQUEIDENTIFIER NULL     REFERENCES dbo.Workflows(Id),
        CreatedAt      DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt      DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        DeletedAt      DATETIME2        NULL
    );
    CREATE NONCLUSTERED INDEX IX_Folders_Space ON dbo.Folders (SpaceId, ParentFolderId, Position);
    CREATE NONCLUSTERED INDEX IX_Folders_Path  ON dbo.Folders (Path);
END
GO

-- ── Lists ────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Lists')
BEGIN
    CREATE TABLE dbo.Lists (
        Id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Workspaces(Id),
        SpaceId     UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Projects(Id),
        FolderId    UNIQUEIDENTIFIER NULL     REFERENCES dbo.Folders(Id),
        Name        NVARCHAR(255)    NOT NULL,
        Position    FLOAT            NOT NULL DEFAULT 0,
        Path        NVARCHAR(900)    NOT NULL,
        WorkflowId  UNIQUEIDENTIFIER NULL     REFERENCES dbo.Workflows(Id),
        IsDefault   BIT              NOT NULL DEFAULT 0,
        CreatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        DeletedAt   DATETIME2        NULL
    );
    CREATE NONCLUSTERED INDEX IX_Lists_Space ON dbo.Lists (SpaceId, FolderId, Position);
    CREATE NONCLUSTERED INDEX IX_Lists_Path  ON dbo.Lists (Path);
END
GO

-- ── Tasks: ListId + ListPath + ArchivedAt ───────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Tasks') AND name = 'ListId')
BEGIN
    ALTER TABLE dbo.Tasks ADD ListId UNIQUEIDENTIFIER NULL REFERENCES dbo.Lists(Id);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Tasks') AND name = 'ListPath')
BEGIN
    ALTER TABLE dbo.Tasks ADD ListPath NVARCHAR(900) NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Tasks') AND name = 'ArchivedAt')
BEGIN
    ALTER TABLE dbo.Tasks ADD ArchivedAt DATETIME2 NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Tasks_List' AND object_id = OBJECT_ID('dbo.Tasks'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Tasks_List ON dbo.Tasks (ListId, Status, Position);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Tasks_ListPath' AND object_id = OBJECT_ID('dbo.Tasks'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Tasks_ListPath ON dbo.Tasks (ListPath);
END
GO

-- ── Workflows: generalize scope to Folder/List (ProjectId retained) ─────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Workflows') AND name = 'FolderId')
BEGIN
    ALTER TABLE dbo.Workflows ADD FolderId UNIQUEIDENTIFIER NULL REFERENCES dbo.Folders(Id);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Workflows') AND name = 'ListId')
BEGIN
    ALTER TABLE dbo.Workflows ADD ListId UNIQUEIDENTIFIER NULL REFERENCES dbo.Lists(Id);
END
GO

-- ── ObjectPermissions ACL ───────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ObjectPermissions')
BEGIN
    CREATE TABLE dbo.ObjectPermissions (
        Id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Workspaces(Id),
        SubjectType NVARCHAR(8)      NOT NULL,             -- 'USER' | 'ROLE'
        SubjectId   UNIQUEIDENTIFIER NOT NULL,            -- Users(Id) or Roles(Id)
        ObjectType  NVARCHAR(8)      NOT NULL,             -- 'SPACE' | 'FOLDER' | 'LIST'
        ObjectId    UNIQUEIDENTIFIER NOT NULL,
        Level       NVARCHAR(8)      NOT NULL,             -- 'VIEW'|'COMMENT'|'EDIT'|'FULL'
        CreatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_ObjPerm_SubjectType CHECK (SubjectType IN ('USER','ROLE')),
        CONSTRAINT CK_ObjPerm_ObjectType  CHECK (ObjectType IN ('SPACE','FOLDER','LIST')),
        CONSTRAINT CK_ObjPerm_Level       CHECK (Level IN ('VIEW','COMMENT','EDIT','FULL')),
        CONSTRAINT UQ_ObjPerm UNIQUE (SubjectType, SubjectId, ObjectType, ObjectId)
    );
    CREATE NONCLUSTERED INDEX IX_ObjPerm_Object  ON dbo.ObjectPermissions (ObjectType, ObjectId);
    CREATE NONCLUSTERED INDEX IX_ObjPerm_Subject ON dbo.ObjectPermissions (SubjectType, SubjectId);
END
GO
```

- [ ] **Step 2: Run the migration against the local dev DB**

Run: `npm run db:migrate`
Expected: console prints `0029_hierarchy.sql` applied; no errors.

- [ ] **Step 3: Verify idempotency**

Run: `npm run db:migrate`
Expected: `0029_hierarchy.sql` reported as already applied (no re-execution, no error).

- [ ] **Step 4: Commit**

```bash
git add infra/sql/migrations/0029_hierarchy.sql
git commit -m "feat(db): 0029 hierarchy schema — Folders, Lists, ObjectPermissions, Task/Project/Workflow columns"
```

---

## Task 2: Idempotent backfill (default Lists + task re-home) inside 0029

**Files:**
- Modify: `infra/sql/migrations/0029_hierarchy.sql` (append backfill batch)

- [ ] **Step 1: Append the idempotent backfill batch to the end of `0029_hierarchy.sql`**

```sql
-- ── Backfill: one default List per Space + re-home tasks (idempotent) ───────
-- Re-runnable: only creates a default List for Spaces that lack one, and only
-- re-homes tasks whose ListId is still NULL.
BEGIN
    DECLARE @sid UNIQUEIDENTIFIER, @wsid UNIQUEIDENTIFIER, @pname NVARCHAR(255), @lid UNIQUEIDENTIFIER;
    DECLARE space_cur CURSOR LOCAL FAST_FORWARD FOR
        SELECT p.Id, p.WorkspaceId, p.Name
        FROM   dbo.Projects p
        WHERE  p.DeletedAt IS NULL
          AND  NOT EXISTS (SELECT 1 FROM dbo.Lists l WHERE l.SpaceId = p.Id AND l.IsDefault = 1 AND l.DeletedAt IS NULL);
    OPEN space_cur;
    FETCH NEXT FROM space_cur INTO @sid, @wsid, @pname;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @lid = NEWID();
        INSERT INTO dbo.Lists (Id, WorkspaceId, SpaceId, FolderId, Name, Position, Path, IsDefault)
        VALUES (@lid, @wsid, @sid, NULL, @pname, 0,
                '/' + CONVERT(NVARCHAR(36), @sid) + '/' + CONVERT(NVARCHAR(36), @lid) + '/', 1);
        FETCH NEXT FROM space_cur INTO @sid, @wsid, @pname;
    END
    CLOSE space_cur; DEALLOCATE space_cur;

    UPDATE t
    SET    t.ListId   = l.Id,
           t.ListPath = l.Path
    FROM   dbo.Tasks t
    JOIN   dbo.Lists l ON l.SpaceId = t.ProjectId AND l.IsDefault = 1 AND l.DeletedAt IS NULL
    WHERE  t.ListId IS NULL;
END
GO
```

- [ ] **Step 2: Re-apply 0029 on the dev DB to smoke-test the backfill**

Because the runner records 0029 by checksum, editing it changes the checksum. On the **dev** DB only: delete the `0029_hierarchy.sql` row from `dbo.MigrationHistory`, then re-run.

Run:
```
npm run db:migrate
```
If blocked by checksum mismatch, remove the `0029_hierarchy.sql` history row (dev DB) and re-run.
Expected: every non-deleted Project has exactly one `IsDefault=1` List; every task has non-null `ListId`/`ListPath`. (Authoritative assertion is the Task 14 integration test against a fresh `ProjectFlow_Test` DB.)

- [ ] **Step 3: Commit**

```bash
git add infra/sql/migrations/0029_hierarchy.sql
git commit -m "feat(db): 0029 idempotent backfill — default List per Space + task re-home"
```

---

## Task 3: Rollback (down) script

**Files:**
- Create: `infra/sql/migrations/rollback/0029_hierarchy.down.sql`

- [ ] **Step 1: Write the reverse-order drop script**

```sql
-- =============================================================================
-- Rollback for 0029_hierarchy.sql. Run manually (forward-only runner).
-- Drops in reverse dependency order. Idempotent.
-- =============================================================================
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Tasks_ListPath' AND object_id = OBJECT_ID('dbo.Tasks')) DROP INDEX IX_Tasks_ListPath ON dbo.Tasks;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Tasks_List'     AND object_id = OBJECT_ID('dbo.Tasks')) DROP INDEX IX_Tasks_List ON dbo.Tasks;
GO
-- Tasks.ListId FK to Lists — drop FK then columns.
DECLARE @fk NVARCHAR(128);
SELECT @fk = fk.name FROM sys.foreign_keys fk WHERE fk.parent_object_id = OBJECT_ID('dbo.Tasks') AND fk.referenced_object_id = OBJECT_ID('dbo.Lists');
IF @fk IS NOT NULL EXEC('ALTER TABLE dbo.Tasks DROP CONSTRAINT ' + @fk);
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Tasks') AND name = 'ListPath')   ALTER TABLE dbo.Tasks DROP COLUMN ListPath;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Tasks') AND name = 'ArchivedAt') ALTER TABLE dbo.Tasks DROP COLUMN ArchivedAt;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Tasks') AND name = 'ListId')     ALTER TABLE dbo.Tasks DROP COLUMN ListId;
GO
-- Workflows FKs to Folder/List
DECLARE @wfFk NVARCHAR(128);
SELECT @wfFk = fk.name FROM sys.foreign_keys fk WHERE fk.parent_object_id = OBJECT_ID('dbo.Workflows') AND fk.referenced_object_id = OBJECT_ID('dbo.Lists');
IF @wfFk IS NOT NULL EXEC('ALTER TABLE dbo.Workflows DROP CONSTRAINT ' + @wfFk);
SELECT @wfFk = fk.name FROM sys.foreign_keys fk WHERE fk.parent_object_id = OBJECT_ID('dbo.Workflows') AND fk.referenced_object_id = OBJECT_ID('dbo.Folders');
IF @wfFk IS NOT NULL EXEC('ALTER TABLE dbo.Workflows DROP CONSTRAINT ' + @wfFk);
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Workflows') AND name = 'ListId')   ALTER TABLE dbo.Workflows DROP COLUMN ListId;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Workflows') AND name = 'FolderId') ALTER TABLE dbo.Workflows DROP COLUMN FolderId;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ObjectPermissions') DROP TABLE dbo.ObjectPermissions;
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Lists')             DROP TABLE dbo.Lists;
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Folders')           DROP TABLE dbo.Folders;
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Projects_Visibility') ALTER TABLE dbo.Projects DROP CONSTRAINT CK_Projects_Visibility;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Projects') AND name = 'MaxSubtaskDepth') ALTER TABLE dbo.Projects DROP COLUMN MaxSubtaskDepth;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Projects') AND name = 'Visibility')      ALTER TABLE dbo.Projects DROP COLUMN Visibility;
GO
-- Use the actual MigrationHistory filename column confirmed in Task 1 Step 0.
DELETE FROM dbo.MigrationHistory WHERE [FileName] = '0029_hierarchy.sql';
GO
```

- [ ] **Step 2: Commit**

```bash
git add infra/sql/migrations/rollback/0029_hierarchy.down.sql
git commit -m "feat(db): reversible down script for 0029 hierarchy"
```

---

## Task 4: Pure path helpers (unit-first)

**Files:**
- Create: `apps/api/src/modules/hierarchy/path.ts`
- Test: `apps/api/src/modules/hierarchy/__tests__/path.unit.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { spacePath, folderPath, listPath, descendantPrefix, rewritePrefix } from '../path.js';

describe('hierarchy path helpers', () => {
  const sid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const fid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const lid = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  it('spacePath wraps the space id with slashes', () => {
    expect(spacePath(sid)).toBe(`/${sid}/`);
  });
  it('folderPath appends folder id to the parent path', () => {
    expect(folderPath(`/${sid}/`, fid)).toBe(`/${sid}/${fid}/`);
  });
  it('listPath under a folder appends list id to folder path', () => {
    expect(listPath(`/${sid}/${fid}/`, lid)).toBe(`/${sid}/${fid}/${lid}/`);
  });
  it('listPath directly under a space (folderless)', () => {
    expect(listPath(`/${sid}/`, lid)).toBe(`/${sid}/${lid}/`);
  });
  it('descendantPrefix is the node path used for LIKE matching', () => {
    expect(descendantPrefix(`/${sid}/${fid}/`)).toBe(`/${sid}/${fid}/`);
  });
  it('rewritePrefix swaps an old ancestor prefix for a new one', () => {
    expect(rewritePrefix(`/${sid}/${fid}/${lid}/`, `/${sid}/${fid}/`, `/${sid}/`)).toBe(`/${sid}/${lid}/`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit --workspace apps/api -- path.unit`
Expected: FAIL — `Cannot find module '../path.js'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/api/src/modules/hierarchy/path.ts
/** Materialized-path helpers. Path = '/' + ancestor ids in order + trailing '/'. */

export function spacePath(spaceId: string): string {
  return `/${spaceId}/`;
}
export function folderPath(parentPath: string, folderId: string): string {
  return `${parentPath}${folderId}/`;
}
export function listPath(parentPath: string, listId: string): string {
  return `${parentPath}${listId}/`;
}
/** Prefix for "everything under node X" — WHERE ListPath LIKE descendantPrefix(path) + '%'. */
export function descendantPrefix(nodePath: string): string {
  return nodePath;
}
/** Replace an old ancestor prefix with a new one when a container moves. */
export function rewritePrefix(path: string, oldPrefix: string, newPrefix: string): string {
  if (!path.startsWith(oldPrefix)) return path;
  return newPrefix + path.slice(oldPrefix.length);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit --workspace apps/api -- path.unit`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/hierarchy/path.ts apps/api/src/modules/hierarchy/__tests__/path.unit.test.ts
git commit -m "feat(api): pure materialized-path helpers + unit tests"
```

---

## Task 5: Folder stored procedures

**Files:**
- Create: `infra/sql/procedures/usp_Folder_Create.sql`, `usp_Folder_Update.sql`, `usp_Folder_Move.sql`, `usp_Folder_Delete.sql`, `usp_Folder_List.sql`, `usp_Folder_GetById.sql`, `usp_Folder_GetWorkspaceId.sql`
- Reference: `infra/sql/procedures/usp_Project_Create.sql`, `usp_Task_SetAssignees.sql`

The service generates the GUID and computes `@Path` (it knows the parent path); the SP validates parent containment + workspace consistency and inserts.

- [ ] **Step 1: Write `usp_Folder_Create.sql`** (service passes `@Id` + `@Path`)

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Folder_Create
    @Id             UNIQUEIDENTIFIER,
    @WorkspaceId    UNIQUEIDENTIFIER,
    @SpaceId        UNIQUEIDENTIFIER,
    @ParentFolderId UNIQUEIDENTIFIER = NULL,
    @Name           NVARCHAR(255),
    @Position       FLOAT,
    @Path           NVARCHAR(900)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Projects WHERE Id = @SpaceId AND WorkspaceId = @WorkspaceId AND DeletedAt IS NULL)
            THROW 51200, 'Space not found in workspace', 1;
        IF @ParentFolderId IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM dbo.Folders
            WHERE Id = @ParentFolderId AND SpaceId = @SpaceId AND WorkspaceId = @WorkspaceId AND DeletedAt IS NULL)
            THROW 51201, 'Parent folder not found in this space', 1;

        INSERT INTO dbo.Folders (Id, WorkspaceId, SpaceId, ParentFolderId, Name, Position, Path)
        VALUES (@Id, @WorkspaceId, @SpaceId, @ParentFolderId, @Name, @Position, @Path);

        SELECT * FROM dbo.Folders WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] **Step 2: Write `usp_Folder_Update.sql`** (rename + optional WorkflowId override/clear)

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Folder_Update
    @Id            UNIQUEIDENTIFIER,
    @Name          NVARCHAR(255) = NULL,
    @WorkflowId    UNIQUEIDENTIFIER = NULL,
    @ClearWorkflow BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Folders WHERE Id = @Id AND DeletedAt IS NULL)
            THROW 51202, 'Folder not found', 1;
        UPDATE dbo.Folders
        SET    Name       = COALESCE(@Name, Name),
               WorkflowId = CASE WHEN @ClearWorkflow = 1 THEN NULL ELSE COALESCE(@WorkflowId, WorkflowId) END,
               UpdatedAt  = SYSUTCDATETIME()
        WHERE  Id = @Id;
        SELECT * FROM dbo.Folders WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] **Step 3: Write `usp_Folder_Move.sql`** (reparent + reorder + rewrite descendant paths set-based)

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Folder_Move
    @Id                UNIQUEIDENTIFIER,
    @NewParentFolderId UNIQUEIDENTIFIER = NULL,
    @NewPosition       FLOAT,
    @NewPath           NVARCHAR(900)   -- computed by the service from the new parent's path
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @OldPath NVARCHAR(900);
        SELECT @OldPath = Path FROM dbo.Folders WHERE Id = @Id AND DeletedAt IS NULL;
        IF @OldPath IS NULL THROW 51202, 'Folder not found', 1;

        IF @NewParentFolderId IS NOT NULL AND EXISTS (
            SELECT 1 FROM dbo.Folders WHERE Id = @NewParentFolderId AND Path LIKE @OldPath + '%')
            THROW 51203, 'Cannot move a folder into its own descendant', 1;

        UPDATE dbo.Folders
        SET ParentFolderId = @NewParentFolderId, Position = @NewPosition, Path = @NewPath, UpdatedAt = SYSUTCDATETIME()
        WHERE Id = @Id;

        UPDATE dbo.Folders
        SET Path = @NewPath + SUBSTRING(Path, LEN(@OldPath) + 1, 900), UpdatedAt = SYSUTCDATETIME()
        WHERE Path LIKE @OldPath + '%' AND Id <> @Id;

        UPDATE dbo.Lists
        SET Path = @NewPath + SUBSTRING(Path, LEN(@OldPath) + 1, 900), UpdatedAt = SYSUTCDATETIME()
        WHERE Path LIKE @OldPath + '%';

        UPDATE dbo.Tasks
        SET ListPath = @NewPath + SUBSTRING(ListPath, LEN(@OldPath) + 1, 900)
        WHERE ListPath LIKE @OldPath + '%';

        COMMIT TRANSACTION;
        SELECT * FROM dbo.Folders WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
```

> Note on `LEN()`: T-SQL `LEN` ignores trailing spaces, but paths end in `/` (not a space), so `LEN(@OldPath)` is correct here.

- [ ] **Step 4: Write `usp_Folder_Delete.sql`** (soft-delete; block if non-empty)

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Folder_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Folders WHERE Id = @Id AND DeletedAt IS NULL)
            THROW 51202, 'Folder not found', 1;
        IF EXISTS (SELECT 1 FROM dbo.Lists   WHERE FolderId = @Id AND DeletedAt IS NULL)
            THROW 51204, 'Folder is not empty (has lists)', 1;
        IF EXISTS (SELECT 1 FROM dbo.Folders WHERE ParentFolderId = @Id AND DeletedAt IS NULL)
            THROW 51204, 'Folder is not empty (has subfolders)', 1;
        UPDATE dbo.Folders SET DeletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id;
        SELECT * FROM dbo.Folders WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] **Step 5: Write `usp_Folder_List.sql`, `usp_Folder_GetById.sql`, `usp_Folder_GetWorkspaceId.sql`**

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Folder_List
    @SpaceId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.Folders
    WHERE SpaceId = @SpaceId AND DeletedAt IS NULL
    ORDER BY ParentFolderId, Position;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_Folder_GetById
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.Folders WHERE Id = @Id AND DeletedAt IS NULL;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_Folder_GetWorkspaceId
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT WorkspaceId FROM dbo.Folders WHERE Id = @Id AND DeletedAt IS NULL;
END;
```

- [ ] **Step 6: Deploy SPs and commit**

Run: `npm run db:deploy-sps`
Expected: each `usp_Folder_*` reported deployed, no errors.

```bash
git add infra/sql/procedures/usp_Folder_*.sql
git commit -m "feat(db): folder stored procedures (create/update/move/delete/list/getbyid/getworkspaceid)"
```

---

## Task 6: List stored procedures (incl. effective statuses)

**Files:**
- Create: `infra/sql/procedures/usp_List_Create.sql`, `usp_List_Update.sql`, `usp_List_Move.sql`, `usp_List_Delete.sql`, `usp_List_List.sql`, `usp_List_GetWorkspaceId.sql`, `usp_List_EffectiveStatuses.sql`
- Reference: Task 5 procs, `infra/sql/migrations/0008_workflows.sql` (WorkflowStatuses columns: `Id, WorkflowId, Name, Category, Color, Position`)

- [ ] **Step 1: Write `usp_List_Create.sql`** (service generates `@Id` + `@Path`)

```sql
CREATE OR ALTER PROCEDURE dbo.usp_List_Create
    @Id          UNIQUEIDENTIFIER,
    @WorkspaceId UNIQUEIDENTIFIER,
    @SpaceId     UNIQUEIDENTIFIER,
    @FolderId    UNIQUEIDENTIFIER = NULL,
    @Name        NVARCHAR(255),
    @Position    FLOAT,
    @Path        NVARCHAR(900),
    @IsDefault   BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Projects WHERE Id = @SpaceId AND WorkspaceId = @WorkspaceId AND DeletedAt IS NULL)
            THROW 51200, 'Space not found in workspace', 1;
        IF @FolderId IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM dbo.Folders WHERE Id = @FolderId AND SpaceId = @SpaceId AND WorkspaceId = @WorkspaceId AND DeletedAt IS NULL)
            THROW 51201, 'Folder not found in this space', 1;

        INSERT INTO dbo.Lists (Id, WorkspaceId, SpaceId, FolderId, Name, Position, Path, IsDefault)
        VALUES (@Id, @WorkspaceId, @SpaceId, @FolderId, @Name, @Position, @Path, @IsDefault);
        SELECT * FROM dbo.Lists WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] **Step 2: Write `usp_List_Update.sql`** (rename + WorkflowId override/clear)

```sql
CREATE OR ALTER PROCEDURE dbo.usp_List_Update
    @Id            UNIQUEIDENTIFIER,
    @Name          NVARCHAR(255) = NULL,
    @WorkflowId    UNIQUEIDENTIFIER = NULL,
    @ClearWorkflow BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Lists WHERE Id = @Id AND DeletedAt IS NULL)
            THROW 51210, 'List not found', 1;
        UPDATE dbo.Lists
        SET    Name       = COALESCE(@Name, Name),
               WorkflowId = CASE WHEN @ClearWorkflow = 1 THEN NULL ELSE COALESCE(@WorkflowId, WorkflowId) END,
               UpdatedAt  = SYSUTCDATETIME()
        WHERE  Id = @Id;
        SELECT * FROM dbo.Lists WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] **Step 3: Write `usp_List_Move.sql`** (reparent across folder/space-root + reorder + rewrite list path & its tasks' ListPath)

```sql
CREATE OR ALTER PROCEDURE dbo.usp_List_Move
    @Id          UNIQUEIDENTIFIER,
    @NewFolderId UNIQUEIDENTIFIER = NULL,
    @NewPosition FLOAT,
    @NewPath     NVARCHAR(900)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @OldPath NVARCHAR(900);
        SELECT @OldPath = Path FROM dbo.Lists WHERE Id = @Id AND DeletedAt IS NULL;
        IF @OldPath IS NULL THROW 51210, 'List not found', 1;

        UPDATE dbo.Lists
        SET FolderId = @NewFolderId, Position = @NewPosition, Path = @NewPath, UpdatedAt = SYSUTCDATETIME()
        WHERE Id = @Id;

        UPDATE dbo.Tasks SET ListPath = @NewPath WHERE ListId = @Id;

        COMMIT TRANSACTION;
        SELECT * FROM dbo.Lists WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
```

- [ ] **Step 4: Write `usp_List_Delete.sql`** (block delete of a default list or non-empty list)

```sql
CREATE OR ALTER PROCEDURE dbo.usp_List_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Lists WHERE Id = @Id AND DeletedAt IS NULL)
            THROW 51210, 'List not found', 1;
        IF EXISTS (SELECT 1 FROM dbo.Lists WHERE Id = @Id AND IsDefault = 1)
            THROW 51211, 'Cannot delete the default list', 1;
        IF EXISTS (SELECT 1 FROM dbo.Tasks WHERE ListId = @Id AND DeletedAt IS NULL)
            THROW 51212, 'List is not empty (has tasks)', 1;
        UPDATE dbo.Lists SET DeletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id;
        SELECT * FROM dbo.Lists WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] **Step 5: Write `usp_List_List.sql` and `usp_List_GetWorkspaceId.sql`**

```sql
CREATE OR ALTER PROCEDURE dbo.usp_List_List
    @SpaceId    UNIQUEIDENTIFIER,
    @FolderId   UNIQUEIDENTIFIER = NULL,
    @AllInSpace BIT = 1   -- 1 = every list in the space; 0 = only those directly under @FolderId (NULL => space root)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.Lists
    WHERE SpaceId = @SpaceId AND DeletedAt IS NULL
      AND (@AllInSpace = 1
           OR (@FolderId IS NULL AND FolderId IS NULL)
           OR (FolderId = @FolderId))
    ORDER BY FolderId, Position;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_List_GetWorkspaceId
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT WorkspaceId FROM dbo.Lists WHERE Id = @Id AND DeletedAt IS NULL;
END;
```

- [ ] **Step 6: Write `usp_List_EffectiveStatuses.sql`** — `List.WorkflowId ?? Folder.WorkflowId ?? Space.WorkflowId`

```sql
CREATE OR ALTER PROCEDURE dbo.usp_List_EffectiveStatuses
    @ListId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @WorkflowId UNIQUEIDENTIFIER;

    SELECT @WorkflowId = COALESCE(l.WorkflowId, f.WorkflowId, p.WorkflowId)
    FROM        dbo.Lists    l
    LEFT JOIN   dbo.Folders  f ON f.Id = l.FolderId
    JOIN        dbo.Projects p ON p.Id = l.SpaceId
    WHERE       l.Id = @ListId AND l.DeletedAt IS NULL;

    IF @WorkflowId IS NULL
    BEGIN
        SELECT TOP 0 Id, WorkflowId, Name, Category, Color, Position FROM dbo.WorkflowStatuses;
        RETURN;
    END

    SELECT Id, WorkflowId, Name, Category, Color, Position
    FROM   dbo.WorkflowStatuses
    WHERE  WorkflowId = @WorkflowId
    ORDER  BY Position;
END;
```

- [ ] **Step 7: Deploy SPs and commit**

Run: `npm run db:deploy-sps`
Expected: each `usp_List_*` deployed, no errors.

```bash
git add infra/sql/procedures/usp_List_*.sql
git commit -m "feat(db): list stored procedures + effective-status resolution"
```

---

## Task 7: Object-access ACL stored procedures

**Files:**
- Create: `infra/sql/procedures/usp_ObjectAccess_Resolve.sql`, `usp_ObjectPermission_Set.sql`, `usp_ObjectPermission_Unset.sql`
- Reference: `infra/sql/procedures/usp_UserPermissions_Get.sql`, `usp_Workspace_ListMembers.sql`

**Resolution rule** (encode exactly): given `(@UserId, @ObjectType, @ObjectId)` →
1. Resolve the object's `WorkspaceId` + owning `SpaceId` + the object's `Path`.
2. **Role floor**: workspace owner → `FULL`; any workspace member → `EDIT`; non-member → no floor (`NULL`).
3. **Most-specific wins**: among ObjectPermission rows matching the user (`SubjectType='USER' AND SubjectId=@UserId`) or a role the user holds in this workspace (`SubjectType='ROLE'`), and whose `(ObjectType,ObjectId)` is in the ancestry (Space + ancestor folders + the object itself), pick the deepest. USER beats ROLE at equal depth. Its `Level` overrides the floor (can raise or lower).
4. **Private space**: if the owning Space is `PRIVATE`, the user is not a member/owner, and there is no explicit ancestry grant → return `NULL` level (caller maps to 403).
5. Effective level = explicit most-specific row if present, else the role floor.

- [ ] **Step 1: Write `usp_ObjectAccess_Resolve.sql`**

```sql
CREATE OR ALTER PROCEDURE dbo.usp_ObjectAccess_Resolve
    @UserId     UNIQUEIDENTIFIER,
    @ObjectType NVARCHAR(8),     -- 'SPACE' | 'FOLDER' | 'LIST'
    @ObjectId   UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @SpaceId UNIQUEIDENTIFIER, @WorkspaceId UNIQUEIDENTIFIER, @Path NVARCHAR(900);
    IF @ObjectType = 'SPACE'
        SELECT @SpaceId = Id, @WorkspaceId = WorkspaceId, @Path = '/' + CONVERT(NVARCHAR(36), Id) + '/'
        FROM dbo.Projects WHERE Id = @ObjectId AND DeletedAt IS NULL;
    ELSE IF @ObjectType = 'FOLDER'
        SELECT @SpaceId = SpaceId, @WorkspaceId = WorkspaceId, @Path = Path
        FROM dbo.Folders WHERE Id = @ObjectId AND DeletedAt IS NULL;
    ELSE IF @ObjectType = 'LIST'
        SELECT @SpaceId = SpaceId, @WorkspaceId = WorkspaceId, @Path = Path
        FROM dbo.Lists WHERE Id = @ObjectId AND DeletedAt IS NULL;

    IF @SpaceId IS NULL
    BEGIN
        SELECT CAST(NULL AS NVARCHAR(8)) AS Level, CAST(0 AS BIT) AS Found;  -- object missing
        RETURN;
    END

    DECLARE @IsMember BIT = 0, @IsOwner BIT = 0, @Visibility NVARCHAR(10);
    SELECT @Visibility = Visibility FROM dbo.Projects WHERE Id = @SpaceId;
    IF EXISTS (SELECT 1 FROM dbo.WorkspaceMembers WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId) SET @IsMember = 1;
    IF EXISTS (SELECT 1 FROM dbo.Workspaces WHERE Id = @WorkspaceId AND OwnerId = @UserId) SET @IsOwner = 1;

    DECLARE @Floor NVARCHAR(8) =
        CASE WHEN @IsOwner = 1 THEN 'FULL'
             WHEN @IsMember = 1 THEN 'EDIT'
             ELSE NULL END;

    -- Ancestry object ids: the Space, ancestor folders (path is a prefix of @Path), and the object itself.
    DECLARE @Ancestry TABLE (ObjectType NVARCHAR(8), ObjectId UNIQUEIDENTIFIER, Depth INT);
    INSERT INTO @Ancestry VALUES ('SPACE', @SpaceId, 0);
    INSERT INTO @Ancestry
        SELECT 'FOLDER', f.Id, LEN(f.Path)
        FROM dbo.Folders f
        WHERE f.SpaceId = @SpaceId AND f.DeletedAt IS NULL AND @Path LIKE f.Path + '%';
    IF @ObjectType = 'LIST'
        INSERT INTO @Ancestry VALUES ('LIST', @ObjectId, 9999);

    DECLARE @Explicit NVARCHAR(8);
    SELECT TOP 1 @Explicit = op.Level
    FROM   dbo.ObjectPermissions op
    JOIN   @Ancestry a ON a.ObjectType = op.ObjectType AND a.ObjectId = op.ObjectId
    WHERE  op.WorkspaceId = @WorkspaceId
      AND  (
            (op.SubjectType = 'USER' AND op.SubjectId = @UserId)
            OR (op.SubjectType = 'ROLE' AND op.SubjectId IN (
                  SELECT ur.RoleId FROM dbo.UserRoles ur
                  WHERE ur.UserId = @UserId AND (ur.WorkspaceId = @WorkspaceId OR ur.WorkspaceId IS NULL)))
           )
    ORDER BY a.Depth DESC,
             CASE op.SubjectType WHEN 'USER' THEN 0 ELSE 1 END;

    IF @Visibility = 'PRIVATE' AND @IsMember = 0 AND @IsOwner = 0 AND @Explicit IS NULL
    BEGIN
        SELECT CAST(NULL AS NVARCHAR(8)) AS Level, CAST(1 AS BIT) AS Found;
        RETURN;
    END

    SELECT COALESCE(@Explicit, @Floor) AS Level, CAST(1 AS BIT) AS Found;
END;
```

- [ ] **Step 2: Write `usp_ObjectPermission_Set.sql` (upsert) and `usp_ObjectPermission_Unset.sql`**

```sql
CREATE OR ALTER PROCEDURE dbo.usp_ObjectPermission_Set
    @WorkspaceId UNIQUEIDENTIFIER,
    @SubjectType NVARCHAR(8),
    @SubjectId   UNIQUEIDENTIFIER,
    @ObjectType  NVARCHAR(8),
    @ObjectId    UNIQUEIDENTIFIER,
    @Level       NVARCHAR(8)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        MERGE dbo.ObjectPermissions AS tgt
        USING (SELECT @SubjectType AS S, @SubjectId AS SI, @ObjectType AS O, @ObjectId AS OI) AS src
        ON (tgt.SubjectType = src.S AND tgt.SubjectId = src.SI AND tgt.ObjectType = src.O AND tgt.ObjectId = src.OI)
        WHEN MATCHED THEN UPDATE SET Level = @Level
        WHEN NOT MATCHED THEN
            INSERT (WorkspaceId, SubjectType, SubjectId, ObjectType, ObjectId, Level)
            VALUES (@WorkspaceId, @SubjectType, @SubjectId, @ObjectType, @ObjectId, @Level);
        SELECT * FROM dbo.ObjectPermissions
        WHERE SubjectType = @SubjectType AND SubjectId = @SubjectId AND ObjectType = @ObjectType AND ObjectId = @ObjectId;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_ObjectPermission_Unset
    @SubjectType NVARCHAR(8),
    @SubjectId   UNIQUEIDENTIFIER,
    @ObjectType  NVARCHAR(8),
    @ObjectId    UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM dbo.ObjectPermissions
    WHERE SubjectType = @SubjectType AND SubjectId = @SubjectId AND ObjectType = @ObjectType AND ObjectId = @ObjectId;
END;
```

- [ ] **Step 3: Deploy and commit**

Run: `npm run db:deploy-sps`
Expected: 3 procs deployed.

```bash
git add infra/sql/procedures/usp_ObjectAccess_Resolve.sql infra/sql/procedures/usp_ObjectPermission_Set.sql infra/sql/procedures/usp_ObjectPermission_Unset.sql
git commit -m "feat(db): object-access ACL procs (resolve + set/unset)"
```

---

## Task 8: Descendant-tasks + Task create/move stored procedures

**Files:**
- Create: `infra/sql/procedures/usp_Hierarchy_DescendantTasks.sql`, `usp_Task_Move.sql`
- Modify: `infra/sql/procedures/usp_Task_Create.sql`
- Reference: existing `usp_Task_Create.sql`, `usp_Task_UpdatePosition.sql`

- [ ] **Step 1: Write `usp_Hierarchy_DescendantTasks.sql`** ("everything under node X" — single indexed scan on `ListPath`)

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Hierarchy_DescendantTasks
    @NodeType NVARCHAR(8),       -- 'SPACE' | 'FOLDER' | 'LIST'
    @NodeId   UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Prefix NVARCHAR(900);
    IF @NodeType = 'SPACE'
        SET @Prefix = '/' + CONVERT(NVARCHAR(36), @NodeId) + '/';
    ELSE IF @NodeType = 'FOLDER'
        SELECT @Prefix = Path FROM dbo.Folders WHERE Id = @NodeId AND DeletedAt IS NULL;
    ELSE IF @NodeType = 'LIST'
        SELECT @Prefix = Path FROM dbo.Lists WHERE Id = @NodeId AND DeletedAt IS NULL;

    IF @Prefix IS NULL THROW 51220, 'Node not found', 1;

    SELECT t.*
    FROM   dbo.Tasks t
    WHERE  t.ListPath LIKE @Prefix + '%'
      AND  t.DeletedAt IS NULL
    ORDER  BY t.ListPath, t.Position;
END;
```

- [ ] **Step 2: Modify `usp_Task_Create.sql`** — add `@ListId UNIQUEIDENTIFIER = NULL` to the param list; before the INSERT resolve the List + apply the depth guard

Insert this block before the existing `INSERT INTO Tasks`:

```sql
    DECLARE @ListPath NVARCHAR(900) = NULL;
    IF @ListId IS NOT NULL
    BEGIN
        DECLARE @ListSpaceId UNIQUEIDENTIFIER;
        SELECT @ListSpaceId = SpaceId, @ListPath = Path
        FROM   dbo.Lists WHERE Id = @ListId AND DeletedAt IS NULL;
        IF @ListSpaceId IS NULL THROW 51213, 'List not found', 1;
        SET @ProjectId = @ListSpaceId;   -- bridge: ProjectId tracks the List's Space
    END

    -- Subtask-depth guard (Space.MaxSubtaskDepth). Walk the ParentTaskId chain.
    IF @ParentTaskId IS NOT NULL
    BEGIN
        DECLARE @MaxDepth INT;
        SELECT @MaxDepth = MaxSubtaskDepth FROM dbo.Projects WHERE Id = @ProjectId;
        IF @MaxDepth IS NOT NULL
        BEGIN
            DECLARE @Depth INT = 1, @Cur UNIQUEIDENTIFIER = @ParentTaskId;
            WHILE @Cur IS NOT NULL
            BEGIN
                SELECT @Cur = ParentTaskId FROM dbo.Tasks WHERE Id = @Cur;
                SET @Depth = @Depth + 1;
                IF @Depth > @MaxDepth + 1 BREAK;
            END
            IF @Depth > @MaxDepth + 1
                THROW 51230, 'Subtask depth exceeds the space limit', 1;
        END
    END
```

Then add `ListId, ListPath` to the INSERT column list and `@ListId, @ListPath` to the values. Keep the existing `SELECT * FROM Tasks WHERE Id = @NewId;` return. (Preserve all existing params/behavior; this is additive.)

- [ ] **Step 3: Write `usp_Task_Move.sql`** — re-home to a new List + reorder + set ListPath + bridge ProjectId

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Task_Move
    @TaskId   UNIQUEIDENTIFIER,
    @ListId   UNIQUEIDENTIFIER,
    @Position FLOAT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        DECLARE @SpaceId UNIQUEIDENTIFIER, @ListPath NVARCHAR(900);
        SELECT @SpaceId = SpaceId, @ListPath = Path FROM dbo.Lists WHERE Id = @ListId AND DeletedAt IS NULL;
        IF @SpaceId IS NULL THROW 51213, 'List not found', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL)
            THROW 50404, 'Task not found', 1;

        UPDATE dbo.Tasks
        SET    ListId = @ListId, ListPath = @ListPath, ProjectId = @SpaceId,
               Position = @Position, UpdatedAt = SYSUTCDATETIME()
        WHERE  Id = @TaskId;

        SELECT * FROM dbo.Tasks WHERE Id = @TaskId;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] **Step 4: Deploy and commit**

Run: `npm run db:deploy-sps`
Expected: deployed, no errors.

```bash
git add infra/sql/procedures/usp_Hierarchy_DescendantTasks.sql infra/sql/procedures/usp_Task_Move.sql infra/sql/procedures/usp_Task_Create.sql
git commit -m "feat(db): descendant-tasks query, task move, task-create listId + depth guard"
```

---

## Task 9: Types — extend `@projectflow/types`

**Files:**
- Modify: `packages/types/index.ts`

- [ ] **Step 1: Add the new types and extend `Task`**

Append near the existing RBAC/Task types:

```typescript
export type Visibility = 'PUBLIC' | 'PRIVATE';
export type ObjectPermissionLevel = 'VIEW' | 'COMMENT' | 'EDIT' | 'FULL';
export type HierarchyNodeType = 'SPACE' | 'FOLDER' | 'LIST';

export interface Folder {
  id: string;
  workspaceId: string;
  spaceId: string;
  parentFolderId: string | null;
  name: string;
  position: number;
  path: string;
  workflowId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface List {
  id: string;
  workspaceId: string;
  spaceId: string;
  folderId: string | null;
  name: string;
  position: number;
  path: string;
  workflowId: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** "Space" is the API/UI label for the physical Projects table. */
export interface SpaceExtras {
  visibility: Visibility;
  maxSubtaskDepth: number | null;
}
```

Then add to the existing `Task` interface (do not remove existing fields):

```typescript
  listId: string | null;
  listPath: string | null;
  archivedAt: Date | null;
```

- [ ] **Step 2: Type-check the package**

Run: `npm run build --workspace packages/types` (or `npx tsc --noEmit` inside `packages/types` if no build script).
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/types/index.ts
git commit -m "feat(types): Folder, List, Space extras, ObjectPermissionLevel; Task.listId/listPath"
```

---

## Task 10: Access service + middleware (unit-first)

**Files:**
- Create: `apps/api/src/modules/access/access.repository.ts`
- Create: `apps/api/src/modules/access/access.service.ts`
- Create: `apps/api/src/modules/access/access.middleware.ts`
- Test: `apps/api/src/modules/access/__tests__/access.service.unit.test.ts`

- [ ] **Step 1: Write the repository (wraps the resolve + set/unset SPs)**

```typescript
// apps/api/src/modules/access/access.repository.ts
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { HierarchyNodeType, ObjectPermissionLevel } from '@projectflow/types';

export interface ResolvedAccess {
  Level: ObjectPermissionLevel | null;
  Found: boolean;
}

export class AccessRepository {
  async resolve(userId: string, objectType: HierarchyNodeType, objectId: string): Promise<ResolvedAccess> {
    const rows = await execSpOne<{ Level: ObjectPermissionLevel | null; Found: boolean }>(
      'dbo.usp_ObjectAccess_Resolve',
      [
        { name: 'UserId',     type: sql.UniqueIdentifier, value: userId },
        { name: 'ObjectType', type: sql.NVarChar(8),      value: objectType },
        { name: 'ObjectId',   type: sql.UniqueIdentifier, value: objectId },
      ],
    );
    const r = rows[0];
    return { Level: r?.Level ?? null, Found: Boolean(r?.Found) };
  }

  async set(workspaceId: string, subjectType: 'USER' | 'ROLE', subjectId: string, objectType: HierarchyNodeType, objectId: string, level: ObjectPermissionLevel) {
    const rows = await execSpOne('dbo.usp_ObjectPermission_Set', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'SubjectType', type: sql.NVarChar(8),      value: subjectType },
      { name: 'SubjectId',   type: sql.UniqueIdentifier, value: subjectId },
      { name: 'ObjectType',  type: sql.NVarChar(8),      value: objectType },
      { name: 'ObjectId',    type: sql.UniqueIdentifier, value: objectId },
      { name: 'Level',       type: sql.NVarChar(8),      value: level },
    ]);
    return rows[0];
  }
}
```

- [ ] **Step 2: Write the failing unit test**

```typescript
// apps/api/src/modules/access/__tests__/access.service.unit.test.ts
import { describe, expect, it, vi } from 'vitest';
const { AccessService } = await import('../access.service.js');

function makeRepo(resolved: { Level: any; Found: boolean }) {
  return { resolve: vi.fn().mockResolvedValue(resolved) } as any;
}

describe('AccessService.can', () => {
  it('grants when resolved level meets the minimum', async () => {
    const svc = new AccessService(makeRepo({ Level: 'EDIT', Found: true }));
    expect(await svc.can('u1', 'LIST', 'l1', 'VIEW')).toBe(true);
    expect(await svc.can('u1', 'LIST', 'l1', 'EDIT')).toBe(true);
  });
  it('denies when resolved level is below the minimum', async () => {
    const svc = new AccessService(makeRepo({ Level: 'VIEW', Found: true }));
    expect(await svc.can('u1', 'LIST', 'l1', 'EDIT')).toBe(false);
  });
  it('denies (403) when found but level is null (private-space gate)', async () => {
    const svc = new AccessService(makeRepo({ Level: null, Found: true }));
    expect(await svc.can('u1', 'SPACE', 's1', 'VIEW')).toBe(false);
  });
  it('reports notFound when the object does not exist', async () => {
    const svc = new AccessService(makeRepo({ Level: null, Found: false }));
    expect(await svc.resolveOrNull('u1', 'SPACE', 'missing')).toEqual({ level: null, found: false });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:unit --workspace apps/api -- access.service`
Expected: FAIL — cannot find `../access.service.js`.

- [ ] **Step 4: Write the service**

```typescript
// apps/api/src/modules/access/access.service.ts
import type { HierarchyNodeType, ObjectPermissionLevel } from '@projectflow/types';
import { AccessRepository } from './access.repository.js';

export const LEVEL_ORDER: Record<ObjectPermissionLevel, number> = { VIEW: 1, COMMENT: 2, EDIT: 3, FULL: 4 };

export class AccessService {
  constructor(private repo: AccessRepository = new AccessRepository()) {}

  async can(userId: string, objectType: HierarchyNodeType, objectId: string, min: ObjectPermissionLevel): Promise<boolean> {
    const { Level } = await this.repo.resolve(userId, objectType, objectId);
    if (!Level) return false;
    return LEVEL_ORDER[Level] >= LEVEL_ORDER[min];
  }

  async resolveOrNull(userId: string, objectType: HierarchyNodeType, objectId: string): Promise<{ level: ObjectPermissionLevel | null; found: boolean }> {
    const r = await this.repo.resolve(userId, objectType, objectId);
    return { level: r.Level, found: r.Found };
  }
}

export const accessService = new AccessService();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit --workspace apps/api -- access.service`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the Hono middleware**

```typescript
// apps/api/src/modules/access/access.middleware.ts
import type { Context, Next } from 'hono';
import type { HierarchyNodeType, ObjectPermissionLevel } from '@projectflow/types';
import { accessService, LEVEL_ORDER } from './access.service.js';

function getUserId(c: Context): string | null {
  const u = (c as any).get('user');
  return u?.userId ?? null;
}

/** Gate a route on the caller's effective level for a hierarchy object. */
export function requireObjectAccess(
  min: ObjectPermissionLevel,
  resolveObject: (c: Context) => { type: HierarchyNodeType; id: string } | null,
) {
  return async (c: Context, next: Next) => {
    const userId = getUserId(c);
    if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
    const obj = resolveObject(c);
    if (!obj?.id) return c.json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } }, 404);

    const { level, found } = await accessService.resolveOrNull(userId, obj.type, obj.id);
    if (!found) return c.json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } }, 404);
    if (!level || LEVEL_ORDER[level] < LEVEL_ORDER[min]) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'You do not have access' } }, 403);
    }
    await next();
  };
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/access/
git commit -m "feat(api): object-access service + requireObjectAccess middleware (+unit tests)"
```

---

## Task 11: Folder module (repository + service + routes + GraphQL)

**Files:**
- Create: `apps/api/src/modules/hierarchy/folder.repository.ts` / `folder.service.ts` / `folder.routes.ts`
- Create: `apps/api/src/modules/hierarchy/map.ts` (shared row→shape mappers for REST + GraphQL)
- Modify: `apps/api/src/graphql/schema.ts`, `apps/api/src/graphql/pubsub.ts`, route registrar (`server.ts`)
- Reference: `apps/api/src/modules/projects/*`, `apps/api/src/shared/lib/sqlClient.ts`

- [ ] **Step 1: Write the shared mapper**

```typescript
// apps/api/src/modules/hierarchy/map.ts
export interface FolderShape { id: string; workspaceId: string; spaceId: string; parentFolderId: string | null; name: string; position: number; path: string; workflowId: string | null; createdAt: string; updatedAt: string; }
export interface ListShape { id: string; workspaceId: string; spaceId: string; folderId: string | null; name: string; position: number; path: string; workflowId: string | null; isDefault: boolean; createdAt: string; updatedAt: string; }

export function mapFolderRow(r: any): FolderShape {
  return { id: r.Id, workspaceId: r.WorkspaceId, spaceId: r.SpaceId, parentFolderId: r.ParentFolderId ?? null, name: r.Name, position: r.Position, path: r.Path, workflowId: r.WorkflowId ?? null, createdAt: r.CreatedAt, updatedAt: r.UpdatedAt };
}
export function mapListRow(r: any): ListShape {
  return { id: r.Id, workspaceId: r.WorkspaceId, spaceId: r.SpaceId, folderId: r.FolderId ?? null, name: r.Name, position: r.Position, path: r.Path, workflowId: r.WorkflowId ?? null, isDefault: Boolean(r.IsDefault), createdAt: r.CreatedAt, updatedAt: r.UpdatedAt };
}
```

- [ ] **Step 2: Write the repository**

```typescript
// apps/api/src/modules/hierarchy/folder.repository.ts
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';

export class FolderRepository {
  async create(p: { id: string; workspaceId: string; spaceId: string; parentFolderId: string | null; name: string; position: number; path: string }) {
    const rows = await execSpOne('usp_Folder_Create', [
      { name: 'Id',             type: sql.UniqueIdentifier, value: p.id },
      { name: 'WorkspaceId',    type: sql.UniqueIdentifier, value: p.workspaceId },
      { name: 'SpaceId',        type: sql.UniqueIdentifier, value: p.spaceId },
      { name: 'ParentFolderId', type: sql.UniqueIdentifier, value: p.parentFolderId ?? null },
      { name: 'Name',           type: sql.NVarChar(255),    value: p.name },
      { name: 'Position',       type: sql.Float,            value: p.position },
      { name: 'Path',           type: sql.NVarChar(900),    value: p.path },
    ]);
    return rows[0];
  }
  async list(spaceId: string) {
    return execSpOne('usp_Folder_List', [{ name: 'SpaceId', type: sql.UniqueIdentifier, value: spaceId }]);
  }
  async getById(id: string) {
    const rows = await execSpOne('usp_Folder_GetById', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0] ?? null;
  }
  async getWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_Folder_GetWorkspaceId', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0]?.WorkspaceId ?? null;
  }
  async update(id: string, name?: string, workflowId?: string | null, clearWorkflow = false) {
    const rows = await execSpOne('usp_Folder_Update', [
      { name: 'Id',            type: sql.UniqueIdentifier, value: id },
      { name: 'Name',          type: sql.NVarChar(255),    value: name ?? null },
      { name: 'WorkflowId',    type: sql.UniqueIdentifier, value: workflowId ?? null },
      { name: 'ClearWorkflow', type: sql.Bit,              value: clearWorkflow ? 1 : 0 },
    ]);
    return rows[0];
  }
  async move(id: string, newParentFolderId: string | null, newPosition: number, newPath: string) {
    const rows = await execSpOne('usp_Folder_Move', [
      { name: 'Id',                type: sql.UniqueIdentifier, value: id },
      { name: 'NewParentFolderId', type: sql.UniqueIdentifier, value: newParentFolderId ?? null },
      { name: 'NewPosition',       type: sql.Float,            value: newPosition },
      { name: 'NewPath',           type: sql.NVarChar(900),    value: newPath },
    ]);
    return rows[0];
  }
  async softDelete(id: string) {
    const rows = await execSpOne('usp_Folder_Delete', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0];
  }
}
```

- [ ] **Step 3: Write the service (computes path from the parent's path)**

```typescript
// apps/api/src/modules/hierarchy/folder.service.ts
import { randomUUID } from 'node:crypto';
import { FolderRepository } from './folder.repository.js';
import { spacePath, folderPath } from './path.js';

export class FolderService {
  constructor(private repo: FolderRepository = new FolderRepository()) {}

  /** parentPath = the parent folder's Path, or spacePath(spaceId) when top-level. */
  async create(input: { workspaceId: string; spaceId: string; parentFolderId: string | null; name: string; position: number; parentPath: string }) {
    const id = randomUUID();
    const path = folderPath(input.parentPath, id);
    return this.repo.create({ id, workspaceId: input.workspaceId, spaceId: input.spaceId, parentFolderId: input.parentFolderId, name: input.name, position: input.position, path });
  }
  list(spaceId: string) { return this.repo.list(spaceId); }
  getById(id: string) { return this.repo.getById(id); }
  getWorkspaceId(id: string) { return this.repo.getWorkspaceId(id); }
  update(id: string, name?: string, workflowId?: string | null, clearWorkflow = false) { return this.repo.update(id, name, workflowId, clearWorkflow); }
  async move(id: string, newParentFolderId: string | null, newPosition: number, newParentPath: string) {
    const newPath = folderPath(newParentPath, id);
    return this.repo.move(id, newParentFolderId, newPosition, newPath);
  }
  delete(id: string) { return this.repo.softDelete(id); }
  spacePath = spacePath;  // helper for routes computing top-level parent path
}

export const folderService = new FolderService();
```

- [ ] **Step 4: Write REST routes (gated by `requireObjectAccess`)**

```typescript
// apps/api/src/modules/hierarchy/folder.routes.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { folderService } from './folder.service.js';
import { requireObjectAccess } from '../access/access.middleware.js';
import { pubsub } from '../../graphql/pubsub.js';

export const folderRoutes = new Hono();

const createSchema = z.object({
  workspaceId: z.string().uuid(),
  spaceId: z.string().uuid(),
  parentFolderId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(255),
  position: z.number().default(0),
});

async function parentPathFor(spaceId: string, parentFolderId: string | null): Promise<string | null> {
  if (!parentFolderId) return folderService.spacePath(spaceId);
  const parent = await folderService.getById(parentFolderId);
  return parent ? (parent as any).Path : null;
}

folderRoutes.post('/', zValidator('json', createSchema),
  requireObjectAccess('EDIT', (c) => {
    const b = (c.req as any).valid('json');
    return b.parentFolderId ? { type: 'FOLDER', id: b.parentFolderId } : { type: 'SPACE', id: b.spaceId };
  }),
  async (c) => {
    const b = c.req.valid('json');
    const parentPath = await parentPathFor(b.spaceId, b.parentFolderId ?? null);
    if (!parentPath) return c.json({ error: { code: 'NOT_FOUND', message: 'Parent not found' } }, 404);
    const folder = await folderService.create({ ...b, parentFolderId: b.parentFolderId ?? null, parentPath });
    pubsub.publish('folder:updated', { spaceId: b.spaceId, folder });
    return c.json({ data: folder }, 201);
  },
);

folderRoutes.get('/', zValidator('query', z.object({ spaceId: z.string().uuid() })),
  requireObjectAccess('VIEW', (c) => ({ type: 'SPACE', id: c.req.query('spaceId')! })),
  async (c) => c.json({ data: await folderService.list(c.req.query('spaceId')!) }),
);

const updateSchema = z.object({ name: z.string().min(1).max(255).optional(), workflowId: z.string().uuid().nullable().optional() });
folderRoutes.patch('/:id', zValidator('json', updateSchema),
  requireObjectAccess('EDIT', (c) => ({ type: 'FOLDER', id: c.req.param('id')! })),
  async (c) => {
    const { name, workflowId } = c.req.valid('json');
    const folder = await folderService.update(c.req.param('id')!, name, workflowId ?? undefined, workflowId === null);
    pubsub.publish('folder:updated', { spaceId: (folder as any).SpaceId, folder });
    return c.json({ data: folder });
  },
);

const moveSchema = z.object({ parentFolderId: z.string().uuid().nullable(), position: z.number(), spaceId: z.string().uuid() });
folderRoutes.patch('/:id/move', zValidator('json', moveSchema),
  requireObjectAccess('EDIT', (c) => ({ type: 'FOLDER', id: c.req.param('id')! })),
  async (c) => {
    const { parentFolderId, position, spaceId } = c.req.valid('json');
    const newParentPath = await parentPathFor(spaceId, parentFolderId);
    if (!newParentPath) return c.json({ error: { code: 'NOT_FOUND', message: 'Parent not found' } }, 404);
    try {
      const folder = await folderService.move(c.req.param('id')!, parentFolderId, position, newParentPath);
      pubsub.publish('folder:updated', { spaceId, folder });
      return c.json({ data: folder });
    } catch (err: any) {
      if (err.number === 51203) return c.json({ error: { code: 'UNPROCESSABLE', message: err.message } }, 422);
      throw err;
    }
  },
);

folderRoutes.delete('/:id',
  requireObjectAccess('FULL', (c) => ({ type: 'FOLDER', id: c.req.param('id')! })),
  async (c) => {
    try {
      const folder = await folderService.delete(c.req.param('id')!);
      pubsub.publish('folder:updated', { spaceId: (folder as any).SpaceId, folder });
      return c.json({ data: folder });
    } catch (err: any) {
      if (err.number === 51204) return c.json({ error: { code: 'CONFLICT', message: err.message } }, 409);
      throw err;
    }
  },
);
```

- [ ] **Step 5: Register pubsub channels + mount routes**

In `apps/api/src/graphql/pubsub.ts` add to `PubSubChannels`:

```typescript
  'space:updated':  [{ workspaceId: string; space: unknown }];
  'folder:updated': [{ spaceId: string; folder: unknown }];
  'list:updated':   [{ spaceId: string; list: unknown }];
```

In the route registrar (where `taskRoutes` is mounted in `server.ts`):

```typescript
import { folderRoutes } from './modules/hierarchy/folder.routes.js';
app.route('/api/v1/folders', folderRoutes);
```

- [ ] **Step 6: Add GraphQL `Folder` type + queries/mutations**

In `schema.ts`, using `mapFolderRow` and the `builder.objectRef` pattern (mirror `ProjectType`):

```typescript
import { mapFolderRow, type FolderShape } from '../modules/hierarchy/map.js';
import { folderService } from '../modules/hierarchy/folder.service.js';

const FolderType = builder.objectRef<FolderShape>('Folder');
FolderType.implement({ fields: (t) => ({
  id:             t.exposeString('id'),
  workspaceId:    t.exposeString('workspaceId'),
  spaceId:        t.exposeString('spaceId'),
  parentFolderId: t.string({ nullable: true, resolve: (f) => f.parentFolderId ?? null }),
  name:           t.exposeString('name'),
  position:       t.exposeFloat('position'),
  path:           t.exposeString('path'),
  workflowId:     t.string({ nullable: true, resolve: (f) => f.workflowId ?? null }),
  createdAt:      t.field({ type: 'Date', resolve: (f) => new Date(f.createdAt) }),
}) });
```

Add `folders(spaceId)` query and `createFolder`/`updateFolder`/`moveFolder`/`deleteFolder` mutations. Each calls `requireAuth(ctx)`, delegates to `folderService` (compute `parentPath` exactly as the REST route does — reuse a small shared helper if convenient), maps rows via `mapFolderRow`, and publishes `folder:updated`. Mirror the existing `createTask` mutation shape.

- [ ] **Step 7: Type-check + commit**

Run: `npm run build --workspace apps/api` (or `npx tsc --noEmit`).
Expected: compiles.

```bash
git add apps/api/src/modules/hierarchy/folder.* apps/api/src/modules/hierarchy/map.ts apps/api/src/graphql/schema.ts apps/api/src/graphql/pubsub.ts apps/api/src/server.ts
git commit -m "feat(api): folder module (repo/service/REST/GraphQL) + pubsub channels"
```

---

## Task 12: List module (repository + service + routes + GraphQL + effectiveStatuses)

**Files:**
- Create: `apps/api/src/modules/hierarchy/list.repository.ts` / `list.service.ts` / `list.routes.ts`
- Modify: `apps/api/src/graphql/schema.ts`, route registrar
- Test: `apps/api/src/modules/hierarchy/__tests__/list-status.unit.test.ts`

- [ ] **Step 1: Write the failing unit test for status-shaping**

```typescript
// apps/api/src/modules/hierarchy/__tests__/list-status.unit.test.ts
import { describe, expect, it, vi } from 'vitest';
const { ListService } = await import('../list.service.js');

function makeRepo(statuses: any[]) {
  return { effectiveStatuses: vi.fn().mockResolvedValue(statuses) } as any;
}

describe('ListService.effectiveStatuses', () => {
  it('maps SP rows (PascalCase) to camelCase status objects, preserving SP order', async () => {
    const svc = new ListService(makeRepo([
      { Id: 's1', Name: 'To Do', Category: 'TODO',        Color: '#999', Position: 0 },
      { Id: 's2', Name: 'Doing', Category: 'IN_PROGRESS', Color: '#00f', Position: 1 },
    ]));
    const out = await svc.effectiveStatuses('l1');
    expect(out.map((s) => s.name)).toEqual(['To Do', 'Doing']);
    expect(out[1]).toMatchObject({ id: 's2', category: 'IN_PROGRESS', color: '#00f', position: 1 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit --workspace apps/api -- list-status`
Expected: FAIL — cannot find `../list.service.js`.

- [ ] **Step 3: Write the repository**

```typescript
// apps/api/src/modules/hierarchy/list.repository.ts
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';

export class ListRepository {
  async create(p: { id: string; workspaceId: string; spaceId: string; folderId: string | null; name: string; position: number; path: string; isDefault?: boolean }) {
    const rows = await execSpOne('usp_List_Create', [
      { name: 'Id',          type: sql.UniqueIdentifier, value: p.id },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: p.workspaceId },
      { name: 'SpaceId',     type: sql.UniqueIdentifier, value: p.spaceId },
      { name: 'FolderId',    type: sql.UniqueIdentifier, value: p.folderId ?? null },
      { name: 'Name',        type: sql.NVarChar(255),    value: p.name },
      { name: 'Position',    type: sql.Float,            value: p.position },
      { name: 'Path',        type: sql.NVarChar(900),    value: p.path },
      { name: 'IsDefault',   type: sql.Bit,              value: p.isDefault ? 1 : 0 },
    ]);
    return rows[0];
  }
  async list(spaceId: string, folderId: string | null, allInSpace = true) {
    return execSpOne('usp_List_List', [
      { name: 'SpaceId',    type: sql.UniqueIdentifier, value: spaceId },
      { name: 'FolderId',   type: sql.UniqueIdentifier, value: folderId ?? null },
      { name: 'AllInSpace', type: sql.Bit,              value: allInSpace ? 1 : 0 },
    ]);
  }
  async getWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_List_GetWorkspaceId', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0]?.WorkspaceId ?? null;
  }
  async update(id: string, name?: string, workflowId?: string | null, clearWorkflow = false) {
    const rows = await execSpOne('usp_List_Update', [
      { name: 'Id',            type: sql.UniqueIdentifier, value: id },
      { name: 'Name',          type: sql.NVarChar(255),    value: name ?? null },
      { name: 'WorkflowId',    type: sql.UniqueIdentifier, value: workflowId ?? null },
      { name: 'ClearWorkflow', type: sql.Bit,              value: clearWorkflow ? 1 : 0 },
    ]);
    return rows[0];
  }
  async move(id: string, newFolderId: string | null, newPosition: number, newPath: string) {
    const rows = await execSpOne('usp_List_Move', [
      { name: 'Id',          type: sql.UniqueIdentifier, value: id },
      { name: 'NewFolderId', type: sql.UniqueIdentifier, value: newFolderId ?? null },
      { name: 'NewPosition', type: sql.Float,            value: newPosition },
      { name: 'NewPath',     type: sql.NVarChar(900),    value: newPath },
    ]);
    return rows[0];
  }
  async softDelete(id: string) {
    const rows = await execSpOne('usp_List_Delete', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0];
  }
  async effectiveStatuses(listId: string) {
    return execSpOne('usp_List_EffectiveStatuses', [{ name: 'ListId', type: sql.UniqueIdentifier, value: listId }]);
  }
}
```

- [ ] **Step 4: Write the service**

```typescript
// apps/api/src/modules/hierarchy/list.service.ts
import { randomUUID } from 'node:crypto';
import { ListRepository } from './list.repository.js';
import { FolderRepository } from './folder.repository.js';
import { spacePath, listPath } from './path.js';

export interface EffectiveStatus { id: string; name: string; category: string; color: string | null; position: number; }

export class ListService {
  constructor(
    private repo: ListRepository = new ListRepository(),
    private folders: FolderRepository = new FolderRepository(),
  ) {}

  /** parentPath = the folder's Path (if folderId), else spacePath(spaceId). */
  async parentPath(spaceId: string, folderId: string | null): Promise<string | null> {
    if (!folderId) return spacePath(spaceId);
    const f = await this.folders.getById(folderId);
    return f ? (f as any).Path : null;
  }

  async create(input: { workspaceId: string; spaceId: string; folderId: string | null; name: string; position: number; parentPath: string; isDefault?: boolean }) {
    const id = randomUUID();
    const path = listPath(input.parentPath, id);
    return this.repo.create({ id, workspaceId: input.workspaceId, spaceId: input.spaceId, folderId: input.folderId, name: input.name, position: input.position, path, isDefault: input.isDefault });
  }
  list(spaceId: string, folderId: string | null = null, allInSpace = true) { return this.repo.list(spaceId, folderId, allInSpace); }
  getWorkspaceId(id: string) { return this.repo.getWorkspaceId(id); }
  update(id: string, name?: string, workflowId?: string | null, clearWorkflow = false) { return this.repo.update(id, name, workflowId, clearWorkflow); }
  async move(id: string, newFolderId: string | null, newPosition: number, newParentPath: string) {
    const newPath = listPath(newParentPath, id);
    return this.repo.move(id, newFolderId, newPosition, newPath);
  }
  delete(id: string) { return this.repo.softDelete(id); }
  async effectiveStatuses(listId: string): Promise<EffectiveStatus[]> {
    const rows = await this.repo.effectiveStatuses(listId);
    return (rows as any[]).map((r) => ({ id: r.Id, name: r.Name, category: r.Category, color: r.Color ?? null, position: r.Position }));
  }
}

export const listService = new ListService();
```

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `npm run test:unit --workspace apps/api -- list-status`
Expected: PASS.

- [ ] **Step 6: Write REST routes**

Mirror `folder.routes.ts`: `POST /` (requires `EDIT` on the folder when `folderId`, else on the space; `parentPath` via `listService.parentPath`; publish `list:updated`); `GET /?spaceId=&folderId=` (requires `VIEW` on the space); `PATCH /:id` (rename/workflow, `EDIT` on the list); `PATCH /:id/move` (`EDIT` on the list; `parentPath` via the new folder/space root); `DELETE /:id` (`FULL` on the list; map 51211/51212 → 409); and:

```typescript
// effective statuses
listRoutes.get('/:id/effective-statuses',
  requireObjectAccess('VIEW', (c) => ({ type: 'LIST', id: c.req.param('id')! })),
  async (c) => c.json({ data: await listService.effectiveStatuses(c.req.param('id')!) }),
);
```

- [ ] **Step 7: Add GraphQL `List` + `EffectiveStatus` types, `lists(spaceId, folderId?)`, `effectiveStatuses(listId)`, and create/update/move/delete mutations**

Mirror Task 11 Step 6 using `mapListRow`. `EffectiveStatus` is a GraphQL object with `id/name/category/color/position`. Mutations publish `list:updated`.

- [ ] **Step 8: Mount routes, type-check, commit**

Add `app.route('/api/v1/lists', listRoutes);`.
Run: `npm run build --workspace apps/api`. Expected: compiles.

```bash
git add apps/api/src/modules/hierarchy/list.* apps/api/src/graphql/schema.ts apps/api/src/server.ts
git commit -m "feat(api): list module (repo/service/REST/GraphQL) + effective-status resolution"
```

---

## Task 13: everythingUnder + Task create/move wiring (subtask-depth unit)

**Files:**
- Create: `apps/api/src/modules/hierarchy/hierarchy.repository.ts` / `hierarchy.routes.ts`
- Modify: `apps/api/src/modules/tasks/task.repository.ts` / `task.service.ts` / `task.routes.ts`, `graphql/schema.ts`
- Test: `apps/api/src/modules/tasks/__tests__/subtask-depth.unit.test.ts`

- [ ] **Step 1: Write `hierarchy.repository.ts`**

```typescript
// apps/api/src/modules/hierarchy/hierarchy.repository.ts
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { HierarchyNodeType } from '@projectflow/types';

export class HierarchyRepository {
  async descendantTasks(nodeType: HierarchyNodeType, nodeId: string) {
    return execSpOne('usp_Hierarchy_DescendantTasks', [
      { name: 'NodeType', type: sql.NVarChar(8),      value: nodeType },
      { name: 'NodeId',   type: sql.UniqueIdentifier, value: nodeId },
    ]);
  }
}
```

- [ ] **Step 2: Write `hierarchy.routes.ts`**

```typescript
// apps/api/src/modules/hierarchy/hierarchy.routes.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HierarchyRepository } from './hierarchy.repository.js';
import { requireObjectAccess } from '../access/access.middleware.js';

const repo = new HierarchyRepository();
export const hierarchyRoutes = new Hono();
const q = z.object({ nodeType: z.enum(['SPACE', 'FOLDER', 'LIST']), nodeId: z.string().uuid() });

hierarchyRoutes.get('/everything', zValidator('query', q),
  requireObjectAccess('VIEW', (c) => ({ type: c.req.query('nodeType') as any, id: c.req.query('nodeId')! })),
  async (c) => c.json({ data: await repo.descendantTasks(c.req.query('nodeType') as any, c.req.query('nodeId')!) }),
);
```

- [ ] **Step 3: Add `listId` to task create + `move` in the task repository**

In `task.repository.ts`, add to the `create` SP params:

```typescript
    { name: 'ListId', type: sql.UniqueIdentifier, value: (input as any).listId ?? null },
```

and add:

```typescript
async move(taskId: string, listId: string, position: number): Promise<Task | null> {
  const rows = await execSpOne<Task>('usp_Task_Move', [
    { name: 'TaskId',   type: sql.UniqueIdentifier, value: taskId },
    { name: 'ListId',   type: sql.UniqueIdentifier, value: listId },
    { name: 'Position', type: sql.Float,            value: position },
  ]);
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Write the failing subtask-depth unit test (SP error number survives the service)**

```typescript
// apps/api/src/modules/tasks/__tests__/subtask-depth.unit.test.ts
import { describe, expect, it, vi } from 'vitest';
import { TaskService } from '../task.service.js';

describe('TaskService.createTask subtask-depth mapping', () => {
  it('propagates SP error 51230 (route maps to 422)', async () => {
    const repo = { create: vi.fn().mockRejectedValue(Object.assign(new Error('Subtask depth exceeds the space limit'), { number: 51230 })) } as any;
    const svc = new TaskService(repo);
    await expect(svc.createTask({ title: 'x', listId: 'l1', workspaceId: 'w1' } as any, 'u1'))
      .rejects.toMatchObject({ number: 51230 });
  });
});
```

> If `TaskService` is exported as an object rather than a class, adapt to construct/import it accordingly (match the existing `task.service.ts` shape). The assertion that matters: the SP error number is not swallowed.

- [ ] **Step 5: Add `moveTask` to the service + 422/404 mappings in routes; run the test**

In `task.service.ts` add `moveTask(taskId, listId, position)` delegating to `repo.move`. In `task.routes.ts` add `PATCH /:id/move` (validate `{ listId: uuid, position: number }`, gate with `requireObjectAccess('EDIT', { type: 'LIST', id: body.listId })`); in the create + move catch blocks map `err.number === 51230` → 422 and `err.number === 51213` → 404 (mirroring the existing `50020` → 409 mapping in projects routes). Publish `task:updated` after move.

Run: `npm run test:unit --workspace apps/api -- subtask-depth`
Expected: PASS.

- [ ] **Step 6: GraphQL — `listId` on `CreateTaskInput`, `moveTask` mutation, `everythingUnder` query**

Add `listId` (nullable) to `CreateTaskInput`. Add `moveTask(taskId, listId, position)` resolver (`requireAuth`, `taskService.moveTask`, publish `task:updated`). Add `everythingUnder(nodeType, nodeId): [Task]` delegating to `HierarchyRepository.descendantTasks` (map rows to the existing Task shape).

- [ ] **Step 7: Mount hierarchy routes, type-check, commit**

Add `app.route('/api/v1/hierarchy', hierarchyRoutes);`.
Run: `npm run build --workspace apps/api`. Expected: compiles.

```bash
git add apps/api/src/modules/hierarchy/hierarchy.* apps/api/src/modules/tasks/ apps/api/src/graphql/schema.ts apps/api/src/server.ts
git commit -m "feat(api): everythingUnder query + task listId create/move + subtask-depth 422"
```

---

## Task 14: Integration tests — build tree, everythingUnder, effective statuses, backfill

**Files:**
- Modify: `apps/api/src/__tests__/fixtures/truncate.ts`
- Create: `apps/api/src/modules/hierarchy/__tests__/hierarchy.integration.test.ts`
- Create: `apps/api/src/modules/hierarchy/__tests__/backfill.integration.test.ts`
- Reference: `apps/api/src/__tests__/fixtures/factories.ts`, `testServer.ts`

- [ ] **Step 0: Add new tables to truncation order**

In `truncate.ts`, ensure `TRUNCATION_ORDER` deletes `Tasks` (already present, now FKs `Lists`) before `Lists`, and `Lists`/`Folders` before `Projects`; add `'ObjectPermissions'` (any time before `Workspaces`/`Users`). Keep catalog tables (`Roles`/`Permissions`/`RolePermissions`) preserved. Concretely insert `'ObjectPermissions'`, `'Lists'`, `'Folders'` in the correct positions.

- [ ] **Step 1: Write the tree + everythingUnder + folderless-list integration test**

```typescript
// apps/api/src/modules/hierarchy/__tests__/hierarchy.integration.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function setup() {
  const owner = await createTestUser({ email: `tree-${Date.now()}-${Math.random().toString(36).slice(2)}@projectflow.test` });
  const ws = await createTestWorkspace(owner.accessToken);
  const space = await createTestProject(ws.Id, owner.accessToken, { name: 'Space A', key: `SPCA${Date.now() % 10000}` });
  return { owner, ws, space };
}

describe('hierarchy tree', () => {
  it('builds Space -> Folder -> List AND a folderless List under the Space', async () => {
    const { owner, ws, space } = await setup();
    const t = owner.accessToken;

    const f = (await json<{ data: any }>(await request('/folders', {
      method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, name: 'Folder 1', position: 0 },
    }), 201)).data;

    const listInFolder = (await json<{ data: any }>(await request('/lists', {
      method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: f.Id, name: 'List in folder', position: 0 },
    }), 201)).data;
    expect(listInFolder.FolderId).toBe(f.Id);
    expect(listInFolder.Path).toBe(`/${space.Id}/${f.Id}/${listInFolder.Id}/`);

    const folderless = (await json<{ data: any }>(await request('/lists', {
      method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Folderless', position: 1 },
    }), 201)).data;
    expect(folderless.FolderId).toBeNull();
    expect(folderless.Path).toBe(`/${space.Id}/${folderless.Id}/`);
  });

  it('everythingUnder returns descendant tasks via ListPath (Space-wide and folder-scoped)', async () => {
    const { owner, ws, space } = await setup();
    const t = owner.accessToken;
    const f = (await json<{ data: any }>(await request('/folders', { method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, name: 'F', position: 0 } }), 201)).data;
    const l1 = (await json<{ data: any }>(await request('/lists', { method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: f.Id, name: 'L1', position: 0 } }), 201)).data;
    const l2 = (await json<{ data: any }>(await request('/lists', { method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'L2', position: 1 } }), 201)).data;

    await request('/tasks', { method: 'POST', token: t, json: { title: 'in L1', listId: l1.Id, workspaceId: ws.Id } });
    await request('/tasks', { method: 'POST', token: t, json: { title: 'in L2', listId: l2.Id, workspaceId: ws.Id } });

    const all = (await json<{ data: any[] }>(await request(`/hierarchy/everything?nodeType=SPACE&nodeId=${space.Id}`, { token: t }), 200)).data;
    expect(all.length).toBe(2);

    const underF = (await json<{ data: any[] }>(await request(`/hierarchy/everything?nodeType=FOLDER&nodeId=${f.Id}`, { token: t }), 200)).data;
    expect(underF.length).toBe(1);
    expect(underF[0].Title).toBe('in L1');
  });

  it('effective statuses: List-level workflow overrides the Space-level workflow', async () => {
    // If a workflow-create REST/SP exists, create a Space workflow + a List workflow and assert
    // GET /lists/:id/effective-statuses returns the List workflow's statuses. If workflow CRUD is
    // not exposed via REST, assert the precedence by writing Workflows/WorkflowStatuses rows
    // directly via getPool() then calling the endpoint. Keep at least one assertion that the
    // List-level set wins over the Space-level set.
    expect(true).toBe(true); // replace with the concrete assertion above during execution
  });
});
```

> The `/tasks` POST body must match the real create schema (it may require `reporterId`/`status`); align with `createTestTask` in `factories.ts`. If `createTestTask` accepts `listId`, prefer it. The status-override test MUST be made concrete during execution (it maps to acceptance criterion §2.8 "overridable at List level").

- [ ] **Step 2: Run the integration test**

Run: `npm run test:integration --workspace apps/api -- hierarchy.integration`
Expected: PASS. Fix SP/route bugs until green.

- [ ] **Step 3: Write the backfill integration test**

```typescript
// apps/api/src/modules/hierarchy/__tests__/backfill.integration.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../../../shared/lib/db.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

// The idempotent backfill SQL, kept in sync with the batch in 0029_hierarchy.sql.
const BACKFILL = `
DECLARE @sid UNIQUEIDENTIFIER, @wsid UNIQUEIDENTIFIER, @pname NVARCHAR(255), @lid UNIQUEIDENTIFIER;
DECLARE space_cur CURSOR LOCAL FAST_FORWARD FOR
  SELECT p.Id, p.WorkspaceId, p.Name FROM dbo.Projects p
  WHERE p.DeletedAt IS NULL AND NOT EXISTS (SELECT 1 FROM dbo.Lists l WHERE l.SpaceId = p.Id AND l.IsDefault = 1 AND l.DeletedAt IS NULL);
OPEN space_cur; FETCH NEXT FROM space_cur INTO @sid, @wsid, @pname;
WHILE @@FETCH_STATUS = 0 BEGIN
  SET @lid = NEWID();
  INSERT INTO dbo.Lists (Id, WorkspaceId, SpaceId, FolderId, Name, Position, Path, IsDefault)
  VALUES (@lid, @wsid, @sid, NULL, @pname, 0, '/' + CONVERT(NVARCHAR(36), @sid) + '/' + CONVERT(NVARCHAR(36), @lid) + '/', 1);
  FETCH NEXT FROM space_cur INTO @sid, @wsid, @pname;
END
CLOSE space_cur; DEALLOCATE space_cur;
UPDATE t SET t.ListId = l.Id, t.ListPath = l.Path
FROM dbo.Tasks t JOIN dbo.Lists l ON l.SpaceId = t.ProjectId AND l.IsDefault = 1 AND l.DeletedAt IS NULL
WHERE t.ListId IS NULL;`;

describe('backfill', () => {
  it('creates exactly one default List per Space and re-homes ListId-less tasks; is idempotent', async () => {
    const owner = await createTestUser({ email: `bf-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const space = await createTestProject(ws.Id, owner.accessToken, { name: 'Legacy', key: `LEG${Date.now() % 10000}` });
    const pool = await getPool();

    await pool.request().query(`
      INSERT INTO dbo.Tasks (Id, ProjectId, WorkspaceId, IssueKey, Title, Status, Priority, ReporterId, Position)
      VALUES (NEWID(), '${space.Id}', '${ws.Id}', 'LEG-1', 'Legacy task', 'To Do', 'MEDIUM', '${owner.user.Id}', 0)`);

    await pool.request().batch(BACKFILL);
    await pool.request().batch(BACKFILL); // idempotent re-run

    const lists = await pool.request().query(`SELECT * FROM dbo.Lists WHERE SpaceId = '${space.Id}' AND IsDefault = 1`);
    expect(lists.recordset.length).toBe(1);

    const tasks = await pool.request().query(`SELECT ListId, ListPath FROM dbo.Tasks WHERE ProjectId = '${space.Id}'`);
    expect(tasks.recordset.every((r) => r.ListId && r.ListPath)).toBe(true);
  });
});
```

> Confirm the pool accessor name (`getPool`) and the Tasks insert column set against `0001_init.sql` (IssueKey unique per project). Adjust the legacy-task insert if more NOT NULL columns exist.

- [ ] **Step 4: Run + commit**

Run: `npm run test:integration --workspace apps/api -- backfill.integration`
Expected: PASS.

```bash
git add apps/api/src/modules/hierarchy/__tests__/ apps/api/src/__tests__/fixtures/truncate.ts
git commit -m "test(api): hierarchy tree, everythingUnder, effective-statuses, backfill integration"
```

---

## Task 15: Integration tests — private-space 403/200 + multitenancy; Space visibility PATCH

**Files:**
- Modify: `apps/api/src/modules/projects/project.routes.ts` (+ repo/SP) — accept `visibility` (and optionally `maxSubtaskDepth`) on project update
- Create: `apps/api/src/modules/access/__tests__/object-access.integration.test.ts`
- Create: `apps/api/src/modules/hierarchy/__tests__/multitenancy.integration.test.ts`

- [ ] **Step 1: Add `visibility` to the Space (project) update path**

Extend the existing `usp_Project_Update` (or add `usp_Space_SetVisibility`) to set `Visibility` (and `MaxSubtaskDepth`), and accept `visibility`/`maxSubtaskDepth` in the project PATCH route + repository. Record this small extension in `DECISIONS.md`. Deploy SPs.

- [ ] **Step 2: Write the private-space access test**

```typescript
// apps/api/src/modules/access/__tests__/object-access.integration.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

describe('private space access', () => {
  it('owner gets 200, non-member gets 403 on a PRIVATE space subtree', async () => {
    const owner = await createTestUser({ email: `acc-owner-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const space = await createTestProject(ws.Id, owner.accessToken, { name: 'Private', key: `PRV${Date.now() % 10000}` });

    await request(`/projects/${space.Id}`, { method: 'PATCH', token: owner.accessToken, json: { visibility: 'PRIVATE' } });

    const ownerRes = await request(`/folders?spaceId=${space.Id}`, { token: owner.accessToken });
    expect(ownerRes.status).toBe(200);

    const stranger = await createTestUser({ email: `acc-stranger-${Date.now()}@projectflow.test` });
    const strangerRes = await request(`/folders?spaceId=${space.Id}`, { token: stranger.accessToken });
    expect(strangerRes.status).toBe(403);
  });
});
```

- [ ] **Step 3: Write the multitenancy isolation test**

```typescript
// apps/api/src/modules/hierarchy/__tests__/multitenancy.integration.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

describe('hierarchy multitenancy isolation', () => {
  it('a user in workspace B cannot read folders of a space in workspace A', async () => {
    const a = await createTestUser({ email: `mt-a-${Date.now()}@projectflow.test` });
    const wsA = await createTestWorkspace(a.accessToken);
    const spaceA = await createTestProject(wsA.Id, a.accessToken, { name: 'A', key: `AAA${Date.now() % 10000}` });
    await request('/folders', { method: 'POST', token: a.accessToken, json: { workspaceId: wsA.Id, spaceId: spaceA.Id, name: 'secret', position: 0 } });

    const b = await createTestUser({ email: `mt-b-${Date.now()}@projectflow.test` });
    const res = await request(`/folders?spaceId=${spaceA.Id}`, { token: b.accessToken });
    expect([403, 404]).toContain(res.status);
  });
});
```

- [ ] **Step 4: Run + commit**

Run: `npm run test:integration --workspace apps/api -- object-access multitenancy`
Expected: PASS (fix the visibility route until green).

```bash
git add apps/api/src/modules/access/__tests__/ apps/api/src/modules/hierarchy/__tests__/multitenancy.integration.test.ts apps/api/src/modules/projects/ infra/sql/procedures/ DECISIONS.md
git commit -m "test(api): private-space 403/200 + multitenancy isolation; space visibility PATCH"
```

---

## Task 16: Frontend — label constants + server queries/actions

**Files:**
- Create: `apps/next-web/src/config/hierarchy.config.ts`
- Create: `apps/next-web/src/server/queries/hierarchy.ts`
- Modify: `apps/next-web/src/server/queries/normalize.ts`
- Create: `apps/next-web/src/server/actions/hierarchy.ts`
- Reference: `apps/next-web/src/server/queries/projects.ts`, `actions/projects.ts`, `actions/tasks.ts`

> **Read `node_modules/next/dist/docs/` before writing web code** (per AGENTS.md — Next 16 breaking changes). Confirm `revalidatePath`, server-action, and async `cookies()` signatures against the installed version.

- [ ] **Step 1: Create the label/icon constants (single relabel source)**

```typescript
// apps/next-web/src/config/hierarchy.config.ts
import { Box, Folder as FolderIcon, List as ListIcon } from 'lucide-react';

export const HIERARCHY_LABELS = { space: 'Space', folder: 'Folder', list: 'List' } as const;
export const HIERARCHY_LABELS_PLURAL = { space: 'Spaces', folder: 'Folders', list: 'Lists' } as const;
export const HIERARCHY_ICONS = { space: Box, folder: FolderIcon, list: ListIcon } as const;
```

- [ ] **Step 2: Add normalizers to `normalize.ts`**

```typescript
export interface Folder { id: string; spaceId: string; parentFolderId: string | null; name: string; position: number; path: string; }
export interface List { id: string; spaceId: string; folderId: string | null; name: string; position: number; path: string; isDefault: boolean; }

export function normalizeFolder(r: any): Folder {
  return { id: r.Id ?? r.id, spaceId: r.SpaceId ?? r.spaceId, parentFolderId: r.ParentFolderId ?? r.parentFolderId ?? null, name: r.Name ?? r.name, position: r.Position ?? r.position ?? 0, path: r.Path ?? r.path };
}
export function normalizeList(r: any): List {
  return { id: r.Id ?? r.id, spaceId: r.SpaceId ?? r.spaceId, folderId: r.FolderId ?? r.folderId ?? null, name: r.Name ?? r.name, position: r.Position ?? r.position ?? 0, path: r.Path ?? r.path, isDefault: Boolean(r.IsDefault ?? r.isDefault) };
}
```

- [ ] **Step 3: Create server queries**

```typescript
// apps/next-web/src/server/queries/hierarchy.ts
import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';
import { normalizeFolder, normalizeList, type Folder, type List } from './normalize';

export const getFolders = cache(async (spaceId: string): Promise<Folder[]> => {
  const data = await serverFetch<any[]>(`/folders?spaceId=${encodeURIComponent(spaceId)}`);
  return (data ?? []).map(normalizeFolder);
});

export const getLists = cache(async (spaceId: string): Promise<List[]> => {
  const data = await serverFetch<any[]>(`/lists?spaceId=${encodeURIComponent(spaceId)}`);
  return (data ?? []).map(normalizeList);
});

export const getEverythingUnder = cache(async (nodeType: 'SPACE' | 'FOLDER' | 'LIST', nodeId: string) => {
  return serverFetch<any[]>(`/hierarchy/everything?nodeType=${nodeType}&nodeId=${encodeURIComponent(nodeId)}`);
});
```

- [ ] **Step 4: Create server actions**

```typescript
// apps/next-web/src/server/actions/hierarchy.ts
'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError, type ActionResult } from './error';

export async function createFolder(input: { workspaceId: string; spaceId: string; parentFolderId: string | null; name: string; position?: number }): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch('/folders', { method: 'POST', body: JSON.stringify({ position: 0, ...input }) }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/'); return { ok: true };
}
export async function createList(input: { workspaceId: string; spaceId: string; folderId: string | null; name: string; position?: number }): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch('/lists', { method: 'POST', body: JSON.stringify({ position: 0, ...input }) }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/'); return { ok: true };
}
export async function moveFolder(id: string, parentFolderId: string | null, position: number, spaceId: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/folders/${encodeURIComponent(id)}/move`, { method: 'PATCH', body: JSON.stringify({ parentFolderId, position, spaceId }) }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/'); return { ok: true };
}
export async function moveList(id: string, folderId: string | null, position: number, spaceId: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/lists/${encodeURIComponent(id)}/move`, { method: 'PATCH', body: JSON.stringify({ folderId, position, spaceId }) }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/'); return { ok: true };
}
export async function moveTaskToList(taskId: string, listId: string, position: number): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/tasks/${encodeURIComponent(taskId)}/move`, { method: 'PATCH', body: JSON.stringify({ listId, position }) }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/'); return { ok: true };
}
export async function renameFolder(id: string, name: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/folders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/'); return { ok: true };
}
export async function renameList(id: string, name: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/lists/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/'); return { ok: true };
}
export async function deleteFolder(id: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/folders/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/'); return { ok: true };
}
export async function deleteList(id: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/lists/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/'); return { ok: true };
}
```

> Confirm `ActionResult` + `toActionError` exports in `actions/error.ts`; match their actual shape. Confirm `serverFetch` infers `Content-Type: application/json` for string bodies (it does, per `api.ts`).

- [ ] **Step 5: Type-check + commit**

Run: `npm run build --workspace apps/next-web` (or the repo typecheck).
Expected: compiles (UI not wired yet).

```bash
git add apps/next-web/src/config/hierarchy.config.ts apps/next-web/src/server/queries/hierarchy.ts apps/next-web/src/server/queries/normalize.ts apps/next-web/src/server/actions/hierarchy.ts
git commit -m "feat(web): hierarchy labels, server queries + actions for folders/lists/task-move"
```

---

## Task 17: Frontend — sidebar tree (create/rename/delete + dnd reorder/reparent)

**Files:**
- Create: `apps/next-web/src/components/hierarchy/SidebarTree.tsx`
- Create: `apps/next-web/src/components/hierarchy/SidebarTreeNode.tsx`
- Modify: `apps/next-web/src/components/layouts/layout-1/components/sidebar-menu.tsx`
- Reference: `apps/next-web/src/components/Board.tsx` (dnd-kit usage + `midpoint` import)

- [ ] **Step 1: Build `SidebarTree` (`'use client'`, collapsible, server-data-driven)**

`SidebarTree` receives props `{ spaces: Project[]; foldersBySpace: Record<string, Folder[]>; listsBySpace: Record<string, List[]> }` (fetched server-side by the layout). It renders Space → Folder → List using `HIERARCHY_LABELS`/`HIERARCHY_ICONS`. Each node: collapse/expand toggle (`useState<Set<string>>`), inline "+" to create a child (opens a small inline input → calls `createFolder`/`createList`), double-click to rename (→ `renameFolder`/`renameList`), and a delete affordance (→ `deleteFolder`/`deleteList`). List nodes are `<Link href={`/lists/${list.id}`}>`. Wrap action calls in `useTransition`; on `{ ok:false }` call the existing `notifyActionError` helper. Add stable `data-testid` attributes: `space-node`, `folder-node`, `list-node`, `folder-add`, `list-add`, `node-name-input`.

- [ ] **Step 2: Add dnd-kit reorder + reparent**

Wrap in `DndContext` + `SortableContext` (mirror `Board.tsx`). On drag end compute `position` via the existing `midpoint(prevPos, nextPos)` helper (import from the same module `Board.tsx` uses). Determine the new parent from the drop target (folder vs space-root for lists; folder vs folder for subfolders). Call `moveFolder`/`moveList` (and `moveTaskToList` when a task is dragged onto a list). Apply optimistic local-state update; reconcile on the action result.

- [ ] **Step 3: Mount in the sidebar**

In `sidebar-menu.tsx`, render `<SidebarTree … />` under a heading using `HIERARCHY_LABELS_PLURAL.space`, below the static `MENU_SIDEBAR`. The parent server layout fetches `getProjects` + `getFolders` + `getLists` for the active workspace and passes them down. (If `sidebar-menu.tsx` is a client component, fetch in the layout server component and pass props.)

- [ ] **Step 4: Manual smoke + commit**

Run: `npm run dev --workspace apps/next-web`; confirm the tree renders and create/rename/delete + drag reorder work and persist after reload. (Automated coverage = Task 19.)

```bash
git add apps/next-web/src/components/hierarchy/ apps/next-web/src/components/layouts/layout-1/components/sidebar-menu.tsx
git commit -m "feat(web): sidebar Space/Folder/List tree with dnd reorder + reparent"
```

---

## Task 18: Frontend — List view page + Task drawer breadcrumb

**Files:**
- Create: `apps/next-web/src/app/(app)/lists/[listId]/page.tsx`
- Create: `apps/next-web/src/app/(app)/lists/[listId]/list-view.tsx`
- Modify: `apps/next-web/src/components/TaskDrawer.tsx`
- Reference: `apps/next-web/src/app/(app)/board/page.tsx` + `board-view.tsx`

> Next 16: `params` is async — `const { listId } = await params;`. Confirm against `node_modules/next/dist/docs/`.

- [ ] **Step 1: Build the List view page (SSR)**

```typescript
// apps/next-web/src/app/(app)/lists/[listId]/page.tsx
import { requireSession } from '@/server/session';
import { getEverythingUnder } from '@/server/queries/hierarchy';
import { ListView } from './list-view';

export default async function ListPage({ params }: { params: Promise<{ listId: string }> }) {
  await requireSession();
  const { listId } = await params;
  const tasks = await getEverythingUnder('LIST', listId);
  return <ListView listId={listId} tasks={tasks ?? []} />;
}
```

- [ ] **Step 2: Build `list-view.tsx`** (`'use client'`)

Reuse the same task-row rendering used by the existing Board/Backlog (extract or import the row component). Render the list's tasks keyed by `listId`. Inline create input calls `createTask({ listId, workspaceId })` (the existing task action; pass `listId`). Drag-reorder within the list calls `moveTaskToList(taskId, listId, midpoint(prevPos, nextPos))`. Clicking a task opens the existing `TaskDrawer`. Add `data-testid="list-task-input"` to the create input and `data-testid="list-task"` to rows.

- [ ] **Step 3: Add the breadcrumb to `TaskDrawer.tsx`**

Add a Space / Folder / List breadcrumb line near the title. Pass a `breadcrumb?: { space: string; folder?: string; list?: string }` prop from the list/board pages (derive from the task's `listId` via a small server lookup or the already-loaded lists/folders). Render with `HIERARCHY_ICONS`. Read-only for Phase 1.

- [ ] **Step 4: Smoke + commit**

Run: `npm run dev --workspace apps/next-web`; open a List, create/move a task, open the drawer, verify the breadcrumb.

```bash
git add "apps/next-web/src/app/(app)/lists" apps/next-web/src/components/TaskDrawer.tsx
git commit -m "feat(web): List view page + task move; Space/Folder/List breadcrumb in TaskDrawer"
```

---

## Task 19: E2E — sidebar create-tree + task-move (Playwright)

**Files:**
- Create: `e2e/hierarchy.spec.ts`
- Reference: `e2e/smoke.spec.ts`, `playwright.config.ts`, `e2e/global-setup.ts`

- [ ] **Step 1: Write the e2e spec (register via API, drive the UI; use the `data-testid`s from Tasks 17–18)**

```typescript
// e2e/hierarchy.spec.ts
import { test, expect, request as pwRequest } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';
const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

test('create Space tree (folder + list) in sidebar, create a task, persist on reload', async ({ page }) => {
  const s = uniq();
  const email = `e2e-h-${s}@projectflow.test`;
  const password = 'E2EPass123!';

  const api = await pwRequest.newContext();
  await api.post(`${API_BASE}/auth/register`, { data: { email, name: `H ${s}`, password } });
  const login = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
  const { data: { token } } = await login.json();
  const ws = await (await api.post(`${API_BASE}/workspaces`, { headers: { Authorization: `Bearer ${token}` }, data: { name: `WS ${s}`, slug: `ws-${s}` } })).json();
  await api.post(`${API_BASE}/projects`, { headers: { Authorization: `Bearer ${token}` }, data: { workspaceId: ws.data.Id, name: `Space ${s}`, key: `SP${s.slice(-4)}`, type: 'KANBAN' } });

  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });

  // Create a Folder under the Space.
  const spaceNode = page.getByTestId('space-node').filter({ hasText: `Space ${s}` }).first();
  await spaceNode.hover();
  await spaceNode.getByTestId('folder-add').click();
  await page.getByTestId('node-name-input').fill(`Folder ${s}`);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('folder-node').filter({ hasText: `Folder ${s}` })).toBeVisible({ timeout: 10000 });

  // Create a List under the Folder.
  const folderNode = page.getByTestId('folder-node').filter({ hasText: `Folder ${s}` }).first();
  await folderNode.hover();
  await folderNode.getByTestId('list-add').click();
  await page.getByTestId('node-name-input').fill(`List ${s}`);
  await page.keyboard.press('Enter');
  const listNode = page.getByTestId('list-node').filter({ hasText: `List ${s}` });
  await expect(listNode).toBeVisible({ timeout: 10000 });

  // Open the List, create a task.
  await listNode.click();
  await page.waitForURL(/\/lists\//);
  await page.getByTestId('list-task-input').fill(`Task ${s}`);
  await page.keyboard.press('Enter');
  await expect(page.getByText(`Task ${s}`, { exact: true })).toBeVisible({ timeout: 10000 });

  // Reload: tree + task persist.
  await page.reload();
  await expect(page.getByTestId('list-node').filter({ hasText: `List ${s}` })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(`Task ${s}`, { exact: true })).toBeVisible({ timeout: 10000 });

  await api.dispose();
});
```

- [ ] **Step 2: Run the e2e**

Run: `npx playwright test e2e/hierarchy.spec.ts`
Expected: PASS (Playwright auto-starts api + web webservers per `playwright.config.ts`). Fix selectors/testids until green.

- [ ] **Step 3: Commit**

```bash
git add e2e/hierarchy.spec.ts
git commit -m "test(e2e): sidebar create-tree + task flow persists on reload"
```

---

## Task 20: Full-suite verification + acceptance checklist

**Files:** none (verification only)

- [ ] **Step 1: Run the entire backend unit + integration suite**

Run:
```
npm run test:unit --workspace apps/api
npm run test:integration --workspace apps/api
```
Expected: all green. Paste the summary lines (counts). Do not claim success without the output.

- [ ] **Step 2: Run e2e**

Run: `npx playwright test`
Expected: hierarchy + smoke specs pass.

- [ ] **Step 3: Verify acceptance criteria (design §2.8) against real output — tick each only with evidence**

- [ ] Space → Folder → List tree **and** folderless List under a Space (Task 14 test green).
- [ ] Tasks + nested subtasks within `MaxSubtaskDepth`; over-limit → 422 (Task 13 unit + an integration check that sets `MaxSubtaskDepth` and exceeds it).
- [ ] Space statuses inherited by Lists, overridable at List level (Task 12 unit + the Task 14 status-override integration assertion).
- [ ] Private-Space member-without-permission → 403; owner → 200 (Task 15 test green).
- [ ] Reordering folders/lists/tasks persists & survives concurrent edits (fractional `Position`; e2e reload + a `midpoint` concurrent check).
- [ ] "Everything" returns all descendant tasks via one indexed `ListPath` query (Task 14 test green).
- [ ] Backfill: every existing task lands in its Space's default List; `/board`, `/backlog`, `/roadmap` still work via the `ProjectId` bridge (Task 14 backfill test + manual page smoke).

- [ ] **Step 4: Confirm DoD §3 items**

- [ ] `0029_hierarchy.sql` reversible (apply on a scratch DB, run `rollback/0029_hierarchy.down.sql`, confirm clean).
- [ ] Unit + integration cover new SPs/resolvers; ≥1 Playwright e2e covers create-tree + task flow.
- [ ] `@projectflow/types` updated (Task 9).
- [ ] Deviations recorded in `DECISIONS.md` (Task 0 + the visibility-PATCH note from Task 15).

- [ ] **Step 5: Final commit + STOP for human review**

```bash
git add -A
git commit -m "chore(hierarchy): Phase 1 verification — full suite green, acceptance criteria met"
```

Then **stop for human review before Phase 2 (Custom Fields)**, per the DoD.

---

## Self-Review notes (author)

- **Spec coverage:** §2.1 data model → Tasks 1–2; §2.2 migration/backfill → Tasks 1–3, 14; §2.3 SPs + GraphQL → Tasks 5–8, 11–13; §2.4 resolvers (permission/status/depth/ordering) → Tasks 7, 10, 12, 13; §2.5 frontend → Tasks 16–18; §2.6 realtime/cross-cutting → pubsub channels (Task 11) + multitenancy test (Task 15) + Idempotency deferred (Task 0); §2.7 tests → Tasks 4,10,12,13 (unit), 14,15 (integration), 19 (e2e); §2.8 acceptance → Task 20.
- **Deviations to confirm during execution:** (a) project `visibility` PATCH requires extending `usp_Project_Update` (Task 15) — logged; (b) `midpoint` import path confirmed from `Board.tsx`; (c) the Task 14 status-override and Task 13/20 depth-exceed integration assertions must be made concrete (not left as `expect(true)`).
- **Type consistency:** `LEVEL_ORDER` defined once in `access.service.ts`, imported by the middleware (no duplicate map). SP error codes (51200–51230, plus reused 50404/51030) referenced consistently across procs, route mappings, and tests. Mapper functions (`mapFolderRow`/`mapListRow`) shared by REST and GraphQL via `hierarchy/map.ts`. `parentPath` computation centralized in `folderService.spacePath`/`listService.parentPath`.
