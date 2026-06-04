# Views Engine (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build savable, shareable views (List/Board/Table/Calendar) backed by a TypeScript query compiler that filters/groups/sorts tasks over built-in and custom fields, with Me-mode and bulk edit; retrofit the existing Board onto the new engine.

**Architecture:** New `views` backend module. SavedView CRUD uses house-style stored procedures (`usp_View_*`). The dynamic task query is the one documented exception to SP-per-op: a pure TS compiler turns a typed filter AST into a single **parameterized** SQL statement, executed via the `mssql` parameterized request API (identifiers strictly allow-listed from a field catalog, every value a bound parameter). GraphQL (Pothos) is the primary surface, delegating to `ViewService` → `ViewRepository`/`QueryCompiler`. Frontend adds a tabbed view surface and retrofits `/board`.

**Tech Stack:** TypeScript, Hono, GraphQL (Pothos + graphql-yoga), SQL Server (mssql), Redis pubsub, Next.js 16 (SSR server-queries/actions), Vitest (unit + integration), Playwright.

**Spec:** `docs/superpowers/specs/2026-06-04-views-engine-phase3-design.md`

**Conventions (verified against repo):**
- Repository methods call SPs via `execSpOne<T>(name, [{ name, type, value }])` from `apps/api/src/shared/lib/sqlClient.js`; `sql` types from `mssql`.
- SP house style: `CREATE OR ALTER PROCEDURE dbo.usp_X`, `SET NOCOUNT ON;`, `BEGIN TRY … END TRY BEGIN CATCH THROW; END CATCH`, custom `THROW <code>, '<msg>', 1;`, return rows via `SELECT *`.
- GraphQL: Pothos `builder.objectRef`/`queryFields`/`mutationFields`; authz via `requireObjectLevel(ctx, nodeType, nodeId, 'VIEW'|'EDIT')` from `apps/api/src/graphql/authz.js`; each schema file exports a `registerXGraphql()` wired in `apps/api/src/graphql/schema.ts`.
- Tests: `apps/api/src/__tests__/fixtures/factories.ts` (`createTestUser/Workspace/Project/Task`), `request`/`json` from `__tests__/setup/testServer.js`, `getPool()`/`closePool()` from `shared/lib/db.js`, `truncateAll()` from `__tests__/fixtures/truncate.ts`. Integration global setup auto-deploys migrations + SPs.
- Test commands: unit → `npx vitest run --project unit <path>` ; integration → `npx vitest run --project integration <path>` (run from `apps/api`).
- Migrations: numbered idempotent files in `infra/sql/migrations/` with `IF NOT EXISTS` guards; SPs are individual files in `infra/sql/procedures/`. Latest migration is `0031_*`; this phase adds `0032_saved_views.sql`.

**Build order (phases):** A) data model + SavedView SPs + repo CRUD · B) query engine (catalog + compiler) unit-first · C) query execution + service + GraphQL + integration · D) bulk edit + Me-mode · E) frontend (surface, Table, Calendar, Board retrofit, e2e) · F) finalize.

---

## PHASE A — Data model + SavedView CRUD

### Task A1: Migration `0032_saved_views.sql`

**Files:**
- Create: `infra/sql/migrations/0032_saved_views.sql`

- [ ] **Step 1: Write the migration (idempotent, reversible)**

```sql
-- 0032_saved_views.sql — Phase 3 Views Engine: SavedViews table
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SavedViews')
BEGIN
    CREATE TABLE dbo.SavedViews (
        Id           UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId  UNIQUEIDENTIFIER NOT NULL,
        OwnerId      UNIQUEIDENTIFIER NOT NULL,
        ScopeType    NVARCHAR(12) NOT NULL,
        ScopeId      UNIQUEIDENTIFIER NULL,
        ScopePath    NVARCHAR(900) NULL,
        Type         NVARCHAR(10) NOT NULL,
        Name         NVARCHAR(255) NOT NULL,
        IsShared     BIT NOT NULL DEFAULT 0,
        IsDefault    BIT NOT NULL DEFAULT 0,
        Config       NVARCHAR(MAX) NOT NULL,
        Position     FLOAT NOT NULL DEFAULT 0,
        CreatedAt    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        DeletedAt    DATETIME2 NULL,
        CONSTRAINT CK_SavedViews_ScopeType  CHECK (ScopeType IN ('LIST','FOLDER','SPACE','EVERYTHING')),
        CONSTRAINT CK_SavedViews_Type       CHECK (Type IN ('list','board','table','calendar')),
        CONSTRAINT CK_SavedViews_ScopeId    CHECK (ScopeType = 'EVERYTHING' OR ScopeId IS NOT NULL),
        CONSTRAINT FK_SavedViews_Workspace  FOREIGN KEY (WorkspaceId) REFERENCES dbo.Workspaces(Id),
        CONSTRAINT FK_SavedViews_Owner      FOREIGN KEY (OwnerId) REFERENCES dbo.Users(Id)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SavedViews_Scope')
    CREATE INDEX IX_SavedViews_Scope ON dbo.SavedViews (WorkspaceId, ScopeType, ScopeId, Position) WHERE DeletedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SavedViews_Owner')
    CREATE INDEX IX_SavedViews_Owner ON dbo.SavedViews (OwnerId) WHERE DeletedAt IS NULL;
GO
```

> Down migration (for the reversibility note in DoD): drop `IX_SavedViews_Owner`, `IX_SavedViews_Scope`, then `dbo.SavedViews`. Match the existing down-migration convention used by `0029`/`0030` — open one of them in `infra/sql/migrations/` to see whether downs are a `.down.sql` sibling or an embedded `-- DOWN` marker, and follow it exactly.

- [ ] **Step 2: Verify it parses by running the integration setup once**

Run (from `apps/api`): `npx vitest run --project integration src/modules/customfields/__tests__/multitenancy.integration.test.ts`
Expected: PASS (global setup deploys all migrations incl. `0032` without error). A SQL syntax error in `0032` fails setup loudly here.

- [ ] **Step 3: Commit**

```bash
git add infra/sql/migrations/0032_saved_views.sql
git commit -m "feat(views): add SavedViews table migration (0032)"
```

---

### Task A2: SavedView stored procedures

**Files:**
- Create: `infra/sql/procedures/usp_View_GetWorkspaceId.sql`
- Create: `infra/sql/procedures/usp_View_Create.sql`
- Create: `infra/sql/procedures/usp_View_Update.sql`
- Create: `infra/sql/procedures/usp_View_Delete.sql`
- Create: `infra/sql/procedures/usp_View_List.sql`
- Create: `infra/sql/procedures/usp_View_Reorder.sql`

- [ ] **Step 1: `usp_View_GetWorkspaceId.sql`**

```sql
CREATE OR ALTER PROCEDURE dbo.usp_View_GetWorkspaceId
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT WorkspaceId FROM dbo.SavedViews WHERE Id = @Id AND DeletedAt IS NULL;
END;
```

- [ ] **Step 2: `usp_View_Create.sql`**

```sql
CREATE OR ALTER PROCEDURE dbo.usp_View_Create
    @Id          UNIQUEIDENTIFIER,
    @WorkspaceId UNIQUEIDENTIFIER,
    @OwnerId     UNIQUEIDENTIFIER,
    @ScopeType   NVARCHAR(12),
    @ScopeId     UNIQUEIDENTIFIER,
    @ScopePath   NVARCHAR(900),
    @Type        NVARCHAR(10),
    @Name        NVARCHAR(255),
    @IsShared    BIT,
    @IsDefault   BIT,
    @Config      NVARCHAR(MAX),
    @Position    FLOAT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF @IsDefault = 1
            UPDATE dbo.SavedViews
               SET IsDefault = 0, UpdatedAt = SYSUTCDATETIME()
             WHERE WorkspaceId = @WorkspaceId AND ScopeType = @ScopeType
               AND ((@ScopeId IS NULL AND ScopeId IS NULL) OR ScopeId = @ScopeId)
               AND Type = @Type AND DeletedAt IS NULL;

        INSERT INTO dbo.SavedViews (Id, WorkspaceId, OwnerId, ScopeType, ScopeId, ScopePath, Type, Name, IsShared, IsDefault, Config, Position)
        VALUES (@Id, @WorkspaceId, @OwnerId, @ScopeType, @ScopeId, @ScopePath, @Type, @Name, @IsShared, @IsDefault, @Config, @Position);

        SELECT * FROM dbo.SavedViews WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] **Step 3: `usp_View_Update.sql`** (partial update; NULL = leave unchanged)

```sql
CREATE OR ALTER PROCEDURE dbo.usp_View_Update
    @Id        UNIQUEIDENTIFIER,
    @Name      NVARCHAR(255) = NULL,
    @IsShared  BIT = NULL,
    @IsDefault BIT = NULL,
    @Config    NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        DECLARE @Ws UNIQUEIDENTIFIER, @ScopeType NVARCHAR(12), @ScopeId UNIQUEIDENTIFIER, @Type NVARCHAR(10);
        SELECT @Ws = WorkspaceId, @ScopeType = ScopeType, @ScopeId = ScopeId, @Type = Type
          FROM dbo.SavedViews WHERE Id = @Id AND DeletedAt IS NULL;
        IF @Ws IS NULL THROW 51500, 'Saved view not found', 1;

        IF @IsDefault = 1
            UPDATE dbo.SavedViews
               SET IsDefault = 0, UpdatedAt = SYSUTCDATETIME()
             WHERE WorkspaceId = @Ws AND ScopeType = @ScopeType
               AND ((@ScopeId IS NULL AND ScopeId IS NULL) OR ScopeId = @ScopeId)
               AND Type = @Type AND Id <> @Id AND DeletedAt IS NULL;

        UPDATE dbo.SavedViews
           SET Name      = COALESCE(@Name, Name),
               IsShared  = COALESCE(@IsShared, IsShared),
               IsDefault = COALESCE(@IsDefault, IsDefault),
               Config    = COALESCE(@Config, Config),
               UpdatedAt = SYSUTCDATETIME()
         WHERE Id = @Id;

        SELECT * FROM dbo.SavedViews WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] **Step 4: `usp_View_Delete.sql`** (soft delete)

```sql
CREATE OR ALTER PROCEDURE dbo.usp_View_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.SavedViews WHERE Id = @Id AND DeletedAt IS NULL)
            THROW 51500, 'Saved view not found', 1;
        UPDATE dbo.SavedViews SET DeletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id;
        SELECT * FROM dbo.SavedViews WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] **Step 5: `usp_View_List.sql`** (visible to caller = shared ∪ own-private, at a node)

```sql
CREATE OR ALTER PROCEDURE dbo.usp_View_List
    @WorkspaceId UNIQUEIDENTIFIER,
    @UserId      UNIQUEIDENTIFIER,
    @ScopeType   NVARCHAR(12),
    @ScopeId     UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.SavedViews
     WHERE WorkspaceId = @WorkspaceId
       AND ScopeType = @ScopeType
       AND ((@ScopeId IS NULL AND ScopeId IS NULL) OR ScopeId = @ScopeId)
       AND DeletedAt IS NULL
       AND (IsShared = 1 OR OwnerId = @UserId)
     ORDER BY Position ASC, CreatedAt ASC;
END;
```

- [ ] **Step 6: `usp_View_Reorder.sql`**

```sql
CREATE OR ALTER PROCEDURE dbo.usp_View_Reorder
    @Id       UNIQUEIDENTIFIER,
    @Position FLOAT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.SavedViews WHERE Id = @Id AND DeletedAt IS NULL)
            THROW 51500, 'Saved view not found', 1;
        UPDATE dbo.SavedViews SET Position = @Position, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id;
        SELECT * FROM dbo.SavedViews WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] **Step 7: Commit**

```bash
git add infra/sql/procedures/usp_View_*.sql
git commit -m "feat(views): SavedView CRUD stored procedures"
```

---

### Task A3: `ViewConfig` + row types in `@projectflow/types`

**Files:**
- Modify: `packages/types/index.ts` (append a Views Engine section)

- [ ] **Step 1: Add the types**

Append to `packages/types/index.ts`:

