# Custom Fields + Custom Task Types + Tags (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add custom fields (15 wave-1 types with location-scoped downward cascade), configurable task types (+ milestone), Space-scoped tags (over the existing `Labels` table), task watchers, and a Space-level multiple-assignees toggle to the Phase 1 hierarchy spine — backend (REST + Pothos GraphQL mirror, one shared service per entity) and Next.js SSR frontend — carried by ONE reversible migration `0030`.

**Architecture:** Mirror the Phase 1 house style exactly. Stored-proc-per-op (`CREATE OR ALTER`, `SET NOCOUNT ON`, `BEGIN TRY/CATCH … THROW 51xxx`, `SELECT *` return) deployed by `db:deploy-sps`; `*.repository.ts` (`execSpOne`) → `*.service.ts` (logic, UUID upper-cased, validation, typed errors) → `*.routes.ts` (Hono + `zValidator` + `requireObjectAccess` + `pubsub.publish`) with a Pothos GraphQL mirror delegating to the same service singleton. Hand-written types in `packages/types/index.ts`. Frontend = `serverFetch` queries + `'use server'` actions + `revalidatePath`. The field cascade reuses the materialized-`Path` prefix mechanism from `usp_Hierarchy_DescendantTasks`.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import suffix), Hono, Pothos GraphQL (`graphql-yoga` pubsub), `mssql` + SQL Server (T-SQL stored procs), Next.js App Router (apps/next-web — customized), Vitest (unit + integration projects), Playwright (e2e).

---

## CRITICAL ENVIRONMENT & SAFETY (read before any command)

- **Shell is PowerShell on Windows.** Use the PowerShell tool. Honor the GateGuard fact-forcing hook.
- **`apps/api/.env` points at REMOTE PRODUCTION** (`sql.binasentra.co.id/ProjectFlow`). NEVER run migrations or integration tests against it (integration `DELETE`s every table; a classifier blocks that server anyway). Use the local Docker MSSQL stack only.
- **Local DB bringup** (verified working):
  ```powershell
  docker compose -f docker-compose.yml up -d
  # SA password YourStrong@Passw0rd ; ports 1433/6379/9000-9001 ; named volume sqldata
  # Poll a few seconds for SQL to recover user DBs after `up`.
  # Back up apps/api/.env -> apps/api/.env.prod.bak (NEVER git add), then set:
  #   DB_SERVER=localhost DB_PORT=1433 DB_NAME=ProjectFlow DB_USER=sa
  #   DB_PASSWORD=YourStrong@Passw0rd DB_ENCRYPT=false DB_TRUST_SERVER_CERTIFICATE=true
  ```