```ts
// ───────────────────────── Views Engine (Phase 3) ─────────────────────────
export type ViewScopeType = 'LIST' | 'FOLDER' | 'SPACE' | 'EVERYTHING';
export type ViewType = 'list' | 'board' | 'table' | 'calendar';

export type FieldRefKind = 'builtin' | 'custom';
export interface FieldRef { kind: FieldRefKind; key: string } // custom key = CustomFields.Id (GUID)

export type FilterOperator =
  | '=' | '!=' | '>' | '>=' | '<' | '<='
  | 'in' | 'not_in' | 'contains' | 'is_empty' | 'is_not_empty';

export interface FilterRule { field: FieldRef; op: FilterOperator; value?: unknown }
export interface FilterGroup { conjunction: 'AND' | 'OR'; rules: Array<FilterRule | FilterGroup> }
export interface SortKey { field: FieldRef; dir: 'ASC' | 'DESC' }

export interface ViewConfig {
  filter: FilterGroup;          // default { conjunction:'AND', rules:[] }
  groupBy?: FieldRef;
  sort: SortKey[];              // default [{ field:{kind:'builtin',key:'position'}, dir:'ASC' }]
  columns?: FieldRef[];
  dateField?: FieldRef;
  meMode?: boolean;
  pageSize?: number;            // default 25
}

export interface SavedView {
  id: string;
  workspaceId: string;
  ownerId: string;
  scopeType: ViewScopeType;
  scopeId: string | null;
  type: ViewType;
  name: string;
  isShared: boolean;
  isDefault: boolean;
  config: ViewConfig;
  position: number;
}

export interface ViewGroup { key: string; label: string; count: number }
export interface ViewTaskPage { tasks: Task[]; total: number; groups?: ViewGroup[] }

export type BulkAction =
  | { kind: 'set_status'; status: string }
  | { kind: 'set_priority'; priority: string }
  | { kind: 'set_assignees'; userIds: string[] }
  | { kind: 'set_custom_field'; fieldId: string; value: unknown }
  | { kind: 'move_to_list'; listId: string }
  | { kind: 'delete' };

export interface BulkUpdateResult { updated: string[]; failed: Array<{ id: string; reason: string }> }
```

- [ ] **Step 2: Type-check the package**

Run (from repo root): `npx tsc -p packages/types --noEmit`
Expected: PASS. If `Task` is not exported in this file, grep `export interface Task`/`export type Task` and reference the existing exported task type name in `ViewTaskPage`.

- [ ] **Step 3: Commit**

```bash
git add packages/types/index.ts
git commit -m "feat(views): ViewConfig + SavedView + bulk types"
```

---

### Task A4: `view.repository.ts` CRUD + `map.ts` (TDD via integration test)

**Files:**
- Create: `apps/api/src/modules/views/map.ts`
- Create: `apps/api/src/modules/views/view.repository.ts`
- Test: `apps/api/src/modules/views/__tests__/view-crud.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { ViewRepository } from '../view.repository.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool } from '../../../shared/lib/db.js';
import { randomUUID } from 'node:crypto';

const repo = new ViewRepository();
const emptyConfig = JSON.stringify({ filter: { conjunction: 'AND', rules: [] }, sort: [] });

describe('ViewRepository CRUD', () => {
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });

  it('creates, lists (shared∪own), updates, reorders, soft-deletes', async () => {
    const owner = await createTestUser();
    const ws = await createTestWorkspace(owner.accessToken);
    const project = await createTestProject(ws.Id, owner.accessToken);

    const created = await repo.create({
      id: randomUUID(), workspaceId: ws.Id, ownerId: owner.user.Id,
      scopeType: 'SPACE', scopeId: project.Id, scopePath: `/${project.Id}/`,
      type: 'table', name: 'My Table', isShared: false, isDefault: true,
      config: emptyConfig, position: 1,
    });
    expect(created.name).toBe('My Table');
    expect(created.isDefault).toBe(true);

    const ownList = await repo.list(ws.Id, owner.user.Id, 'SPACE', project.Id);
    expect(ownList.map((v) => v.id)).toContain(created.id);

    const other = await createTestUser();
    const otherList = await repo.list(ws.Id, other.user.Id, 'SPACE', project.Id);
    expect(otherList.map((v) => v.id)).not.toContain(created.id);

    await repo.update(created.id, { isShared: true });
    const otherList2 = await repo.list(ws.Id, other.user.Id, 'SPACE', project.Id);
    expect(otherList2.map((v) => v.id)).toContain(created.id);

    const reordered = await repo.reorder(created.id, 5);
    expect(reordered?.position).toBe(5);

    const deleted = await repo.delete(created.id);
    expect(deleted?.id).toBe(created.id);
    const afterDelete = await repo.list(ws.Id, owner.user.Id, 'SPACE', project.Id);
    expect(afterDelete.map((v) => v.id)).not.toContain(created.id);
  });

  it('getWorkspaceId returns the owning workspace', async () => {
    const owner = await createTestUser();
    const ws = await createTestWorkspace(owner.accessToken);
    const project = await createTestProject(ws.Id, owner.accessToken);
    const v = await repo.create({
      id: randomUUID(), workspaceId: ws.Id, ownerId: owner.user.Id,
      scopeType: 'SPACE', scopeId: project.Id, scopePath: `/${project.Id}/`,
      type: 'list', name: 'L', isShared: true, isDefault: false, config: emptyConfig, position: 0,
    });
    expect(await repo.getWorkspaceId(v.id)).toBe(ws.Id);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `apps/api`): `npx vitest run --project integration src/modules/views/__tests__/view-crud.integration.test.ts`
Expected: FAIL — cannot find module `../view.repository.js`.

- [ ] **Step 3: Write `map.ts`**

```ts
import type { SavedView, ViewConfig } from '@projectflow/types';

export function mapSavedViewRow(row: any): SavedView {
  return {
    id: row.Id,
    workspaceId: row.WorkspaceId,
    ownerId: row.OwnerId,
    scopeType: row.ScopeType,
    scopeId: row.ScopeId ?? null,
    type: row.Type,
    name: row.Name,
    isShared: !!row.IsShared,
    isDefault: !!row.IsDefault,
    config: JSON.parse(row.Config) as ViewConfig,
    position: row.Position,
  };
}
```

- [ ] **Step 4: Write `view.repository.ts`**

```ts
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import { mapSavedViewRow } from './map.js';
import type { SavedView, ViewScopeType, ViewType } from '@projectflow/types';

export class ViewRepository {
  async getWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_View_GetWorkspaceId',
      [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0]?.WorkspaceId ?? null;
  }

  async create(p: {
    id: string; workspaceId: string; ownerId: string;
    scopeType: ViewScopeType; scopeId: string | null; scopePath: string | null;
    type: ViewType; name: string; isShared: boolean; isDefault: boolean;
    config: string; position: number;
  }): Promise<SavedView> {
    const rows = await execSpOne('usp_View_Create', [
      { name: 'Id', type: sql.UniqueIdentifier, value: p.id },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: p.workspaceId },
      { name: 'OwnerId', type: sql.UniqueIdentifier, value: p.ownerId },
      { name: 'ScopeType', type: sql.NVarChar(12), value: p.scopeType },
      { name: 'ScopeId', type: sql.UniqueIdentifier, value: p.scopeId },
      { name: 'ScopePath', type: sql.NVarChar(900), value: p.scopePath },
      { name: 'Type', type: sql.NVarChar(10), value: p.type },
      { name: 'Name', type: sql.NVarChar(255), value: p.name },
      { name: 'IsShared', type: sql.Bit, value: p.isShared ? 1 : 0 },
      { name: 'IsDefault', type: sql.Bit, value: p.isDefault ? 1 : 0 },
      { name: 'Config', type: sql.NVarChar(sql.MAX), value: p.config },
      { name: 'Position', type: sql.Float, value: p.position },
    ]);
    return mapSavedViewRow(rows[0]);
  }

  async update(id: string, p: { name?: string; isShared?: boolean; isDefault?: boolean; config?: string }): Promise<SavedView | null> {
    const rows = await execSpOne('usp_View_Update', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
      { name: 'Name', type: sql.NVarChar(255), value: p.name ?? null },
      { name: 'IsShared', type: sql.Bit, value: p.isShared == null ? null : (p.isShared ? 1 : 0) },
      { name: 'IsDefault', type: sql.Bit, value: p.isDefault == null ? null : (p.isDefault ? 1 : 0) },
      { name: 'Config', type: sql.NVarChar(sql.MAX), value: p.config ?? null },
    ]);
    return rows[0] ? mapSavedViewRow(rows[0]) : null;
  }

  async delete(id: string): Promise<SavedView | null> {
    const rows = await execSpOne('usp_View_Delete', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0] ? mapSavedViewRow(rows[0]) : null;
  }

  async reorder(id: string, position: number): Promise<SavedView | null> {
    const rows = await execSpOne('usp_View_Reorder', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
      { name: 'Position', type: sql.Float, value: position },
    ]);
    return rows[0] ? mapSavedViewRow(rows[0]) : null;
  }

  async list(workspaceId: string, userId: string, scopeType: ViewScopeType, scopeId: string | null): Promise<SavedView[]> {
    const rows = await execSpOne('usp_View_List', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
      { name: 'ScopeType', type: sql.NVarChar(12), value: scopeType },
      { name: 'ScopeId', type: sql.UniqueIdentifier, value: scopeId },
    ]);
    return (rows as any[]).map(mapSavedViewRow);
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run (from `apps/api`): `npx vitest run --project integration src/modules/views/__tests__/view-crud.integration.test.ts`
Expected: PASS (both tests green).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/views/map.ts apps/api/src/modules/views/view.repository.ts apps/api/src/modules/views/__tests__/view-crud.integration.test.ts
git commit -m "feat(views): SavedView repository + row mapper"
```

---

## PHASE B — Query engine (catalog + compiler), unit-tested first (no DB)

### Task B1: `query/types.ts` + built-in field catalog map

**Files:**
- Create: `apps/api/src/modules/views/query/types.ts`
- Create: `apps/api/src/modules/views/query/builtin-fields.ts`

- [ ] **Step 1: `query/types.ts`** (compiler-internal field descriptors)

```ts
import type { FilterOperator, FieldRef } from '@projectflow/types';

export type LogicalType = 'string' | 'number' | 'date' | 'enum' | 'user' | 'bool' | 'array';

/** How a field maps to SQL inside the compiler. */
export interface FieldDescriptor {
  logical: LogicalType;
  /** built-in: a column on Tasks `t` (e.g. 'Status'); join-backed fields use `exists` instead */
  column?: string;
  /** join-backed built-in (assignee/tags/watchers): returns an EXISTS clause given a param placeholder */
  exists?: (param: string) => string;
  /** custom field id (GUID) when the FieldRef.kind === 'custom' */
  customFieldId?: string;
}

export const OPERATORS_BY_LOGICAL: Record<LogicalType, FilterOperator[]> = {
  string: ['=', '!=', 'contains', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  number: ['=', '!=', '>', '>=', '<', '<=', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  date:   ['=', '!=', '>', '>=', '<', '<=', 'is_empty', 'is_not_empty'],
  enum:   ['=', '!=', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  user:   ['=', '!=', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  bool:   ['=', '!='],
  array:  ['contains', 'in', 'not_in', 'is_empty', 'is_not_empty'],
};

export function fieldRefId(ref: FieldRef): string {
  return `${ref.kind}:${ref.key}`;
}
```

- [ ] **Step 2: `query/builtin-fields.ts`** (the fixed allow-list of Tasks columns/joins)

```ts
import type { FieldDescriptor } from './types.js';

/**
 * Built-in queryable fields. Keys are stable FieldRef.key values; values map to
 * physical Tasks columns (aliased `t`) or EXISTS-joins. This is an allow-list:
 * any FieldRef.key not present here is rejected by the catalog.
 */
export const BUILTIN_FIELDS: Record<string, FieldDescriptor> = {
  status:      { logical: 'enum',   column: 'Status' },
  priority:    { logical: 'enum',   column: 'Priority' },
  type:        { logical: 'enum',   column: 'Type' },
  title:       { logical: 'string', column: 'Title' },
  storyPoints: { logical: 'number', column: 'StoryPoints' },
  dueDate:     { logical: 'date',   column: 'DueDate' },
  startDate:   { logical: 'date',   column: 'StartDate' },
  createdAt:   { logical: 'date',   column: 'CreatedAt' },
  updatedAt:   { logical: 'date',   column: 'UpdatedAt' },
  position:    { logical: 'number', column: 'Position' },
  reporter:    { logical: 'user',   column: 'ReporterId' },
  sprint:      { logical: 'enum',   column: 'SprintId' },
  assignee:    { logical: 'user',   exists: (p) => `EXISTS (SELECT 1 FROM TaskAssignees a WHERE a.TaskId = t.Id AND a.UserId = ${p})` },
  tags:        { logical: 'array',  exists: (p) => `EXISTS (SELECT 1 FROM TaskTags tg WHERE tg.TaskId = t.Id AND tg.TagId = ${p})` },
  watchers:    { logical: 'array',  exists: (p) => `EXISTS (SELECT 1 FROM TaskWatchers w WHERE w.TaskId = t.Id AND w.UserId = ${p})` },
};
```

> **Verify these column/table names before relying on them.** Grep the `Tasks` table definition (`infra/sql/migrations/0001_*` and later alters incl. `0029_hierarchy.sql`) plus `TaskTags`/`TaskAssignees`/`TaskWatchers` to confirm `StartDate`, `ReporterId`, `SprintId`, `StoryPoints`, `TagId`, `ListPath`. If a name differs, fix the descriptor. The compiler unit tests check SQL *shape*, not real column existence — the C1 integration tests close that gap.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/views/query/types.ts apps/api/src/modules/views/query/builtin-fields.ts
git commit -m "feat(views): query field descriptors + built-in field allow-list"
```

---

### Task B2: `field-catalog.ts` (built-in ∪ custom for a scope)

**Files:**
- Create: `apps/api/src/modules/views/query/field-catalog.ts`
- Test: `apps/api/src/modules/views/query/__tests__/field-catalog.unit.test.ts`

The catalog takes the custom-field list as input (the service fetches them via the existing `CustomFieldRepository`), so it stays unit-testable with no DB.

- [ ] **Step 1: Write the failing unit test**

```ts
import { describe, it, expect } from 'vitest';
import { buildCatalog, ViewQueryError } from '../field-catalog.js';
import type { CustomField } from '@projectflow/types';

const customFields = [
  { id: 'f1', type: 'number', name: 'Est', workspaceId: 'w', scopeType: 'SPACE', scopeId: 's', required: false, position: 0, config: null },
  { id: 'f2', type: 'dropdown', name: 'Stage', workspaceId: 'w', scopeType: 'SPACE', scopeId: 's', required: false, position: 1, config: null },
] as unknown as CustomField[];

describe('buildCatalog', () => {
  it('resolves a built-in field', () => {
    const d = buildCatalog(customFields).resolve({ kind: 'builtin', key: 'status' });
    expect(d.logical).toBe('enum');
    expect(d.column).toBe('Status');
  });

  it('resolves a custom field with its logical type', () => {
    const d = buildCatalog(customFields).resolve({ kind: 'custom', key: 'f1' });
    expect(d.logical).toBe('number');
    expect(d.customFieldId).toBe('f1');
  });

  it('rejects unknown built-in field', () => {
    expect(() => buildCatalog(customFields).resolve({ kind: 'builtin', key: 'nope' })).toThrow(ViewQueryError);
  });

  it('rejects unknown custom field id', () => {
    expect(() => buildCatalog(customFields).resolve({ kind: 'custom', key: 'ghost' })).toThrow(ViewQueryError);
  });

  it('validates operator against field logical type', () => {
    const cat = buildCatalog(customFields);
    expect(() => cat.assertOperator({ kind: 'builtin', key: 'status' }, '>')).toThrow(ViewQueryError);
    expect(() => cat.assertOperator({ kind: 'builtin', key: 'dueDate' }, '>')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `apps/api`): `npx vitest run --project unit src/modules/views/query/__tests__/field-catalog.unit.test.ts`
Expected: FAIL — cannot find module `../field-catalog.js`.

- [ ] **Step 3: Write `field-catalog.ts`**

```ts
import type { CustomField, FieldRef, FilterOperator } from '@projectflow/types';
import { BUILTIN_FIELDS } from './builtin-fields.js';
import { OPERATORS_BY_LOGICAL, fieldRefId, type FieldDescriptor, type LogicalType } from './types.js';

export class ViewQueryError extends Error {
  constructor(message: string) { super(message); this.name = 'ViewQueryError'; }
}

const CUSTOM_TYPE_TO_LOGICAL: Record<string, LogicalType> = {
  text: 'string', text_area: 'string', url: 'string', email: 'string', phone: 'string', dropdown: 'enum',
  number: 'number', currency: 'number', rating: 'number', progress_manual: 'number', progress_auto: 'number',
  date: 'date', checkbox: 'bool', labels: 'array', people: 'array',
};

export interface Catalog {
  resolve(ref: FieldRef): FieldDescriptor;
  assertOperator(ref: FieldRef, op: FilterOperator): void;
}

export function buildCatalog(customFields: CustomField[]): Catalog {
  const customById = new Map<string, FieldDescriptor>();
  for (const f of customFields) {
    const logical = CUSTOM_TYPE_TO_LOGICAL[f.type] ?? 'string';
    customById.set(f.id, { logical, customFieldId: f.id });
  }

  function resolve(ref: FieldRef): FieldDescriptor {
    if (ref.kind === 'builtin') {
      const d = BUILTIN_FIELDS[ref.key];
      if (!d) throw new ViewQueryError(`Unknown built-in field: ${ref.key}`);
      return d;
    }
    const d = customById.get(ref.key);
    if (!d) throw new ViewQueryError(`Unknown custom field: ${ref.key}`);
    return d;
  }

  function assertOperator(ref: FieldRef, op: FilterOperator): void {
    const d = resolve(ref);
    const allowed = OPERATORS_BY_LOGICAL[d.logical];
    if (!allowed.includes(op))
      throw new ViewQueryError(`Operator '${op}' not valid for field ${fieldRefId(ref)} (${d.logical})`);
  }

  return { resolve, assertOperator };
}
```

- [ ] **Step 4: Run to verify it passes**

Run (from `apps/api`): `npx vitest run --project unit src/modules/views/query/__tests__/field-catalog.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/views/query/field-catalog.ts apps/api/src/modules/views/query/__tests__/field-catalog.unit.test.ts
git commit -m "feat(views): field catalog (built-in + custom, operator validation)"
```

---

### Task B3: `compiler.ts` — filter AST + sort → parameterized SQL

**Files:**
- Create: `apps/api/src/modules/views/query/compiler.ts`
- Test: `apps/api/src/modules/views/query/__tests__/compiler.unit.test.ts`

- [ ] **Step 1: Write the failing unit test**

```ts
import { describe, it, expect } from 'vitest';
import { compile } from '../compiler.js';
import { buildCatalog } from '../field-catalog.js';
import type { CustomField } from '@projectflow/types';

const cat = buildCatalog([
  { id: 'f1', type: 'number', name: 'Est', workspaceId: 'w', scopeType: 'SPACE', scopeId: 's', required: false, position: 0, config: null },
  { id: 'f2', type: 'dropdown', name: 'Stage', workspaceId: 'w', scopeType: 'SPACE', scopeId: 's', required: false, position: 1, config: null },
] as unknown as CustomField[]);

const base = { workspaceId: 'WS', scope: { scopeType: 'SPACE' as const, scopePath: '/SP/' }, catalog: cat };

it('always injects tenant + soft-delete + scope predicate', () => {
  const r = compile({ ...base, filter: { conjunction: 'AND', rules: [] }, sort: [] });
  expect(r.whereSql).toContain('t.WorkspaceId = @ws');
  expect(r.whereSql).toContain('t.DeletedAt IS NULL');
  expect(r.whereSql).toContain('t.ListPath LIKE @scopePrefix');
  expect(r.params.ws).toBe('WS');
  expect(r.params.scopePrefix).toBe('/SP/%');
});

it('EVERYTHING scope omits the path predicate but keeps workspace bound', () => {
  const r = compile({ workspaceId: 'WS', scope: { scopeType: 'EVERYTHING', scopePath: null }, catalog: cat, filter: { conjunction: 'AND', rules: [] }, sort: [] });
  expect(r.whereSql).toContain('t.WorkspaceId = @ws');
  expect(r.whereSql).not.toContain('ListPath');
});

it('compiles a built-in column equality with a bound parameter', () => {
  const r = compile({ ...base, filter: { conjunction: 'AND', rules: [{ field: { kind: 'builtin', key: 'status' }, op: '=', value: 'DONE' }] }, sort: [] });
  expect(r.whereSql).toMatch(/t\.Status = @p\d+/);
  expect(Object.values(r.params)).toContain('DONE');
});

it('compiles a join-backed assignee filter as EXISTS', () => {
  const r = compile({ ...base, filter: { conjunction: 'AND', rules: [{ field: { kind: 'builtin', key: 'assignee' }, op: '=', value: 'U1' }] }, sort: [] });
  expect(r.whereSql).toContain('EXISTS (SELECT 1 FROM TaskAssignees a');
  expect(Object.values(r.params)).toContain('U1');
});

it('compiles a custom number field with CAST(... AS FLOAT)', () => {
  const r = compile({ ...base, filter: { conjunction: 'AND', rules: [{ field: { kind: 'custom', key: 'f1' }, op: '>=', value: 3 }] }, sort: [] });
  expect(r.whereSql).toContain('TaskCustomFieldValues v');
  expect(r.whereSql).toContain('CAST(JSON_VALUE(v.Value');
  expect(r.whereSql).toContain('AS FLOAT)');
});

it('compiles nested AND/OR groups', () => {
  const r = compile({ ...base, sort: [], filter: {
    conjunction: 'AND',
    rules: [
      { field: { kind: 'builtin', key: 'status' }, op: '=', value: 'OPEN' },
      { conjunction: 'OR', rules: [
        { field: { kind: 'builtin', key: 'priority' }, op: '=', value: 'HIGH' },
        { field: { kind: 'builtin', key: 'priority' }, op: '=', value: 'URGENT' },
      ] },
    ],
  } });
  expect(r.whereSql).toMatch(/\(.*OR.*\)/s);
});

it('compiles IN with multiple params', () => {
  const r = compile({ ...base, sort: [], filter: { conjunction: 'AND', rules: [{ field: { kind: 'builtin', key: 'status' }, op: 'in', value: ['A', 'B'] }] } });
  expect(r.whereSql).toMatch(/t\.Status IN \(@p\d+, @p\d+\)/);
});

it('compiles is_empty for a scalar column', () => {
  const r = compile({ ...base, sort: [], filter: { conjunction: 'AND', rules: [{ field: { kind: 'builtin', key: 'dueDate' }, op: 'is_empty' }] } });
  expect(r.whereSql).toContain('t.DueDate IS NULL');
});

it('compiles multi-key sort over built-in + custom and reports custom joins', () => {
  const r = compile({ ...base, filter: { conjunction: 'AND', rules: [] }, sort: [
    { field: { kind: 'builtin', key: 'priority' }, dir: 'DESC' },
    { field: { kind: 'custom', key: 'f1' }, dir: 'ASC' },
  ] });
  expect(r.orderSql).toContain('t.Priority DESC');
  expect(r.orderSql).toContain('ASC');
  expect(r.customSortJoins).toEqual([{ alias: 'cfv_f1', fieldId: 'f1' }]);
});

it('rejects an invalid operator for the field type', () => {
  expect(() => compile({ ...base, sort: [], filter: { conjunction: 'AND', rules: [{ field: { kind: 'builtin', key: 'status' }, op: '>', value: 'x' }] } })).toThrow();
});

it('defaults sort to position ASC when none given', () => {
  const r = compile({ ...base, filter: { conjunction: 'AND', rules: [] }, sort: [] });
  expect(r.orderSql).toContain('t.Position ASC');
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `apps/api`): `npx vitest run --project unit src/modules/views/query/__tests__/compiler.unit.test.ts`
Expected: FAIL — cannot find module `../compiler.js`.

- [ ] **Step 3: Write `compiler.ts`**

```ts
import type { FilterGroup, FilterRule, SortKey, ViewScopeType, FieldRef, FilterOperator } from '@projectflow/types';
import { ViewQueryError, type Catalog } from './field-catalog.js';
import { BUILTIN_FIELDS } from './builtin-fields.js';
import type { FieldDescriptor } from './types.js';

export interface CompileScope { scopeType: ViewScopeType; scopePath: string | null }
export interface CompileInput {
  workspaceId: string;
  scope: CompileScope;
  catalog: Catalog;
  filter: FilterGroup;
  sort: SortKey[];
  /** when set, AND an "assigned to this user" predicate (Me-mode overlay) */
  meUserId?: string;
}
export interface CompiledQuery {
  whereSql: string;
  orderSql: string;
  params: Record<string, unknown>;
  customSortJoins: Array<{ alias: string; fieldId: string }>;
}

const SQL_OP: Record<string, string> = { '=': '=', '!=': '<>', '>': '>', '>=': '>=', '<': '<', '<=': '<=' };

export function compile(input: CompileInput): CompiledQuery {
  const params: Record<string, unknown> = { ws: input.workspaceId };
  let pi = 0;
  const bind = (v: unknown): string => { const k = `p${pi++}`; params[k] = v; return `@${k}`; };

  const baseParts: string[] = ['t.WorkspaceId = @ws', 't.DeletedAt IS NULL'];
  if (input.scope.scopeType !== 'EVERYTHING') {
    if (!input.scope.scopePath) throw new ViewQueryError('scopePath required for non-EVERYTHING scope');
    params.scopePrefix = `${input.scope.scopePath}%`;
    baseParts.push('t.ListPath LIKE @scopePrefix');
  }
  if (input.meUserId)
    baseParts.push(`EXISTS (SELECT 1 FROM TaskAssignees a WHERE a.TaskId = t.Id AND a.UserId = ${bind(input.meUserId)})`);

  const userWhere = compileGroup(input.filter, input.catalog, bind);
  const whereSql = userWhere ? `${baseParts.join(' AND ')} AND ${userWhere}` : baseParts.join(' AND ');

  const { orderSql, joins } = compileSort(input.sort, input.catalog);
  return { whereSql, orderSql, params, customSortJoins: joins };
}

function compileGroup(group: FilterGroup, cat: Catalog, bind: (v: unknown) => string): string {
  if (!group.rules.length) return '';
  const parts = group.rules
    .map((r) => ('conjunction' in r ? wrap(compileGroup(r, cat, bind)) : compileRule(r, cat, bind)))
    .filter(Boolean);
  if (!parts.length) return '';
  return parts.join(` ${group.conjunction} `);
}

function wrap(s: string): string { return s ? `(${s})` : ''; }

function compileRule(rule: FilterRule, cat: Catalog, bind: (v: unknown) => string): string {
  cat.assertOperator(rule.field, rule.op);
  const d = cat.resolve(rule.field);
  return rule.field.kind === 'custom' ? compileCustom(d, rule, bind) : compileBuiltin(d, rule, bind);
}

function compileBuiltin(d: FieldDescriptor, rule: FilterRule, bind: (v: unknown) => string): string {
  if (d.exists) {
    // membership / existence semantics for join-backed fields
    if (rule.op === 'is_not_empty') return d.exists('NULL').replace(/ = NULL\)/, ')').replace(/ AND .*UserId =\s*$/,'') || d.exists('NULL');
    if (rule.op === 'is_empty')     return `NOT (${d.exists('NULL').replace(/ AND [^)]*= NULL/, '')})`;
    if (rule.op === 'not_in' || rule.op === '!=') return `NOT ${d.exists(bind(rule.value))}`;
    if (rule.op === 'in') return `(${asArray(rule.value).map((v) => d.exists!(bind(v))).join(' OR ')})`;
    return d.exists(bind(rule.value)); // '=' / 'contains'
  }
  const col = `t.${d.column}`;
  return scalarPredicate(col, rule.op, rule.value, bind, d.logical === 'string');
}

function compileCustom(d: FieldDescriptor, rule: FilterRule, bind: (v: unknown) => string): string {
  const fieldParam = bind(d.customFieldId);
  const inner = (expr: string) =>
    `EXISTS (SELECT 1 FROM TaskCustomFieldValues v WHERE v.TaskId = t.Id AND v.FieldId = ${fieldParam} AND ${expr})`;

  if (rule.op === 'is_empty')
    return `NOT EXISTS (SELECT 1 FROM TaskCustomFieldValues v WHERE v.TaskId = t.Id AND v.FieldId = ${fieldParam} AND JSON_VALUE(v.Value, '$') IS NOT NULL)`;
  if (rule.op === 'is_not_empty')
    return inner(`JSON_VALUE(v.Value, '$') IS NOT NULL`);

  if (d.logical === 'array') {
    if (rule.op === 'in' || rule.op === 'not_in') {
      const ors = asArray(rule.value).map((val) => `EXISTS (SELECT 1 FROM OPENJSON(v.Value) j WHERE j.value = ${bind(val)})`).join(' OR ');
      const clause = inner(`(${ors})`);
      return rule.op === 'not_in' ? `NOT ${clause}` : clause;
    }
    return inner(`EXISTS (SELECT 1 FROM OPENJSON(v.Value) j WHERE j.value = ${bind(rule.value)})`);
  }

  const lhs = scalarLhs(d, `JSON_VALUE(v.Value, '$')`);
  if (rule.op === 'in' || rule.op === 'not_in') {
    const list = asArray(rule.value).map((v) => bind(v)).join(', ');
    const clause = inner(`${lhs} IN (${list})`);
    return rule.op === 'not_in' ? `NOT ${clause}` : clause;
  }
  if (rule.op === 'contains') return inner(`${lhs} LIKE ${bindLike(rule.value, bind)}`);
  return inner(`${lhs} ${SQL_OP[rule.op]} ${bind(coerce(d, rule.value))}`);
}

function scalarPredicate(col: string, op: FilterOperator, value: unknown, bind: (v: unknown) => string, isString: boolean): string {
  if (op === 'is_empty')     return `${col} IS NULL`;
  if (op === 'is_not_empty') return `${col} IS NOT NULL`;
  if (op === 'in' || op === 'not_in') {
    const list = asArray(value).map((v) => bind(v)).join(', ');
    return `${col} ${op === 'in' ? 'IN' : 'NOT IN'} (${list})`;
  }
  if (op === 'contains' && isString) return `${col} LIKE ${bindLike(value, bind)}`;
  return `${col} ${SQL_OP[op]} ${bind(value)}`;
}

function scalarLhs(d: FieldDescriptor, jsonExpr: string): string {
  if (d.logical === 'number') return `CAST(${jsonExpr} AS FLOAT)`;
  if (d.logical === 'date')   return `CAST(${jsonExpr} AS DATETIME2)`;
  return jsonExpr; // string/bool compared as text
}

function coerce(d: FieldDescriptor, value: unknown): unknown {
  if (d.logical === 'bool') return value ? 'true' : 'false';
  return value;
}

function bindLike(value: unknown, bind: (v: unknown) => string): string {
  return bind(`%${String(value ?? '')}%`);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function compileSort(sort: SortKey[], cat: Catalog): { orderSql: string; joins: Array<{ alias: string; fieldId: string }> } {
  const keys: SortKey[] = sort.length ? sort : [{ field: { kind: 'builtin', key: 'position' } as FieldRef, dir: 'ASC' }];
  const joins: Array<{ alias: string; fieldId: string }> = [];
  const parts = keys.map((k) => {
    const d = cat.resolve(k.field);
    const dir = k.dir === 'DESC' ? 'DESC' : 'ASC';
    if (k.field.kind === 'custom') {
      const alias = `cfv_${k.field.key}`;
      joins.push({ alias, fieldId: d.customFieldId! });
      const lhs = d.logical === 'number' ? `CAST(${alias}.Value AS FLOAT)`
                : d.logical === 'date'   ? `CAST(${alias}.Value AS DATETIME2)`
                : `${alias}.Value`;
      return `${lhs} ${dir}`;
    }
    if (!d.column) throw new ViewQueryError(`Field ${k.field.key} is not sortable`);
    return `t.${d.column} ${dir}`;
  });
  return { orderSql: parts.join(', '), joins };
}
```

> **Join-backed `is_empty`/`is_not_empty` are tricky** — the `.replace(...)` chain above is brittle. When implementing, prefer replacing those two branches with explicit, readable clauses and a dedicated unit test:
> - `is_not_empty` → `EXISTS (SELECT 1 FROM TaskAssignees a WHERE a.TaskId = t.Id)` (drop the user predicate),
> - `is_empty` → `NOT EXISTS (SELECT 1 FROM TaskAssignees a WHERE a.TaskId = t.Id)`.
>   Generalize per join field (tags→`TaskTags tg WHERE tg.TaskId = t.Id`, watchers→`TaskWatchers w WHERE w.TaskId = t.Id`) by adding an `existsBare?: () => string` to the descriptor, or skip `is_empty`/`is_not_empty` for join-backed fields in v1 (remove them from the `user`/`array` operator lists in `types.ts` and assert the catalog rejects them). Pick one; keep the chosen behavior covered by a unit test. The provided `.replace` code is a placeholder for whichever you choose.

- [ ] **Step 4: Run to verify all compiler tests pass**

Run (from `apps/api`): `npx vitest run --project unit src/modules/views/query/__tests__/compiler.unit.test.ts`
Expected: PASS (all cases incl. `customSortJoins`). If you simplified join `is_empty`/`is_not_empty` per the note, adjust/keep tests accordingly.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/views/query/compiler.ts apps/api/src/modules/views/query/__tests__/compiler.unit.test.ts
git commit -m "feat(views): query compiler (filter AST + sort -> parameterized SQL)"
```

---

## PHASE C — Query execution + service + GraphQL + integration

### Task C1: `view.repository.ts` — `queryTasks` (run compiled SQL via parameterized request)

**Files:**
- Modify: `apps/api/src/modules/views/view.repository.ts`
- Test: `apps/api/src/modules/views/__tests__/query-tasks.integration.test.ts`

- [ ] **Step 1: Write the failing integration test** (built-in filter + multitenancy isolation)

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { ViewRepository } from '../view.repository.js';
import { buildCatalog } from '../query/field-catalog.js';
import { compile } from '../query/compiler.js';
import { createTestUser, createTestWorkspace, createTestProject, createTestTask } from '../../../__tests__/fixtures/factories.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool, getPool } from '../../../shared/lib/db.js';

const repo = new ViewRepository();

async function setTaskListPath(taskId: string, listPath: string) {
  const pool = await getPool();
  await pool.request().input('Id', taskId).input('LP', listPath).query('UPDATE Tasks SET ListPath = @LP WHERE Id = @Id');
}

describe('ViewRepository.queryTasks', () => {
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });

  it('filters tasks by a built-in title within a space scope', async () => {
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const p = await createTestProject(ws.Id, u.accessToken);
    const t1 = await createTestTask(p.Id, ws.Id, u.accessToken, { title: 'A' });
    const t2 = await createTestTask(p.Id, ws.Id, u.accessToken, { title: 'B' });
    await setTaskListPath(t1.Id, `/${p.Id}/`);
    await setTaskListPath(t2.Id, `/${p.Id}/`);

    const cat = buildCatalog([]);
    const compiled = compile({
      workspaceId: ws.Id, scope: { scopeType: 'SPACE', scopePath: `/${p.Id}/` }, catalog: cat,
      filter: { conjunction: 'AND', rules: [{ field: { kind: 'builtin', key: 'title' }, op: '=', value: 'A' }] }, sort: [],
    });
    const page = await repo.queryTasks(compiled, { page: 1, pageSize: 25 });
    expect(page.total).toBe(1);
    expect(page.tasks[0]!.Title).toBe('A');
  });

  it('never returns tasks from another workspace (multitenancy isolation)', async () => {
    const u1 = await createTestUser(); const ws1 = await createTestWorkspace(u1.accessToken); const p1 = await createTestProject(ws1.Id, u1.accessToken);
    const u2 = await createTestUser(); const ws2 = await createTestWorkspace(u2.accessToken); const p2 = await createTestProject(ws2.Id, u2.accessToken);
    const tA = await createTestTask(p1.Id, ws1.Id, u1.accessToken, { title: 'ws1-task' });
    const tB = await createTestTask(p2.Id, ws2.Id, u2.accessToken, { title: 'ws2-task' });
    await setTaskListPath(tA.Id, `/${p1.Id}/`);
    await setTaskListPath(tB.Id, `/${p2.Id}/`);

    const cat = buildCatalog([]);
    const compiled = compile({ workspaceId: ws1.Id, scope: { scopeType: 'EVERYTHING', scopePath: null }, catalog: cat, filter: { conjunction: 'AND', rules: [] }, sort: [] });
    const page = await repo.queryTasks(compiled, { page: 1, pageSize: 100 });
    const titles = page.tasks.map((t) => t.Title);
    expect(titles).toContain('ws1-task');
    expect(titles).not.toContain('ws2-task');
  });
});
```

- [ ] **Step 2: Run to verify it fails** (`repo.queryTasks is not a function`).

- [ ] **Step 3: Add `queryTasks` to `view.repository.ts`**

Add imports and method:

```ts
import { getPool } from '../../shared/lib/db.js';
import type { CompiledQuery } from './query/compiler.js';
import type { ViewTaskPage } from '@projectflow/types';

// … inside class ViewRepository:

async queryTasks(compiled: CompiledQuery, opts: { page: number; pageSize: number }): Promise<ViewTaskPage> {
  const pool = await getPool();
  const offset = (opts.page - 1) * opts.pageSize;

  const joins = compiled.customSortJoins
    .map((j) => `LEFT JOIN TaskCustomFieldValues ${j.alias} ON ${j.alias}.TaskId = t.Id AND ${j.alias}.FieldId = @${j.alias}_fid`)
    .join('\n');

  const bindAll = (req: sql.Request) => {
    for (const [k, v] of Object.entries(compiled.params)) req.input(k, v as any);
    for (const j of compiled.customSortJoins) req.input(`${j.alias}_fid`, sql.UniqueIdentifier, j.fieldId);
    return req;
  };

  const pageSql =
    `SELECT t.* FROM Tasks t ${joins} WHERE ${compiled.whereSql} ` +
    `ORDER BY ${compiled.orderSql} OFFSET @__off ROWS FETCH NEXT @__size ROWS ONLY`;
  const pageReq = bindAll(pool.request());
  pageReq.input('__off', sql.Int, offset);
  pageReq.input('__size', sql.Int, opts.pageSize);
  const pageRes = await pageReq.query(pageSql);

  const countReq = bindAll(pool.request());
  const countRes = await countReq.query(`SELECT COUNT(*) AS Total FROM Tasks t WHERE ${compiled.whereSql}`);

  return { tasks: pageRes.recordset as any, total: countRes.recordset[0]?.Total ?? 0 };
}
```

- [ ] **Step 4: Run to verify it passes**

Run (from `apps/api`): `npx vitest run --project integration src/modules/views/__tests__/query-tasks.integration.test.ts`
Expected: PASS (both — incl. multitenancy isolation). If a built-in column name in `builtin-fields.ts` is wrong, the first test fails with a SQL "invalid column" error — fix the descriptor and re-run.

- [ ] **Step 5: Add a custom-field-filter integration case**

Append to the same file (seed a value via the Phase-2 custom-field repo):

```ts
import { CustomFieldRepository } from '../../customfields/customfield.repository.js';
import { randomUUID } from 'node:crypto';

it('filters by a custom number field', async () => {
  const u = await createTestUser(); const ws = await createTestWorkspace(u.accessToken); const p = await createTestProject(ws.Id, u.accessToken);
  const t1 = await createTestTask(p.Id, ws.Id, u.accessToken, { title: 'low' });
  const t2 = await createTestTask(p.Id, ws.Id, u.accessToken, { title: 'high' });
  await setTaskListPath(t1.Id, `/${p.Id}/`); await setTaskListPath(t2.Id, `/${p.Id}/`);

  const cf = new CustomFieldRepository();
  const field = await cf.create({ id: randomUUID(), workspaceId: ws.Id, scopeType: 'SPACE', scopeId: p.Id, scopePath: `/${p.Id}/`, type: 'number', name: 'Est', config: null, required: false, position: 0 });
  await cf.setValue(t1.Id, field.id, JSON.stringify(2));
  await cf.setValue(t2.Id, field.id, JSON.stringify(8));

  const cat = buildCatalog([field]);
  const compiled = compile({ workspaceId: ws.Id, scope: { scopeType: 'SPACE', scopePath: `/${p.Id}/` }, catalog: cat,
    filter: { conjunction: 'AND', rules: [{ field: { kind: 'custom', key: field.id }, op: '>=', value: 5 }] }, sort: [] });
  const page = await repo.queryTasks(compiled, { page: 1, pageSize: 25 });
  expect(page.tasks.map((t) => t.Title)).toEqual(['high']);
});
```

Run again; expected PASS. (If `cf.create`'s arg shape differs, match the real signature in `customfield.repository.ts` — verified to be `{ id, workspaceId, scopeType, scopeId, scopePath, type, name, config, required, position }`.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/views/view.repository.ts apps/api/src/modules/views/__tests__/query-tasks.integration.test.ts
git commit -m "feat(views): dynamic queryTasks execution (parameterized) + isolation tests"
```

---

### Task C2: grouped counts (`groupBy`) in the repository

**Files:**
- Modify: `apps/api/src/modules/views/view.repository.ts`
- Modify: `apps/api/src/modules/views/query/compiler.ts` (export a safe group expression)
- Test: `apps/api/src/modules/views/__tests__/query-tasks.integration.test.ts` (append)

- [ ] **Step 1: Add a `builtinGroupExpr` helper to the compiler**

```ts
import { BUILTIN_FIELDS } from './builtin-fields.js';
// (Catalog import already present)

export function builtinGroupExpr(_catalog: Catalog, ref: FieldRef): string {
  if (ref.kind !== 'builtin') throw new ViewQueryError('Group counts support built-in fields in v1');
  const d = BUILTIN_FIELDS[ref.key];
  if (!d?.column) throw new ViewQueryError(`Field ${ref.key} is not groupable`);
  return `t.${d.column}`;
}
```

- [ ] **Step 2: Write the failing test (append)**

```ts
import { builtinGroupExpr } from '../query/compiler.js';

it('returns grouped counts by status', async () => {
  const u = await createTestUser(); const ws = await createTestWorkspace(u.accessToken); const p = await createTestProject(ws.Id, u.accessToken);
  const a = await createTestTask(p.Id, ws.Id, u.accessToken, { title: 'a' });
  const b = await createTestTask(p.Id, ws.Id, u.accessToken, { title: 'b' });
  await setTaskListPath(a.Id, `/${p.Id}/`); await setTaskListPath(b.Id, `/${p.Id}/`);
  const cat = buildCatalog([]);
  const compiled = compile({ workspaceId: ws.Id, scope: { scopeType: 'SPACE', scopePath: `/${p.Id}/` }, catalog: cat, filter: { conjunction: 'AND', rules: [] }, sort: [] });
  const groups = await repo.groupCounts(compiled, builtinGroupExpr(cat, { kind: 'builtin', key: 'status' }));
  expect(groups.reduce((s, g) => s + g.count, 0)).toBe(2);
});
```

- [ ] **Step 3: Add `groupCounts` to the repository**

```ts
import type { ViewGroup } from '@projectflow/types';

async groupCounts(compiled: CompiledQuery, groupExpr: string): Promise<ViewGroup[]> {
  const pool = await getPool();
  const req = pool.request();
  for (const [k, v] of Object.entries(compiled.params)) req.input(k, v as any);
  const res = await req.query(`SELECT ${groupExpr} AS GroupKey, COUNT(*) AS Cnt FROM Tasks t WHERE ${compiled.whereSql} GROUP BY ${groupExpr}`);
  return res.recordset.map((r: any) => ({ key: String(r.GroupKey ?? ''), label: String(r.GroupKey ?? '∅'), count: r.Cnt }));
}
```

> `groupExpr` originates only from `builtinGroupExpr` (allow-listed column name), never user input — safe to interpolate.

- [ ] **Step 4: Run; expected PASS. Commit**

```bash
git add apps/api/src/modules/views/view.repository.ts apps/api/src/modules/views/query/compiler.ts apps/api/src/modules/views/__tests__/query-tasks.integration.test.ts
git commit -m "feat(views): grouped counts for view headers"
```

---

### Task C3: `view.service.ts` — orchestration + `getById` SP

**Files:**
- Create: `apps/api/src/modules/views/view.service.ts`
- Create: `apps/api/src/modules/views/view.errors.ts`
- Create: `infra/sql/procedures/usp_View_GetById.sql`
- Modify: `apps/api/src/modules/views/view.repository.ts` (add `getById`)
- Test: `apps/api/src/modules/views/__tests__/view-service.integration.test.ts`

- [ ] **Step 1: `usp_View_GetById.sql`**

```sql
CREATE OR ALTER PROCEDURE dbo.usp_View_GetById
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.SavedViews WHERE Id = @Id AND DeletedAt IS NULL;
END;
```

- [ ] **Step 2: Add `getById` to `view.repository.ts`**

```ts
async getById(id: string): Promise<SavedView | null> {
  const rows = await execSpOne('usp_View_GetById', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
  return rows[0] ? mapSavedViewRow(rows[0]) : null;
}
```

- [ ] **Step 3: `view.errors.ts`**

```ts
export class ViewNotFoundError extends Error { constructor() { super('Saved view not found'); this.name = 'ViewNotFoundError'; } }
export class ViewValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ViewValidationError'; } }
```

- [ ] **Step 4: Write the failing integration test**

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { viewService } from '../view.service.js';
import { createTestUser, createTestWorkspace, createTestProject, createTestTask } from '../../../__tests__/fixtures/factories.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool, getPool } from '../../../shared/lib/db.js';

async function setTaskListPath(taskId: string, lp: string) {
  const pool = await getPool();
  await pool.request().input('Id', taskId).input('LP', lp).query('UPDATE Tasks SET ListPath=@LP WHERE Id=@Id');
}

describe('ViewService', () => {
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });

  it('runs a saved view and returns filtered tasks', async () => {
    const u = await createTestUser(); const ws = await createTestWorkspace(u.accessToken); const p = await createTestProject(ws.Id, u.accessToken);
    const t = await createTestTask(p.Id, ws.Id, u.accessToken, { title: 'keep' });
    await setTaskListPath(t.Id, `/${p.Id}/`);

    const view = await viewService.create(u.user.Id, {
      scopeType: 'SPACE', scopeId: p.Id, type: 'table', name: 'V', isShared: true, isDefault: false,
      config: { filter: { conjunction: 'AND', rules: [{ field: { kind: 'builtin', key: 'title' }, op: '=', value: 'keep' }] }, sort: [] },
    });
    const page = await viewService.runView(u.user.Id, view.id, { page: 1, pageSize: 25 });
    expect(page.tasks.map((x) => x.Title)).toEqual(['keep']);
  });

  it('rejects a config referencing an unknown field', async () => {
    const u = await createTestUser(); const ws = await createTestWorkspace(u.accessToken); const p = await createTestProject(ws.Id, u.accessToken);
    await expect(viewService.create(u.user.Id, {
      scopeType: 'SPACE', scopeId: p.Id, type: 'list', name: 'bad', isShared: false, isDefault: false,
      config: { filter: { conjunction: 'AND', rules: [{ field: { kind: 'builtin', key: 'nonexistent' }, op: '=', value: 1 }] }, sort: [] },
    })).rejects.toThrow();
  });
});
```

- [ ] **Step 5: Run to verify it fails** (cannot find `../view.service.js`).

- [ ] **Step 6: Write `view.service.ts`**

```ts
import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import { ViewRepository } from './view.repository.js';
import { CustomFieldRepository } from '../customfields/customfield.repository.js';
import { buildCatalog } from './query/field-catalog.js';
import { compile, builtinGroupExpr } from './query/compiler.js';
import { ViewNotFoundError, ViewValidationError } from './view.errors.js';
import type { SavedView, ViewConfig, ViewScopeType, ViewType, ViewTaskPage, CustomField } from '@projectflow/types';

interface ScopeNode { workspaceId: string; scopePath: string | null }

export class ViewService {
  private repo = new ViewRepository();
  private cfRepo = new CustomFieldRepository();

  private async resolveScope(scopeType: ViewScopeType, scopeId: string | null, fallbackWorkspaceId?: string): Promise<ScopeNode> {
    if (scopeType === 'EVERYTHING') {
      if (!fallbackWorkspaceId) throw new ViewValidationError('EVERYTHING scope requires a workspaceId');
      return { workspaceId: fallbackWorkspaceId, scopePath: null };
    }
    const rows = await execSpOne<{ WorkspaceId: string; ScopePath: string }>('usp_CustomField_GetScopeNode', [
      { name: 'ScopeType', type: sql.NVarChar(8), value: scopeType },
      { name: 'ScopeId', type: sql.UniqueIdentifier, value: scopeId },
    ]);
    const r = rows[0];
    if (!r) throw new ViewValidationError('Scope node not found');
    return { workspaceId: r.WorkspaceId, scopePath: r.ScopePath };
  }

  private async catalogFor(scopeType: ViewScopeType, scopeId: string | null) {
    let fields: CustomField[] = [];
    if (scopeType !== 'EVERYTHING' && scopeId) fields = await this.cfRepo.list(scopeType as any, scopeId);
    return buildCatalog(fields);
  }

  private async validateConfig(scopeType: ViewScopeType, scopeId: string | null, scope: ScopeNode, config: ViewConfig): Promise<void> {
    const catalog = await this.catalogFor(scopeType, scopeId);
    try {
      compile({ workspaceId: scope.workspaceId, scope: { scopeType, scopePath: scope.scopePath }, catalog,
        filter: config.filter ?? { conjunction: 'AND', rules: [] }, sort: config.sort ?? [] });
    } catch (e) {
      throw new ViewValidationError((e as Error).message);
    }
  }

  async create(userId: string, input: {
    scopeType: ViewScopeType; scopeId: string | null; type: ViewType; name: string;
    isShared: boolean; isDefault: boolean; config: ViewConfig; workspaceId?: string;
  }): Promise<SavedView> {
    const scope = await this.resolveScope(input.scopeType, input.scopeId, input.workspaceId);
    await this.validateConfig(input.scopeType, input.scopeId, scope, input.config);
    return this.repo.create({
      id: randomUUID(), workspaceId: scope.workspaceId, ownerId: userId,
      scopeType: input.scopeType, scopeId: input.scopeId, scopePath: scope.scopePath,
      type: input.type, name: input.name, isShared: input.isShared, isDefault: input.isDefault,
      config: JSON.stringify(input.config), position: Date.now(),
    });
  }

  async update(id: string, patch: { name?: string; isShared?: boolean; isDefault?: boolean; config?: ViewConfig }): Promise<SavedView> {
    const existing = await this.getOrThrow(id);
    if (patch.config) {
      const scope = await this.resolveScope(existing.scopeType, existing.scopeId, existing.workspaceId);
      await this.validateConfig(existing.scopeType, existing.scopeId, scope, patch.config);
    }
    const updated = await this.repo.update(id, {
      name: patch.name, isShared: patch.isShared, isDefault: patch.isDefault,
      config: patch.config ? JSON.stringify(patch.config) : undefined,
    });
    if (!updated) throw new ViewNotFoundError();
    return updated;
  }

  async delete(id: string): Promise<SavedView> { const v = await this.repo.delete(id); if (!v) throw new ViewNotFoundError(); return v; }
  async reorder(id: string, position: number): Promise<SavedView> { const v = await this.repo.reorder(id, position); if (!v) throw new ViewNotFoundError(); return v; }

  async list(userId: string, scopeType: ViewScopeType, scopeId: string | null, workspaceId?: string): Promise<SavedView[]> {
    const scope = await this.resolveScope(scopeType, scopeId, workspaceId);
    return this.repo.list(scope.workspaceId, userId, scopeType, scopeId);
  }

  async getOrThrow(id: string): Promise<SavedView> {
    const v = await this.repo.getById(id);
    if (!v) throw new ViewNotFoundError();
    return v;
  }

  async runView(userId: string, id: string, opts: { page: number; pageSize?: number; meMode?: boolean }): Promise<ViewTaskPage> {
    const view = await this.getOrThrow(id);
    return this.runConfig(view.scopeType, view.scopeId, view.config, opts, view.workspaceId, userId);
  }

  async runConfig(scopeType: ViewScopeType, scopeId: string | null, config: ViewConfig, opts: { page: number; pageSize?: number; meMode?: boolean }, workspaceId: string | undefined, userId: string): Promise<ViewTaskPage> {
    const scope = await this.resolveScope(scopeType, scopeId, workspaceId);
    const catalog = await this.catalogFor(scopeType, scopeId);
    const compiled = compile({
      workspaceId: scope.workspaceId, scope: { scopeType, scopePath: scope.scopePath }, catalog,
      filter: config.filter ?? { conjunction: 'AND', rules: [] }, sort: config.sort ?? [],
      meUserId: (opts.meMode ?? config.meMode) ? userId : undefined,
    });
    const pageSize = opts.pageSize ?? config.pageSize ?? 25;
    const page = await this.repo.queryTasks(compiled, { page: opts.page, pageSize });
    if (config.groupBy) page.groups = await this.repo.groupCounts(compiled, builtinGroupExpr(catalog, config.groupBy));
    return page;
  }
}

export const viewService = new ViewService();
```

- [ ] **Step 7: Run the service test; expected PASS. Commit**

```bash
git add apps/api/src/modules/views/view.service.ts apps/api/src/modules/views/view.errors.ts infra/sql/procedures/usp_View_GetById.sql apps/api/src/modules/views/view.repository.ts apps/api/src/modules/views/__tests__/view-service.integration.test.ts
git commit -m "feat(views): ViewService (scope resolution, validation, runView/runConfig)"
```

---

### Task C4: GraphQL surface — `views.schema.ts`

**Files:**
- Create: `apps/api/src/graphql/views.schema.ts`
- Modify: `apps/api/src/graphql/schema.ts` (register it)
- Test: `apps/api/src/modules/views/__tests__/views-graphql.integration.test.ts`

- [ ] **Step 1: Inspect integration points** — open `apps/api/src/graphql/schema.ts` and note (a) where `registerCustomFieldsGraphql()`/tags/watchers are called (you'll add `registerViewsGraphql()` there), (b) the registered **Task** object type ref name (grep `objectRef<Task>` / `'Task'`), and (c) the context user field in `apps/api/src/graphql/context.ts` (`ctx.userId` vs `ctx.user.id`). Also confirm `pubsub.publish` signature in `apps/api/src/graphql/pubsub.ts`.

- [ ] **Step 2: Write the failing integration test**

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { createTestUser, createTestWorkspace, createTestProject, createTestTask } from '../../../__tests__/fixtures/factories.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool, getPool } from '../../../shared/lib/db.js';

async function gql(token: string, query: string, variables: any) {
  const res = await request('/graphql', { method: 'POST', token, json: { query, variables } });
  return json<{ data?: any; errors?: any[] }>(res, 200);
}
async function setListPath(id: string, lp: string) { const pool = await getPool(); await pool.request().input('Id', id).input('LP', lp).query('UPDATE Tasks SET ListPath=@LP WHERE Id=@Id'); }

describe('Views GraphQL', () => {
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });

  it('creates a saved view and runs it', async () => {
    const u = await createTestUser(); const ws = await createTestWorkspace(u.accessToken); const p = await createTestProject(ws.Id, u.accessToken);
    const t = await createTestTask(p.Id, ws.Id, u.accessToken, { title: 'gql' });
    await setListPath(t.Id, `/${p.Id}/`);

    const create = await gql(u.accessToken, `mutation($input: CreateSavedViewInput!){ createSavedView(input: $input){ id name type } }`,
      { input: { scopeType: 'SPACE', scopeId: p.Id, type: 'table', name: 'V', isShared: true, isDefault: false,
                 config: JSON.stringify({ filter: { conjunction: 'AND', rules: [] }, sort: [] }) } });
    expect(create.errors).toBeUndefined();
    const viewId = create.data.createSavedView.id;

    const run = await gql(u.accessToken, `query($id: String!){ viewTasks(viewId: $id, page: 1){ total tasks { title } } }`, { id: viewId });
    expect(run.errors).toBeUndefined();
    expect(run.data.viewTasks.total).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 3: Run to verify it fails** (unknown field `createSavedView`).

- [ ] **Step 4: Write `views.schema.ts`** (mirror `customfields.schema.ts`)

```ts
import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { viewService } from '../modules/views/view.service.js';
import { ViewNotFoundError, ViewValidationError } from '../modules/views/view.errors.js';
import { requireObjectLevel } from './authz.js';
import { pubsub } from './pubsub.js';
import type { SavedView, ViewTaskPage, ViewConfig, HierarchyNodeType } from '@projectflow/types';

function authzNode(scopeType: string): HierarchyNodeType | null {
  return scopeType === 'EVERYTHING' ? null : (scopeType as HierarchyNodeType);
}

export function registerViewsGraphql(): void {
  const SavedViewType = builder.objectRef<SavedView>('SavedView');
  SavedViewType.implement({ fields: (t) => ({
    id: t.exposeString('id'),
    workspaceId: t.exposeString('workspaceId'),
    ownerId: t.exposeString('ownerId'),
    scopeType: t.exposeString('scopeType'),
    scopeId: t.string({ nullable: true, resolve: (v) => v.scopeId }),
    type: t.exposeString('type'),
    name: t.exposeString('name'),
    isShared: t.exposeBoolean('isShared'),
    isDefault: t.exposeBoolean('isDefault'),
    position: t.exposeFloat('position'),
    config: t.string({ resolve: (v) => JSON.stringify(v.config) }),
  }) });

  const ViewGroupType = builder.objectRef<{ key: string; label: string; count: number }>('ViewGroup');
  ViewGroupType.implement({ fields: (t) => ({ key: t.exposeString('key'), label: t.exposeString('label'), count: t.exposeInt('count') }) });

  const ViewTaskPageType = builder.objectRef<ViewTaskPage>('ViewTaskPage');
  ViewTaskPageType.implement({ fields: (t) => ({
    total: t.exposeInt('total'),
    groups: t.field({ type: [ViewGroupType], nullable: true, resolve: (p) => p.groups ?? null }),
    // Reuse the existing registered Task object type ref (Step 1). If it's exported as `TaskType`,
    // import it and use `type: [TaskType]`. The string form below works only if string refs are enabled.
    tasks: t.field({ type: ['Task'], resolve: (p) => p.tasks as any }),
  }) });

  const CreateInput = builder.inputType('CreateSavedViewInput', { fields: (t) => ({
    scopeType: t.string({ required: true }), scopeId: t.string({ required: false }),
    type: t.string({ required: true }), name: t.string({ required: true }),
    isShared: t.boolean({ required: true }), isDefault: t.boolean({ required: true }),
    config: t.string({ required: true }), workspaceId: t.string({ required: false }),
  }) });

  const UpdateInput = builder.inputType('UpdateSavedViewInput', { fields: (t) => ({
    name: t.string({ required: false }), isShared: t.boolean({ required: false }),
    isDefault: t.boolean({ required: false }), config: t.string({ required: false }),
  }) });

  builder.queryFields((t) => ({
    savedViews: t.field({
      type: [SavedViewType],
      args: { scopeType: t.arg.string({ required: true }), scopeId: t.arg.string({ required: false }), workspaceId: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        const node = authzNode(a.scopeType);
        if (node) await requireObjectLevel(ctx, node, a.scopeId!, 'VIEW');
        return viewService.list(ctx.userId, a.scopeType as any, a.scopeId ?? null, a.workspaceId ?? undefined);
      },
    }),
    viewTasks: t.field({
      type: ViewTaskPageType,
      args: { viewId: t.arg.string({ required: true }), page: t.arg.int({ required: false }), meMode: t.arg.boolean({ required: false }) },
      resolve: async (_, a, ctx) => {
        const view = await viewService.getOrThrow(a.viewId);
        const node = authzNode(view.scopeType);
        if (node) await requireObjectLevel(ctx, node, view.scopeId!, 'VIEW');
        return viewService.runView(ctx.userId, a.viewId, { page: a.page ?? 1, meMode: a.meMode ?? undefined });
      },
    }),
    previewViewTasks: t.field({
      type: ViewTaskPageType,
      args: { scopeType: t.arg.string({ required: true }), scopeId: t.arg.string({ required: false }), config: t.arg.string({ required: true }), page: t.arg.int({ required: false }), meMode: t.arg.boolean({ required: false }), workspaceId: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        const node = authzNode(a.scopeType);
        if (node) await requireObjectLevel(ctx, node, a.scopeId!, 'VIEW');
        const config = JSON.parse(a.config) as ViewConfig;
        return viewService.runConfig(a.scopeType as any, a.scopeId ?? null, config, { page: a.page ?? 1, meMode: a.meMode ?? undefined }, a.workspaceId ?? undefined, ctx.userId);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    createSavedView: t.field({
      type: SavedViewType, args: { input: t.arg({ type: CreateInput, required: true }) },
      resolve: async (_, a, ctx) => {
        const node = authzNode(a.input.scopeType);
        if (node) await requireObjectLevel(ctx, node, a.input.scopeId!, 'EDIT');
        try {
          const v = await viewService.create(ctx.userId, {
            scopeType: a.input.scopeType as any, scopeId: a.input.scopeId ?? null, type: a.input.type as any,
            name: a.input.name, isShared: a.input.isShared, isDefault: a.input.isDefault,
            config: JSON.parse(a.input.config), workspaceId: a.input.workspaceId ?? undefined,
          });
          pubsub.publish('savedView:updated', { scopeType: v.scopeType, scopeId: v.scopeId });
          return v;
        } catch (e) { throw toGraphqlError(e); }
      },
    }),
    updateSavedView: t.field({
      type: SavedViewType, args: { id: t.arg.string({ required: true }), input: t.arg({ type: UpdateInput, required: true }) },
      resolve: async (_, a, ctx) => {
        await requireOwnerOrNodeEdit(ctx, a.id);
        try {
          const v = await viewService.update(a.id, {
            name: a.input.name ?? undefined, isShared: a.input.isShared ?? undefined,
            isDefault: a.input.isDefault ?? undefined, config: a.input.config ? JSON.parse(a.input.config) : undefined,
          });
          pubsub.publish('savedView:updated', { scopeType: v.scopeType, scopeId: v.scopeId });
          return v;
        } catch (e) { throw toGraphqlError(e); }
      },
    }),
    deleteSavedView: t.field({
      type: SavedViewType, args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => { await requireOwnerOrNodeEdit(ctx, a.id); const v = await viewService.delete(a.id); pubsub.publish('savedView:updated', { scopeType: v.scopeType, scopeId: v.scopeId }); return v; },
    }),
    reorderSavedView: t.field({
      type: SavedViewType, args: { id: t.arg.string({ required: true }), position: t.arg.float({ required: true }) },
      resolve: async (_, a, ctx) => { await requireOwnerOrNodeEdit(ctx, a.id); return viewService.reorder(a.id, a.position); },
    }),
  }));
}

function toGraphqlError(e: unknown): GraphQLError {
  if (e instanceof ViewValidationError) return new GraphQLError(e.message, { extensions: { code: 'VIEW_VALIDATION' } });
  if (e instanceof ViewNotFoundError) return new GraphQLError(e.message, { extensions: { code: 'NOT_FOUND' } });
  return e as GraphQLError;
}

async function requireOwnerOrNodeEdit(ctx: any, id: string): Promise<void> {
  const v = await viewService.getOrThrow(id);
  if (v.ownerId === ctx.userId) return;
  if (v.scopeType !== 'EVERYTHING') await requireObjectLevel(ctx, v.scopeType as HierarchyNodeType, v.scopeId!, 'EDIT');
}
```

> Adjust per Step 1 findings: the `Task` type ref, `ctx.userId` field, and `pubsub.publish` signature/channel. The test only reads `tasks { title }`, so the registered Task type must expose `title`.

- [ ] **Step 5: Register in `schema.ts`** — add `import { registerViewsGraphql } from './views.schema.js';` and call `registerViewsGraphql();` next to the other `registerXGraphql()` calls.

- [ ] **Step 6: Run the GraphQL integration test; expected PASS. Commit**

```bash
git add apps/api/src/graphql/views.schema.ts apps/api/src/graphql/schema.ts apps/api/src/modules/views/__tests__/views-graphql.integration.test.ts
git commit -m "feat(views): GraphQL surface (savedViews/viewTasks/previewViewTasks + CRUD)"
```

---

### Task C5: access control — private-Space 403 + shared/private visibility

**Files:**
- Test: `apps/api/src/modules/views/__tests__/view-access.integration.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool } from '../../../shared/lib/db.js';

async function gql(token: string, query: string, variables: any) {
  const res = await request('/graphql', { method: 'POST', token, json: { query, variables } });
  return json<{ data?: any; errors?: any[] }>(res, 200);
}
const emptyConfig = JSON.stringify({ filter: { conjunction: 'AND', rules: [] }, sort: [] });

describe('Views access control', () => {
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });

  it('a non-member cannot create a view on another workspace\'s space', async () => {
    const owner = await createTestUser(); const ws = await createTestWorkspace(owner.accessToken); const p = await createTestProject(ws.Id, owner.accessToken);
    const outsider = await createTestUser();
    const res = await gql(outsider.accessToken, `mutation($i: CreateSavedViewInput!){ createSavedView(input:$i){ id } }`,
      { i: { scopeType: 'SPACE', scopeId: p.Id, type: 'list', name: 'x', isShared: false, isDefault: false, config: emptyConfig } });
    expect(res.errors?.length).toBeGreaterThan(0);
  });

  it('owner sees both own-private and shared views at a node', async () => {
    const owner = await createTestUser(); const ws = await createTestWorkspace(owner.accessToken); const p = await createTestProject(ws.Id, owner.accessToken);
    await gql(owner.accessToken, `mutation($i: CreateSavedViewInput!){ createSavedView(input:$i){ id } }`,
      { i: { scopeType: 'SPACE', scopeId: p.Id, type: 'list', name: 'private', isShared: false, isDefault: false, config: emptyConfig } });
    await gql(owner.accessToken, `mutation($i: CreateSavedViewInput!){ createSavedView(input:$i){ id } }`,
      { i: { scopeType: 'SPACE', scopeId: p.Id, type: 'list', name: 'shared', isShared: true, isDefault: false, config: emptyConfig } });
    const own = await gql(owner.accessToken, `query($st:String!,$sid:String){ savedViews(scopeType:$st, scopeId:$sid){ name } }`, { st: 'SPACE', sid: p.Id });
    expect(own.data.savedViews.map((v: any) => v.name).sort()).toEqual(['private', 'shared']);
  });
});
```

> If the factories support adding a second member to a workspace, add a stronger case: the member sees the shared view but not the private one. Check `factories.ts`/the workspaces API for a member-add helper; if none exists, the owner-side assertion above plus the repository-level cross-user test in Task A4 cover the shared/private rule.

- [ ] **Step 2: Run; expected PASS.** If the non-member case shows no error, the `requireObjectLevel` wiring in C4 is wrong — fix so non-members are rejected. Commit.

```bash
git add apps/api/src/modules/views/__tests__/view-access.integration.test.ts
git commit -m "test(views): access control + shared/private visibility"
```

---

## PHASE D — Bulk edit + Me-mode

### Task D1: Bulk edit service + GraphQL

**Files:**
- Modify: `apps/api/src/modules/views/view.service.ts` (add `bulkUpdate`)
- Modify: `apps/api/src/graphql/views.schema.ts` (add `bulkUpdateTasks`)
- Test: `apps/api/src/modules/views/__tests__/bulk-update.integration.test.ts`

**Before coding:** read `apps/api/src/modules/tasks/task.service.ts` for the exact method names/signatures of transition, update-priority, set-assignees, move, delete, and how each enforces permission. Map the calls below to the real names.

- [ ] **Step 1: Write the failing integration test**

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { viewService } from '../view.service.js';
import { createTestUser, createTestWorkspace, createTestProject, createTestTask } from '../../../__tests__/fixtures/factories.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool, getPool } from '../../../shared/lib/db.js';

describe('ViewService.bulkUpdate', () => {
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });

  it('sets priority on multiple tasks and reports success', async () => {
    const u = await createTestUser(); const ws = await createTestWorkspace(u.accessToken); const p = await createTestProject(ws.Id, u.accessToken);
    const t1 = await createTestTask(p.Id, ws.Id, u.accessToken); const t2 = await createTestTask(p.Id, ws.Id, u.accessToken);
    const result = await viewService.bulkUpdate(u.user.Id, { taskIds: [t1.Id, t2.Id], action: { kind: 'set_priority', priority: 'HIGH' } });
    expect(result.updated.sort()).toEqual([t1.Id, t2.Id].sort());
    expect(result.failed).toEqual([]);
    const pool = await getPool();
    const rows = await pool.request().input('Id', t1.Id).query('SELECT Priority FROM Tasks WHERE Id=@Id');
    expect(rows.recordset[0].Priority).toBe('HIGH');
  });

  it('reports per-task failure without aborting the batch', async () => {
    const u = await createTestUser(); const ws = await createTestWorkspace(u.accessToken); const p = await createTestProject(ws.Id, u.accessToken);
    const t1 = await createTestTask(p.Id, ws.Id, u.accessToken);
    const result = await viewService.bulkUpdate(u.user.Id, { taskIds: [t1.Id, '00000000-0000-0000-0000-000000000000'], action: { kind: 'set_priority', priority: 'LOW' } });
    expect(result.updated).toEqual([t1.Id]);
    expect(result.failed.length).toBe(1);
    expect(result.failed[0]!.id).toBe('00000000-0000-0000-0000-000000000000');
  });
});
```

- [ ] **Step 2: Run to verify it fails** (`viewService.bulkUpdate is not a function`).

- [ ] **Step 3: Implement `bulkUpdate` in `view.service.ts`**

```ts
import { taskService } from '../tasks/task.service.js';
import { customFieldService } from '../customfields/customfield.service.js';
import type { BulkAction, BulkUpdateResult } from '@projectflow/types';

// inside ViewService:
async bulkUpdate(userId: string, input: { taskIds: string[]; action: BulkAction }): Promise<BulkUpdateResult> {
  const updated: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  for (const id of input.taskIds) {
    try { await this.applyAction(userId, id, input.action); updated.push(id); }
    catch (e) { failed.push({ id, reason: (e as Error).message }); }
  }
  return { updated, failed };
}

private async applyAction(userId: string, taskId: string, action: BulkAction): Promise<void> {
  switch (action.kind) {
    case 'set_status':       await taskService.transition(taskId, action.status); break;
    case 'set_priority':     await taskService.update(taskId, { priority: action.priority }); break;
    case 'set_assignees':    await taskService.setAssignees(taskId, action.userIds); break;
    case 'set_custom_field': await customFieldService.setValue(taskId, action.fieldId, action.value); break;
    case 'move_to_list':     await taskService.moveTask(taskId, action.listId); break;
    case 'delete':           await taskService.delete(taskId); break;
  }
}
```

> Replace each `taskService.*`/`customFieldService.*` call with the **actual** method name + arg order from `task.service.ts`/`customfield.service.ts`. If a method requires extra context (workspaceId/actor) thread it via `bulkUpdate`. **Per-task permission:** if `taskService` methods don't self-check the caller's access, resolve the task's list (reuse the `taskListId` helper pattern from `customfields.schema.ts`) and call `requireObjectLevel`/`resolveAccess` with `userId` before applying — so a user can't bulk-edit tasks they can't access. Add an integration case proving an outsider's id in `taskIds` lands in `failed`.

- [ ] **Step 4: Run; expected PASS.**

- [ ] **Step 5: Add `bulkUpdateTasks` mutation to `views.schema.ts`**

```ts
const BulkFailType = builder.objectRef<{ id: string; reason: string }>('BulkUpdateFailure');
BulkFailType.implement({ fields: (t) => ({ id: t.exposeString('id'), reason: t.exposeString('reason') }) });
const BulkResultType = builder.objectRef<{ updated: string[]; failed: Array<{ id: string; reason: string }> }>('BulkUpdateResult');
BulkResultType.implement({ fields: (t) => ({ updated: t.exposeStringList('updated'), failed: t.field({ type: [BulkFailType], resolve: (r) => r.failed }) }) });

// in builder.mutationFields:
bulkUpdateTasks: t.field({
  type: BulkResultType,
  args: { taskIds: t.arg.stringList({ required: true }), action: t.arg.string({ required: true }) },
  resolve: async (_, a, ctx) => viewService.bulkUpdate(ctx.userId, { taskIds: a.taskIds, action: JSON.parse(a.action) }),
}),
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/views/view.service.ts apps/api/src/graphql/views.schema.ts apps/api/src/modules/views/__tests__/bulk-update.integration.test.ts
git commit -m "feat(views): bulk edit (reuses single-task ops, partial success)"
```

---

### Task D2: Me-mode end-to-end test

**Files:**
- Test: `apps/api/src/modules/views/__tests__/me-mode.integration.test.ts`

The compiler supports `meUserId` (B3) and the service threads `meMode` (C3); this proves it end-to-end.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { viewService } from '../view.service.js';
import { taskService } from '../../tasks/task.service.js';
import { createTestUser, createTestWorkspace, createTestProject, createTestTask } from '../../../__tests__/fixtures/factories.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool, getPool } from '../../../shared/lib/db.js';

async function setListPath(id: string, lp: string) { const pool = await getPool(); await pool.request().input('Id', id).input('LP', lp).query('UPDATE Tasks SET ListPath=@LP WHERE Id=@Id'); }

describe('Me-mode overlay', () => {
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });

  it('filters to tasks assigned to the current user without mutating the view config', async () => {
    const u = await createTestUser(); const ws = await createTestWorkspace(u.accessToken); const p = await createTestProject(ws.Id, u.accessToken);
    const mine = await createTestTask(p.Id, ws.Id, u.accessToken, { title: 'mine' });
    const other = await createTestTask(p.Id, ws.Id, u.accessToken, { title: 'other' });
    await setListPath(mine.Id, `/${p.Id}/`); await setListPath(other.Id, `/${p.Id}/`);
    await taskService.setAssignees(mine.Id, [u.user.Id]); // adjust to real signature

    const view = await viewService.create(u.user.Id, { scopeType: 'SPACE', scopeId: p.Id, type: 'list', name: 'V', isShared: true, isDefault: false, config: { filter: { conjunction: 'AND', rules: [] }, sort: [] } });
    const off = await viewService.runView(u.user.Id, view.id, { page: 1 });
    const on  = await viewService.runView(u.user.Id, view.id, { page: 1, meMode: true });
    expect(off.tasks.length).toBe(2);
    expect(on.tasks.map((t) => t.Title)).toEqual(['mine']);
  });
});
```

- [ ] **Step 2: Run; expected PASS. Commit**

```bash
git add apps/api/src/modules/views/__tests__/me-mode.integration.test.ts
git commit -m "test(views): me-mode overlay end-to-end"
```

---

## PHASE E — Frontend (Next.js 16)

> **Before any web code:** read `apps/next-web/CLAUDE.md`/`AGENTS.md` and `node_modules/next/dist/docs/` (Next 16 breaking changes). Mirror the existing patterns in `apps/next-web/src/app/(app)/board/` and `apps/next-web/src/server/queries|actions/`. Each task references the file to copy structure from. These tasks have no unit tests (thin SSR wrappers / UI); correctness is covered by the API integration tests and the Playwright e2e in E6.

### Task E1: server queries + actions for views

**Files:**
- Create: `apps/next-web/src/server/queries/views.ts`
- Create: `apps/next-web/src/server/actions/views.ts`

- [ ] **Step 1: `views.ts` (queries)** — mirror `src/server/queries/tasks.ts`: same GraphQL server helper, calling `savedViews` and `viewTasks`; reuse the existing `normalizeTask`.

```ts
import { serverGraphql } from './_client.js'; // use the project's actual GraphQL server helper name/path
import { normalizeTask } from './tasks.js';
import type { SavedView, ViewTaskPage } from '@projectflow/types';

export async function getSavedViews(scopeType: string, scopeId: string | null): Promise<SavedView[]> {
  const data = await serverGraphql(`query($st:String!,$sid:String){ savedViews(scopeType:$st,scopeId:$sid){ id name type scopeType scopeId isShared isDefault position config } }`, { st: scopeType, sid: scopeId });
  return (data.savedViews as any[]).map((v) => ({ ...v, config: JSON.parse(v.config) }));
}

export async function getViewTasks(viewId: string, page = 1, meMode = false): Promise<ViewTaskPage> {
  const data = await serverGraphql(
    `query($id:String!,$p:Int,$me:Boolean){ viewTasks(viewId:$id,page:$p,meMode:$me){ total groups { key label count } tasks { id title status priority /* add fields normalizeTask needs */ } } }`,
    { id: viewId, p: page, me: meMode });
  return { total: data.viewTasks.total, tasks: data.viewTasks.tasks.map(normalizeTask), groups: data.viewTasks.groups ?? undefined };
}
```

- [ ] **Step 2: `views.ts` (actions)** — mirror `src/server/actions/tasks.ts` (`'use server'`, the mutation client, `revalidatePath`). Implement `createSavedView`, `updateSavedView`, `deleteSavedView`, `reorderSavedView`, `bulkUpdateTasks`; serialize `config`/`action` to JSON strings to match the schema args.

- [ ] **Step 3: Commit**

```bash
git add apps/next-web/src/server/queries/views.ts apps/next-web/src/server/actions/views.ts
git commit -m "feat(web): server queries + actions for saved views"
```

---

### Task E2: View surface shell + tab row

**Files:**
- Create: `apps/next-web/src/app/(app)/views/[scopeType]/[scopeId]/page.tsx`
- Create: `apps/next-web/src/components/views/view-surface.tsx`
- Create: `apps/next-web/src/components/views/view-tabs.tsx`

- [ ] **Step 1: `page.tsx` (SSR)** — read route params + `searchParams` (`viewId`, `page`, `meMode`); call `getSavedViews(scopeType, scopeId)`; pick the active view (`viewId` ?? the `isDefault` one ?? first); call `getViewTasks(activeId, page, meMode)`; render `<ViewSurface views={…} active={…} page={…} />`. Mirror `board/page.tsx` for the SSR + searchParams shape (note Next 16 async `searchParams`).
- [ ] **Step 2: `view-tabs.tsx` (client)** — render one tab per saved view + "＋ New view"; navigate by setting `?viewId=`; dnd-kit reorder calls the `reorderSavedView` action (mirror dnd usage in `board-view.tsx`/`backlog-view.tsx`). Add `data-testid="view-tab"`.
- [ ] **Step 3: `view-surface.tsx` (client)** — switch on `active.type` → `<ListView>`/`<BoardViewEngine>`/`<TableView>`/`<CalendarView>`; host the filter/group/sort builder panel (E3) and a Me-mode toggle that sets `?meMode=1` (`data-testid="me-mode-toggle"`).
- [ ] **Step 4: Commit**

```bash
git add apps/next-web/src/app/(app)/views apps/next-web/src/components/views/view-surface.tsx apps/next-web/src/components/views/view-tabs.tsx
git commit -m "feat(web): view surface shell + tabs"
```

---

### Task E3: Table view + filter/group/sort builder

**Files:**
- Create: `apps/next-web/src/components/views/table-view.tsx`
- Create: `apps/next-web/src/components/views/list-view.tsx`
- Create: `apps/next-web/src/components/views/filter-builder.tsx`

- [ ] **Step 1: `table-view.tsx`** — columns from `config.columns` (built-in + custom); rows = `page.tasks`; client-side grouping when `config.groupBy` is set, using `page.groups` for header counts; row checkboxes feed selection state (consumed by the bulk bar in E6). `data-testid="table-row"`, `data-testid="row-select"`.
- [ ] **Step 2: `list-view.tsx`** — simpler flat/grouped rows reusing the existing task-row component; same selection wiring.
- [ ] **Step 3: `filter-builder.tsx`** — edit the `ViewConfig` AST: add/remove `FilterRule`s, nest AND/OR groups, pick `groupBy`, multi-key `sort`, choose `columns`. Field options = built-in list + `customFields(scopeType, scopeId)` (Phase 2 query). On change, call the `previewViewTasks` action for a live count; "Save" → `updateSavedView`, "Save as new" → `createSavedView`. `data-testid="add-filter-rule"`, `data-testid="save-view"`.
- [ ] **Step 4: Commit**

```bash
git add apps/next-web/src/components/views/table-view.tsx apps/next-web/src/components/views/list-view.tsx apps/next-web/src/components/views/filter-builder.tsx
git commit -m "feat(web): list + table views + filter/group/sort builder"
```

---

### Task E4: Calendar view

**Files:**
- Create: `apps/next-web/src/components/views/calendar-view.tsx`

- [ ] **Step 1:** month grid; place each task on the day from `config.dateField` (default builtin `dueDate`). Month nav updates `?month=`; for v1, filter the fetched page client-side to the visible month (no API change). Use `apps/next-web/src/lib/date.ts` for locale-safe formatting (per CSR→SSR migration memory — avoids hydration mismatch). `data-testid="calendar-day"`.
- [ ] **Step 2: Commit**

```bash
git add apps/next-web/src/components/views/calendar-view.tsx
git commit -m "feat(web): calendar view"
```

---

### Task E5: Board retrofit (engine-backed, behind a parity gate)

**Files:**
- Create: `apps/next-web/src/components/views/board-view-engine.tsx`
- Modify: `apps/next-web/src/app/(app)/board/page.tsx`

- [ ] **Step 1: Seed-on-demand default board view** — in `board/page.tsx`, after loading `savedViews` for the Space, if no `board`-type default exists, create one via the `createSavedView` action (type `board`, `isShared:true`, `isDefault:true`, empty filter). (The "seeded per Space" step from the spec.)
- [ ] **Step 2: `board-view-engine.tsx`** — Kanban columns from the node's effective workflow statuses (reuse the existing `getWorkflow` query + the Kanban column/card UI from `board-view.tsx`); fetch tasks once via `getViewTasks` and partition client-side by status (v1). Keep drag-reorder wired to the existing reorder action.
- [ ] **Step 3: Parity gate** — keep the legacy `getTasks`-based `board-view.tsx` until the engine board reaches parity (same task set; columns from workflow; filter by type/priority/free-text; drag-reorder persists). Document the parity checklist in the PR. Only after parity, switch `board/page.tsx` to render `<BoardViewEngine>` and remove the bespoke `getTasks` board path.
- [ ] **Step 4: Commit**

```bash
git add apps/next-web/src/components/views/board-view-engine.tsx apps/next-web/src/app/(app)/board/page.tsx
git commit -m "feat(web): retrofit Board onto the views engine (behind parity gate)"
```

---

### Task E6: Bulk-edit UI + Playwright e2e

**Files:**
- Create: `apps/next-web/src/components/views/bulk-bar.tsx`
- Create: `apps/next-web/e2e/views.spec.ts` (match the repo's Playwright dir/naming)

- [ ] **Step 1: `bulk-bar.tsx`** — visible when ≥1 row/card selected; offers set status / priority / assignees / custom field / move / delete; calls the `bulkUpdateTasks` action with selected ids; toasts `{updated, failed}` (partial success). `data-testid="bulk-bar"`, `data-testid="bulk-set-status"`.
- [ ] **Step 2: Write `views.spec.ts`** covering: (a) create a Table view with a custom-field filter + grouping, save, reload → persists; (b) toggle Me-mode → list narrows; (c) select two rows → bulk-change status → both update. Mirror the existing e2e auth/login + base-URL setup from the repo's current Playwright specs; use the `data-testid`s added above.
- [ ] **Step 3: Run the e2e**

Run: the repo's e2e command (e.g. `npx playwright test e2e/views.spec.ts` from `apps/next-web`, or the workspace script in `package.json`). Expected: all three scenarios PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/next-web/src/components/views/bulk-bar.tsx apps/next-web/e2e/views.spec.ts
git commit -m "feat(web): bulk-edit bar + views e2e"
```

---

## PHASE F — Finalize

### Task F1: Record decision + run full suites + acceptance

**Files:**
- Modify: `DECISIONS.md` (match where Phase 1/2 recorded theirs — grep for `DECISIONS.md`)

- [ ] **Step 1: Append the SP-per-op exception to `DECISIONS.md`**

```markdown
## Phase 3 (Views Engine) — dynamic query exception to SP-per-op
The dynamic task query (`ViewRepository.queryTasks`/`groupCounts`) builds parameterized SQL in a pure
TS compiler (`modules/views/query/compiler.ts`) and runs it via the mssql parameterized request,
rather than a stored procedure. Rationale: the query shape is inherently dynamic (arbitrary
filter/sort over built-in + N user-defined custom fields), which fixed-param SPs cannot express.
Safety: field identifiers come only from an allow-list catalog; custom fields enter as parameterized
FieldId GUIDs; operators from an enum; every value is a bound parameter; the tenant + scope +
soft-delete predicate is always injected. SavedView CRUD remains SP-per-op (`usp_View_*`).
```

- [ ] **Step 2: Run the full API suites**

Run (from `apps/api`): `npx vitest run --project unit` then `npx vitest run --project integration`
Expected: all green, including prior phases (no regressions).

- [ ] **Step 3: GraphQL/types codegen if applicable** — check `package.json` for a `codegen` script; if present, run it so web client types include the new operations. Commit generated output.

- [ ] **Step 4: Verify each acceptance box** — re-read §9 of the spec; confirm each criterion maps to a passing test or shipped feature. **Stop for human review before Phase 3.5.**

- [ ] **Step 5: Final commit**

```bash
git add DECISIONS.md
git commit -m "docs(views): record SP-per-op exception; Phase 3 complete"
```

---

## Self-review notes — gaps the implementer closes with live code
Deferred intentionally because they need exact current signatures (guessing here would plant bugs):
1. **Built-in column/table names** in `builtin-fields.ts` — verify vs the real schema (B1 Step 2 note). C1 integration tests are the safety net.
2. **`ctx.userId`** field name and **`pubsub.publish`** signature/channel (C4 Step 1).
3. **Shared `Task` GraphQL object ref** reuse in `ViewTaskPage.tasks` (C4 Step 4 note).
4. **`taskService`/`customFieldService` method names + per-task permission checks** for bulk edit (D1 Step 3 note).
5. **Join-backed `is_empty`/`is_not_empty`** final form (B3 Step 3 note) — pick the explicit clauses or drop the ops in v1; keep a unit test.
6. **Down-migration convention** for `0032` (A1 Step 1 note).
7. **Web GraphQL helper + `normalizeTask` paths** (E1) and **Playwright command + auth helper** (E6) — mirror existing files.

## Spec coverage check (self-review)
- §2 data model → A1. §3.1 catalog → B2. §3.2 compiler → B3. §3.3 query exec → C1. §3.4 ViewConfig → A3. §3.5 grouping → C2 (counts) + E3/E5 (render). §4 GraphQL → C4. §5 frontend/retrofit → E2–E5. §6 Me-mode → B3/C3/D2; bulk edit → D1. §7 cross-cutting (tenant guard) → B3 + C1 isolation test; pubsub → C4. §8 tests → unit B2/B3, integration A4/C1/C2/C3/C5/D1/D2, e2e E6. §9 acceptance → F1 Step 4. §10 DoD → F1. No spec section is unmapped.
```