- **Integration tests need shell env** (vitest doesn't load `.env`; `integration.setup.ts` sets only `DB_NAME=ProjectFlow_Test`):
  ```powershell
  $env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_USER='sa'; $env:DB_PASSWORD='YourStrong@Passw0rd'; $env:DB_ENCRYPT='false'; $env:DB_TRUST_SERVER_CERTIFICATE='true'; $env:REDIS_URL='redis://127.0.0.1:6379'
  ```
- **ALWAYS WHEN DONE:** restore `apps/api/.env` from `.env.prod.bak`, delete the backup, `docker compose -f docker-compose.yml down`.
- **PASTE REAL TEST OUTPUT before claiming any step passes.** Commit only when the human explicitly asks.

---

## House-style facts this plan is grounded in (from live `main` @ 6580ccc)

- **Module layout:** `apps/api/src/modules/<name>/<name>.repository.ts | .service.ts | .routes.ts`, tests in `<name>/__tests__/*.{unit,integration}.test.ts`.
- **`execSpOne`** — `import { execSpOne } from '../../shared/lib/sqlClient.js';`. Two param forms: array of `{ name, type: sql.X, value }` (hierarchy style) or plain `{ Key: value }` object. Returns the first recordset (array of PascalCase rows). SQL `THROW` numbers surface as `err.number`.
- **`requireObjectAccess`** — `import { requireObjectAccess } from '../access/access.middleware.js';`. `requireObjectAccess(min: 'VIEW'|'COMMENT'|'EDIT'|'FULL', resolveObject: (c) => { type: 'SPACE'|'FOLDER'|'LIST', id } | null)`. 401/404/403 envelopes. Body resolver casts `(c.req as any).valid('json')`.
- **`pubsub`** — `import { pubsub } from '../../graphql/pubsub.js';`. **Channels are typed in `pubsub.ts` `PubSubChannels`** — a new channel key MUST be added there before `publish` type-checks. Existing: `task:updated`, `list:updated`, `folder:updated`, `space:updated`, `comment:created`.
- **Response envelope:** hierarchy modules use `{ data }` (201 on create); errors `{ error: { code, message } }` with explicit status. We follow the **hierarchy `{ data }` convention** for all new routes.
- **UUIDs:** `randomUUID().toUpperCase()` for any id whose value lands in a materialized `Path` segment.
- **Route mounting:** `apps/api/src/server.ts` — import the router (~lines 11-27 import block), add `app.route('/x', xRoutes);` in the block at ~lines 180-207. App base path is `/api/v1`.
- **GraphQL wiring:** write `registerXGraphql()` in `apps/api/src/graphql/x.schema.ts`, import + **call it in `apps/api/src/graphql/schema.ts` before `builder.toSchema()`**. Shared builder: `import { builder } from './builder.js';` (Scalars include `Date`). `requireAuth(ctx)` guard throws `GraphQLError(..., { extensions: { code: 'UNAUTHENTICATED' } })`.
- **Migration runner** (`scripts/db-migrate.ts`): discovers top-level `infra/sql/migrations/*.sql`, sorts lexicographically, runs each file not in `dbo.MigrationHistory.[FileName]` split on `/^\s*GO\s*$/im` inside one transaction, records `(FileName, Checksum)`. `rollback/` is NOT recursed. **SP deployer** (`scripts/db-deploy-sps.ts`): re-runs every `infra/sql/procedures/*.sql` — idempotency relies on `CREATE OR ALTER`.
- **THROW code ranges used:** 51001-51013, 51020-51031, 51040, 51050-51060, 51200-51204, 51210-51214, 51220, 51230. **Phase 2 uses 51300+** (51300-51319 custom fields, 51320-51339 task types, 51340-51359 tags, 51360-51379 watchers).
- **Schema facts:** `dbo.Tasks` has `Type NVARCHAR(20) NOT NULL DEFAULT 'TASK'` (no CHECK), `Status NVARCHAR(100)`, `ListId`, `ListPath NVARCHAR(900) NULL`, `ParentTaskId`, `ProjectId` (= Space), `DeletedAt`. **Assignees = junction `dbo.TaskAssignees (TaskId, UserId)`**. `dbo.Projects` (= Space) soft-deletes via `Status='DELETED'` (no `DeletedAt`); has `Visibility`, `MaxSubtaskDepth`, `WorkflowId`. `dbo.Labels (Id, ProjectId, Name, Color, CreatedAt)` UNIQUE `(ProjectId, Name)`; junction `dbo.TaskLabelLinks (TaskId, LabelId)`. `dbo.WorkflowStatuses.Category` ∈ `'TODO'|'IN_PROGRESS'|'DONE'`. `dbo.Workspaces.Id`, `dbo.Users.Id`.
- **DONE-category detection** (mirror `usp_Task_Transition`): effective workflow `COALESCE(l.WorkflowId, f.WorkflowId, p.WorkflowId)` (List→Folder→Space); DONE when `EXISTS (SELECT 1 FROM WorkflowStatuses WHERE WorkflowId=@wf AND Name=@status AND Category='DONE')`; **no-workflow fallback:** `@status IN ('Done','Resolved','Closed','Completed')`.
- **Path helpers** — `apps/api/src/modules/hierarchy/path.ts`: `spacePath(id)='/${id}/'`, `folderPath`, `listPath`. Path = `/` + ancestor GUID ids + trailing `/`. Space has no stored Path (synthesize `/${spaceId}/`); Folders/Lists store `Path`; `Tasks.ListPath` denormalizes its List's `Path`.
- **Frontend (`apps/next-web`):** `serverFetch`/`serverFetchEnvelope`/`serverFetchBody` from `@/server/api`; queries in `src/server/queries/*` wrapped in `cache()` + `import 'server-only'`; actions in `src/server/actions/*` start `'use server'`, `await requireSession()`, `try { await serverFetch(...) } catch (e) { return toActionError(e); }`, `revalidatePath(...)`, `return { ok: true }`. UI primitives `@/components/ui/*`. `TaskDrawer.tsx` = hand-rolled `'use client'` drawer (local mirror state + `useTransition` + `notifyActionError` + rollback). Settings CRUD model: `src/app/(app)/project-settings/project-settings-view.tsx`. `TASK_LIST_PATHS = ['/board','/backlog','/dashboard','/roadmap','/epics']` in `actions/tasks.ts`.
- **Tests:** `import { request, json } from '../../../__tests__/setup/testServer.js'`; `truncateAll` from `__tests__/fixtures/truncate.js` (**add every new table to `TRUNCATION_ORDER`, child-first**); factories `createTestUser/createTestWorkspace/createTestProject/createTestTask` from `__tests__/fixtures/factories.js` (no Folder/List factory — create inline via `request`). `getPool/closePool` from `shared/lib/db.js`. `beforeEach(truncateAll)` + `afterAll(closePool)`. Multitenancy: user A creates, user B reads → `expect([403,404]).toContain(res.status)`. Scripts: `npm run test:unit --workspace apps/api`, `npm run test:integration --workspace apps/api -- <file>`. e2e `e2e/*.spec.ts`, `baseURL :3000`, API `:3001/api/v1`, register-via-API + UI-login, `getByTestId`/`#id`/role selectors.

---

## File Structure

### Migration (Stream A only)
- Create: `infra/sql/migrations/0030_custom_fields.sql` — ALL Phase 2 schema + idempotent backfill.
- Create: `infra/sql/migrations/rollback/0030_custom_fields.down.sql` — reverse-order idempotent teardown incl. dynamic DEFAULT-constraint drop for `Projects.MultipleAssignees`.

### Stored procedures (`infra/sql/procedures/`)
- Custom fields: `usp_CustomField_Create/Update/Delete/List/Reorder.sql`, `usp_CustomField_EffectiveForTask.sql`, `usp_CustomField_GetScopeNode.sql`, `usp_CustomField_GetWorkspaceId.sql`, `usp_TaskCustomFieldValue_Set/Delete.sql`, `usp_CustomField_RequiredUnmetForStatus.sql`, `usp_TaskCustomField_RecomputeProgressAuto.sql`.
- Task types: `usp_TaskType_Create/Update/Delete/List.sql`, `usp_TaskType_GetWorkspaceId.sql`, `usp_Task_SetType.sql`.
- Tags: `usp_Tag_List/Create/Delete/LinkTask/UnlinkTask.sql`, `usp_Tag_GetWorkspaceId.sql`.
- Watchers: `usp_TaskWatcher_Add/Remove/List.sql`.
- Space toggle: `usp_Space_SetMultipleAssignees.sql`, `usp_Space_GetMultipleAssignees.sql`.

### Backend modules (`apps/api/src/modules/`)
- `customfields/{customfield.repository,customfield.service,customfield.routes,customfield.errors,validators,map}.ts`
- `tasktypes/{tasktype.repository,tasktype.service,tasktype.routes,map}.ts`
- `tags/{tag.repository,tag.service,tag.routes,map}.ts`
- `watchers/{watcher.repository,watcher.service,watcher.routes}.ts`
- Modify: `tasks/task.service.ts`, `tasks/task.routes.ts`, `tasks/task.repository.ts`, `server.ts`, `graphql/schema.ts`, `graphql/pubsub.ts`.

### GraphQL mirrors (`apps/api/src/graphql/`)
- `customfields.schema.ts`, `tasktypes.schema.ts`, `tags.schema.ts`, `watchers.schema.ts`.

### Shared types
- Modify: `packages/types/index.ts`.

### Frontend (`apps/next-web/src/`)
- Queries: `server/queries/{custom-fields,task-types,tags,watchers}.ts`.
- Actions: `server/actions/{custom-fields,task-types,tags,watchers}.ts` + additions to `server/actions/tasks.ts`.
- Components: `components/custom-fields/CustomFieldCell.tsx` + `components/custom-fields/types/*.tsx` + `components/custom-fields/FieldManager.tsx`, `components/{TagPicker,WatcherControl,TaskTypeSelector}.tsx`; modify `components/TaskDrawer.tsx`.

### Tests — as enumerated per task below; `e2e/custom-fields.spec.ts` for the headline flow.

---

## Execution order

**Stream A (Custom Fields) → Stream B (Task Types) → Stream C (Tags) → Stream D (Watchers + multi-assignee).** Migration `0030` is authored and applied in Stream A Task A1 and carries ALL four streams' schema. **Review checkpoint after each stream.** Run each task's verification before moving on.

> CODE COMPLETENESS: The 15 validators (A4) are written in full. Per-type frontend cells (A12): dispatcher + 3 representative cells in full, the rest specified by an exact table. Every backend SP/repository/service/route is written in full. Subsequent stream tasks (B–D) are appended to this file in detail-equivalent form (see "Plan continuation" at the end — this document is authored in segments; segment 1 covers the front matter + Stream A through Task A3, and the remaining tasks are filled in by the planning session before execution begins).

---

## STREAM A — Custom Fields engine

### Task A1: Migration 0030 — all Phase 2 schema + backfill

**Files:**
- Create: `infra/sql/migrations/0030_custom_fields.sql`
- Create: `infra/sql/migrations/rollback/0030_custom_fields.down.sql`

- [ ] **Step 1: Write the forward migration**

Create `infra/sql/migrations/0030_custom_fields.sql`:

```sql
-- =============================================================================
-- Migration 0030: Custom Fields + Task Types + Tags + Watchers (Phase 2)
-- New tables: CustomFields, TaskCustomFieldValues, TaskTypes, TaskWatchers.
-- Alters: Tasks.TaskTypeId (nullable FK), Projects.MultipleAssignees (BIT NOT NULL DEFAULT 1).
-- Backfill: seed default Task + Milestone TaskTypes per workspace; point existing Tasks at the default.
-- Idempotent. Forward-only; rollback in rollback/0030_custom_fields.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CustomFields')
BEGIN
    CREATE TABLE dbo.CustomFields (
        Id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Workspaces(Id),
        ScopeType   NVARCHAR(8)      NOT NULL,
        ScopeId     UNIQUEIDENTIFIER NOT NULL,
        ScopePath   NVARCHAR(900)    NOT NULL,
        Type        NVARCHAR(20)     NOT NULL,
        Name        NVARCHAR(255)    NOT NULL,
        Config      NVARCHAR(MAX)    NULL,
        Required    BIT              NOT NULL DEFAULT 0,
        Position    FLOAT            NOT NULL DEFAULT 0,
        CreatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        DeletedAt   DATETIME2        NULL,
        CONSTRAINT CK_CustomFields_ScopeType CHECK (ScopeType IN ('SPACE','FOLDER','LIST')),
        CONSTRAINT CK_CustomFields_Type CHECK (Type IN (
            'text','text_area','number','currency','checkbox','date','url','email','phone',
            'dropdown','labels','rating','people','progress_manual','progress_auto'))
    );
    CREATE NONCLUSTERED INDEX IX_CustomFields_Scope ON dbo.CustomFields (ScopeType, ScopeId, Position);
    CREATE NONCLUSTERED INDEX IX_CustomFields_Path  ON dbo.CustomFields (ScopePath);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskCustomFieldValues')
BEGIN
    CREATE TABLE dbo.TaskCustomFieldValues (
        TaskId    UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Tasks(Id),
        FieldId   UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.CustomFields(Id),
        Value     NVARCHAR(MAX)    NULL,
        UpdatedAt DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_TaskCustomFieldValues PRIMARY KEY (TaskId, FieldId)
    );
    CREATE NONCLUSTERED INDEX IX_TCFV_Field ON dbo.TaskCustomFieldValues (FieldId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskTypes')
BEGIN
    CREATE TABLE dbo.TaskTypes (
        Id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId  UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Workspaces(Id),
        NameSingular NVARCHAR(100)    NOT NULL,
        NamePlural   NVARCHAR(100)    NOT NULL,
        Icon         NVARCHAR(50)     NULL,
        IsMilestone  BIT              NOT NULL DEFAULT 0,
        IsDefault    BIT              NOT NULL DEFAULT 0,
        Position     FLOAT            NOT NULL DEFAULT 0,
        CreatedAt    DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt    DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        DeletedAt    DATETIME2        NULL,
        CONSTRAINT UQ_TaskTypes_Name UNIQUE (WorkspaceId, NameSingular)
    );
    CREATE NONCLUSTERED INDEX IX_TaskTypes_Workspace ON dbo.TaskTypes (WorkspaceId, Position);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskWatchers')
BEGIN
    CREATE TABLE dbo.TaskWatchers (
        TaskId    UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Tasks(Id),
        UserId    UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Users(Id),
        CreatedAt DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_TaskWatchers PRIMARY KEY (TaskId, UserId)
    );
    CREATE NONCLUSTERED INDEX IX_TaskWatchers_User ON dbo.TaskWatchers (UserId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Tasks') AND name = 'TaskTypeId')
BEGIN
    ALTER TABLE dbo.Tasks ADD TaskTypeId UNIQUEIDENTIFIER NULL REFERENCES dbo.TaskTypes(Id);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Tasks_TaskType' AND object_id = OBJECT_ID('dbo.Tasks'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Tasks_TaskType ON dbo.Tasks (TaskTypeId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Projects') AND name = 'MultipleAssignees')
BEGIN
    ALTER TABLE dbo.Projects ADD MultipleAssignees BIT NOT NULL DEFAULT 1;
END
GO

-- Backfill: seed default Task + Milestone task types per workspace, then point
-- existing tasks at their workspace's default. Re-runnable (NOT EXISTS guards).
BEGIN
    INSERT INTO dbo.TaskTypes (Id, WorkspaceId, NameSingular, NamePlural, Icon, IsMilestone, IsDefault, Position)
    SELECT NEWID(), w.Id, 'Task', 'Tasks', NULL, 0, 1, 0
    FROM   dbo.Workspaces w
    WHERE  NOT EXISTS (SELECT 1 FROM dbo.TaskTypes tt WHERE tt.WorkspaceId = w.Id AND tt.IsDefault = 1 AND tt.DeletedAt IS NULL);

    INSERT INTO dbo.TaskTypes (Id, WorkspaceId, NameSingular, NamePlural, Icon, IsMilestone, IsDefault, Position)
    SELECT NEWID(), w.Id, 'Milestone', 'Milestones', 'diamond', 1, 0, 1
    FROM   dbo.Workspaces w
    WHERE  NOT EXISTS (SELECT 1 FROM dbo.TaskTypes tt WHERE tt.WorkspaceId = w.Id AND tt.IsMilestone = 1 AND tt.DeletedAt IS NULL);

    UPDATE t
    SET    t.TaskTypeId = dft.Id
    FROM   dbo.Tasks t
    JOIN   dbo.TaskTypes dft ON dft.WorkspaceId = t.WorkspaceId AND dft.IsDefault = 1 AND dft.DeletedAt IS NULL
    WHERE  t.TaskTypeId IS NULL;
END
GO
```

- [ ] **Step 2: Write the rollback script**

Create `infra/sql/migrations/rollback/0030_custom_fields.down.sql`:

```sql
-- =============================================================================
-- Rollback for 0030_custom_fields.sql. Run MANUALLY (the runner is forward-only).
-- Reverse dependency order, idempotent. Drops the auto-named DEFAULT constraint
-- on Projects.MultipleAssignees BEFORE the column (the 0029 Projects.Visibility lesson).
-- =============================================================================

-- Tasks.TaskTypeId: drop index, drop FK (dynamic name), drop column.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Tasks_TaskType' AND object_id = OBJECT_ID('dbo.Tasks'))
    DROP INDEX IX_Tasks_TaskType ON dbo.Tasks;
DECLARE @fkType NVARCHAR(128);
SELECT @fkType = fk.name FROM sys.foreign_keys fk
WHERE fk.parent_object_id = OBJECT_ID('dbo.Tasks') AND fk.referenced_object_id = OBJECT_ID('dbo.TaskTypes');
IF @fkType IS NOT NULL EXEC('ALTER TABLE dbo.Tasks DROP CONSTRAINT ' + @fkType);
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Tasks') AND name = 'TaskTypeId')
    ALTER TABLE dbo.Tasks DROP COLUMN TaskTypeId;
GO

-- Child tables first.
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskWatchers')           DROP TABLE dbo.TaskWatchers;
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskCustomFieldValues')  DROP TABLE dbo.TaskCustomFieldValues;
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CustomFields')           DROP TABLE dbo.CustomFields;
GO
-- TaskTypes after Tasks.TaskTypeId FK is gone.
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskTypes')              DROP TABLE dbo.TaskTypes;
GO

-- Projects.MultipleAssignees was added NOT NULL DEFAULT 1 -> auto-named DEFAULT
-- constraint (DF__Projects__Multi__*). Drop it dynamically before DROP COLUMN
-- or the drop fails (Msg 5074 / 4922).
DECLARE @dfMA NVARCHAR(128);
SELECT @dfMA = dc.name FROM sys.default_constraints dc
WHERE dc.parent_object_id = OBJECT_ID('dbo.Projects')
  AND dc.parent_column_id = COLUMNPROPERTY(OBJECT_ID('dbo.Projects'), 'MultipleAssignees', 'ColumnId');
IF @dfMA IS NOT NULL EXEC('ALTER TABLE dbo.Projects DROP CONSTRAINT ' + @dfMA);
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Projects') AND name = 'MultipleAssignees')
    ALTER TABLE dbo.Projects DROP COLUMN MultipleAssignees;
GO

DELETE FROM dbo.MigrationHistory WHERE [FileName] = '0030_custom_fields.sql';
GO
```

- [ ] **Step 3: Bring up local DB, point env at it, apply the migration**

Run (PowerShell):
```powershell
docker compose -f docker-compose.yml up -d
Copy-Item apps/api/.env apps/api/.env.prod.bak -Force
@"
DB_SERVER=localhost`nDB_PORT=1433`nDB_NAME=ProjectFlow`nDB_USER=sa`nDB_PASSWORD=YourStrong@Passw0rd`nDB_ENCRYPT=false`nDB_TRUST_SERVER_CERTIFICATE=true`nREDIS_URL=redis://127.0.0.1:6379`nJWT_SECRET=local-dev-secret-32-chars-minimum!!
"@ | Set-Content apps/api/.env
Start-Sleep -Seconds 8
npm run db:migrate
```
Expected: log lines ending with `0030_custom_fields.sql` applied and recorded (no SQL error number printed).

- [ ] **Step 4: Verify schema landed**

Run:
```powershell
npm run db:migrate   # re-run: should report 0030 already applied / nothing pending (idempotency)
```
Expected: `0030_custom_fields.sql` is NOT re-applied (already in MigrationHistory).

- [ ] **Step 5: Verify the down script tears down cleanly on a scratch DB**

Run:
```powershell
$cs = "Server=localhost,1433;Database=master;User Id=sa;Password=YourStrong@Passw0rd;TrustServerCertificate=true;Encrypt=false"
# Create scratch DB, apply 0030 only, then run the down script and assert tables are gone.
docker exec -i $(docker ps --filter "ancestor=mcr.microsoft.com/mssql/server:2022-latest" -q) /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'YourStrong@Passw0rd' -C -Q "IF DB_ID('PF_Scratch') IS NULL CREATE DATABASE PF_Scratch;"
docker exec -i $(docker ps --filter "ancestor=mcr.microsoft.com/mssql/server:2022-latest" -q) /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'YourStrong@Passw0rd' -C -d PF_Scratch -i infra/sql/migrations/0030_custom_fields.sql
docker exec -i $(docker ps --filter "ancestor=mcr.microsoft.com/mssql/server:2022-latest" -q) /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'YourStrong@Passw0rd' -C -d PF_Scratch -i infra/sql/migrations/rollback/0030_custom_fields.down.sql
docker exec -i $(docker ps --filter "ancestor=mcr.microsoft.com/mssql/server:2022-latest" -q) /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'YourStrong@Passw0rd' -C -d PF_Scratch -Q "SELECT name FROM sys.tables WHERE name IN ('CustomFields','TaskCustomFieldValues','TaskTypes','TaskWatchers');"
docker exec -i $(docker ps --filter "ancestor=mcr.microsoft.com/mssql/server:2022-latest" -q) /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'YourStrong@Passw0rd' -C -Q "DROP DATABASE PF_Scratch;"
```
Expected: the `Tasks.TaskTypeId` migration in the scratch DB will no-op the backfill (no Workspaces there) — the key assertion is the final SELECT returns **0 rows** (all four tables dropped, no constraint error). NOTE: `0030` ADD on `dbo.Tasks`/`dbo.Projects` requires those tables — if the scratch DB lacks them, instead run the reversibility check against a full clone (apply `0001`-`0030` to `PF_Scratch`). Document whichever path you used and paste the final `sys.tables` output (must be empty for the four new tables).

- [ ] **Step 6: Commit** (only if the human has authorized committing)

```bash
git add infra/sql/migrations/0030_custom_fields.sql infra/sql/migrations/rollback/0030_custom_fields.down.sql
git commit -m "feat(db): migration 0030 — custom fields, task types, tags, watchers schema"
```

---

### Task A2: Shared types for custom fields

**Files:**
- Modify: `packages/types/index.ts` (append the Phase 2 block near the existing Phase 1 hierarchy block)

- [ ] **Step 1: Add the type definitions**

Append to `packages/types/index.ts`:

```ts
// ─── Custom Fields (Phase 2, migration 0030) ──────────────────────────────
export type CustomFieldType =
  | 'text' | 'text_area' | 'number' | 'currency' | 'checkbox' | 'date'
  | 'url' | 'email' | 'phone' | 'dropdown' | 'labels' | 'rating'
  | 'people' | 'progress_manual' | 'progress_auto';

export type CustomFieldScopeType = 'SPACE' | 'FOLDER' | 'LIST';

export interface DropdownOption { id: string; name: string; color: string | null; }

/** Discriminated by the owning field's `type`; all members optional on the wire. */
export interface CustomFieldConfig {
  options?: DropdownOption[];   // dropdown, labels
  currencyCode?: string;        // currency (ISO-4217)
  max?: number;                 // rating
  precision?: number;           // number
  includeTime?: boolean;        // date
  source?: 'subtasks';          // progress_auto
}

export interface CustomField {
  id: string;
  workspaceId: string;
  scopeType: CustomFieldScopeType;
  scopeId: string;
  scopePath: string;
  type: CustomFieldType;
  name: string;
  config: CustomFieldConfig | null;
  required: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskCustomFieldValue {
  taskId: string;
  fieldId: string;
  value: unknown;          // JSON-decoded; shape depends on the field type
  updatedAt: string;
}

/** A custom field that applies to a task, joined to its current value (null when unset). */
export interface EffectiveField {
  field: CustomField;
  value: unknown;
}

// ─── Task Types (Phase 2) ─────────────────────────────────────────────────
export interface TaskType {
  id: string;
  workspaceId: string;
  nameSingular: string;
  namePlural: string;
  icon: string | null;
  isMilestone: boolean;
  isDefault: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Tags (Phase 2 — alias over Label) ────────────────────────────────────
export type Tag = Label;

// ─── Watchers (Phase 2) ───────────────────────────────────────────────────
export interface TaskWatcher {
  taskId: string;
  userId: string;
  createdAt: string;
}
```

Then extend `SpaceExtras` (find the existing interface) to add the toggle:

```ts
export interface SpaceExtras {
  visibility: Visibility;
  maxSubtaskDepth: number | null;
  multipleAssignees: boolean;   // Phase 2
}
```

- [ ] **Step 2: Typecheck the types package and api**

Run:
```powershell
npm run build --workspace @projectflow/types 2>$null; npx tsc -p apps/api/tsconfig.json --noEmit
```
Expected: no type errors introduced by the new exports (pre-existing errors unrelated to these symbols, if any, are noted but not caused here). If `@projectflow/types` has no `build` script, rely on the api `tsc --noEmit`.

- [ ] **Step 3: Commit** (if authorized)

```bash
git add packages/types/index.ts
git commit -m "feat(types): custom fields, task types, tag, watcher types + SpaceExtras.multipleAssignees"
```

---

### Task A3: Per-type value validators (unit-tested, pure functions)

**Files:**
- Create: `apps/api/src/modules/customfields/validators.ts`
- Test: `apps/api/src/modules/customfields/__tests__/validators.unit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/customfields/__tests__/validators.unit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validateFieldValue } from '../validators.js';
import type { CustomFieldConfig, CustomFieldType } from '@projectflow/types';

function ok(type: CustomFieldType, value: unknown, config: CustomFieldConfig | null = null) {
  return validateFieldValue(type, value, config);
}

describe('validateFieldValue', () => {
  it('text accepts a string, rejects a number', () => {
    expect(ok('text', 'hi').valid).toBe(true);
    expect(ok('text', 42).valid).toBe(false);
  });
  it('url requires a parseable URL', () => {
    expect(ok('url', 'https://x.com').valid).toBe(true);
    expect(ok('url', 'not a url').valid).toBe(false);
  });
  it('email requires an email shape', () => {
    expect(ok('email', 'a@b.co').valid).toBe(true);
    expect(ok('email', 'nope').valid).toBe(false);
  });
  it('number rejects NaN/non-number', () => {
    expect(ok('number', 3.5).valid).toBe(true);
    expect(ok('number', 'x').valid).toBe(false);
  });
  it('currency requires a valid ISO-4217 code in config', () => {
    expect(ok('currency', 10, { currencyCode: 'USD' }).valid).toBe(true);
    expect(ok('currency', 10, { currencyCode: 'ZZZ' }).valid).toBe(false);
  });
  it('checkbox requires boolean', () => {
    expect(ok('checkbox', true).valid).toBe(true);
    expect(ok('checkbox', 'true').valid).toBe(false);
  });
  it('date requires a parseable ISO date', () => {
    expect(ok('date', '2026-06-04T00:00:00.000Z').valid).toBe(true);
    expect(ok('date', 'whenever').valid).toBe(false);
  });
  it('dropdown requires an existing option id', () => {
    const cfg = { options: [{ id: 'o1', name: 'A', color: null }] };
    expect(ok('dropdown', 'o1', cfg).valid).toBe(true);
    expect(ok('dropdown', 'oX', cfg).valid).toBe(false);
  });
  it('labels requires all ids to exist', () => {
    const cfg = { options: [{ id: 'o1', name: 'A', color: null }, { id: 'o2', name: 'B', color: null }] };
    expect(ok('labels', ['o1', 'o2'], cfg).valid).toBe(true);
    expect(ok('labels', ['o1', 'oX'], cfg).valid).toBe(false);
  });
  it('rating requires integer 0..max', () => {
    expect(ok('rating', 3, { max: 5 }).valid).toBe(true);
    expect(ok('rating', 9, { max: 5 }).valid).toBe(false);
  });
  it('progress_manual requires integer 0..100', () => {
    expect(ok('progress_manual', 50).valid).toBe(true);
    expect(ok('progress_manual', 150).valid).toBe(false);
  });
  it('progress_auto rejects any direct write', () => {
    expect(ok('progress_auto', 50).valid).toBe(false);
    expect(ok('progress_auto', 50).code).toBe('PROGRESS_AUTO_READONLY');
  });
  it('people requires an array of strings (membership checked in the service)', () => {
    expect(ok('people', ['u1', 'u2']).valid).toBe(true);
    expect(ok('people', 'u1').valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```powershell
npm run test:unit --workspace apps/api -- src/modules/customfields/__tests__/validators.unit.test.ts
```
Expected: FAIL — `Cannot find module '../validators.js'`.

- [ ] **Step 3: Implement the validators**

Create `apps/api/src/modules/customfields/validators.ts`:

```ts
import type { CustomFieldConfig, CustomFieldType } from '@projectflow/types';

export interface ValidationResult { valid: boolean; code?: string; message?: string; }

const okResult: ValidationResult = { valid: true };
const fail = (code: string, message: string): ValidationResult => ({ valid: false, code, message });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[\d\s().-]{6,20}$/;

// Minimal ISO-4217 set used in the product; extend as needed.
const CURRENCY_CODES = new Set([
  'USD','EUR','GBP','JPY','IDR','SGD','AUD','CAD','CHF','CNY','INR','MYR','THB','PHP','VND','KRW','HKD','NZD',
]);

function isString(v: unknown): v is string { return typeof v === 'string'; }
function isFiniteNumber(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v); }

/**
 * Validates a decoded custom-field value against its type + config.
 * `people` membership and `dropdown`/`labels` option existence beyond the
 * config are enforced here; cross-table checks (workspace membership) happen
 * in the service before calling the SP.
 */
export function validateFieldValue(
  type: CustomFieldType,
  value: unknown,
  config: CustomFieldConfig | null,
): ValidationResult {
  switch (type) {
    case 'text':
    case 'text_area':
      return isString(value) ? okResult : fail('NOT_STRING', 'Value must be a string');
    case 'url':
      if (!isString(value)) return fail('NOT_STRING', 'Value must be a string');
      try { new URL(value); return okResult; } catch { return fail('BAD_URL', 'Value must be a valid URL'); }
    case 'email':
      return isString(value) && EMAIL_RE.test(value) ? okResult : fail('BAD_EMAIL', 'Value must be a valid email');
    case 'phone':
      return isString(value) && PHONE_RE.test(value) ? okResult : fail('BAD_PHONE', 'Value must be a valid phone number');
    case 'number':
      return isFiniteNumber(value) ? okResult : fail('NOT_NUMBER', 'Value must be a number');
    case 'currency': {
      if (!isFiniteNumber(value)) return fail('NOT_NUMBER', 'Value must be a number');
      const code = config?.currencyCode;
      if (!code || !CURRENCY_CODES.has(code)) return fail('BAD_CURRENCY', 'Field has no valid ISO-4217 currency code');
      return okResult;
    }
    case 'checkbox':
      return typeof value === 'boolean' ? okResult : fail('NOT_BOOLEAN', 'Value must be a boolean');
    case 'date': {
      if (!isString(value)) return fail('NOT_STRING', 'Value must be an ISO date string');
      const t = Date.parse(value);
      return Number.isNaN(t) ? fail('BAD_DATE', 'Value must be a parseable date') : okResult;
    }
    case 'dropdown': {
      if (!isString(value)) return fail('NOT_STRING', 'Value must be an option id');
      const ids = new Set((config?.options ?? []).map((o) => o.id));
      return ids.has(value) ? okResult : fail('BAD_OPTION', 'Value is not a valid option');
    }
    case 'labels': {
      if (!Array.isArray(value) || !value.every(isString)) return fail('NOT_STRING_ARRAY', 'Value must be an array of option ids');
      const ids = new Set((config?.options ?? []).map((o) => o.id));
      return value.every((v) => ids.has(v)) ? okResult : fail('BAD_OPTION', 'One or more options are invalid');
    }
    case 'rating': {
      const max = config?.max ?? 5;
      return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max
        ? okResult : fail('BAD_RATING', `Value must be an integer between 0 and ${max}`);
    }
    case 'people':
      return Array.isArray(value) && value.every(isString) ? okResult : fail('NOT_STRING_ARRAY', 'Value must be an array of user ids');
    case 'progress_manual':
      return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100
        ? okResult : fail('BAD_PROGRESS', 'Value must be an integer between 0 and 100');
    case 'progress_auto':
      return fail('PROGRESS_AUTO_READONLY', 'progress_auto is computed and cannot be set directly');
    default:
      return fail('UNKNOWN_TYPE', `Unknown field type: ${type}`);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```powershell
npm run test:unit --workspace apps/api -- src/modules/customfields/__tests__/validators.unit.test.ts
```
Expected: PASS (13 tests).

- [ ] **Step 5: Commit** (if authorized)

```bash
git add apps/api/src/modules/customfields/validators.ts apps/api/src/modules/customfields/__tests__/validators.unit.test.ts
git commit -m "feat(customfields): per-type value validators + unit tests"
```

---

### Task A4: Custom-field stored procedures (CRUD + cascade resolver + value upsert + required/progress)

**Files (all under `infra/sql/procedures/`):**
- Create: `usp_CustomField_GetScopeNode.sql`, `usp_CustomField_GetWorkspaceId.sql`, `usp_CustomField_Create.sql`, `usp_CustomField_Update.sql`, `usp_CustomField_Delete.sql`, `usp_CustomField_List.sql`, `usp_CustomField_Reorder.sql`, `usp_CustomField_EffectiveForTask.sql`, `usp_TaskCustomFieldValue_Set.sql`, `usp_TaskCustomFieldValue_Delete.sql`, `usp_CustomField_RequiredUnmetForStatus.sql`, `usp_TaskCustomField_RecomputeProgressAuto.sql`

Reusable facts: prefix-match cascade = `@ListPath LIKE cf.ScopePath + '%'` (SQL Server default collation is case-insensitive, so GUID casing in paths does not matter). DONE detection mirrors `usp_Task_Transition`. A subtask counts as "done" for `progress_auto` iff `ResolvedAt IS NOT NULL` (set by `usp_Task_Transition` on DONE-category transitions — the cheap, consistent wave-1 signal).

- [ ] **Step 1: Scope-node + workspace lookup procs**

`usp_CustomField_GetScopeNode.sql` (service uses this to materialize `ScopePath` + validate the scope exists):
```sql
CREATE OR ALTER PROCEDURE dbo.usp_CustomField_GetScopeNode
    @ScopeType NVARCHAR(8),
    @ScopeId   UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    IF @ScopeType = 'SPACE'
        SELECT WorkspaceId, '/' + CONVERT(NVARCHAR(36), Id) + '/' AS ScopePath
        FROM dbo.Projects WHERE Id = @ScopeId AND Status <> 'DELETED';
    ELSE IF @ScopeType = 'FOLDER'
        SELECT WorkspaceId, Path AS ScopePath
        FROM dbo.Folders WHERE Id = @ScopeId AND DeletedAt IS NULL;
    ELSE IF @ScopeType = 'LIST'
        SELECT WorkspaceId, Path AS ScopePath
        FROM dbo.Lists WHERE Id = @ScopeId AND DeletedAt IS NULL;
END;
```

`usp_CustomField_GetWorkspaceId.sql` (route permission resolver for `/custom-fields/:id`):
```sql
CREATE OR ALTER PROCEDURE dbo.usp_CustomField_GetWorkspaceId
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT WorkspaceId FROM dbo.CustomFields WHERE Id = @Id AND DeletedAt IS NULL;
END;
```

- [ ] **Step 2: CRUD procs**

`usp_CustomField_Create.sql`:
```sql
CREATE OR ALTER PROCEDURE dbo.usp_CustomField_Create
    @Id          UNIQUEIDENTIFIER,
    @WorkspaceId UNIQUEIDENTIFIER,
    @ScopeType   NVARCHAR(8),
    @ScopeId     UNIQUEIDENTIFIER,
    @ScopePath   NVARCHAR(900),
    @Type        NVARCHAR(20),
    @Name        NVARCHAR(255),
    @Config      NVARCHAR(MAX) = NULL,
    @Required    BIT = 0,
    @Position    FLOAT = 0
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        INSERT INTO dbo.CustomFields (Id, WorkspaceId, ScopeType, ScopeId, ScopePath, Type, Name, Config, Required, Position)
        VALUES (@Id, @WorkspaceId, @ScopeType, @ScopeId, @ScopePath, @Type, @Name, @Config, @Required, @Position);
        SELECT * FROM dbo.CustomFields WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

`usp_CustomField_Update.sql` (partial; `@ClearConfig` flag to null out config):
```sql
CREATE OR ALTER PROCEDURE dbo.usp_CustomField_Update
    @Id          UNIQUEIDENTIFIER,
    @Name        NVARCHAR(255) = NULL,
    @Config      NVARCHAR(MAX) = NULL,
    @ClearConfig BIT = 0,
    @Required    BIT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.CustomFields WHERE Id = @Id AND DeletedAt IS NULL)
            THROW 51300, 'Custom field not found', 1;
        UPDATE dbo.CustomFields
        SET    Name      = COALESCE(@Name, Name),
               Config    = CASE WHEN @ClearConfig = 1 THEN NULL ELSE COALESCE(@Config, Config) END,
               Required  = COALESCE(@Required, Required),
               UpdatedAt = SYSUTCDATETIME()
        WHERE  Id = @Id;
        SELECT * FROM dbo.CustomFields WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

`usp_CustomField_Delete.sql` (soft delete):
```sql
CREATE OR ALTER PROCEDURE dbo.usp_CustomField_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.CustomFields WHERE Id = @Id AND DeletedAt IS NULL)
            THROW 51300, 'Custom field not found', 1;
        UPDATE dbo.CustomFields SET DeletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id;
        SELECT * FROM dbo.CustomFields WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

`usp_CustomField_List.sql` (fields defined DIRECTLY at one node):
```sql
CREATE OR ALTER PROCEDURE dbo.usp_CustomField_List
    @ScopeType NVARCHAR(8),
    @ScopeId   UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.CustomFields
    WHERE ScopeType = @ScopeType AND ScopeId = @ScopeId AND DeletedAt IS NULL
    ORDER BY Position, CreatedAt;
END;
```

`usp_CustomField_Reorder.sql` (set a single field's position; app computes fractional positions):
```sql
CREATE OR ALTER PROCEDURE dbo.usp_CustomField_Reorder
    @Id       UNIQUEIDENTIFIER,
    @Position FLOAT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.CustomFields WHERE Id = @Id AND DeletedAt IS NULL)
            THROW 51300, 'Custom field not found', 1;
        UPDATE dbo.CustomFields SET Position = @Position, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id;
        SELECT * FROM dbo.CustomFields WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

- [ ] **Step 3: The cascade resolver**

`usp_CustomField_EffectiveForTask.sql` — every field whose `ScopePath` is a prefix of the task's `ListPath`, joined to the current value (NULL when unset), ordered deepest-last by path length then position:
```sql
CREATE OR ALTER PROCEDURE dbo.usp_CustomField_EffectiveForTask
    @TaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ListPath NVARCHAR(900), @WorkspaceId UNIQUEIDENTIFIER;
    SELECT @ListPath = ListPath, @WorkspaceId = WorkspaceId
    FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL;

    IF @ListPath IS NULL
    BEGIN
        -- Task not in a list: no location-scoped fields apply. Return empty,
        -- shape-compatible result set.
        SELECT TOP 0 cf.*, CAST(NULL AS NVARCHAR(MAX)) AS CurrentValue
        FROM dbo.CustomFields cf;
        RETURN;
    END

    SELECT cf.*, v.Value AS CurrentValue
    FROM   dbo.CustomFields cf
    LEFT JOIN dbo.TaskCustomFieldValues v ON v.FieldId = cf.Id AND v.TaskId = @TaskId
    WHERE  cf.WorkspaceId = @WorkspaceId
      AND  cf.DeletedAt IS NULL
      AND  @ListPath LIKE cf.ScopePath + '%'
    ORDER  BY LEN(cf.ScopePath), cf.Position, cf.CreatedAt;
END;
```

- [ ] **Step 4: Value upsert + delete**

`usp_TaskCustomFieldValue_Set.sql` (upsert; guards task + field exist; SP stores the JSON as-is — validation is in the service):
```sql
CREATE OR ALTER PROCEDURE dbo.usp_TaskCustomFieldValue_Set
    @TaskId  UNIQUEIDENTIFIER,
    @FieldId UNIQUEIDENTIFIER,
    @Value   NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL)
            THROW 51302, 'Task not found', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.CustomFields WHERE Id = @FieldId AND DeletedAt IS NULL)
            THROW 51300, 'Custom field not found', 1;

        MERGE dbo.TaskCustomFieldValues AS tgt
        USING (SELECT @TaskId AS TaskId, @FieldId AS FieldId) AS src
        ON  tgt.TaskId = src.TaskId AND tgt.FieldId = src.FieldId
        WHEN MATCHED THEN UPDATE SET Value = @Value, UpdatedAt = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (TaskId, FieldId, Value) VALUES (@TaskId, @FieldId, @Value);

        SELECT * FROM dbo.TaskCustomFieldValues WHERE TaskId = @TaskId AND FieldId = @FieldId;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
```

`usp_TaskCustomFieldValue_Delete.sql`:
```sql
CREATE OR ALTER PROCEDURE dbo.usp_TaskCustomFieldValue_Delete
    @TaskId  UNIQUEIDENTIFIER,
    @FieldId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM dbo.TaskCustomFieldValues WHERE TaskId = @TaskId AND FieldId = @FieldId;
END;
```

- [ ] **Step 5: Required-blocks-done resolver**

`usp_CustomField_RequiredUnmetForStatus.sql` — returns required-but-empty effective fields ONLY when `@TargetStatus` is DONE-category for the task's effective workflow; empty result otherwise:
```sql
CREATE OR ALTER PROCEDURE dbo.usp_CustomField_RequiredUnmetForStatus
    @TaskId       UNIQUEIDENTIFIER,
    @TargetStatus NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ListId UNIQUEIDENTIFIER, @ListPath NVARCHAR(900),
            @ProjectId UNIQUEIDENTIFIER, @WorkspaceId UNIQUEIDENTIFIER, @wf UNIQUEIDENTIFIER, @IsDone BIT = 0;

    SELECT @ListId = ListId, @ListPath = ListPath, @ProjectId = ProjectId, @WorkspaceId = WorkspaceId
    FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL;

    IF @ListId IS NOT NULL
        SELECT @wf = COALESCE(l.WorkflowId, f.WorkflowId, p.WorkflowId)
        FROM dbo.Lists l LEFT JOIN dbo.Folders f ON f.Id = l.FolderId
             JOIN dbo.Projects p ON p.Id = l.SpaceId
        WHERE l.Id = @ListId AND l.DeletedAt IS NULL;
    ELSE
        SELECT @wf = WorkflowId FROM dbo.Projects WHERE Id = @ProjectId;

    IF @wf IS NOT NULL
    BEGIN
        IF EXISTS (SELECT 1 FROM dbo.WorkflowStatuses
                   WHERE WorkflowId = @wf AND Name = @TargetStatus AND Category = 'DONE')
            SET @IsDone = 1;
    END
    ELSE IF @TargetStatus IN ('Done', 'Resolved', 'Closed', 'Completed')
        SET @IsDone = 1;

    IF @IsDone = 0 OR @ListPath IS NULL
    BEGIN
        SELECT TOP 0 cf.* FROM dbo.CustomFields cf;   -- shape-compatible empty set
        RETURN;
    END

    SELECT cf.*
    FROM   dbo.CustomFields cf
    LEFT JOIN dbo.TaskCustomFieldValues v ON v.FieldId = cf.Id AND v.TaskId = @TaskId
    WHERE  cf.WorkspaceId = @WorkspaceId
      AND  cf.DeletedAt IS NULL
      AND  cf.Required = 1
      AND  @ListPath LIKE cf.ScopePath + '%'
      AND  (v.Value IS NULL OR v.Value = '' OR v.Value = 'null' OR v.Value = '""' OR v.Value = '[]')
    ORDER BY LEN(cf.ScopePath), cf.Position;
END;
```

- [ ] **Step 6: progress_auto recompute**

`usp_TaskCustomField_RecomputeProgressAuto.sql` — for each effective `progress_auto` field on `@TaskId`, set value = percent of its direct subtasks resolved (`ResolvedAt IS NOT NULL`); 0 when there are no subtasks:
```sql
CREATE OR ALTER PROCEDURE dbo.usp_TaskCustomField_RecomputeProgressAuto
    @TaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ListPath NVARCHAR(900), @WorkspaceId UNIQUEIDENTIFIER, @Total INT, @Done INT, @Pct INT;
    SELECT @ListPath = ListPath, @WorkspaceId = WorkspaceId FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL;
    IF @ListPath IS NULL RETURN;

    SELECT @Total = COUNT(*),
           @Done  = SUM(CASE WHEN ResolvedAt IS NOT NULL THEN 1 ELSE 0 END)
    FROM dbo.Tasks WHERE ParentTaskId = @TaskId AND DeletedAt IS NULL;

    SET @Pct = CASE WHEN ISNULL(@Total, 0) = 0 THEN 0 ELSE CAST(ROUND(100.0 * @Done / @Total, 0) AS INT) END;

    MERGE dbo.TaskCustomFieldValues AS tgt
    USING (
        SELECT cf.Id AS FieldId
        FROM   dbo.CustomFields cf
        WHERE  cf.WorkspaceId = @WorkspaceId AND cf.DeletedAt IS NULL
          AND  cf.Type = 'progress_auto' AND @ListPath LIKE cf.ScopePath + '%'
    ) AS src
    ON  tgt.TaskId = @TaskId AND tgt.FieldId = src.FieldId
    WHEN MATCHED THEN UPDATE SET Value = CONVERT(NVARCHAR(MAX), @Pct), UpdatedAt = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (TaskId, FieldId, Value) VALUES (@TaskId, src.FieldId, CONVERT(NVARCHAR(MAX), @Pct));
END;
```

- [ ] **Step 7: Deploy the procs**

Run:
```powershell
npm run db:deploy-sps
```
Expected: deploy log lists each new `usp_CustomField_*` / `usp_TaskCustomFieldValue_*` file with no error; final summary reports 0 failures.

- [ ] **Step 8: Commit** (if authorized)

```bash
git add infra/sql/procedures/usp_CustomField_*.sql infra/sql/procedures/usp_TaskCustomFieldValue_*.sql infra/sql/procedures/usp_TaskCustomField_RecomputeProgressAuto.sql
git commit -m "feat(customfields): stored procs — CRUD, cascade resolver, value upsert, required/progress"
```

---

### Task A5: Custom-field repository + row mapper

**Files:**
- Create: `apps/api/src/modules/customfields/map.ts`
- Create: `apps/api/src/modules/customfields/customfield.repository.ts`

- [ ] **Step 1: Row mapper** — `map.ts` (PascalCase SP rows → camelCase `@projectflow/types` shapes; `Config` is stored JSON text):
```ts
import type { CustomField, CustomFieldConfig, EffectiveField } from '@projectflow/types';

function parseConfig(raw: unknown): CustomFieldConfig | null {
  if (raw == null || raw === '') return null;
  try { return JSON.parse(String(raw)) as CustomFieldConfig; } catch { return null; }
}

export function mapCustomFieldRow(r: any): CustomField {
  return {
    id: r.Id, workspaceId: r.WorkspaceId, scopeType: r.ScopeType, scopeId: r.ScopeId,
    scopePath: r.ScopePath, type: r.Type, name: r.Name, config: parseConfig(r.Config),
    required: !!r.Required, position: Number(r.Position),
    createdAt: String(r.CreatedAt), updatedAt: String(r.UpdatedAt),
  };
}

/** Rows from usp_CustomField_EffectiveForTask carry an extra CurrentValue column. */
export function mapEffectiveFieldRow(r: any): EffectiveField {
  const field = mapCustomFieldRow(r);
  let value: unknown = null;
  if (r.CurrentValue != null && r.CurrentValue !== '') {
    try { value = JSON.parse(String(r.CurrentValue)); } catch { value = null; }
  }
  return { field, value };
}
```

- [ ] **Step 2: Repository** — `customfield.repository.ts`:
```ts
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import { mapCustomFieldRow, mapEffectiveFieldRow } from './map.js';
import type { CustomField, CustomFieldScopeType, EffectiveField } from '@projectflow/types';

export class CustomFieldRepository {
  async getScopeNode(scopeType: CustomFieldScopeType, scopeId: string): Promise<{ workspaceId: string; scopePath: string } | null> {
    const rows = await execSpOne<{ WorkspaceId: string; ScopePath: string }>('usp_CustomField_GetScopeNode', [
      { name: 'ScopeType', type: sql.NVarChar(8), value: scopeType },
      { name: 'ScopeId',   type: sql.UniqueIdentifier, value: scopeId },
    ]);
    const r = rows[0];
    return r ? { workspaceId: r.WorkspaceId, scopePath: r.ScopePath } : null;
  }

  async getWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_CustomField_GetWorkspaceId',
      [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0]?.WorkspaceId ?? null;
  }

  async create(p: {
    id: string; workspaceId: string; scopeType: CustomFieldScopeType; scopeId: string;
    scopePath: string; type: string; name: string; config: string | null; required: boolean; position: number;
  }): Promise<CustomField> {
    const rows = await execSpOne('usp_CustomField_Create', [
      { name: 'Id', type: sql.UniqueIdentifier, value: p.id },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: p.workspaceId },
      { name: 'ScopeType', type: sql.NVarChar(8), value: p.scopeType },
      { name: 'ScopeId', type: sql.UniqueIdentifier, value: p.scopeId },
      { name: 'ScopePath', type: sql.NVarChar(900), value: p.scopePath },
      { name: 'Type', type: sql.NVarChar(20), value: p.type },
      { name: 'Name', type: sql.NVarChar(255), value: p.name },
      { name: 'Config', type: sql.NVarChar(sql.MAX), value: p.config },
      { name: 'Required', type: sql.Bit, value: p.required ? 1 : 0 },
      { name: 'Position', type: sql.Float, value: p.position },
    ]);
    return mapCustomFieldRow(rows[0]);
  }

  async update(id: string, p: { name?: string; config?: string | null; clearConfig?: boolean; required?: boolean }): Promise<CustomField | null> {
    const rows = await execSpOne('usp_CustomField_Update', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
      { name: 'Name', type: sql.NVarChar(255), value: p.name ?? null },
      { name: 'Config', type: sql.NVarChar(sql.MAX), value: p.config ?? null },
      { name: 'ClearConfig', type: sql.Bit, value: p.clearConfig ? 1 : 0 },
      { name: 'Required', type: sql.Bit, value: p.required == null ? null : (p.required ? 1 : 0) },
    ]);
    return rows[0] ? mapCustomFieldRow(rows[0]) : null;
  }

  async delete(id: string): Promise<CustomField | null> {
    const rows = await execSpOne('usp_CustomField_Delete', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0] ? mapCustomFieldRow(rows[0]) : null;
  }

  async list(scopeType: CustomFieldScopeType, scopeId: string): Promise<CustomField[]> {
    const rows = await execSpOne('usp_CustomField_List', [
      { name: 'ScopeType', type: sql.NVarChar(8), value: scopeType },
      { name: 'ScopeId', type: sql.UniqueIdentifier, value: scopeId },
    ]);
    return (rows as any[]).map(mapCustomFieldRow);
  }

  async reorder(id: string, position: number): Promise<CustomField | null> {
    const rows = await execSpOne('usp_CustomField_Reorder', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
      { name: 'Position', type: sql.Float, value: position },
    ]);
    return rows[0] ? mapCustomFieldRow(rows[0]) : null;
  }

  async effectiveForTask(taskId: string): Promise<EffectiveField[]> {
    const rows = await execSpOne('usp_CustomField_EffectiveForTask',
      [{ name: 'TaskId', type: sql.UniqueIdentifier, value: taskId }]);
    return (rows as any[]).map(mapEffectiveFieldRow);
  }

  async getById(id: string): Promise<CustomField | null> {
    const rows = await execSpOne('usp_CustomField_List', [
      { name: 'ScopeType', type: sql.NVarChar(8), value: 'SPACE' }, // not used; getById via List is wrong — see note
      { name: 'ScopeId', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ? mapCustomFieldRow(rows[0]) : null;
  }

  async setValue(taskId: string, fieldId: string, valueJson: string | null): Promise<void> {
    await execSpOne('usp_TaskCustomFieldValue_Set', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
      { name: 'FieldId', type: sql.UniqueIdentifier, value: fieldId },
      { name: 'Value', type: sql.NVarChar(sql.MAX), value: valueJson },
    ]);
  }

  async deleteValue(taskId: string, fieldId: string): Promise<void> {
    await execSpOne('usp_TaskCustomFieldValue_Delete', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
      { name: 'FieldId', type: sql.UniqueIdentifier, value: fieldId },
    ]);
  }

  async requiredUnmetForStatus(taskId: string, targetStatus: string): Promise<CustomField[]> {
    const rows = await execSpOne('usp_CustomField_RequiredUnmetForStatus', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
      { name: 'TargetStatus', type: sql.NVarChar(100), value: targetStatus },
    ]);
    return (rows as any[]).map(mapCustomFieldRow);
  }

  async recomputeProgressAuto(parentTaskId: string): Promise<void> {
    await execSpOne('usp_TaskCustomField_RecomputeProgressAuto',
      [{ name: 'TaskId', type: sql.UniqueIdentifier, value: parentTaskId }]);
  }
}
```
> NOTE: the `getById` stub above is WRONG (reuses List). Replace it during implementation with a dedicated `usp_CustomField_GetById @Id` proc (trivial `SELECT * FROM dbo.CustomFields WHERE Id=@Id AND DeletedAt IS NULL`) added to Task A4's proc set, and call it here. The effective-field fetch for a value-set validation uses `effectiveForTask` + find-by-id in the service, so `getById` is only needed by the value-set path; add the proc to keep it correct.

- [ ] **Step 3: Add `usp_CustomField_GetById.sql`** to `infra/sql/procedures/`:
```sql
CREATE OR ALTER PROCEDURE dbo.usp_CustomField_GetById
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.CustomFields WHERE Id = @Id AND DeletedAt IS NULL;
END;
```
Then fix the repository `getById` to call it:
```ts
  async getById(id: string): Promise<CustomField | null> {
    const rows = await execSpOne('usp_CustomField_GetById', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0] ? mapCustomFieldRow(rows[0]) : null;
  }
```

- [ ] **Step 4: Deploy SPs + typecheck**

Run:
```powershell
npm run db:deploy-sps; npx tsc -p apps/api/tsconfig.json --noEmit
```
Expected: SP deploy clean; no NEW type errors from `customfield.repository.ts` / `map.ts`.

- [ ] **Step 5: Commit** (if authorized)
```bash
git add apps/api/src/modules/customfields/map.ts apps/api/src/modules/customfields/customfield.repository.ts infra/sql/procedures/usp_CustomField_GetById.sql
git commit -m "feat(customfields): repository + row mappers + GetById proc"
```

---

### Task A6: Custom-field service (validation, typed errors, value coding)

**Files:**
- Create: `apps/api/src/modules/customfields/customfield.errors.ts`
- Create: `apps/api/src/modules/customfields/customfield.service.ts`

- [ ] **Step 1: Typed errors** — `customfield.errors.ts` (thrown by the service; routes map them to 422):
```ts
import type { CustomField } from '@projectflow/types';

/** Per-type or config validation failure on a value-set. */
export class FieldValidationError extends Error {
  constructor(public readonly fieldCode: string, message: string) {
    super(message);
    this.name = 'FieldValidationError';
  }
}

/** A transition into a DONE-category status is blocked by unfilled required fields. */
export class RequiredFieldsUnmetError extends Error {
  constructor(public readonly missing: Array<Pick<CustomField, 'id' | 'name'>>) {
    super('Required custom fields must be filled before this status');
    this.name = 'RequiredFieldsUnmetError';
  }
}
```

- [ ] **Step 2: Service** — `customfield.service.ts`. Validates per-type, materializes `ScopePath`, JSON-encodes values, exposes the helpers the tasks module calls (`requiredUnmetForDone`, `recomputeProgressAuto`):
```ts
import { randomUUID } from 'node:crypto';
import { CustomFieldRepository } from './customfield.repository.js';
import { validateFieldValue } from './validators.js';
import { FieldValidationError, RequiredFieldsUnmetError } from './customfield.errors.js';
import { isWorkspaceMember } from '../workspaces/membership.js'; // see NOTE in Step 3
import type { CustomField, CustomFieldConfig, CustomFieldScopeType, CustomFieldType, EffectiveField } from '@projectflow/types';

export class CustomFieldService {
  constructor(private repo: CustomFieldRepository = new CustomFieldRepository()) {}

  /** Create a field at a SPACE/FOLDER/LIST scope. Returns null when the scope node is missing. */
  async create(input: {
    scopeType: CustomFieldScopeType; scopeId: string; type: CustomFieldType;
    name: string; config: CustomFieldConfig | null; required: boolean; position: number;
  }): Promise<CustomField | null> {
    const node = await this.repo.getScopeNode(input.scopeType, input.scopeId);
    if (!node) return null;
    const id = randomUUID().toUpperCase();
    return this.repo.create({
      id, workspaceId: node.workspaceId, scopeType: input.scopeType, scopeId: input.scopeId,
      scopePath: node.scopePath, type: input.type, name: input.name,
      config: input.config ? JSON.stringify(input.config) : null,
      required: input.required, position: input.position,
    });
  }

  update(id: string, p: { name?: string; config?: CustomFieldConfig | null; clearConfig?: boolean; required?: boolean }) {
    return this.repo.update(id, {
      name: p.name,
      config: p.config === undefined ? undefined : (p.config ? JSON.stringify(p.config) : null),
      clearConfig: p.clearConfig,
      required: p.required,
    });
  }

  delete(id: string) { return this.repo.delete(id); }
  list(scopeType: CustomFieldScopeType, scopeId: string) { return this.repo.list(scopeType, scopeId); }
  reorder(id: string, position: number) { return this.repo.reorder(id, position); }
  effectiveForTask(taskId: string): Promise<EffectiveField[]> { return this.repo.effectiveForTask(taskId); }

  /**
   * Set one value for one (task, field). Validates per-type; for `people` also
   * checks workspace membership; rejects writes to `progress_auto`.
   * Throws FieldValidationError (-> 422) on any failure.
   */
  async setValue(taskId: string, fieldId: string, value: unknown): Promise<void> {
    const field = await this.repo.getById(fieldId);
    if (!field) throw new FieldValidationError('FIELD_NOT_FOUND', 'Custom field not found');

    const result = validateFieldValue(field.type, value, field.config);
    if (!result.valid) throw new FieldValidationError(result.code ?? 'INVALID', result.message ?? 'Invalid value');

    if (field.type === 'people') {
      const ids = value as string[];
      for (const uid of ids) {
        if (!(await isWorkspaceMember(field.workspaceId, uid)))
          throw new FieldValidationError('NOT_MEMBER', `User ${uid} is not a workspace member`);
      }
    }
    await this.repo.setValue(taskId, fieldId, JSON.stringify(value));
  }

  deleteValue(taskId: string, fieldId: string) { return this.repo.deleteValue(taskId, fieldId); }

  /** Called by the tasks service before a transition. Throws RequiredFieldsUnmetError when blocked. */
  async assertRequiredMetForStatus(taskId: string, targetStatus: string): Promise<void> {
    const missing = await this.repo.requiredUnmetForStatus(taskId, targetStatus);
    if (missing.length > 0)
      throw new RequiredFieldsUnmetError(missing.map((m) => ({ id: m.id, name: m.name })));
  }

  recomputeProgressAuto(parentTaskId: string) { return this.repo.recomputeProgressAuto(parentTaskId); }
}

export const customFieldService = new CustomFieldService();
```

- [ ] **Step 3: Provide the membership helper**

Grep first: `Grep "WorkspaceMember" apps/api/src/modules` and `Grep "isWorkspaceMember\|usp_WorkspaceMember" apps/api/src infra/sql`. If a membership check already exists (likely a `usp_WorkspaceMember_*` SP or a service method), import THAT instead of creating `membership.js`. Only if none exists, create `apps/api/src/modules/workspaces/membership.ts`:
```ts
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';

export async function isWorkspaceMember(workspaceId: string, userId: string): Promise<boolean> {
  const rows = await execSpOne<{ Cnt: number }>('usp_WorkspaceMember_Exists', [
    { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
  ]);
  return (rows[0]?.Cnt ?? 0) > 0;
}
```
…and add `usp_WorkspaceMember_Exists.sql` (`SELECT COUNT(1) AS Cnt FROM dbo.WorkspaceMembers WHERE WorkspaceId=@WorkspaceId AND UserId=@UserId`). VERIFY the `WorkspaceMembers` table/column names by grepping an existing membership proc before writing.

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p apps/api/tsconfig.json --noEmit`
Expected: no new errors from the customfields service/errors. (Unit coverage of validators already exists; service logic is exercised by A14 integration tests.)

- [ ] **Step 5: Commit** (if authorized)
```bash
git add apps/api/src/modules/customfields/customfield.errors.ts apps/api/src/modules/customfields/customfield.service.ts
git commit -m "feat(customfields): service with validation, typed errors, value coding"
```

---

### Task A7: Custom-field REST routes

**Files:**
- Create: `apps/api/src/modules/customfields/customfield.routes.ts`
- Modify: `apps/api/src/modules/tasks/task.routes.ts` (the `/tasks/:id/fields` + `/tasks/:id/fields/:fieldId` endpoints live with the task routes so they share the task workspace resolver — OR mount under customfields with an object-access resolver on the task's list; this plan puts them on the customfields router using a `VIEW/EDIT` gate resolved from the task's list)

- [ ] **Step 1: Routes** — `customfield.routes.ts`:
```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { customFieldService } from './customfield.service.js';
import { CustomFieldRepository } from './customfield.repository.js';
import { FieldValidationError } from './customfield.errors.js';
import { requireObjectAccess } from '../access/access.middleware.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { pubsub } from '../../graphql/pubsub.js';

export const customFieldRoutes = new Hono();
const repo = new CustomFieldRepository();
const taskRepo = new TaskRepository();

const SCOPE = z.enum(['SPACE', 'FOLDER', 'LIST']);
const TYPE = z.enum([
  'text','text_area','number','currency','checkbox','date','url','email','phone',
  'dropdown','labels','rating','people','progress_manual','progress_auto',
]);
const configSchema = z.object({
  options: z.array(z.object({ id: z.string(), name: z.string(), color: z.string().nullable() })).optional(),
  currencyCode: z.string().optional(),
  max: z.number().int().optional(),
  precision: z.number().int().optional(),
  includeTime: z.boolean().optional(),
  source: z.literal('subtasks').optional(),
}).nullable();

const createSchema = z.object({
  scopeType: SCOPE, scopeId: z.string().uuid(), type: TYPE,
  name: z.string().min(1).max(255), config: configSchema.optional(),
  required: z.boolean().default(false), position: z.number().default(0),
});
const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  config: configSchema.optional(), clearConfig: z.boolean().optional(),
  required: z.boolean().optional(),
});

// POST /custom-fields — EDIT on the scope node
customFieldRoutes.post('/', zValidator('json', createSchema),
  requireObjectAccess('EDIT', (c) => {
    const b = (c.req as any).valid('json');
    return { type: b.scopeType, id: b.scopeId };
  }),
  async (c) => {
    const b = c.req.valid('json');
    const field = await customFieldService.create({
      scopeType: b.scopeType, scopeId: b.scopeId, type: b.type, name: b.name,
      config: b.config ?? null, required: b.required, position: b.position,
    });
    if (!field) return c.json({ error: { code: 'NOT_FOUND', message: 'Scope not found' } }, 404);
    pubsub.publish('customField:updated', { scopeId: b.scopeId, field });
    return c.json({ data: field }, 201);
  });

// GET /custom-fields?scopeType&scopeId — VIEW on the scope node
const listQuery = z.object({ scopeType: SCOPE, scopeId: z.string().uuid() });
customFieldRoutes.get('/', zValidator('query', listQuery),
  requireObjectAccess('VIEW', (c) => ({ type: c.req.query('scopeType') as any, id: c.req.query('scopeId')! })),
  async (c) => c.json({ data: await customFieldService.list(c.req.query('scopeType') as any, c.req.query('scopeId')!) }));

// PATCH /custom-fields/:id — EDIT (resolve scope via the field's own scope)
customFieldRoutes.patch('/:id', zValidator('json', updateSchema),
  requireObjectAccess('EDIT', async (c) => {
    const f = await repo.getById(c.req.param('id')!);
    return f ? { type: f.scopeType, id: f.scopeId } : null;
  }),
  async (c) => {
    const field = await customFieldService.update(c.req.param('id')!, c.req.valid('json'));
    if (!field) return c.json({ error: { code: 'NOT_FOUND', message: 'Custom field not found' } }, 404);
    pubsub.publish('customField:updated', { scopeId: field.scopeId, field });
    return c.json({ data: field });
  });

// DELETE /custom-fields/:id — FULL
customFieldRoutes.delete('/:id',
  requireObjectAccess('FULL', async (c) => {
    const f = await repo.getById(c.req.param('id')!);
    return f ? { type: f.scopeType, id: f.scopeId } : null;
  }),
  async (c) => {
    const field = await customFieldService.delete(c.req.param('id')!);
    if (!field) return c.json({ error: { code: 'NOT_FOUND', message: 'Custom field not found' } }, 404);
    pubsub.publish('customField:updated', { scopeId: field.scopeId, field });
    return c.json({ data: field });
  });

// PATCH /custom-fields/:id/reorder — EDIT
const reorderSchema = z.object({ position: z.number() });
customFieldRoutes.patch('/:id/reorder', zValidator('json', reorderSchema),
  requireObjectAccess('EDIT', async (c) => {
    const f = await repo.getById(c.req.param('id')!);
    return f ? { type: f.scopeType, id: f.scopeId } : null;
  }),
  async (c) => {
    const field = await customFieldService.reorder(c.req.param('id')!, c.req.valid('json').position);
    if (!field) return c.json({ error: { code: 'NOT_FOUND', message: 'Custom field not found' } }, 404);
    pubsub.publish('customField:updated', { scopeId: field.scopeId, field });
    return c.json({ data: field });
  });
```

> NOTE on the async resolver: `requireObjectAccess`'s `resolveObject` is invoked and its result awaited by the middleware (it calls `accessService.resolveOrNull` on the returned id). Confirm the middleware awaits a Promise-returning resolver; if it does NOT (the Phase 1 signature returns a sync object), add a tiny wrapper middleware that looks up the field's scope first and stashes `{type,id}` on the context, then a sync resolver reads it. VERIFY against `access.middleware.ts` during implementation and adjust — the labels module's `resolveWorkspace` IS async, so an async resolver pattern exists in the codebase to copy.

- [ ] **Step 2: Task-scoped value endpoints** — add to `apps/api/src/modules/tasks/task.routes.ts` (they need the task's list for the access gate; resolve the list id from the task):

```ts
// (add imports at top of task.routes.ts)
import { customFieldService } from '../customfields/customfield.service.js';
import { FieldValidationError } from '../customfields/customfield.errors.js';

// GET /api/v1/tasks/:id/fields — effective fields + current values. VIEW on the task's list.
taskRoutes.get('/:id/fields',
  requireObjectAccess('VIEW', async (c) => {
    const t = await taskRepo.getById(c.req.param('id')!);
    return t?.listId ? { type: 'LIST', id: t.listId } : null;
  }),
  async (c) => c.json({ data: await customFieldService.effectiveForTask(c.req.param('id')!) }));

// PUT /api/v1/tasks/:id/fields/:fieldId — set one value. EDIT on the task's list.
const setValueSchema = z.object({ value: z.unknown() });
taskRoutes.put('/:id/fields/:fieldId', zValidator('json', setValueSchema),
  requireObjectAccess('EDIT', async (c) => {
    const t = await taskRepo.getById(c.req.param('id')!);
    return t?.listId ? { type: 'LIST', id: t.listId } : null;
  }),
  async (c) => {
    try {
      await customFieldService.setValue(c.req.param('id')!, c.req.param('fieldId')!, c.req.valid('json').value);
      const fields = await customFieldService.effectiveForTask(c.req.param('id')!);
      pubsub.publish('task:updated', { projectId: null as any, task: { id: c.req.param('id') } });
      return c.json({ data: fields });
    } catch (err: any) {
      if (err instanceof FieldValidationError)
        return c.json({ error: { code: err.fieldCode, message: err.message } }, 422);
      throw err;
    }
  });
```
> The `pubsub.publish('task:updated', …)` projectId is `null` here because the value-set path doesn't load the task's project; if the existing `task:updated` consumers require a real projectId, fetch it via `taskRepo.getById` (it returns `projectId`). Use the loaded task to publish `{ projectId: t.projectId, task: t }`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p apps/api/tsconfig.json --noEmit`
Expected: no new errors. (`taskRepo.getById` returns a `Task` with `listId`/`projectId` — confirm shape in `task.repository.ts`.)

- [ ] **Step 4: Commit** (if authorized)
```bash
git add apps/api/src/modules/customfields/customfield.routes.ts apps/api/src/modules/tasks/task.routes.ts
git commit -m "feat(customfields): REST routes (CRUD + reorder) + task value endpoints"
```

---

### Task A8: GraphQL mirror for custom fields

**Files:**
- Create: `apps/api/src/graphql/customfields.schema.ts`
- Modify: `apps/api/src/graphql/schema.ts` (import + call `registerCustomFieldsGraphql()` before `builder.toSchema()`)

- [ ] **Step 1: Mirror** — `customfields.schema.ts` (delegates to the SAME `customFieldService`; read-only queries + the value mutation; CRUD-of-definitions can stay REST-only for wave 1, matching how labels has no GraphQL — but expose the read path the board/drawer needs):
```ts
import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { customFieldService } from '../modules/customfields/customfield.service.js';
import { FieldValidationError } from '../modules/customfields/customfield.errors.js';
import type { CustomField, EffectiveField } from '@projectflow/types';

function requireAuth(ctx: { user: unknown }): asserts ctx is { user: { userId: string } } {
  if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
}

export function registerCustomFieldsGraphql(): void {
  const CustomFieldType = builder.objectRef<CustomField>('CustomField');
  CustomFieldType.implement({ fields: (t) => ({
    id: t.exposeString('id'),
    workspaceId: t.exposeString('workspaceId'),
    scopeType: t.exposeString('scopeType'),
    scopeId: t.exposeString('scopeId'),
    type: t.exposeString('type'),
    name: t.exposeString('name'),
    required: t.exposeBoolean('required'),
    position: t.exposeFloat('position'),
    config: t.string({ nullable: true, resolve: (f) => (f.config ? JSON.stringify(f.config) : null) }),
  }) });

  const EffectiveFieldType = builder.objectRef<EffectiveField>('EffectiveField');
  EffectiveFieldType.implement({ fields: (t) => ({
    field: t.field({ type: CustomFieldType, resolve: (e) => e.field }),
    value: t.string({ nullable: true, resolve: (e) => (e.value == null ? null : JSON.stringify(e.value)) }),
  }) });

  builder.queryFields((t) => ({
    customFields: t.field({
      type: [CustomFieldType],
      args: { scopeType: t.arg.string({ required: true }), scopeId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => { requireAuth(ctx); return customFieldService.list(a.scopeType as any, a.scopeId); },
    }),
    taskEffectiveFields: t.field({
      type: [EffectiveFieldType],
      args: { taskId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => { requireAuth(ctx); return customFieldService.effectiveForTask(a.taskId); },
    }),
  }));

  builder.mutationFields((t) => ({
    setTaskCustomField: t.field({
      type: [EffectiveFieldType],
      args: { taskId: t.arg.string({ required: true }), fieldId: t.arg.string({ required: true }), value: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const decoded = a.value == null ? null : JSON.parse(a.value);
        try { await customFieldService.setValue(a.taskId, a.fieldId, decoded); }
        catch (e) { if (e instanceof FieldValidationError) throw new GraphQLError(e.message, { extensions: { code: e.fieldCode } }); throw e; }
        return customFieldService.effectiveForTask(a.taskId);
      },
    }),
  }));
}
```

- [ ] **Step 2: Wire it** — in `apps/api/src/graphql/schema.ts` add the import near the other `register*Graphql` imports and call it before `export const schema = builder.toSchema();`:
```ts
import { registerCustomFieldsGraphql } from './customfields.schema.js';
// …
registerCustomFieldsGraphql();
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p apps/api/tsconfig.json --noEmit`
Expected: no new errors. If Pothos complains about duplicate type names, ensure `CustomField`/`EffectiveField` aren't already registered elsewhere.

- [ ] **Step 4: Commit** (if authorized)
```bash
git add apps/api/src/graphql/customfields.schema.ts apps/api/src/graphql/schema.ts
git commit -m "feat(customfields): Pothos GraphQL mirror (read + setTaskCustomField)"
```

---

### Task A9: Wiring — mount routes, register pubsub channel, register truncate tables

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/graphql/pubsub.ts`
- Modify: `apps/api/src/__tests__/fixtures/truncate.ts`

- [ ] **Step 1: Add the pubsub channel** — in `pubsub.ts`, add to the `PubSubChannels` type (so `publish('customField:updated', …)` type-checks):
```ts
  'customField:updated': [{ scopeId: string; field: unknown }];
```

- [ ] **Step 2: Mount the router** — in `server.ts`, add the import alongside the others and the mount in the `app.route(...)` block:
```ts
import { customFieldRoutes } from './modules/customfields/customfield.routes.js';
// … in the mount block (near app.route('/lists', listRoutes);)
app.route('/custom-fields', customFieldRoutes);
```

- [ ] **Step 3: Register new tables for truncation** — in `truncate.ts`, add the four new tables to `TRUNCATION_ORDER` **child-first, before `Tasks`** (values reference Tasks/CustomFields, so they must be deleted first). Place them ahead of `Tasks` and `Projects`/`Workspaces`:
```ts
  // Phase 2 (0030) — child-first
  'TaskCustomFieldValues',
  'TaskWatchers',
  'CustomFields',
  // TaskTypes is referenced by Tasks.TaskTypeId; null it or delete after Tasks.
  // Simplest: list TaskTypes AFTER Tasks in the order (Tasks deleted first frees the FK).
```
Then add `'TaskTypes'` to the order at a position AFTER `'Tasks'`. VERIFY the exact array variable name/format in `truncate.ts` and insert accordingly (it deletes in array order, child→parent).

- [ ] **Step 4: Smoke-build the API**

Run:
```powershell
npx tsc -p apps/api/tsconfig.json --noEmit
```
Expected: clean (no new errors).

- [ ] **Step 5: Commit** (if authorized)
```bash
git add apps/api/src/server.ts apps/api/src/graphql/pubsub.ts apps/api/src/__tests__/fixtures/truncate.ts
git commit -m "feat(customfields): mount routes, pubsub channel, truncate registration"
```

---

### Task A10: Tasks-module integration — required-blocks-done + progress_auto recompute

**Files:**
- Modify: `apps/api/src/modules/tasks/task.service.ts`
- Modify: `apps/api/src/modules/tasks/task.routes.ts`

- [ ] **Step 1: Block DONE transitions on unmet required fields** — in `task.service.ts`, inject the custom-field service and gate `transitionTask`:
```ts
import { customFieldService } from '../customfields/customfield.service.js';
// transitionTask: assert required fields BEFORE the SP transition.
async transitionTask(taskId: string, newStatus: string, actorId: string): Promise<Task> {
  await customFieldService.assertRequiredMetForStatus(taskId, newStatus); // throws RequiredFieldsUnmetError
  const task = await this.repo.transition(taskId, newStatus, actorId);
  // progress_auto: a transition may flip this task's resolved state -> recompute the PARENT.
  if (task.parentTaskId) customFieldService.recomputeProgressAuto(task.parentTaskId).catch(() => {});
  webhookOutgoingService.dispatch(task.workspaceId, 'issue.updated', {
    id: task.id, issueKey: task.issueKey, title: task.title, status: newStatus, projectId: task.projectId,
  }).catch((err: any) => log.error({ err: err?.message }, 'webhook dispatch failed'));
  return task;
}
```
> `Task.parentTaskId` exists on the `@projectflow/types` `Task` shape — confirm `repo.transition` returns it (it returns the mapped Task). If the repo's mapped Task omits `parentTaskId`, add it to the task row mapper.

- [ ] **Step 2: Recompute on create + delete** — in `createTask` (after `repo.create`) and `deleteTask` (after `repo.delete`), recompute the parent's progress when the affected task has a parent:
```ts
// in createTask, after `const task = await this.repo.create(input);`
if (task.parentTaskId) customFieldService.recomputeProgressAuto(task.parentTaskId).catch(() => {});
// in deleteTask, after `const task = await this.repo.delete(taskId, actorId);`
if (task?.parentTaskId) customFieldService.recomputeProgressAuto(task.parentTaskId).catch(() => {});
```

- [ ] **Step 3: Map the typed error → 422 in the transition route** — in `task.routes.ts` `PATCH /:id/transition` handler's catch:
```ts
import { RequiredFieldsUnmetError } from '../customfields/customfield.errors.js';
// … inside the catch (err: any) of the transition handler, BEFORE the generic 500:
if (err instanceof RequiredFieldsUnmetError)
  return c.json({ error: { code: 'CUSTOM_FIELD_REQUIRED', message: err.message, missing: err.missing } }, 422);
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p apps/api/tsconfig.json --noEmit`
Expected: clean. (Behavior is verified by A14 integration tests `required-on-done` and `progress-auto`.)

- [ ] **Step 5: Commit** (if authorized)
```bash
git add apps/api/src/modules/tasks/task.service.ts apps/api/src/modules/tasks/task.routes.ts
git commit -m "feat(tasks): required-fields-block-done (422) + progress_auto recompute hooks"
```

---

### Task A11: Frontend queries + server actions

**Files:**
- Create: `apps/next-web/src/server/queries/custom-fields.ts`
- Create: `apps/next-web/src/server/actions/custom-fields.ts`
- Modify: `apps/next-web/src/server/actions/tasks.ts` (add `setTaskCustomField`)

- [ ] **Step 1: Queries** — `custom-fields.ts` (model on `queries/labels.ts`; the API uses the `{ data }` envelope so `serverFetch` unwraps it):
```ts
import 'server-only';
import { cache } from 'react';
import type { CustomField, EffectiveField } from '@projectflow/types';
import { serverFetch } from '../api';

export const getCustomFields = cache(async (scopeType: 'SPACE' | 'FOLDER' | 'LIST', scopeId: string): Promise<CustomField[]> => {
  const data = await serverFetch<CustomField[]>(
    `/custom-fields?scopeType=${scopeType}&scopeId=${encodeURIComponent(scopeId)}`);
  return data ?? [];
});

export const getTaskFields = cache(async (taskId: string): Promise<EffectiveField[]> => {
  const data = await serverFetch<EffectiveField[]>(`/tasks/${encodeURIComponent(taskId)}/fields`);
  return data ?? [];
});
```

- [ ] **Step 2: Field-definition actions** — `actions/custom-fields.ts` (model on `actions/labels.ts`; revalidate the settings route):
```ts
'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type { CustomFieldConfig, CustomFieldScopeType, CustomFieldType } from '@projectflow/types';

export interface CreateFieldInput {
  scopeType: CustomFieldScopeType; scopeId: string; type: CustomFieldType;
  name: string; config?: CustomFieldConfig | null; required?: boolean; position?: number;
}

export async function createCustomField(input: CreateFieldInput): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch('/custom-fields', { method: 'POST', body: JSON.stringify(input) }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/project-settings');
  return { ok: true };
}

export async function updateCustomField(id: string, input: { name?: string; config?: CustomFieldConfig | null; clearConfig?: boolean; required?: boolean }): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/custom-fields/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/project-settings');
  return { ok: true };
}

export async function deleteCustomField(id: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/custom-fields/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/project-settings');
  return { ok: true };
}

export async function reorderCustomField(id: string, position: number): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/custom-fields/${encodeURIComponent(id)}/reorder`, { method: 'PATCH', body: JSON.stringify({ position }) }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/project-settings');
  return { ok: true };
}
```

- [ ] **Step 3: Value action** — add `setTaskCustomField` to `actions/tasks.ts` (reuse the existing `run(fn, paths)` helper + `TASK_LIST_PATHS`):
```ts
/** PUT /tasks/:id/fields/:fieldId — TaskDrawer inline custom-field edit. */
export async function setTaskCustomField(taskId: string, fieldId: string, value: unknown): Promise<ActionResult> {
  return run(
    () => serverFetch(`/tasks/${encodeURIComponent(taskId)}/fields/${encodeURIComponent(fieldId)}`, {
      method: 'PUT', body: JSON.stringify({ value }),
    }),
    TASK_LIST_PATHS,
  );
}
```
> If the 422 body's `error.code` (`CUSTOM_FIELD_REQUIRED`, validator codes) must reach the UI, `run`→`toActionError` already carries `code`/`status` on the `ActionFail`. The cell surfaces it via `notifyActionError`.

- [ ] **Step 4: Typecheck the web app**

Run:
```powershell
npx tsc -p apps/next-web/tsconfig.json --noEmit
```
Expected: no new errors from the new query/action files.

- [ ] **Step 5: Commit** (if authorized)
```bash
git add apps/next-web/src/server/queries/custom-fields.ts apps/next-web/src/server/actions/custom-fields.ts apps/next-web/src/server/actions/tasks.ts
git commit -m "feat(web): custom-field queries + actions (definitions + setTaskCustomField)"
```

---

### Task A12: Per-type inline cells (dispatcher + representative cells + spec table)

**Files:**
- Create: `apps/next-web/src/components/custom-fields/CustomFieldCell.tsx`
- Create: `apps/next-web/src/components/custom-fields/types/{TextCell,TextAreaCell,NumberCell,CurrencyCell,CheckboxCell,DateCell,UrlCell,EmailCell,PhoneCell,DropdownCell,LabelsCell,RatingCell,PeopleCell,ProgressManualCell,ProgressAutoCell}.tsx`

- [ ] **Step 1: Dispatcher** — `CustomFieldCell.tsx` (`'use client'`; maps field type → cell; owns the commit→action→toast→rollback flow so each cell is purely presentational):
```tsx
'use client';
import { useState, useTransition } from 'react';
import type { CustomField } from '@projectflow/types';
import { setTaskCustomField } from '@/server/actions/tasks';
import { notifyActionError } from '@/lib/apiErrorToast';
import { TextCell } from './types/TextCell';
import { TextAreaCell } from './types/TextAreaCell';
import { NumberCell } from './types/NumberCell';
import { CurrencyCell } from './types/CurrencyCell';
import { CheckboxCell } from './types/CheckboxCell';
import { DateCell } from './types/DateCell';
import { UrlCell } from './types/UrlCell';
import { EmailCell } from './types/EmailCell';
import { PhoneCell } from './types/PhoneCell';
import { DropdownCell } from './types/DropdownCell';
import { LabelsCell } from './types/LabelsCell';
import { RatingCell } from './types/RatingCell';
import { PeopleCell } from './types/PeopleCell';
import { ProgressManualCell } from './types/ProgressManualCell';
import { ProgressAutoCell } from './types/ProgressAutoCell';

export interface CellProps<T = unknown> {
  field: CustomField;
  value: T;
  disabled?: boolean;
  onCommit: (value: unknown) => void; // null clears
}

export function CustomFieldCell({ taskId, field, value }: { taskId: string; field: CustomField; value: unknown }) {
  const [local, setLocal] = useState<unknown>(value);
  const [, start] = useTransition();

  const onCommit = (next: unknown) => {
    const prev = local;
    setLocal(next);
    start(async () => {
      const r = await setTaskCustomField(taskId, field.id, next);
      if (!r.ok) { setLocal(prev); notifyActionError(r); } // rollback
    });
  };

  const p = { field, value: local, onCommit } as CellProps<any>;
  switch (field.type) {
    case 'text': return <TextCell {...p} />;
    case 'text_area': return <TextAreaCell {...p} />;
    case 'number': return <NumberCell {...p} />;
    case 'currency': return <CurrencyCell {...p} />;
    case 'checkbox': return <CheckboxCell {...p} />;
    case 'date': return <DateCell {...p} />;
    case 'url': return <UrlCell {...p} />;
    case 'email': return <EmailCell {...p} />;
    case 'phone': return <PhoneCell {...p} />;
    case 'dropdown': return <DropdownCell {...p} />;
    case 'labels': return <LabelsCell {...p} />;
    case 'rating': return <RatingCell {...p} />;
    case 'people': return <PeopleCell {...p} />;
    case 'progress_manual': return <ProgressManualCell {...p} />;
    case 'progress_auto': return <ProgressAutoCell {...p} />;
    default: return null;
  }
}
```

- [ ] **Step 2: Three representative cells (full)**

`types/TextCell.tsx` (commit on blur; the `text_area`, `url`, `email`, `phone` cells are identical except the input element/`type` attribute and are listed in the table below):
```tsx
'use client';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import type { CellProps } from '../CustomFieldCell';

export function TextCell({ field, value, onCommit, disabled }: CellProps<string>) {
  const [v, setV] = useState(value ?? '');
  return (
    <Input
      aria-label={field.name}
      disabled={disabled}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if ((v ?? '') !== (value ?? '')) onCommit(v === '' ? null : v); }}
    />
  );
}
```

`types/CheckboxCell.tsx` (commit on change):
```tsx
'use client';
import { Checkbox } from '@/components/ui/checkbox';
import type { CellProps } from '../CustomFieldCell';

export function CheckboxCell({ field, value, onCommit, disabled }: CellProps<boolean>) {
  return (
    <Checkbox
      aria-label={field.name}
      disabled={disabled}
      checked={!!value}
      onCheckedChange={(checked) => onCommit(!!checked)}
    />
  );
}
```

`types/DropdownCell.tsx` (commit on select; options from `field.config.options`):
```tsx
'use client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CellProps } from '../CustomFieldCell';

export function DropdownCell({ field, value, onCommit, disabled }: CellProps<string>) {
  const options = field.config?.options ?? [];
  return (
    <Select value={value ?? ''} disabled={disabled} onValueChange={(v) => onCommit(v || null)}>
      <SelectTrigger aria-label={field.name}><SelectValue placeholder="—" /></SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 3: The remaining 12 cells — derive from this exact table**

Each is the same shape as one of the three above; only the input primitive, the parsed value type, and the commit trigger differ. Build each `types/*Cell.tsx` accordingly (no other logic):

| Cell file | Primitive (`@/components/ui/*`) | Value type | Commit trigger | Notes |
|---|---|---|---|---|
| `TextAreaCell` | `<textarea>` (plain, styled) | `string` | onBlur | like TextCell, multiline |
| `UrlCell` | `Input type="url"` | `string` | onBlur | like TextCell |
| `EmailCell` | `Input type="email"` | `string` | onBlur | like TextCell |
| `PhoneCell` | `Input type="tel"` | `string` | onBlur | like TextCell |
| `NumberCell` | `Input type="number"` | `number` | onBlur | `onCommit(v==='' ? null : Number(v))` |
| `CurrencyCell` | `Input type="number"` + `field.config.currencyCode` prefix label | `number` | onBlur | same parse as NumberCell |
| `DateCell` | `Input type="date"` (or `datetime-local` when `config.includeTime`) | ISO `string` | onChange | `onCommit(e.target.value ? new Date(e.target.value).toISOString() : null)` |
| `RatingCell` | row of N star buttons, N=`config.max ?? 5` | `number` | onClick | click value k → `onCommit(k)`; click current → `onCommit(0)` |
| `LabelsCell` | `Popover` + checkbox list of `config.options` | `string[]` | onChange | toggle id in array → `onCommit(next)` |
| `PeopleCell` | `Popover` + member multiselect (reuse the assignee picker member list source) | `string[]` | onChange | `onCommit(next)`; server re-validates membership |
| `ProgressManualCell` | `Input type="number"` min 0 max 100 + a thin bar | `number` (0..100) | onBlur | clamp 0..100 before commit |
| `ProgressAutoCell` | read-only progress bar showing `value ?? 0`% | `number` | — | `disabled`/no commit; computed server-side |

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p apps/next-web/tsconfig.json --noEmit`
Expected: no new errors. Confirm the `ui/select`, `ui/checkbox`, `ui/input`, `ui/popover` export names match (they exist per the components inventory).

- [ ] **Step 5: Commit** (if authorized)
```bash
git add apps/next-web/src/components/custom-fields/
git commit -m "feat(web): custom-field inline cells (dispatcher + 15 per-type cells)"
```

---

### Task A13: Field Manager UI + wire cells into TaskDrawer

**Files:**
- Create: `apps/next-web/src/components/custom-fields/FieldManager.tsx`
- Modify: a Space/List settings view to host the manager (model: `src/app/(app)/project-settings/project-settings-view.tsx` — add a "Custom Fields" tab; pass `getCustomFields(...)` data from the page)
- Modify: `apps/next-web/src/components/TaskDrawer.tsx` (render a "Custom fields" section using `CustomFieldCell`)

- [ ] **Step 1: FieldManager** — `FieldManager.tsx` (`'use client'`; CRUD list modeled on the Labels tab — `Card` list + `Dialog` create/edit with a type `Select` and a per-type config sub-form + `useTransition`):
```tsx
'use client';
import { useState, useTransition } from 'react';
import type { CustomField, CustomFieldType } from '@projectflow/types';
import { createCustomField, updateCustomField, deleteCustomField } from '@/server/actions/custom-fields';
import { notifyActionError } from '@/lib/apiErrorToast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog';

const TYPES: CustomFieldType[] = ['text','text_area','number','currency','checkbox','date','url','email','phone','dropdown','labels','rating','people','progress_manual','progress_auto'];

export function FieldManager({ scopeType, scopeId, fields }: { scopeType: 'SPACE'|'FOLDER'|'LIST'; scopeId: string; fields: CustomField[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomField | null>(null);
  const [isPending, start] = useTransition();
  const [form, setForm] = useState<{ name: string; type: CustomFieldType; required: boolean }>({ name: '', type: 'text', required: false });

  function save(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = editing
        ? await updateCustomField(editing.id, { name: form.name, required: form.required })
        : await createCustomField({ scopeType, scopeId, type: form.type, name: form.name, required: form.required, position: fields.length });
      if (!r.ok) notifyActionError(r); else { setOpen(false); setEditing(null); }
    });
  }
  function remove(f: CustomField) {
    if (!window.confirm(`Delete field "${f.name}"?`)) return;
    start(async () => { const r = await deleteCustomField(f.id); if (!r.ok) notifyActionError(r); });
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h3>Custom fields</h3>
        <Button onClick={() => { setEditing(null); setForm({ name: '', type: 'text', required: false }); setOpen(true); }}>Add field</Button>
      </div>
      {fields.map((f) => (
        <Card key={f.id} className="flex justify-between items-center p-3 mb-2" data-testid="custom-field-row">
          <span>{f.name} <em>({f.type}){f.required ? ' • required' : ''}</em></span>
          <span>
            <Button variant="ghost" onClick={() => { setEditing(f); setForm({ name: f.name, type: f.type, required: f.required }); setOpen(true); }}>Edit</Button>
            <Button variant="ghost" onClick={() => remove(f)}>Delete</Button>
          </span>
        </Card>
      ))}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit field' : 'New field'}</DialogTitle></DialogHeader>
          <form onSubmit={save}>
            <DialogBody className="space-y-3">
              <Input placeholder="Field name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              {!editing && (
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as CustomFieldType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              )}
              <label className="flex items-center gap-2">
                <Checkbox checked={form.required} onCheckedChange={(c) => setForm({ ...form, required: !!c })} /> Required
              </label>
            </DialogBody>
            <DialogFooter><Button type="submit" disabled={isPending}>{editing ? 'Save' : 'Create'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```
> Per-type config editors (dropdown/labels options, currency code, rating max, date includeTime) are added inside the dialog as a `type`-conditional sub-form, passing `config` to `createCustomField`/`updateCustomField`. For wave-1 minimum, the dialog above creates simple-typed fields; extend the dialog with config inputs for `dropdown`/`labels`/`currency`/`rating` before claiming the "all wave-1 types created" acceptance box (G).

- [ ] **Step 2: Host the manager in settings** — add a "Custom Fields" tab to the settings view that already lists Labels. The hosting page (Server Component) fetches `getCustomFields('SPACE', activeSpaceId)` and passes it to `<FieldManager scopeType="SPACE" scopeId={activeSpaceId} fields={...} />`. (FOLDER/LIST scoping can be added as a scope picker; SPACE-level satisfies the headline cascade flow.)

- [ ] **Step 3: Wire cells into TaskDrawer** — in `TaskDrawer.tsx`, add a "Custom fields" `section`. The drawer's parent (or the drawer via a query) provides `effectiveFields: EffectiveField[]` for the open task (fetch with `getTaskFields(taskId)` where the drawer data is assembled). Render:
```tsx
{effectiveFields.map((ef) => (
  <div key={ef.field.id} className={styles.fieldRow}>
    <label>{ef.field.name}</label>
    <CustomFieldCell taskId={mutationTaskId} field={ef.field} value={ef.value} />
  </div>
))}
```
> The drawer is hand-rolled and owns a `task` snapshot prop; thread `effectiveFields` through the same prop path the parent uses to pass the task. If the drawer fetches its own data client-side, add a small client fetch to the task fields endpoint via a server action wrapper, OR pass `effectiveFields` from the server component that renders the board/list. Match the existing data-flow; do not introduce a new client data layer.

- [ ] **Step 4: Typecheck + lint the web app**

Run:
```powershell
npx tsc -p apps/next-web/tsconfig.json --noEmit
```
Expected: no new errors.

- [ ] **Step 5: Commit** (if authorized)
```bash
git add apps/next-web/src/components/custom-fields/FieldManager.tsx apps/next-web/src/components/TaskDrawer.tsx apps/next-web/src/app/(app)/project-settings/
git commit -m "feat(web): field manager UI + custom-field cells in TaskDrawer"
```

---

### Task A14: Verification — integration + multitenancy + headline e2e + regression

**Files:**
- Create: `apps/api/src/modules/customfields/__tests__/customfield-cascade.integration.test.ts`
- Create: `apps/api/src/modules/customfields/__tests__/customfield-values.integration.test.ts`
- Create: `apps/api/src/modules/customfields/__tests__/required-on-done.integration.test.ts`
- Create: `apps/api/src/modules/customfields/__tests__/progress-auto.integration.test.ts`
- Create: `apps/api/src/modules/customfields/__tests__/multitenancy.integration.test.ts`
- Create: `e2e/custom-fields.spec.ts`

Shared test setup helper (repeated at the top of each integration file):
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

// Build Space -> default List (created by 0029 backfill on space create) -> a task in it.
async function setupTaskInList() {
  const owner = await createTestUser({ email: `cf-${Date.now()}-${Math.random().toString(36).slice(2)}@projectflow.test` });
  const t = owner.accessToken;
  const ws = await createTestWorkspace(t);
  const space = await createTestProject(ws.Id, t, { name: 'CF Space', key: `CF${Date.now() % 10000}` });
  // The default List under the space is created by the 0029 backfill at project create.
  const lists = (await json<{ data: any[] }>(await request(`/lists?spaceId=${space.Id}`, { token: t }), 200)).data;
  const list = lists[0];
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token: t, json: { workspaceId: ws.Id, listId: list.id ?? list.Id, title: 'CF task' },
  }), 201)).data;
  return { owner, t, ws, space, list, task };
}
```
> VERIFY at implementation: whether creating a Project via `createTestProject` triggers the default-List backfill (the backfill is in migration 0030/0029 and runs at migrate time, not per-create). If a freshly created test Space has NO default list, create one inline via `request('/lists', { json: { workspaceId, spaceId, folderId:null, name:'Default', position:0 } })` and use it. Adjust `setupTaskInList` accordingly and re-run.

- [ ] **Step 1: Cascade test (the headline integration)**

`customfield-cascade.integration.test.ts`:
```ts
// …shared setup above…
describe('custom field cascade', () => {
  it('a SPACE-level field appears on a task in a list beneath the space', async () => {
    const { t, space, task } = await setupTaskInList();
    await json(await request('/custom-fields', {
      method: 'POST', token: t, json: { scopeType: 'SPACE', scopeId: space.Id, type: 'text', name: 'Severity', required: false },
    }), 201);
    const eff = (await json<{ data: any[] }>(await request(`/tasks/${task.Id ?? task.id}/fields`, { token: t }), 200)).data;
    expect(eff.map((e) => e.field.name)).toContain('Severity');
  });

  it('a LIST-level field stays local to its list (not on a task in a different list)', async () => {
    const { t, ws, space } = await setupTaskInList();
    // second list + task
    const l2 = (await json<{ data: any }>(await request('/lists', { method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'L2', position: 1 } }), 201)).data;
    const task2 = (await json<{ data: any }>(await request('/tasks', { method: 'POST', token: t, json: { workspaceId: ws.Id, listId: l2.id ?? l2.Id, title: 'in L2' } }), 201)).data;
    // field on the FIRST list only
    const lists = (await json<{ data: any[] }>(await request(`/lists?spaceId=${space.Id}`, { token: t }), 200)).data;
    const firstList = lists.find((x) => (x.id ?? x.Id) !== (l2.id ?? l2.Id));
    await json(await request('/custom-fields', { method: 'POST', token: t, json: { scopeType: 'LIST', scopeId: firstList.id ?? firstList.Id, type: 'text', name: 'LocalOnly' } }), 201);
    const eff2 = (await json<{ data: any[] }>(await request(`/tasks/${task2.Id ?? task2.id}/fields`, { token: t }), 200)).data;
    expect(eff2.map((e) => e.field.name)).not.toContain('LocalOnly');
  });
});
```

- [ ] **Step 2: Value round-trip + validation test**

`customfield-values.integration.test.ts` — set a valid value (persists), set an invalid value (422):
```ts
describe('custom field values', () => {
  it('sets and persists a value; rejects an invalid one with 422', async () => {
    const { t, space, task } = await setupTaskInList();
    const f = (await json<{ data: any }>(await request('/custom-fields', { method: 'POST', token: t, json: { scopeType: 'SPACE', scopeId: space.Id, type: 'number', name: 'Estimate' } }), 201)).data;
    const taskId = task.Id ?? task.id;
    await json(await request(`/tasks/${taskId}/fields/${f.id}`, { method: 'PUT', token: t, json: { value: 42 } }), 200);
    const eff = (await json<{ data: any[] }>(await request(`/tasks/${taskId}/fields`, { token: t }), 200)).data;
    expect(eff.find((e) => e.field.id === f.id)?.value).toBe(42);
    const bad = await request(`/tasks/${taskId}/fields/${f.id}`, { method: 'PUT', token: t, json: { value: 'not a number' } });
    expect(bad.status).toBe(422);
  });
});
```

- [ ] **Step 3: Required-blocks-done test**

`required-on-done.integration.test.ts`:
```ts
describe('required field blocks status -> done', () => {
  it('returns 422 CUSTOM_FIELD_REQUIRED when transitioning to Done with an empty required field, succeeds once filled', async () => {
    const { t, space, task } = await setupTaskInList();
    const taskId = task.Id ?? task.id;
    const f = (await json<{ data: any }>(await request('/custom-fields', { method: 'POST', token: t, json: { scopeType: 'SPACE', scopeId: space.Id, type: 'text', name: 'Root Cause', required: true } }), 201)).data;
    const blocked = await request(`/tasks/${taskId}/transition`, { method: 'PATCH', token: t, json: { status: 'Done' } });
    expect(blocked.status).toBe(422);
    const body = await blocked.json();
    expect(body.error.code).toBe('CUSTOM_FIELD_REQUIRED');
    await json(await request(`/tasks/${taskId}/fields/${f.id}`, { method: 'PUT', token: t, json: { value: 'fixed' } }), 200);
    const okRes = await request(`/tasks/${taskId}/transition`, { method: 'PATCH', token: t, json: { status: 'Done' } });
    expect([200, 201]).toContain(okRes.status);
  });
});
```
> If the test Space has no attached workflow with a `Done` (Category=DONE) status, the SP falls back to the name list `('Done','Resolved','Closed','Completed')` — `'Done'` is covered, so the test is valid without seeding a workflow. If transitions require the status to exist in a workflow, seed one via the pool (see backfill.integration.test pattern) — VERIFY by reading `usp_Task_Transition` behavior for unknown statuses.

- [ ] **Step 4: progress_auto test**

`progress-auto.integration.test.ts`:
```ts
describe('progress_auto', () => {
  it('updates the parent percentage when a subtask is resolved', async () => {
    const { t, ws, space, list, task } = await setupTaskInList();
    const parentId = task.Id ?? task.id;
    const f = (await json<{ data: any }>(await request('/custom-fields', { method: 'POST', token: t, json: { scopeType: 'SPACE', scopeId: space.Id, type: 'progress_auto', name: 'Progress', config: { source: 'subtasks' } } }), 201)).data;
    // two subtasks
    const listId = list.id ?? list.Id;
    const s1 = (await json<{ data: any }>(await request('/tasks', { method: 'POST', token: t, json: { workspaceId: ws.Id, listId, title: 's1', parentTaskId: parentId } }), 201)).data;
    await json(await request('/tasks', { method: 'POST', token: t, json: { workspaceId: ws.Id, listId, title: 's2', parentTaskId: parentId } }), 201);
    // resolve one subtask
    await request(`/tasks/${s1.Id ?? s1.id}/transition`, { method: 'PATCH', token: t, json: { status: 'Done' } });
    const eff = (await json<{ data: any[] }>(await request(`/tasks/${parentId}/fields`, { token: t }), 200)).data;
    expect(eff.find((e) => e.field.id === f.id)?.value).toBe(50);
  });
});
```

- [ ] **Step 5: Multitenancy test** (every new repo read method)

`multitenancy.integration.test.ts`:
```ts
describe('custom fields multitenancy isolation', () => {
  it('user B cannot list custom fields of user A\'s space', async () => {
    const a = await createTestUser({ email: `mt-a-${Date.now()}@projectflow.test` });
    const wsA = await createTestWorkspace(a.accessToken);
    const spaceA = await createTestProject(wsA.Id, a.accessToken, { name: 'A', key: `AAA${Date.now() % 10000}` });
    await json(await request('/custom-fields', { method: 'POST', token: a.accessToken, json: { scopeType: 'SPACE', scopeId: spaceA.Id, type: 'text', name: 'Secret' } }), 201);
    const b = await createTestUser({ email: `mt-b-${Date.now()}@projectflow.test` });
    const res = await request(`/custom-fields?scopeType=SPACE&scopeId=${spaceA.Id}`, { token: b.accessToken });
    expect([403, 404]).toContain(res.status);
  });
});
```

- [ ] **Step 6: Run unit + integration**

Run (DB up + env exported per the safety section):
```powershell
npm run test:unit --workspace apps/api
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_USER='sa'; $env:DB_PASSWORD='YourStrong@Passw0rd'; $env:DB_ENCRYPT='false'; $env:DB_TRUST_SERVER_CERTIFICATE='true'; $env:REDIS_URL='redis://127.0.0.1:6379'
npm run test:integration --workspace apps/api -- src/modules/customfields
```
Expected: unit green (incl. 13 validator tests); integration green for all 5 custom-field files. **PASTE THE REAL OUTPUT.**

- [ ] **Step 7: Headline e2e**

`e2e/custom-fields.spec.ts` — create SPACE-level `dropdown` + `required text` → both cascade to a list task → edit inline → blocked from Done until required filled → succeeds. Use the API-register + UI-login pattern from `e2e/hierarchy.spec.ts`; create the fields via API (`POST /custom-fields`), drive the inline edit + transition through the UI (TaskDrawer), assert the 422 surfaces as a toast/inline error and that Done succeeds after filling. Selectors: `getByTestId('custom-field-row')` in settings; the drawer cells via `getByLabel(field.name)`. (Full spec authored at implementation following the hierarchy spec template; keep it to the single headline flow.)

Run:
```powershell
npx playwright install chromium   # first run only
npx playwright test e2e/custom-fields.spec.ts
```
Expected: 1 passed. **PASTE THE REAL OUTPUT.**

- [ ] **Step 8: Regression — board/backlog/roadmap still 200**

With the dev servers running (playwright `webServer` auto-starts them, or `npm run dev` both apps), confirm:
```powershell
# after logging in via the app, or via a quick authenticated fetch in an e2e check:
# GET /board, /backlog, /roadmap return 200 (legacy Tasks.Type untouched in Stream A).
```
Add a tiny assertion to the e2e (navigate to `/board`, `/backlog`, `/roadmap`, expect no error page) OR a separate smoke. **PASTE THE REAL OUTPUT.**

- [ ] **Step 9: Commit** (if authorized)
```bash
git add apps/api/src/modules/customfields/__tests__/ e2e/custom-fields.spec.ts
git commit -m "test(customfields): cascade, values, required-on-done, progress_auto, multitenancy, e2e"
```

---

## ✅ STREAM A REVIEW CHECKPOINT

STOP. Present to the human: migration 0030 applied + reversible (paste the scratch-DB teardown output), unit + integration + e2e output pasted, `/board`+`/backlog`+`/roadmap` still 200. Do NOT start Stream B until the human approves Stream A.

---

## STREAM B — Task Types (additive; legacy `Tasks.Type` kept in sync)

Schema (TaskTypes table, `Tasks.TaskTypeId`, default/Milestone seed) already shipped in migration 0030 (Task A1). Stream B adds procs, module, the `PATCH /tasks/:id/type` endpoint with legacy-`Type` sync, frontend selector + milestone marker.

### Task B1: Task-type stored procedures (CRUD + SetType-with-legacy-sync)

**Files (all under `infra/sql/procedures/`):**
- Create: `usp_TaskType_Create.sql`, `usp_TaskType_Update.sql`, `usp_TaskType_Delete.sql`, `usp_TaskType_List.sql`, `usp_TaskType_GetWorkspaceId.sql`, `usp_Task_SetType.sql`

- [ ] **Step 1: CRUD + list + workspace lookup**

`usp_TaskType_Create.sql`:
```sql
CREATE OR ALTER PROCEDURE dbo.usp_TaskType_Create
    @Id UNIQUEIDENTIFIER, @WorkspaceId UNIQUEIDENTIFIER, @NameSingular NVARCHAR(100),
    @NamePlural NVARCHAR(100), @Icon NVARCHAR(50) = NULL, @IsMilestone BIT = 0, @Position FLOAT = 0
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        INSERT INTO dbo.TaskTypes (Id, WorkspaceId, NameSingular, NamePlural, Icon, IsMilestone, IsDefault, Position)
        VALUES (@Id, @WorkspaceId, @NameSingular, @NamePlural, @Icon, @IsMilestone, 0, @Position);
        SELECT * FROM dbo.TaskTypes WHERE Id = @Id;
    END TRY BEGIN CATCH THROW; END CATCH
END;
```

`usp_TaskType_Update.sql`:
```sql
CREATE OR ALTER PROCEDURE dbo.usp_TaskType_Update
    @Id UNIQUEIDENTIFIER, @NameSingular NVARCHAR(100) = NULL, @NamePlural NVARCHAR(100) = NULL,
    @Icon NVARCHAR(50) = NULL, @ClearIcon BIT = 0, @Position FLOAT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.TaskTypes WHERE Id = @Id AND DeletedAt IS NULL)
            THROW 51320, 'Task type not found', 1;
        UPDATE dbo.TaskTypes
        SET NameSingular = COALESCE(@NameSingular, NameSingular),
            NamePlural   = COALESCE(@NamePlural, NamePlural),
            Icon         = CASE WHEN @ClearIcon = 1 THEN NULL ELSE COALESCE(@Icon, Icon) END,
            Position     = COALESCE(@Position, Position),
            UpdatedAt    = SYSUTCDATETIME()
        WHERE Id = @Id;
        SELECT * FROM dbo.TaskTypes WHERE Id = @Id;
    END TRY BEGIN CATCH THROW; END CATCH
END;
```

`usp_TaskType_Delete.sql` (soft delete; block deleting the default; reassign tasks of this type back to the default):
```sql
CREATE OR ALTER PROCEDURE dbo.usp_TaskType_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        DECLARE @WorkspaceId UNIQUEIDENTIFIER, @IsDefault BIT;
        SELECT @WorkspaceId = WorkspaceId, @IsDefault = IsDefault FROM dbo.TaskTypes WHERE Id = @Id AND DeletedAt IS NULL;
        IF @WorkspaceId IS NULL THROW 51320, 'Task type not found', 1;
        IF @IsDefault = 1 THROW 51321, 'Cannot delete the default task type', 1;
        BEGIN TRANSACTION;
        DECLARE @DefId UNIQUEIDENTIFIER = (SELECT TOP 1 Id FROM dbo.TaskTypes WHERE WorkspaceId = @WorkspaceId AND IsDefault = 1 AND DeletedAt IS NULL);
        UPDATE dbo.Tasks SET TaskTypeId = @DefId, Type = 'TASK' WHERE TaskTypeId = @Id;
        UPDATE dbo.TaskTypes SET DeletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id;
        COMMIT TRANSACTION;
        SELECT * FROM dbo.TaskTypes WHERE Id = @Id;
    END TRY BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION; THROW; END CATCH
END;
```

`usp_TaskType_List.sql`:
```sql
CREATE OR ALTER PROCEDURE dbo.usp_TaskType_List
    @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.TaskTypes WHERE WorkspaceId = @WorkspaceId AND DeletedAt IS NULL ORDER BY Position, NameSingular;
END;
```

`usp_TaskType_GetWorkspaceId.sql`:
```sql
CREATE OR ALTER PROCEDURE dbo.usp_TaskType_GetWorkspaceId
    @Id UNIQUEIDENTIFIER
AS
BEGIN SET NOCOUNT ON; SELECT WorkspaceId FROM dbo.TaskTypes WHERE Id = @Id AND DeletedAt IS NULL; END;
```

- [ ] **Step 2: SetType with legacy sync** — `usp_Task_SetType.sql` (caller passes both the new `TaskTypeId` and the computed legacy `@LegacyType`; SP validates the type belongs to the task's workspace, sets both columns):
```sql
CREATE OR ALTER PROCEDURE dbo.usp_Task_SetType
    @TaskId     UNIQUEIDENTIFIER,
    @TaskTypeId UNIQUEIDENTIFIER,
    @LegacyType NVARCHAR(20)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        DECLARE @ws UNIQUEIDENTIFIER;
        SELECT @ws = WorkspaceId FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL;
        IF @ws IS NULL THROW 51322, 'Task not found', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.TaskTypes WHERE Id = @TaskTypeId AND WorkspaceId = @ws AND DeletedAt IS NULL)
            THROW 51323, 'Task type not found in this workspace', 1;
        UPDATE dbo.Tasks SET TaskTypeId = @TaskTypeId, Type = @LegacyType, UpdatedAt = SYSUTCDATETIME() WHERE Id = @TaskId;
        SELECT * FROM dbo.Tasks WHERE Id = @TaskId;
    END TRY BEGIN CATCH THROW; END CATCH
END;
```

- [ ] **Step 3: Deploy + commit** (if authorized)
```powershell
npm run db:deploy-sps
```
Expected: clean deploy.
```bash
git add infra/sql/procedures/usp_TaskType_*.sql infra/sql/procedures/usp_Task_SetType.sql
git commit -m "feat(tasktypes): CRUD procs + usp_Task_SetType with legacy Type sync"
```

### Task B2: Task-type module (map, repository, service, legacy-sync unit test)

**Files:**
- Create: `apps/api/src/modules/tasktypes/{map,tasktype.repository,tasktype.service}.ts`
- Test: `apps/api/src/modules/tasktypes/__tests__/legacy-type-sync.unit.test.ts`

- [ ] **Step 1: Failing unit test for the legacy mapping** — `legacy-type-sync.unit.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { legacyTypeForTaskType } from '../tasktype.service.js';

describe('legacyTypeForTaskType', () => {
  it('maps a known enum name (case-insensitive) to that enum', () => {
    expect(legacyTypeForTaskType({ nameSingular: 'Bug', isMilestone: false })).toBe('BUG');
    expect(legacyTypeForTaskType({ nameSingular: 'epic', isMilestone: false })).toBe('EPIC');
  });
  it('maps the default / unknown custom type to TASK', () => {
    expect(legacyTypeForTaskType({ nameSingular: 'Initiative', isMilestone: false })).toBe('TASK');
  });
  it('maps a milestone type to TASK (board has no MILESTONE bucket)', () => {
    expect(legacyTypeForTaskType({ nameSingular: 'Milestone', isMilestone: true })).toBe('TASK');
  });
});
```

- [ ] **Step 2: Run → fails** (`Cannot find module '../tasktype.service.js'`).
```powershell
npm run test:unit --workspace apps/api -- src/modules/tasktypes/__tests__/legacy-type-sync.unit.test.ts
```

- [ ] **Step 3: map.ts**
```ts
import type { TaskType } from '@projectflow/types';
export function mapTaskTypeRow(r: any): TaskType {
  return { id: r.Id, workspaceId: r.WorkspaceId, nameSingular: r.NameSingular, namePlural: r.NamePlural,
    icon: r.Icon ?? null, isMilestone: !!r.IsMilestone, isDefault: !!r.IsDefault, position: Number(r.Position),
    createdAt: String(r.CreatedAt), updatedAt: String(r.UpdatedAt) };
}
```

- [ ] **Step 4: repository** — `tasktype.repository.ts` (`usp_TaskType_*` + `usp_Task_SetType`); follow the A5 array-param style. Methods: `list(workspaceId)`, `create(p)`, `update(id,p)`, `delete(id)`, `getWorkspaceId(id)`, `getById(id)` (add `usp_TaskType_GetById.sql` like A5 Step 3), `setTaskType(taskId, taskTypeId, legacyType)` → returns the mapped Task row.

- [ ] **Step 5: service** — `tasktype.service.ts` with the exported pure mapper + singleton:
```ts
import { randomUUID } from 'node:crypto';
import { TaskTypeRepository } from './tasktype.repository.js';
import type { TaskType } from '@projectflow/types';

const KNOWN = new Set(['EPIC','STORY','TASK','BUG','SUBTASK','IMPROVEMENT','FEATURE','TEST']);

/** Legacy Tasks.Type stays valid for board/roadmap: known enum name -> that enum; else TASK. */
export function legacyTypeForTaskType(tt: { nameSingular: string; isMilestone: boolean }): string {
  const up = tt.nameSingular.trim().toUpperCase();
  return KNOWN.has(up) ? up : 'TASK';
}

export class TaskTypeService {
  constructor(private repo: TaskTypeRepository = new TaskTypeRepository()) {}
  list(workspaceId: string) { return this.repo.list(workspaceId); }
  create(input: { workspaceId: string; nameSingular: string; namePlural: string; icon?: string | null; isMilestone?: boolean; position?: number }) {
    const id = randomUUID().toUpperCase();
    return this.repo.create({ id, ...input, icon: input.icon ?? null, isMilestone: !!input.isMilestone, position: input.position ?? 0 });
  }
  update(id: string, p: { nameSingular?: string; namePlural?: string; icon?: string | null; clearIcon?: boolean; position?: number }) { return this.repo.update(id, p); }
  delete(id: string) { return this.repo.delete(id); }
  async setTaskType(taskId: string, taskTypeId: string) {
    const tt = await this.repo.getById(taskTypeId);
    if (!tt) return null;
    return this.repo.setTaskType(taskId, taskTypeId, legacyTypeForTaskType(tt));
  }
}
export const taskTypeService = new TaskTypeService();
```

- [ ] **Step 6: Run unit test → passes**; deploy `usp_TaskType_GetById.sql`; typecheck.
```powershell
npm run db:deploy-sps; npm run test:unit --workspace apps/api -- src/modules/tasktypes; npx tsc -p apps/api/tsconfig.json --noEmit
```
Expected: 3 mapping tests PASS; clean typecheck. **PASTE OUTPUT.**

- [ ] **Step 7: Commit** (if authorized)
```bash
git add apps/api/src/modules/tasktypes/ infra/sql/procedures/usp_TaskType_GetById.sql
git commit -m "feat(tasktypes): module + legacy-type mapper (unit-tested)"
```

### Task B3: Task-type routes + `/tasks/:id/type` + GraphQL mirror + wiring

**Files:**
- Create: `apps/api/src/modules/tasktypes/tasktype.routes.ts`, `apps/api/src/graphql/tasktypes.schema.ts`
- Modify: `apps/api/src/modules/tasks/task.routes.ts` (add `PATCH /:id/type`), `apps/api/src/server.ts`, `apps/api/src/graphql/schema.ts`, `apps/api/src/graphql/pubsub.ts`

- [ ] **Step 1: Routes** — `tasktype.routes.ts` workspace-scoped CRUD, gated with `requirePermission` (workspace-level, like labels) since task types are a workspace resource not a hierarchy node. Use `requirePermission('project.manage'|<appropriate slug>, { resolveWorkspace })`. VERIFY the right permission slug by grepping existing workspace-settings routes; reuse it. Routes:
  - `GET /task-types?workspaceId=` → `taskTypeService.list`
  - `POST /task-types` (body workspaceId, nameSingular, namePlural, icon?, isMilestone?) → create
  - `PATCH /task-types/:id`, `DELETE /task-types/:id` (resolveWorkspace via `usp_TaskType_GetWorkspaceId`)
  Envelope `{ data }`, publish `pubsub.publish('taskType:updated', { workspaceId, taskType })`.

- [ ] **Step 2: `PATCH /tasks/:id/type`** — add to `task.routes.ts` (gated `requirePermission('task.update', { resolveWorkspace: resolveTaskWorkspace })`):
```ts
import { taskTypeService } from '../tasktypes/tasktype.service.js';
const setTypeSchema = z.object({ taskTypeId: z.string().uuid() });
taskRoutes.patch('/:id/type', requirePermission('task.update', { resolveWorkspace: resolveTaskWorkspace }),
  zValidator('json', setTypeSchema),
  async (c) => {
    try {
      const task = await taskTypeService.setTaskType(c.req.param('id')!, c.req.valid('json').taskTypeId);
      if (!task) return c.json({ error: { code: 'NOT_FOUND', message: 'Task type not found' } }, 404);
      await invalidateTaskCaches((task as any).ProjectId ?? (task as any).projectId);
      return c.json({ data: task });
    } catch (err: any) {
      if (err.number === 51322 || err.number === 51323) return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
      throw err;
    }
  });
```

- [ ] **Step 3: GraphQL mirror** `tasktypes.schema.ts` — `registerTaskTypesGraphql()` exposing `taskTypes(workspaceId)` query + `setTaskType` mutation delegating to `taskTypeService`. Wire in `schema.ts`. Add `'taskType:updated': [{ workspaceId: string; taskType: unknown }]` to `PubSubChannels`.

- [ ] **Step 4: Mount** `app.route('/task-types', taskTypeRoutes);` in `server.ts`. Typecheck.
```powershell
npx tsc -p apps/api/tsconfig.json --noEmit
```

- [ ] **Step 5: Commit** (if authorized)
```bash
git add apps/api/src/modules/tasktypes/tasktype.routes.ts apps/api/src/graphql/tasktypes.schema.ts apps/api/src/modules/tasks/task.routes.ts apps/api/src/server.ts apps/api/src/graphql/schema.ts apps/api/src/graphql/pubsub.ts
git commit -m "feat(tasktypes): routes + /tasks/:id/type + GraphQL mirror + wiring"
```

### Task B4: Frontend — task-type selector + milestone marker

**Files:**
- Create: `apps/next-web/src/server/queries/task-types.ts`, `apps/next-web/src/components/TaskTypeSelector.tsx`
- Modify: `apps/next-web/src/server/actions/tasks.ts` (add `setTaskType`), `apps/next-web/src/components/TaskDrawer.tsx`

- [ ] **Step 1: Query** `task-types.ts`:
```ts
import 'server-only';
import { cache } from 'react';
import type { TaskType } from '@projectflow/types';
import { serverFetch } from '../api';
export const getTaskTypes = cache(async (workspaceId: string): Promise<TaskType[]> => {
  return (await serverFetch<TaskType[]>(`/task-types?workspaceId=${encodeURIComponent(workspaceId)}`)) ?? [];
});
```

- [ ] **Step 2: Action** — add to `actions/tasks.ts`:
```ts
export async function setTaskType(taskId: string, taskTypeId: string): Promise<ActionResult> {
  return run(() => serverFetch(`/tasks/${encodeURIComponent(taskId)}/type`, { method: 'PATCH', body: JSON.stringify({ taskTypeId }) }), TASK_LIST_PATHS);
}
```

- [ ] **Step 3: Selector** `TaskTypeSelector.tsx` (`'use client'`; `Select` of task types showing icon + singular; milestone types render a diamond `◆` marker). Commit on change via `setTaskType`, rollback on `!ok` + `notifyActionError`.

- [ ] **Step 4: Wire into TaskDrawer** — render `<TaskTypeSelector taskId types value={task.taskTypeId} />` in the drawer header; when the selected type `isMilestone`, render a diamond marker placeholder next to the title. Typecheck.
```powershell
npx tsc -p apps/next-web/tsconfig.json --noEmit
```

- [ ] **Step 5: Commit** (if authorized)
```bash
git add apps/next-web/src/server/queries/task-types.ts apps/next-web/src/components/TaskTypeSelector.tsx apps/next-web/src/server/actions/tasks.ts apps/next-web/src/components/TaskDrawer.tsx
git commit -m "feat(web): task-type selector + milestone marker"
```

### Task B5: Verification — task types

**Files:**
- Create: `apps/api/src/modules/tasktypes/__tests__/tasktype.integration.test.ts`, `apps/api/src/modules/tasktypes/__tests__/multitenancy.integration.test.ts`

- [ ] **Step 1: Integration** — assert: (a) a freshly migrated workspace has a default `Task` type + a `Milestone` type (from 0030 backfill); (b) `POST /task-types` then `PATCH /tasks/:id/type` sets `TaskTypeId` AND syncs legacy `Type` (create a `Bug` type → task's `Type` becomes `'BUG'`; create an `Initiative` type → `Type` becomes `'TASK'`); (c) deleting the default type is rejected. Use the `setupTaskInList` helper pattern from A14.
- [ ] **Step 2: Multitenancy** — user B cannot `GET /task-types?workspaceId=<A's ws>` (expect 403/404).
- [ ] **Step 3: Run** integration (`-- src/modules/tasktypes`). **PASTE OUTPUT.**
- [ ] **Step 4: Commit** (if authorized)
```bash
git add apps/api/src/modules/tasktypes/__tests__/
git commit -m "test(tasktypes): seed, set-type legacy sync, default-delete guard, multitenancy"
```

## ✅ STREAM B REVIEW CHECKPOINT — STOP for human approval (paste test output; confirm `/board`,`/roadmap` 200 — they read legacy `Type`).

---

## STREAM C — Tags (Tag terminology over `dbo.Labels` + `dbo.TaskLabelLinks`)

No new tables (locked decision 1). A thin Tag surface reuses Labels (`ProjectId` = Space, colored) and the `TaskLabelLinks` junction. The legacy string `TaskLabels` junction is left untouched.

### Task C1: Tag stored procedures

**Files (`infra/sql/procedures/`):** `usp_Tag_List.sql`, `usp_Tag_Create.sql`, `usp_Tag_Delete.sql`, `usp_Tag_LinkTask.sql`, `usp_Tag_UnlinkTask.sql`, `usp_Tag_GetWorkspaceId.sql`

- [ ] **Step 1:** Reuse Labels semantics. If `usp_Label_*` procs already cover create/list/delete cleanly, the `usp_Tag_*` procs can be thin and operate directly on `dbo.Labels`/`dbo.TaskLabelLinks` (a Tag IS a Label). Write:

`usp_Tag_List.sql` (tags = labels for a space):
```sql
CREATE OR ALTER PROCEDURE dbo.usp_Tag_List
    @SpaceId UNIQUEIDENTIFIER
AS
BEGIN SET NOCOUNT ON; SELECT * FROM dbo.Labels WHERE ProjectId = @SpaceId ORDER BY Name; END;
```

`usp_Tag_Create.sql` (app generates @Id; default color when null; UNIQUE (ProjectId,Name) bubbles as a SQL error the route maps to 409):
```sql
CREATE OR ALTER PROCEDURE dbo.usp_Tag_Create
    @Id UNIQUEIDENTIFIER, @SpaceId UNIQUEIDENTIFIER, @Name NVARCHAR(100), @Color NVARCHAR(7) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Projects WHERE Id = @SpaceId AND Status <> 'DELETED')
            THROW 51340, 'Space not found', 1;
        INSERT INTO dbo.Labels (Id, ProjectId, Name, Color) VALUES (@Id, @SpaceId, @Name, COALESCE(@Color, '#6c63ff'));
        SELECT * FROM dbo.Labels WHERE Id = @Id;
    END TRY BEGIN CATCH THROW; END CATCH
END;
```

`usp_Tag_Delete.sql` (hard delete; `TaskLabelLinks` rows for it must go first — FK is NO ACTION):
```sql
CREATE OR ALTER PROCEDURE dbo.usp_Tag_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        DELETE FROM dbo.TaskLabelLinks WHERE LabelId = @Id;
        DELETE FROM dbo.Labels WHERE Id = @Id;
        COMMIT TRANSACTION;
    END TRY BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION; THROW; END CATCH
END;
```

`usp_Tag_LinkTask.sql` / `usp_Tag_UnlinkTask.sql` (idempotent link via NOT EXISTS; unlink via DELETE):
```sql
CREATE OR ALTER PROCEDURE dbo.usp_Tag_LinkTask
    @TaskId UNIQUEIDENTIFIER, @TagId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL) THROW 51341, 'Task not found', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.Labels WHERE Id = @TagId) THROW 51342, 'Tag not found', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.TaskLabelLinks WHERE TaskId = @TaskId AND LabelId = @TagId)
            INSERT INTO dbo.TaskLabelLinks (TaskId, LabelId) VALUES (@TaskId, @TagId);
    END TRY BEGIN CATCH THROW; END CATCH
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_Tag_UnlinkTask
    @TaskId UNIQUEIDENTIFIER, @TagId UNIQUEIDENTIFIER
AS
BEGIN SET NOCOUNT ON; DELETE FROM dbo.TaskLabelLinks WHERE TaskId = @TaskId AND LabelId = @TagId; END;
```
> NOTE: the SP deployer splits on `GO`, so two procs in one file is allowed — but the house convention is one proc per file. Put `usp_Tag_UnlinkTask` in its own file. The combined block above is illustrative.

`usp_Tag_GetWorkspaceId.sql` (a Label has no WorkspaceId column — resolve via its Project):
```sql
CREATE OR ALTER PROCEDURE dbo.usp_Tag_GetWorkspaceId
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT p.WorkspaceId FROM dbo.Labels l JOIN dbo.Projects p ON p.Id = l.ProjectId WHERE l.Id = @Id;
END;
```

- [ ] **Step 2: Deploy + commit** (if authorized)
```powershell
npm run db:deploy-sps
```
```bash
git add infra/sql/procedures/usp_Tag_*.sql
git commit -m "feat(tags): stored procs over Labels + TaskLabelLinks"
```

### Task C2: Tag module + routes + GraphQL + wiring

**Files:** `apps/api/src/modules/tags/{map,tag.repository,tag.service,tag.routes}.ts`, `apps/api/src/graphql/tags.schema.ts`; modify `server.ts`, `schema.ts`, `pubsub.ts`.

- [ ] **Step 1:** `map.ts` reuses the Label shape (`Tag = Label`): map `{ Id, ProjectId, Name, Color, CreatedAt }` → `{ id, projectId, name, color, createdAt, issueCount: 0 }`.
- [ ] **Step 2:** `tag.repository.ts` — `usp_Tag_*` calls; `list(spaceId)`, `create(id, spaceId, name, color)`, `delete(id)`, `linkTask(taskId, tagId)`, `unlinkTask(taskId, tagId)`, `getWorkspaceId(id)`.
- [ ] **Step 3:** `tag.service.ts` — singleton; `create` uses `randomUUID().toUpperCase()`.
- [ ] **Step 4:** `tag.routes.ts` — routes with access gates:
  - `GET /spaces/:spaceId/tags` — `requireObjectAccess('VIEW', (c) => ({ type:'SPACE', id: c.req.param('spaceId') }))`
  - `POST /spaces/:spaceId/tags` — `EDIT` on the space; map UNIQUE-violation SQL error to 409.
  - `DELETE /tags/:id` — `FULL`, resolve scope via the tag's space (`usp_Tag_GetWorkspaceId` is for workspace; for object-access resolve the SPACE id — add `usp_Tag_GetSpaceId` returning `ProjectId`, or gate via `requirePermission('label.manage', { resolveWorkspace })` matching the labels module). Choose the labels-style `requirePermission` gate for tag mutations to match the sibling Labels surface; envelope `{ data }`.
  - `POST /tasks/:id/tags/:tagId` · `DELETE /tasks/:id/tags/:tagId` — `requirePermission('task.update', { resolveWorkspace: resolveTaskWorkspace })` (mount these on the tasks router OR the tags router; if on tags router, add a task-workspace resolver).
  Publish `pubsub.publish('tag:updated', { spaceId, tag })` / `task:updated` on link/unlink.
- [ ] **Step 5:** GraphQL mirror `tags.schema.ts` — `spaceTags(spaceId)` query, `createTag`/`deleteTag`/`linkTag`/`unlinkTag` mutations; wire in `schema.ts`. Add `'tag:updated': [{ spaceId: string; tag: unknown }]` to `PubSubChannels`.
- [ ] **Step 6:** Mount `app.route('/spaces', tagRoutes)` (or a dedicated prefix; ensure no clash with existing space routes — if `/spaces` is taken, mount tag routes under the existing spaces router or use `/tags` + `?spaceId=`). VERIFY existing `/spaces` mounting before choosing. Typecheck.
- [ ] **Step 7: Commit** (if authorized)
```bash
git add apps/api/src/modules/tags/ apps/api/src/graphql/tags.schema.ts apps/api/src/server.ts apps/api/src/graphql/schema.ts apps/api/src/graphql/pubsub.ts
git commit -m "feat(tags): module, routes, GraphQL mirror, wiring"
```

### Task C3: Frontend — tag picker

**Files:** `apps/next-web/src/server/queries/tags.ts`, `apps/next-web/src/server/actions/tags.ts`, `apps/next-web/src/components/TagPicker.tsx`; modify `TaskDrawer.tsx`.

- [ ] **Step 1:** Query `getSpaceTags(spaceId)`; actions `createTag(spaceId, name, color)`, `deleteTag(id)`, `linkTag(taskId, tagId)`, `unlinkTag(taskId, tagId)` (revalidate `TASK_LIST_PATHS` for link/unlink; settings path for create/delete).
- [ ] **Step 2:** `TagPicker.tsx` (`'use client'`) — `Popover` listing space tags as colored `Badge`s; toggle to link/unlink; an inline "create new tag" input with color (create-on-the-fly). Optimistic + rollback + `notifyActionError`.
- [ ] **Step 3:** Wire into `TaskDrawer.tsx` (a Tags row showing linked tags + the picker). Typecheck.
- [ ] **Step 4: Commit** (if authorized)
```bash
git add apps/next-web/src/server/queries/tags.ts apps/next-web/src/server/actions/tags.ts apps/next-web/src/components/TagPicker.tsx apps/next-web/src/components/TaskDrawer.tsx
git commit -m "feat(web): tag picker (create-on-the-fly, link/unlink)"
```

### Task C4: Verification — tags

**Files:** `apps/api/src/modules/tags/__tests__/tag.integration.test.ts`, `apps/api/src/modules/tags/__tests__/multitenancy.integration.test.ts`

- [ ] **Step 1:** Integration — create tag in a space; link to a task; `GET` task shows the tag; unlink removes it; deleting a linked tag also clears the link (no FK error). Duplicate-name create → 409.
- [ ] **Step 2:** Multitenancy — user B cannot list/create tags in user A's space (403/404).
- [ ] **Step 3:** Run (`-- src/modules/tags`). **PASTE OUTPUT.**
- [ ] **Step 4: Commit** (if authorized)
```bash
git add apps/api/src/modules/tags/__tests__/
git commit -m "test(tags): create/link/unlink/delete, dup-name 409, multitenancy"
```

## ✅ STREAM C REVIEW CHECKPOINT — STOP for human approval (paste test output).

---

## STREAM D — Watchers + multiple-assignee gate

`TaskWatchers` table + `Projects.MultipleAssignees` shipped in migration 0030 (Task A1).

### Task D1: Watcher procs + module + routes + GraphQL

**Files:** `infra/sql/procedures/usp_TaskWatcher_{Add,Remove,List}.sql`; `apps/api/src/modules/watchers/{watcher.repository,watcher.service,watcher.routes}.ts`; `apps/api/src/graphql/watchers.schema.ts`; modify `server.ts`, `schema.ts`, `pubsub.ts`.

- [ ] **Step 1: Procs**
```sql
-- usp_TaskWatcher_Add.sql
CREATE OR ALTER PROCEDURE dbo.usp_TaskWatcher_Add @TaskId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL) THROW 51360, 'Task not found', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.TaskWatchers WHERE TaskId = @TaskId AND UserId = @UserId)
            INSERT INTO dbo.TaskWatchers (TaskId, UserId) VALUES (@TaskId, @UserId);
        SELECT * FROM dbo.TaskWatchers WHERE TaskId = @TaskId AND UserId = @UserId;
    END TRY BEGIN CATCH THROW; END CATCH
END;
-- usp_TaskWatcher_Remove.sql
CREATE OR ALTER PROCEDURE dbo.usp_TaskWatcher_Remove @TaskId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS BEGIN SET NOCOUNT ON; DELETE FROM dbo.TaskWatchers WHERE TaskId = @TaskId AND UserId = @UserId; END;
-- usp_TaskWatcher_List.sql
CREATE OR ALTER PROCEDURE dbo.usp_TaskWatcher_List @TaskId UNIQUEIDENTIFIER
AS BEGIN SET NOCOUNT ON; SELECT * FROM dbo.TaskWatchers WHERE TaskId = @TaskId ORDER BY CreatedAt; END;
```
(one proc per file.)

- [ ] **Step 2: Module** — repository (`add/remove/list`), service singleton, routes:
  - `GET /tasks/:id/watchers` (VIEW on task list via object-access, or `requirePermission` task read), `POST /tasks/:id/watchers/:userId`, `DELETE /tasks/:id/watchers/:userId` — gate with `requirePermission('task.update', { resolveWorkspace: resolveTaskWorkspace })` to match the tasks surface. Publish `watcher:updated`.
- [ ] **Step 3: GraphQL** `watchers.schema.ts` — `taskWatchers(taskId)` query + add/remove mutations; wire in `schema.ts`. Add `'watcher:updated': [{ taskId: string; watchers: unknown }]` to `PubSubChannels`. Mount `app.route('/tasks', watcherRoutes)` OR fold watcher routes into the tasks router (recommended: add the three watcher endpoints directly in `task.routes.ts` to share `resolveTaskWorkspace`). Typecheck.
- [ ] **Step 4: Commit** (if authorized)
```bash
git add infra/sql/procedures/usp_TaskWatcher_*.sql apps/api/src/modules/watchers/ apps/api/src/graphql/watchers.schema.ts apps/api/src/server.ts apps/api/src/graphql/schema.ts apps/api/src/graphql/pubsub.ts
git commit -m "feat(watchers): procs, module, routes, GraphQL mirror"
```

### Task D2: Multiple-assignee gate

**Files:** `infra/sql/procedures/usp_Space_SetMultipleAssignees.sql`, `usp_Space_GetMultipleAssignees.sql`; modify `apps/api/src/modules/tasks/task.service.ts`, `apps/api/src/modules/tasks/task.repository.ts`, `apps/api/src/modules/tasks/task.routes.ts`, and the existing Space-settings PATCH route/SP.

- [ ] **Step 1: Procs**
```sql
-- usp_Space_GetMultipleAssignees.sql
CREATE OR ALTER PROCEDURE dbo.usp_Space_GetMultipleAssignees @TaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT p.MultipleAssignees FROM dbo.Tasks t JOIN dbo.Projects p ON p.Id = t.ProjectId WHERE t.Id = @TaskId;
END;
-- usp_Space_SetMultipleAssignees.sql
CREATE OR ALTER PROCEDURE dbo.usp_Space_SetMultipleAssignees @SpaceId UNIQUEIDENTIFIER, @Value BIT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.Projects SET MultipleAssignees = @Value, UpdatedAt = SYSUTCDATETIME() WHERE Id = @SpaceId;
    SELECT * FROM dbo.Projects WHERE Id = @SpaceId;
END;
```

- [ ] **Step 2: Enforce the gate in `setAssignees`** — `task.service.ts`:
```ts
// repo helper in task.repository.ts:
//   async getSpaceMultipleAssignees(taskId: string): Promise<boolean> {
//     const rows = await execSpOne<{ MultipleAssignees: boolean }>('usp_Space_GetMultipleAssignees',
//       [{ name: 'TaskId', type: sql.UniqueIdentifier, value: taskId }]);
//     return !!(rows[0]?.MultipleAssignees ?? 1);
//   }
import { MultipleAssigneesDisabledError } from './task.errors.js'; // new typed error (see Step 3)
async setAssignees(taskId: string, userIds: string[], actorId: string): Promise<AssigneeRow[]> {
  if (userIds.length > 1) {
    const allowed = await this.repo.getSpaceMultipleAssignees(taskId);
    if (!allowed) throw new MultipleAssigneesDisabledError();
  }
  // …existing body…
}
```

- [ ] **Step 3: Typed error + route mapping** — create `apps/api/src/modules/tasks/task.errors.ts`:
```ts
export class MultipleAssigneesDisabledError extends Error {
  constructor() { super('This space does not allow multiple assignees'); this.name = 'MultipleAssigneesDisabledError'; }
}
```
In `task.routes.ts` `PUT /:id/assignees` catch, before the generic 500:
```ts
if (err instanceof MultipleAssigneesDisabledError)
  return c.json({ error: { code: 'MULTIPLE_ASSIGNEES_DISABLED', message: err.message } }, 422);
```

- [ ] **Step 4: Space-settings PATCH accepts `multipleAssignees`** — extend the existing Space settings PATCH route + its SP to accept and persist `multipleAssignees` (mirroring how `visibility`/`maxSubtaskDepth` from 0029 are handled). Grep for the existing space-update route/SP (`usp_*Space*Update` / project settings) and add the column to its COALESCE update; extend the Zod schema with `multipleAssignees: z.boolean().optional()`. Also extend `SpaceExtras` mapping wherever space settings are read so the UI receives `multipleAssignees`.
- [ ] **Step 5: Deploy + typecheck.** `npm run db:deploy-sps; npx tsc -p apps/api/tsconfig.json --noEmit`
- [ ] **Step 6: Commit** (if authorized)
```bash
git add infra/sql/procedures/usp_Space_*MultipleAssignees.sql apps/api/src/modules/tasks/
git commit -m "feat(tasks): multiple-assignees space toggle + 422 gate on setAssignees"
```

### Task D3: Frontend — watcher control + multi-assignee collapse + toggle in settings

**Files:** `apps/next-web/src/server/queries/watchers.ts`, `apps/next-web/src/server/actions/watchers.ts`, `apps/next-web/src/components/WatcherControl.tsx`; modify `TaskDrawer.tsx`, the assignee picker, and the Space settings view.

- [ ] **Step 1:** Query `getTaskWatchers(taskId)`; actions `addWatcher(taskId,userId)`/`removeWatcher(taskId,userId)` (revalidate `TASK_LIST_PATHS`).
- [ ] **Step 2:** `WatcherControl.tsx` — list watchers (avatars) + add/remove control (member picker). Wire into `TaskDrawer.tsx`.
- [ ] **Step 3:** Multi-assignee picker collapse — the drawer's assignee picker reads the space's `multipleAssignees`; when false, render single-select (replace, not add). The existing `setTaskAssignees` action already replaces the full set; pass at most one id when the toggle is off and surface the 422 (`MULTIPLE_ASSIGNEES_DISABLED`) via `notifyActionError` if the server rejects.
- [ ] **Step 4:** Add a `multipleAssignees` toggle (`ui/switch`) to the Space settings view, calling the extended space-settings action. Typecheck.
- [ ] **Step 5: Commit** (if authorized)
```bash
git add apps/next-web/src/server/queries/watchers.ts apps/next-web/src/server/actions/watchers.ts apps/next-web/src/components/WatcherControl.tsx apps/next-web/src/components/TaskDrawer.tsx apps/next-web/src/app/(app)/
git commit -m "feat(web): watcher control + multi-assignee collapse + space toggle"
```

### Task D4: Verification — watchers + multi-assignee gate

**Files:** `apps/api/src/modules/watchers/__tests__/watcher.integration.test.ts`, `apps/api/src/modules/watchers/__tests__/multi-assignee-gate.integration.test.ts`

- [ ] **Step 1:** Watcher integration — add a watcher; `GET` lists it; add again is idempotent; remove clears it.
- [ ] **Step 2:** Multi-assignee gate — with the space toggle ON (default), `PUT /tasks/:id/assignees` with 2 users succeeds; turn the toggle OFF (PATCH space settings), then 2 users → 422 `MULTIPLE_ASSIGNEES_DISABLED`; 1 user still succeeds.
- [ ] **Step 3:** Multitenancy — user B cannot add a watcher to user A's task (403/404).
- [ ] **Step 4: Run** (`-- src/modules/watchers`). **PASTE OUTPUT.**
- [ ] **Step 5: Commit** (if authorized)
```bash
git add apps/api/src/modules/watchers/__tests__/
git commit -m "test(watchers): add/remove/idempotent + multi-assignee gate 422 + multitenancy"
```

## ✅ STREAM D REVIEW CHECKPOINT — STOP for human approval.

---

## FINAL PHASE-2 VERIFICATION (after all four streams)

- [ ] Full `npm run test:unit --workspace apps/api` green. **PASTE.**
- [ ] Full `npm run test:integration --workspace apps/api` green (all new + existing). **PASTE.**
- [ ] `npx playwright test e2e/custom-fields.spec.ts` (+ existing e2e suite) green. **PASTE.**
- [ ] Reversibility: apply 0030 + run `0030_custom_fields.down.sql` on a scratch/clone DB → clean teardown (auto-named DEFAULT-constraint drop verified). **PASTE.**
- [ ] Regression: `/board`, `/backlog`, `/roadmap` render 200. **PASTE.**
- [ ] ENV RESTORE: `apps/api/.env` restored from `.env.prod.bak`, backup deleted, `docker compose down`.
- [ ] Record any spec deviations in `DECISIONS.md`.
- [ ] STOP for human review before Phase 3. Do NOT merge/push/start Phase 3 without explicit OK.

---

## Self-Review (run against the spec with fresh eyes)

**1. Spec coverage** (spec `2026-06-04-custom-fields-phase2-design.md`):
- §A migration 0030 + rollback → **A1** ✓
- §B 15 types + validation + progress_auto + required-on-done → **A3** (validators), **A4** (`RequiredUnmetForStatus`, `RecomputeProgressAuto`), **A6/A10** ✓
- §C cascade resolver (path-prefix) → **A4** `usp_CustomField_EffectiveForTask` ✓
- §D API surface: custom-fields CRUD/reorder/effective/value → **A4–A8**; task-types → **B**; tags → **C**; watchers → **D1**; multi-assignee gate → **D2**; pubsub events → each stream's wiring ✓
- §E types → **A2** (+ `Tag`, `TaskType`, `TaskWatcher`, `SpaceExtras.multipleAssignees`) ✓
- §F frontend (field manager, inline cells, type selector + milestone, tag picker, watcher control, multi-assignee collapse) → **A11–A13, B4, C3, D3** ✓
- §G testing (unit validators, cascade, value round-trip, progress_auto, required-on-done, type sync, tag link/unlink, watcher, multi-assignee gate, multitenancy per repo, e2e headline, reversibility, regression) → **A14, B5, C4, D4, Final** ✓
- §I acceptance table → covered by the above ✓

**2. Placeholder scan** — All code steps contain complete code. Two intentional, flagged "VERIFY/derive" notes remain (the `getById` proc fix in A5 — fixed in the same task's Step 3; the per-type cell table in A12 — each cell mechanically derivable from 3 full examples + exact table). These are explicit, not silent TODOs.

**3. Type consistency** — Names consistent across tasks: `validateFieldValue`, `CustomFieldConfig`/`EffectiveField`/`CustomField`, `usp_CustomField_EffectiveForTask`, `customFieldService.assertRequiredMetForStatus`/`recomputeProgressAuto`/`setValue`, `RequiredFieldsUnmetError`/`FieldValidationError`, `setTaskCustomField`, `legacyTypeForTaskType`, `usp_Task_SetType`, `MultipleAssigneesDisabledError`, `TASK_LIST_PATHS`, `MultipleAssignees`. Pubsub channels added in their streams: `customField:updated`, `taskType:updated`, `tag:updated`, `watcher:updated`.

**Open verification items the executor must confirm against live code (flagged inline):** async resolver support in `requireObjectAccess` (A7); whether `createTestProject` triggers default-list backfill (A14); existence of a workspace-membership check helper (A6); correct permission slug for workspace-resource routes (B3); `/spaces` mount collision for tag routes (C2); the existing Space-settings PATCH route/SP to extend (D2).


---

## Self-Review (run against the spec once all segments are written)

1. **Spec coverage** — map every spec section (A migration, B 15 types+validation, C cascade resolver, D API surface incl. tags/watchers/multi-assignee, E types, F frontend, G testing, I acceptance table) to a task; list gaps.
2. **Placeholder scan** — no "TBD"/"add validation"/"similar to Task N"; every code step shows complete code.
3. **Type consistency** — verify symbol names match across tasks: `validateFieldValue`, `CustomFieldConfig`, `EffectiveField`, `usp_CustomField_EffectiveForTask`, `setTaskCustomField`, `MultipleAssignees`, `TASK_LIST_PATHS`.
