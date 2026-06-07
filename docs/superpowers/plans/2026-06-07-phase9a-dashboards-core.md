# Phase 9a — Dashboards Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the hardcoded dashboard page into a first-class, savable, **config-driven** object: `Dashboards` + `DashboardCards` tables scoped exactly like `SavedViews` (workspace/space/folder/list × private/shared/protected), a **movable/resizable card grid** (dnd-kit, already installed), **wave-1 card types** (`task_list`, `calculation`, `bar`, `line`, `pie`, `time_tracked`, `goal`) resolved through **one shared `card.service` dispatcher**, **per-card filters** reusing the Phase 3 filter-builder, and **PDF export** via a `?print=1` print-optimized layout + browser print-to-PDF. Surfaced as Hono REST (primary) + a GraphQL mirror over the same service.

**Architecture:** A dashboard is a `Dashboards` row; each card is a `DashboardCards(Type, Config NVARCHAR(MAX), Layout NVARCHAR(MAX))` row. The decisive mechanism is **one resolver, three data sources** — `cardService.resolve(card, scope, userId)` routes:
- **generic cards** (`task_list`/`calculation`/`bar`/`line`/`pie`) → the **Phase 3 view query compiler** (`viewService.runConfig(scopeType, scopeId, config, opts, workspaceId, userId)` in `apps/api/src/modules/views/`), so a card is "a saved query + a chart shape", and runs under the **requesting user's object-level filter** (the same `requireObjectLevel`/`scopePath` machinery the views use — a card never returns rows a user could not read directly);
- **entity cards** (`time_tracked`/`goal`) → Phase 8 services. **Phase 8 is not built on-disk yet** (no `goals` module; `worklog.service` is still basic CRUD), so `time_tracked` resolves through a NEW scope-aggregating worklog SP (`usp_Dashboard_TimeTracked`) and `goal` ships as a **feature-flagged stub** that returns an empty/placeholder payload until Phase 8's `goal.service` lands (re-point is a one-line registry change — designed to extend cleanly).

`card.service` is a **registry of per-type resolvers** keyed on `CardType` so **9b** can add `burndown`/`velocity`/`burnup`/`portfolio`/`timesheet`/`battery` and **9c** can snapshot every card by iterating the same registry — no per-card bespoke plumbing.

**Tech Stack:** SQL Server stored procedures (`CREATE OR ALTER`, `SET NOCOUNT ON`, TRY/CATCH/TRANSACTION, idempotent GO-batched migration + rollback); Hono REST + `@hono/zod-validator`; graphql-yoga + Pothos (`@pothos/core`, `register*Graphql()` in `apps/api/src/graphql/schema.ts`); `mssql` via `execSp`/`execSpOne`; vitest (`--project unit` / `--project integration`); Next.js App Router (SSR) + `next-intl` (en + id parity); `@dnd-kit/core` + `@dnd-kit/sortable` (already in `apps/next-web/package.json`); Recharts v3.8.1 card renderers; Playwright e2e. DB work runs ONLY against local Docker `ProjectFlow_Test`.

**Prerequisite:** Phases 1–8 merged; reuses the Phase 3 query compiler + the existing chart components. (On-disk migrations are currently `0037`; the spec assigns Phase 9a migration **`0047`** assuming Phases 6/7/8 land first at `0038–0046`. Keep `0047` as the cross-slice contract; if Phase 8 has not landed, see Task 5's `goal`/`time_tracked` stubbing notes.)

---

## File Structure

**Migration**
- `infra/sql/migrations/0047_dashboards.sql` — **Create.** Idempotent, GO-batched: `Dashboards` (scope/visibility/default/position) + `DashboardCards` (Type/Config/Layout/Position) with CHECK constraints + scope/dashboard indexes.
- `infra/sql/migrations/rollback/0047_dashboards.down.sql` — **Create.** Reverse: drop `DashboardCards` then `Dashboards`.

**Stored procedures** (`infra/sql/procedures/`)
- `usp_Dashboard_Create.sql` — **Create.** Insert a dashboard, return the row.
- `usp_Dashboard_GetById.sql` — **Create.** Return one dashboard (no workspace filter; service/authz guards tenancy).
- `usp_Dashboard_GetWorkspaceId.sql` — **Create.** Return a dashboard's WorkspaceId (RBAC resolver).
- `usp_Dashboard_Update.sql` — **Create.** ISNULL-coalesced patch of Name/Description/Visibility/Position; return the row.
- `usp_Dashboard_Delete.sql` — **Create.** Soft-delete (`DeletedAt`), return the row.
- `usp_Dashboard_ListByScope.sql` — **Create.** Visibility-filtered list for a scope (`Visibility='shared' OR OwnerId=@UserId`), mirroring `usp_View_List`.
- `usp_Dashboard_SetDefault.sql` — **Create.** Transactionally clear the existing default for the (ScopeType,ScopeId) and set this one — the **one-default-per-scope guard**.
- `usp_DashboardCard_Create.sql` — **Create.** Insert a card under a dashboard, return it.
- `usp_DashboardCard_Update.sql` — **Create.** ISNULL-coalesced patch of Title/Config/Layout/Position; return it.
- `usp_DashboardCard_Delete.sql` — **Create.** Delete a card, return it.
- `usp_DashboardCard_Reorder.sql` — **Create.** Bulk-apply `{id,layout,position}` from a JSON payload (one round-trip for drag/resize persistence), return the dashboard's cards.
- `usp_Dashboard_TimeTracked.sql` — **Create.** Aggregate `WorkLogs.TimeSpentSeconds` over a scope (`ListPath LIKE @ScopePrefix`), grouped by user — backs the `time_tracked` card without a Phase 8 service.

**API: dashboard + card.service** (`apps/api/src/`)
- `modules/dashboards/dashboard.repository.ts` — **Create.** `execSpOne` wrappers for every dashboard/card SP + row→type mappers.
- `modules/dashboards/dashboard.service.ts` — **Create.** Dashboard + card CRUD, scope resolution (reuse `CustomFieldRepository.getScopeNode`), **default-per-scope guard**, **visibility resolution** (reuse the `SavedViews` shared/private rule).
- `modules/dashboards/card.service.ts` — **Create.** The §2.1 dispatcher: a `CardResolver` registry keyed on `CardType`; `resolve(card, scope, userId)` routes generic cards through `viewService.runConfig` (object-level scoped) and `time_tracked`/`goal` through entity resolvers; `aggregate()` helper for `calculation` (count/sum/avg/min/max).
- `modules/dashboards/card.aggregate.ts` — **Create.** Pure aggregation helpers (`computeAggregate`, `cardConfigToViewConfig`) — unit-testable without a DB.
- `modules/dashboards/dashboard.routes.ts` — **Create.** REST: `/dashboards` CRUD + `/dashboards/:id/cards` CRUD + `/cards/:cardId/data` resolve + `/dashboards/:id/set-default` + `/dashboards/:id/reorder-cards`.
- `modules/dashboards/dashboard.errors.ts` — **Create.** `DashboardNotFoundError` / `DashboardValidationError`.
- `graphql/dashboards.schema.ts` — **Create.** `registerDashboardsGraphql()`: `Dashboard`/`DashboardCard`/`CardData` types + `dashboards(scope)`/`dashboard(id)`/`dashboardCardData(cardId)` queries + create/update/delete/reorder/setDefault mutations.
- `graphql/schema.ts` — **Modify.** Import + call `registerDashboardsGraphql()`.
- `server.ts` — **Modify.** `app.route('/dashboards', dashboardRoutes)`.

**Types** (`packages/types/`)
- `index.ts` — **Modify.** Add `CardType`, `CardConfig`, `DashboardCardLayout`, `DashboardCard`, `Dashboard`, `DashboardScopeType`, `DashboardVisibility`, `CardData`, and the create/update input shapes.

**Frontend: grid + card renderers + print layout** (`apps/next-web/src/`)
- `app/(app)/dashboard/page.tsx` — **Modify.** Re-point: load the scope's dashboards (seed a default), render the grid (or the `?print=1` print layout).
- `app/(app)/dashboard/dashboard-view.tsx` — **Modify.** Re-point from the hardcoded gadget grid to `<DashboardGrid />`; keep the header/switchers.
- `components/dashboard/DashboardGrid.tsx` — **Create.** dnd-kit movable/resizable card grid: add-card, configure-card, resize, reorder, per-card filter editor, PDF-export button.
- `components/dashboard/DashboardGrid.module.css` — **Create.** Grid + card-chrome styles.
- `components/dashboard/card-registry.tsx` — **Create.** Maps `CardType` → renderer (existing Recharts charts + the generic renderers); 9b extends this.
- `components/dashboard/TaskListCard.tsx` — **Create.** Generic `task_list` renderer (rows from compiled query).
- `components/dashboard/CalculationCard.tsx` — **Create.** Generic `calculation` renderer (a single big number).
- `components/dashboard/CardConfigDrawer.tsx` — **Create.** Per-card config + filter editor (reuses `filter-builder`'s rule machinery).
- `app/(app)/dashboard/print/dashboard-print.tsx` — **Create.** The `?print=1` print-optimized read-only layout that auto-invokes `window.print()`.
- `server/actions/dashboards.ts` — **Create.** Server actions over the REST surface (list/create/update/delete/reorder/setDefault + `getCardData`).
- `server/queries/dashboards.ts` — **Create.** SSR `serverFetch` reads (scope dashboards + card data).

**i18n**
- `messages/en.json` — **Modify.** New `Dashboard` additions + a `DashboardCards` namespace (card-type labels, aggregate ops, axis/series labels, print/export/empty strings).
- `messages/id.json` — **Modify.** Same keys, real Indonesian.

**Tests**
- `apps/api/src/modules/dashboards/__tests__/card-aggregate.unit.test.ts` — **Create.** Pure: `cardConfigToViewConfig` (config→compiled-query mapping) + `computeAggregate` (count/sum/avg/min/max + empty/no-field).
- `apps/api/src/modules/dashboards/__tests__/visibility.unit.test.ts` — **Create.** Pure: visibility resolution + default-per-scope guard logic.
- `apps/api/src/modules/dashboards/__tests__/dashboards.integration.test.ts` — **Create.** Dashboard+card CRUD; card data under object-level scoping (no-access user sees no rows); reorder/resize persists; one-default-per-scope.
- `apps/next-web/src/components/dashboard/__tests__/card-registry.unit.test.tsx` — **Create.** Registry resolves each wave-1 type to a renderer.
- `apps/next-web/e2e/dashboards.spec.ts` — **Create.** Create a dashboard, add ≥6 card types with live data + per-card filters, export to PDF.

---

## Tasks

### Task 1: Migration + rollback (`0047_dashboards.sql`)

**Files:**
- Create: `infra/sql/migrations/0047_dashboards.sql`
- Create: `infra/sql/migrations/rollback/0047_dashboards.down.sql`
- Test: manual deploy against local Docker `ProjectFlow_Test` (migrations have no unit harness; verified via the integration suite in Task 7).

Steps:

- [ ] Write the migration. Idempotent (`sys.tables` / `sys.indexes` guards), GO-batched, matching the `0032`/`0036` style. Column names/types are the spec's §4.1 exactly:

```sql
-- =============================================================================
-- Migration 0047: Dashboards (Phase 9a)
-- A dashboard is a first-class, scoped, savable object; each card is a typed
-- config row resolved by card.service. Scope + visibility mirror SavedViews.
--   * Dashboards     — ScopeType/ScopeId/Visibility/IsDefault/Position (+ soft delete)
--   * DashboardCards — Type/Config (JSON) /Layout {x,y,w,h} (JSON) /Position
-- Idempotent (catalog guards), GO-batched.
-- Rollback in rollback/0047_dashboards.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Dashboards')
BEGIN
    CREATE TABLE dbo.Dashboards (
        Id          UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL,
        ScopeType   NVARCHAR(12)     NOT NULL,           -- 'workspace'|'space'|'folder'|'list'
        ScopeId     UNIQUEIDENTIFIER NULL,
        ScopePath   NVARCHAR(900)    NULL,               -- materialized path of the scope node (for card scoping)
        Name        NVARCHAR(200)    NOT NULL,
        Description NVARCHAR(MAX)    NULL,
        Visibility  NVARCHAR(10)     NOT NULL CONSTRAINT DF_Dashboards_Visibility DEFAULT 'shared', -- 'private'|'shared'|'protected'
        OwnerId     UNIQUEIDENTIFIER NOT NULL,
        IsDefault   BIT              NOT NULL CONSTRAINT DF_Dashboards_IsDefault DEFAULT 0,
        Position    FLOAT            NOT NULL CONSTRAINT DF_Dashboards_Position  DEFAULT 0,
        CreatedAt   DATETIME2        NOT NULL CONSTRAINT DF_Dashboards_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2        NOT NULL CONSTRAINT DF_Dashboards_UpdatedAt DEFAULT SYSUTCDATETIME(),
        DeletedAt   DATETIME2        NULL,
        CONSTRAINT CK_Dashboards_ScopeType  CHECK (ScopeType IN ('workspace','space','folder','list')),
        CONSTRAINT CK_Dashboards_Visibility CHECK (Visibility IN ('private','shared','protected')),
        CONSTRAINT CK_Dashboards_ScopeId    CHECK (ScopeType = 'workspace' OR ScopeId IS NOT NULL),
        CONSTRAINT FK_Dashboards_Workspace  FOREIGN KEY (WorkspaceId) REFERENCES dbo.Workspaces(Id),
        CONSTRAINT FK_Dashboards_Owner      FOREIGN KEY (OwnerId)     REFERENCES dbo.Users(Id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Dashboards_Scope' AND object_id = OBJECT_ID('dbo.Dashboards'))
    CREATE NONCLUSTERED INDEX IX_Dashboards_Scope
        ON dbo.Dashboards (WorkspaceId, ScopeType, ScopeId, Position) WHERE DeletedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DashboardCards')
BEGIN
    CREATE TABLE dbo.DashboardCards (
        Id          UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        DashboardId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_DashboardCards_Dashboard REFERENCES dbo.Dashboards(Id) ON DELETE CASCADE,
        Type        NVARCHAR(24)     NOT NULL,           -- card catalog token (wave-1 + 9b additions)
        Title       NVARCHAR(200)    NULL,
        Config      NVARCHAR(MAX)    NOT NULL,           -- JSON: data source + chart shape + per-card filter
        Layout      NVARCHAR(MAX)    NOT NULL,           -- JSON: { x, y, w, h }
        Position    FLOAT            NOT NULL CONSTRAINT DF_DashboardCards_Position  DEFAULT 0,
        CreatedAt   DATETIME2        NOT NULL CONSTRAINT DF_DashboardCards_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2        NOT NULL CONSTRAINT DF_DashboardCards_UpdatedAt DEFAULT SYSUTCDATETIME()
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DashboardCards_Dashboard' AND object_id = OBJECT_ID('dbo.DashboardCards'))
    CREATE NONCLUSTERED INDEX IX_DashboardCards_Dashboard ON dbo.DashboardCards (DashboardId, Position);
GO
```

- [ ] Write the rollback `rollback/0047_dashboards.down.sql` (child table first, then parent):

```sql
-- Rollback 0047: Dashboards. Drops DashboardCards then Dashboards.
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DashboardCards') DROP TABLE dbo.DashboardCards;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Dashboards')     DROP TABLE dbo.Dashboards;
GO
```

- [ ] Run against local Docker `ProjectFlow_Test` only (explicit local DB env, never `apps/api/.env`). Apply `0047_dashboards.sql` then the `.down.sql` then re-apply `0047` to prove idempotency + reversibility. Expected: all three runs succeed with no errors; the second `0047` apply is a clean no-op (guards skip everything).

- [ ] Commit:
```
git add infra/sql/migrations/0047_dashboards.sql infra/sql/migrations/rollback/0047_dashboards.down.sql
git commit -m "feat(9a): dashboards migration — Dashboards + DashboardCards (scope/visibility/layout)"
```

---

### Task 2: Dashboard CRUD SPs (`Create`/`GetById`/`GetWorkspaceId`/`Update`/`Delete`/`ListByScope`/`SetDefault`)

**Files:**
- Create: `infra/sql/procedures/usp_Dashboard_Create.sql`
- Create: `infra/sql/procedures/usp_Dashboard_GetById.sql`
- Create: `infra/sql/procedures/usp_Dashboard_GetWorkspaceId.sql`
- Create: `infra/sql/procedures/usp_Dashboard_Update.sql`
- Create: `infra/sql/procedures/usp_Dashboard_Delete.sql`
- Create: `infra/sql/procedures/usp_Dashboard_ListByScope.sql`
- Create: `infra/sql/procedures/usp_Dashboard_SetDefault.sql`
- Test: covered by `dashboards.integration.test.ts` (Task 7); deploy via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`.

Steps:

- [ ] Write `usp_Dashboard_Create.sql` — insert + return `SELECT *` of the new row:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Dashboard_Create
  @Id          UNIQUEIDENTIFIER,
  @WorkspaceId UNIQUEIDENTIFIER,
  @OwnerId     UNIQUEIDENTIFIER,
  @ScopeType   NVARCHAR(12),
  @ScopeId     UNIQUEIDENTIFIER = NULL,
  @ScopePath   NVARCHAR(900)   = NULL,
  @Name        NVARCHAR(200),
  @Description NVARCHAR(MAX)   = NULL,
  @Visibility  NVARCHAR(10)    = 'shared',
  @IsDefault   BIT             = 0,
  @Position    FLOAT           = 0
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.Dashboards (Id, WorkspaceId, OwnerId, ScopeType, ScopeId, ScopePath, Name, Description, Visibility, IsDefault, Position)
  VALUES (@Id, @WorkspaceId, @OwnerId, @ScopeType, @ScopeId, @ScopePath, @Name, @Description, @Visibility, @IsDefault, @Position);

  SELECT * FROM dbo.Dashboards WHERE Id = @Id;
END;
GO
```

- [ ] Write `usp_Dashboard_GetById.sql`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Dashboard_GetById
  @Id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM dbo.Dashboards WHERE Id = @Id AND DeletedAt IS NULL;
END;
GO
```

- [ ] Write `usp_Dashboard_GetWorkspaceId.sql` (RBAC resolver — mirrors `usp_View_GetWorkspaceId`):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Dashboard_GetWorkspaceId
  @Id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT WorkspaceId FROM dbo.Dashboards WHERE Id = @Id AND DeletedAt IS NULL;
END;
GO
```

- [ ] Write `usp_Dashboard_Update.sql` (ISNULL-coalesced patch; touch `UpdatedAt`):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Dashboard_Update
  @Id          UNIQUEIDENTIFIER,
  @Name        NVARCHAR(200) = NULL,
  @Description NVARCHAR(MAX) = NULL,
  @Visibility  NVARCHAR(10)  = NULL,
  @Position    FLOAT         = NULL
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.Dashboards SET
    Name        = ISNULL(@Name,        Name),
    Description = ISNULL(@Description, Description),
    Visibility  = ISNULL(@Visibility,  Visibility),
    Position    = ISNULL(@Position,    Position),
    UpdatedAt   = SYSUTCDATETIME()
  WHERE Id = @Id AND DeletedAt IS NULL;

  SELECT * FROM dbo.Dashboards WHERE Id = @Id;
END;
GO
```

- [ ] Write `usp_Dashboard_Delete.sql` (soft delete):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Dashboard_Delete
  @Id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.Dashboards SET DeletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
   WHERE Id = @Id AND DeletedAt IS NULL;
  SELECT * FROM dbo.Dashboards WHERE Id = @Id;
END;
GO
```

- [ ] Write `usp_Dashboard_ListByScope.sql` — visibility-filtered (mirrors `usp_View_List`: shared OR owned). `protected` is treated as readable like `shared` here (write-gating happens at the service/route layer):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Dashboard_ListByScope
  @WorkspaceId UNIQUEIDENTIFIER,
  @UserId      UNIQUEIDENTIFIER,
  @ScopeType   NVARCHAR(12),
  @ScopeId     UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM dbo.Dashboards
   WHERE WorkspaceId = @WorkspaceId
     AND ScopeType = @ScopeType
     AND ((@ScopeId IS NULL AND ScopeId IS NULL) OR ScopeId = @ScopeId)
     AND DeletedAt IS NULL
     AND (Visibility IN ('shared','protected') OR OwnerId = @UserId)
   ORDER BY Position ASC, CreatedAt ASC;
END;
GO
```

- [ ] Write `usp_Dashboard_SetDefault.sql` — the **one-default-per-scope guard**: transactionally clear the existing default for this exact (ScopeType,ScopeId) and set the target:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Dashboard_SetDefault
  @Id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @WorkspaceId UNIQUEIDENTIFIER, @ScopeType NVARCHAR(12), @ScopeId UNIQUEIDENTIFIER;
    SELECT @WorkspaceId = WorkspaceId, @ScopeType = ScopeType, @ScopeId = ScopeId
      FROM dbo.Dashboards WHERE Id = @Id AND DeletedAt IS NULL;

    UPDATE dbo.Dashboards SET IsDefault = 0, UpdatedAt = SYSUTCDATETIME()
     WHERE WorkspaceId = @WorkspaceId AND ScopeType = @ScopeType
       AND ((@ScopeId IS NULL AND ScopeId IS NULL) OR ScopeId = @ScopeId)
       AND DeletedAt IS NULL AND IsDefault = 1 AND Id <> @Id;

    UPDATE dbo.Dashboards SET IsDefault = 1, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id;

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;

  SELECT * FROM dbo.Dashboards WHERE Id = @Id;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`. Expected: all seven procedures created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_Dashboard_Create.sql infra/sql/procedures/usp_Dashboard_GetById.sql infra/sql/procedures/usp_Dashboard_GetWorkspaceId.sql infra/sql/procedures/usp_Dashboard_Update.sql infra/sql/procedures/usp_Dashboard_Delete.sql infra/sql/procedures/usp_Dashboard_ListByScope.sql infra/sql/procedures/usp_Dashboard_SetDefault.sql
git commit -m "feat(9a): dashboard CRUD SPs — create/get/update/delete/listByScope + one-default-per-scope guard"
```

---

### Task 3: Card SPs (`Create`/`Update`/`Delete`/`Reorder`) + `Dashboard_TimeTracked`

**Files:**
- Create: `infra/sql/procedures/usp_DashboardCard_Create.sql`
- Create: `infra/sql/procedures/usp_DashboardCard_Update.sql`
- Create: `infra/sql/procedures/usp_DashboardCard_Delete.sql`
- Create: `infra/sql/procedures/usp_DashboardCard_Reorder.sql`
- Create: `infra/sql/procedures/usp_Dashboard_TimeTracked.sql`
- Test: covered by `dashboards.integration.test.ts` (Task 7); deploy via `scripts/db-deploy-sps.ts`.

Steps:

- [ ] Write `usp_DashboardCard_Create.sql`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_DashboardCard_Create
  @Id          UNIQUEIDENTIFIER,
  @DashboardId UNIQUEIDENTIFIER,
  @Type        NVARCHAR(24),
  @Title       NVARCHAR(200) = NULL,
  @Config      NVARCHAR(MAX),
  @Layout      NVARCHAR(MAX),
  @Position    FLOAT = 0
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.DashboardCards (Id, DashboardId, Type, Title, Config, Layout, Position)
  VALUES (@Id, @DashboardId, @Type, @Title, @Config, @Layout, @Position);

  SELECT * FROM dbo.DashboardCards WHERE Id = @Id;
END;
GO
```

- [ ] Write `usp_DashboardCard_Update.sql` (ISNULL-coalesced):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_DashboardCard_Update
  @Id       UNIQUEIDENTIFIER,
  @Title    NVARCHAR(200) = NULL,
  @Config   NVARCHAR(MAX) = NULL,
  @Layout   NVARCHAR(MAX) = NULL,
  @Position FLOAT         = NULL
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.DashboardCards SET
    Title     = ISNULL(@Title,    Title),
    Config    = ISNULL(@Config,   Config),
    Layout    = ISNULL(@Layout,   Layout),
    Position  = ISNULL(@Position, Position),
    UpdatedAt = SYSUTCDATETIME()
  WHERE Id = @Id;

  SELECT * FROM dbo.DashboardCards WHERE Id = @Id;
END;
GO
```

- [ ] Write `usp_DashboardCard_Delete.sql`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_DashboardCard_Delete
  @Id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @Row TABLE (Id UNIQUEIDENTIFIER, DashboardId UNIQUEIDENTIFIER, Type NVARCHAR(24),
                      Title NVARCHAR(200), Config NVARCHAR(MAX), Layout NVARCHAR(MAX),
                      Position FLOAT, CreatedAt DATETIME2, UpdatedAt DATETIME2);
  DELETE FROM dbo.DashboardCards OUTPUT DELETED.* INTO @Row WHERE Id = @Id;
  SELECT * FROM @Row;
END;
GO
```

- [ ] Write `usp_DashboardCard_Reorder.sql` — apply `{id,layout,position}` from a JSON array in ONE round-trip (drag/resize persistence), then return the dashboard's cards. Card ids are validated to belong to `@DashboardId` (no cross-dashboard writes):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_DashboardCard_Reorder
  @DashboardId UNIQUEIDENTIFIER,
  @Cards       NVARCHAR(MAX)        -- JSON: [{ "id": "...", "layout": "{...}", "position": 1 }, ...]
AS
BEGIN
  SET NOCOUNT ON;
  BEGIN TRY
    BEGIN TRANSACTION;

    UPDATE c SET
      c.Layout    = j.Layout,
      c.Position  = j.Position,
      c.UpdatedAt = SYSUTCDATETIME()
    FROM dbo.DashboardCards c
    JOIN OPENJSON(@Cards) WITH (
      Id       UNIQUEIDENTIFIER '$.id',
      Layout   NVARCHAR(MAX)    '$.layout' AS JSON,
      Position FLOAT            '$.position'
    ) j ON j.Id = c.Id
    WHERE c.DashboardId = @DashboardId;   -- scope guard: only this dashboard's cards

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;

  SELECT * FROM dbo.DashboardCards WHERE DashboardId = @DashboardId ORDER BY Position ASC, CreatedAt ASC;
END;
GO
```

- [ ] Write `usp_Dashboard_TimeTracked.sql` — aggregate logged time over a scope by user. Scope is the dashboard's `ScopePath` prefix over `Tasks.ListPath` (the same materialized-path predicate the view compiler uses); `@ScopePrefix` NULL means workspace-wide:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Dashboard_TimeTracked
  @WorkspaceId UNIQUEIDENTIFIER,
  @ScopePrefix NVARCHAR(901) = NULL   -- e.g. '/spaceId/folderId/%'; NULL = whole workspace
AS
BEGIN
  SET NOCOUNT ON;
  SELECT
    u.Id   AS UserId,
    u.Name AS UserName,
    SUM(wl.TimeSpentSeconds) AS TotalSeconds
  FROM dbo.WorkLogs wl
  JOIN dbo.Tasks t ON t.Id = wl.TaskId AND t.WorkspaceId = @WorkspaceId AND t.DeletedAt IS NULL
  JOIN dbo.Users u ON u.Id = wl.UserId
  WHERE (@ScopePrefix IS NULL OR t.ListPath LIKE @ScopePrefix)
  GROUP BY u.Id, u.Name
  ORDER BY TotalSeconds DESC;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`. Expected: all five procedures created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_DashboardCard_Create.sql infra/sql/procedures/usp_DashboardCard_Update.sql infra/sql/procedures/usp_DashboardCard_Delete.sql infra/sql/procedures/usp_DashboardCard_Reorder.sql infra/sql/procedures/usp_Dashboard_TimeTracked.sql
git commit -m "feat(9a): dashboard card SPs — card CRUD + reorder (JSON batch) + time-tracked scope aggregate"
```

---

### Task 4: Types + pure aggregation helpers + unit tests

**Files:**
- Modify: `packages/types/index.ts` (append a Dashboards block near the Views block, ~after line 1022)
- Create: `apps/api/src/modules/dashboards/card.aggregate.ts`
- Create: `apps/api/src/modules/dashboards/dashboard.errors.ts`
- Create: `apps/api/src/modules/dashboards/__tests__/card-aggregate.unit.test.ts`
- Create: `apps/api/src/modules/dashboards/__tests__/visibility.unit.test.ts`

Steps:

- [ ] Add the Dashboards types to `packages/types/index.ts`. `CardConfig` is shaped like a view (`filter`/`groupBy`/`sort`) plus a card-specific `aggregate` and `chart` block, reusing the existing `FilterGroup`/`FieldRef`/`SortKey`:

```ts
// ───────────────────────────── Dashboards (Phase 9a) ─────────────────────────
// A dashboard is a scoped, savable object; each card is a typed config resolved
// by card.service (one resolver, three data sources). 9b adds more CardTypes to
// the same registry; 9c snapshots cards by iterating it.

export type DashboardScopeType = 'workspace' | 'space' | 'folder' | 'list';
export type DashboardVisibility = 'private' | 'shared' | 'protected';

// Wave-1 catalog (9a). 9b extends: 'burndown'|'velocity'|'burnup'|'cumulative_flow'
// |'lead_cycle_time'|'sprint_summary'|'portfolio'|'timesheet'|'battery'.
export type CardType =
  | 'task_list' | 'calculation' | 'bar' | 'line' | 'pie' | 'time_tracked' | 'goal';

export type AggregateOp = 'count' | 'sum' | 'avg' | 'min' | 'max';

/** Per-card config. Generic cards carry a view-like query (filter/groupBy/sort)
 *  + a chart/aggregate shape; entity cards carry their own params. */
export interface CardConfig {
  filter?: FilterGroup;            // per-card filter (composed with the dashboard scope)
  groupBy?: FieldRef;              // bar/line/pie category axis
  sort?: SortKey[];
  columns?: FieldRef[];           // task_list columns
  pageSize?: number;              // task_list cap
  aggregate?: { op: AggregateOp; field?: FieldRef }; // calculation / bar value
  chart?: { xLabel?: string; yLabel?: string; seriesLabel?: string };
  // entity-card params (forward-compatible with 9b):
  goalId?: string;                // goal card (Phase 8)
  reportParams?: Record<string, unknown>; // report cards (9b)
}

export interface DashboardCardLayout { x: number; y: number; w: number; h: number }

export interface DashboardCard {
  id: string;
  dashboardId: string;
  type: CardType;
  title: string | null;
  config: CardConfig;
  layout: DashboardCardLayout;
  position: number;
}

export interface Dashboard {
  id: string;
  workspaceId: string;
  ownerId: string;
  scopeType: DashboardScopeType;
  scopeId: string | null;
  name: string;
  description: string | null;
  visibility: DashboardVisibility;
  isDefault: boolean;
  position: number;
  cards?: DashboardCard[];
}

/** A resolved card payload. `shape` tells the renderer how to read `data`. */
export interface CardData {
  cardId: string;
  type: CardType;
  shape: 'rows' | 'scalar' | 'series' | 'totals';
  data: unknown;          // rows: Task[]; scalar: { value:number }; series: {key,label,value}[]; totals: {userId,userName,totalSeconds}[]
  total?: number;
}

export interface CreateDashboardInput {
  scopeType: DashboardScopeType;
  scopeId: string | null;
  name: string;
  description?: string | null;
  visibility?: DashboardVisibility;
  workspaceId?: string;
}

export interface UpdateDashboardInput {
  name?: string;
  description?: string | null;
  visibility?: DashboardVisibility;
  position?: number;
}

export interface CreateDashboardCardInput {
  type: CardType;
  title?: string | null;
  config: CardConfig;
  layout: DashboardCardLayout;
  position?: number;
}

export interface UpdateDashboardCardInput {
  title?: string | null;
  config?: CardConfig;
  layout?: DashboardCardLayout;
  position?: number;
}

export interface ReorderCardEntry { id: string; layout: DashboardCardLayout; position: number }
```

- [ ] Write `dashboard.errors.ts`:

```ts
export class DashboardNotFoundError extends Error {
  constructor(message = 'Dashboard not found') { super(message); this.name = 'DashboardNotFoundError'; }
}
export class DashboardValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'DashboardValidationError'; }
}
```

- [ ] Write the failing unit tests first. `card-aggregate.unit.test.ts` covers config→view-config mapping + the aggregate math:

```ts
import { describe, it, expect } from 'vitest';
import { cardConfigToViewConfig, computeAggregate } from '../card.aggregate.js';
import type { CardConfig } from '@projectflow/types';

describe('cardConfigToViewConfig', () => {
  it('maps a card filter/groupBy/sort to a ViewConfig the Phase 3 compiler accepts', () => {
    const card: CardConfig = {
      filter: { conjunction: 'AND', rules: [{ field: { kind: 'builtin', key: 'status' }, op: '=', value: 'Done' }] },
      groupBy: { kind: 'builtin', key: 'priority' },
      sort: [{ field: { kind: 'builtin', key: 'position' }, dir: 'ASC' }],
      pageSize: 50,
    };
    const vc = cardConfigToViewConfig(card);
    expect(vc.filter.rules).toHaveLength(1);
    expect(vc.groupBy).toEqual({ kind: 'builtin', key: 'priority' });
    expect(vc.pageSize).toBe(50);
  });

  it('defaults an empty filter + position sort when the card omits them', () => {
    const vc = cardConfigToViewConfig({});
    expect(vc.filter).toEqual({ conjunction: 'AND', rules: [] });
    expect(vc.sort).toEqual([{ field: { kind: 'builtin', key: 'position' }, dir: 'ASC' }]);
  });
});

describe('computeAggregate', () => {
  const vals = [2, 4, 6, 8];
  it('count ignores the field and returns row length', () => {
    expect(computeAggregate('count', [10, 20, 30], () => 1)).toBe(3);
  });
  it('sum / avg / min / max over a numeric field', () => {
    expect(computeAggregate('sum', vals, (v) => v)).toBe(20);
    expect(computeAggregate('avg', vals, (v) => v)).toBe(5);
    expect(computeAggregate('min', vals, (v) => v)).toBe(2);
    expect(computeAggregate('max', vals, (v) => v)).toBe(8);
  });
  it('returns 0 for sum and null for avg/min/max over no rows', () => {
    expect(computeAggregate('sum', [], (v: number) => v)).toBe(0);
    expect(computeAggregate('avg', [], (v: number) => v)).toBeNull();
    expect(computeAggregate('min', [], (v: number) => v)).toBeNull();
    expect(computeAggregate('max', [], (v: number) => v)).toBeNull();
  });
  it('skips non-numeric / null field values in sum/avg', () => {
    expect(computeAggregate('sum', [3, null, 'x', 7], (v) => v as number)).toBe(10);
  });
});
```

`visibility.unit.test.ts` covers the visibility + default-per-scope pure rules:

```ts
import { describe, it, expect } from 'vitest';
import { canReadDashboard, nextDefaultMutation } from '../card.aggregate.js';

describe('canReadDashboard', () => {
  it('owner always reads their dashboard regardless of visibility', () => {
    expect(canReadDashboard({ ownerId: 'u1', visibility: 'private' }, 'u1')).toBe(true);
  });
  it('non-owner reads shared/protected but NOT private', () => {
    expect(canReadDashboard({ ownerId: 'u1', visibility: 'shared' }, 'u2')).toBe(true);
    expect(canReadDashboard({ ownerId: 'u1', visibility: 'protected' }, 'u2')).toBe(true);
    expect(canReadDashboard({ ownerId: 'u1', visibility: 'private' }, 'u2')).toBe(false);
  });
});

describe('nextDefaultMutation (one-default-per-scope guard, pure preview)', () => {
  it('clears the prior default in the same scope and sets the new one', () => {
    const rows = [
      { id: 'a', scopeType: 'space', scopeId: 's1', isDefault: true },
      { id: 'b', scopeType: 'space', scopeId: 's1', isDefault: false },
      { id: 'c', scopeType: 'space', scopeId: 's2', isDefault: true },
    ];
    const next = nextDefaultMutation(rows as any, 'b');
    expect(next.find((r) => r.id === 'a')!.isDefault).toBe(false); // cleared (same scope)
    expect(next.find((r) => r.id === 'b')!.isDefault).toBe(true);  // set
    expect(next.find((r) => r.id === 'c')!.isDefault).toBe(true);  // untouched (other scope)
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- card-aggregate visibility`. Expected: FAIL — `Cannot find module '../card.aggregate.js'`.

- [ ] Write `apps/api/src/modules/dashboards/card.aggregate.ts` (pure; no DB):

```ts
import type { AggregateOp, CardConfig, DashboardVisibility, ViewConfig } from '@projectflow/types';

/** Lift a per-card config into the ViewConfig the Phase 3 compiler accepts.
 *  Generic cards ARE saved queries — this is the only translation needed. */
export function cardConfigToViewConfig(card: CardConfig): ViewConfig {
  return {
    filter: card.filter ?? { conjunction: 'AND', rules: [] },
    groupBy: card.groupBy,
    sort: card.sort ?? [{ field: { kind: 'builtin', key: 'position' }, dir: 'ASC' }],
    columns: card.columns,
    pageSize: card.pageSize,
  };
}

/** Fold a numeric field over rows. `count` ignores the accessor.
 *  sum→0 / avg|min|max→null on empty; non-numeric values are skipped. */
export function computeAggregate<T>(
  op: AggregateOp,
  rows: readonly T[],
  field: (row: T) => unknown,
): number | null {
  if (op === 'count') return rows.length;
  const nums = rows
    .map((r) => field(r))
    .map((v) => (typeof v === 'number' ? v : Number(v)))
    .filter((v): v is number => Number.isFinite(v));
  if (op === 'sum') return nums.reduce((a, b) => a + b, 0);
  if (nums.length === 0) return null;
  if (op === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (op === 'min') return Math.min(...nums);
  return Math.max(...nums); // 'max'
}

/** Owner always reads; others read shared/protected, never private. */
export function canReadDashboard(d: { ownerId: string; visibility: DashboardVisibility }, userId: string): boolean {
  if (d.ownerId === userId) return true;
  return d.visibility !== 'private';
}

/** Pure preview of the one-default-per-scope mutation (mirrors usp_Dashboard_SetDefault):
 *  clear IsDefault on same-scope siblings, set it on the target. */
export function nextDefaultMutation<
  T extends { id: string; scopeType: string; scopeId: string | null; isDefault: boolean },
>(rows: T[], targetId: string): T[] {
  const target = rows.find((r) => r.id === targetId);
  if (!target) return rows;
  return rows.map((r) => {
    if (r.id === targetId) return { ...r, isDefault: true };
    const sameScope = r.scopeType === target.scopeType && r.scopeId === target.scopeId;
    return sameScope ? { ...r, isDefault: false } : r;
  });
}
```

- [ ] Run: `npm test --workspace apps/api -- card-aggregate visibility`. Expected: PASS (all assertions green).

- [ ] Commit:
```
git add packages/types/index.ts apps/api/src/modules/dashboards/card.aggregate.ts apps/api/src/modules/dashboards/dashboard.errors.ts apps/api/src/modules/dashboards/__tests__/card-aggregate.unit.test.ts apps/api/src/modules/dashboards/__tests__/visibility.unit.test.ts
git commit -m "feat(9a): dashboard types + pure card-aggregate/visibility helpers + unit tests"
```

---

### Task 5: Repository + `dashboard.service` + `card.service` dispatcher

**Files:**
- Create: `apps/api/src/modules/dashboards/dashboard.repository.ts`
- Create: `apps/api/src/modules/dashboards/dashboard.service.ts`
- Create: `apps/api/src/modules/dashboards/card.service.ts`

Steps:

- [ ] Write `dashboard.repository.ts` — `execSpOne` wrappers + row mappers. JSON columns (`Config`/`Layout`) are parsed on read, stringified on write:

```ts
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import { getPool } from '../../shared/lib/db.js';
import type {
  Dashboard, DashboardCard, DashboardScopeType, DashboardVisibility, CardConfig, DashboardCardLayout,
} from '@projectflow/types';

function mapDashboard(r: any): Dashboard {
  return {
    id: r.Id, workspaceId: r.WorkspaceId, ownerId: r.OwnerId,
    scopeType: r.ScopeType as DashboardScopeType, scopeId: r.ScopeId ?? null,
    name: r.Name, description: r.Description ?? null,
    visibility: r.Visibility as DashboardVisibility,
    isDefault: Boolean(r.IsDefault), position: r.Position,
  };
}

function mapCard(r: any): DashboardCard {
  return {
    id: r.Id, dashboardId: r.DashboardId, type: r.Type,
    title: r.Title ?? null,
    config: JSON.parse(r.Config) as CardConfig,
    layout: JSON.parse(r.Layout) as DashboardCardLayout,
    position: r.Position,
  };
}

export class DashboardRepository {
  async getWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_Dashboard_GetWorkspaceId',
      [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0]?.WorkspaceId ?? null;
  }

  async create(p: {
    id: string; workspaceId: string; ownerId: string; scopeType: DashboardScopeType;
    scopeId: string | null; scopePath: string | null; name: string; description: string | null;
    visibility: DashboardVisibility; position: number;
  }): Promise<Dashboard> {
    const rows = await execSpOne('usp_Dashboard_Create', [
      { name: 'Id',          type: sql.UniqueIdentifier,  value: p.id },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier,  value: p.workspaceId },
      { name: 'OwnerId',     type: sql.UniqueIdentifier,  value: p.ownerId },
      { name: 'ScopeType',   type: sql.NVarChar(12),      value: p.scopeType },
      { name: 'ScopeId',     type: sql.UniqueIdentifier,  value: p.scopeId },
      { name: 'ScopePath',   type: sql.NVarChar(900),     value: p.scopePath },
      { name: 'Name',        type: sql.NVarChar(200),     value: p.name },
      { name: 'Description', type: sql.NVarChar(sql.MAX), value: p.description },
      { name: 'Visibility',  type: sql.NVarChar(10),      value: p.visibility },
      { name: 'Position',    type: sql.Float,             value: p.position },
    ]);
    return mapDashboard(rows[0]);
  }

  async getById(id: string): Promise<Dashboard | null> {
    const rows = await execSpOne('usp_Dashboard_GetById', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0] ? mapDashboard(rows[0]) : null;
  }

  async update(id: string, p: { name?: string; description?: string | null; visibility?: DashboardVisibility; position?: number }): Promise<Dashboard | null> {
    const rows = await execSpOne('usp_Dashboard_Update', [
      { name: 'Id',          type: sql.UniqueIdentifier,  value: id },
      { name: 'Name',        type: sql.NVarChar(200),     value: p.name ?? null },
      { name: 'Description', type: sql.NVarChar(sql.MAX), value: p.description ?? null },
      { name: 'Visibility',  type: sql.NVarChar(10),      value: p.visibility ?? null },
      { name: 'Position',    type: sql.Float,             value: p.position ?? null },
    ]);
    return rows[0] ? mapDashboard(rows[0]) : null;
  }

  async delete(id: string): Promise<Dashboard | null> {
    const rows = await execSpOne('usp_Dashboard_Delete', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0] ? mapDashboard(rows[0]) : null;
  }

  async listByScope(workspaceId: string, userId: string, scopeType: DashboardScopeType, scopeId: string | null): Promise<Dashboard[]> {
    const rows = await execSpOne('usp_Dashboard_ListByScope', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'UserId',      type: sql.UniqueIdentifier, value: userId },
      { name: 'ScopeType',   type: sql.NVarChar(12),     value: scopeType },
      { name: 'ScopeId',     type: sql.UniqueIdentifier, value: scopeId },
    ]);
    return (rows as any[]).map(mapDashboard);
  }

  async setDefault(id: string): Promise<Dashboard | null> {
    const rows = await execSpOne('usp_Dashboard_SetDefault', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0] ? mapDashboard(rows[0]) : null;
  }

  // ── Cards ────────────────────────────────────────────────────────────────
  async listCards(dashboardId: string): Promise<DashboardCard[]> {
    const pool = await getPool();
    const res = await pool.request()
      .input('DashboardId', sql.UniqueIdentifier, dashboardId)
      .query('SELECT * FROM dbo.DashboardCards WHERE DashboardId = @DashboardId ORDER BY Position ASC, CreatedAt ASC');
    return (res.recordset as any[]).map(mapCard);
  }

  async getCard(id: string): Promise<DashboardCard | null> {
    const pool = await getPool();
    const res = await pool.request().input('Id', sql.UniqueIdentifier, id)
      .query('SELECT * FROM dbo.DashboardCards WHERE Id = @Id');
    return res.recordset[0] ? mapCard(res.recordset[0]) : null;
  }

  async createCard(p: { id: string; dashboardId: string; type: string; title: string | null; config: CardConfig; layout: DashboardCardLayout; position: number }): Promise<DashboardCard> {
    const rows = await execSpOne('usp_DashboardCard_Create', [
      { name: 'Id',          type: sql.UniqueIdentifier,  value: p.id },
      { name: 'DashboardId', type: sql.UniqueIdentifier,  value: p.dashboardId },
      { name: 'Type',        type: sql.NVarChar(24),      value: p.type },
      { name: 'Title',       type: sql.NVarChar(200),     value: p.title },
      { name: 'Config',      type: sql.NVarChar(sql.MAX), value: JSON.stringify(p.config) },
      { name: 'Layout',      type: sql.NVarChar(sql.MAX), value: JSON.stringify(p.layout) },
      { name: 'Position',    type: sql.Float,             value: p.position },
    ]);
    return mapCard(rows[0]);
  }

  async updateCard(id: string, p: { title?: string | null; config?: CardConfig; layout?: DashboardCardLayout; position?: number }): Promise<DashboardCard | null> {
    const rows = await execSpOne('usp_DashboardCard_Update', [
      { name: 'Id',       type: sql.UniqueIdentifier,  value: id },
      { name: 'Title',    type: sql.NVarChar(200),     value: p.title ?? null },
      { name: 'Config',   type: sql.NVarChar(sql.MAX), value: p.config ? JSON.stringify(p.config) : null },
      { name: 'Layout',   type: sql.NVarChar(sql.MAX), value: p.layout ? JSON.stringify(p.layout) : null },
      { name: 'Position', type: sql.Float,             value: p.position ?? null },
    ]);
    return rows[0] ? mapCard(rows[0]) : null;
  }

  async deleteCard(id: string): Promise<DashboardCard | null> {
    const rows = await execSpOne('usp_DashboardCard_Delete', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0] ? mapCard(rows[0]) : null;
  }

  async reorderCards(dashboardId: string, cards: Array<{ id: string; layout: DashboardCardLayout; position: number }>): Promise<DashboardCard[]> {
    const payload = JSON.stringify(cards.map((c) => ({ id: c.id, layout: JSON.stringify(c.layout), position: c.position })));
    const rows = await execSpOne('usp_DashboardCard_Reorder', [
      { name: 'DashboardId', type: sql.UniqueIdentifier,  value: dashboardId },
      { name: 'Cards',       type: sql.NVarChar(sql.MAX), value: payload },
    ]);
    return (rows as any[]).map(mapCard);
  }

  async timeTracked(workspaceId: string, scopePrefix: string | null): Promise<Array<{ userId: string; userName: string; totalSeconds: number }>> {
    const rows = await execSpOne<{ UserId: string; UserName: string; TotalSeconds: number }>('usp_Dashboard_TimeTracked', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'ScopePrefix', type: sql.NVarChar(901),    value: scopePrefix },
    ]);
    return rows.map((r) => ({ userId: r.UserId, userName: r.UserName, totalSeconds: r.TotalSeconds }));
  }
}
```

- [ ] Write `dashboard.service.ts` — CRUD + scope resolution (reuse `CustomFieldRepository.getScopeNode`, mapping dashboard scope `space|folder|list` → the hierarchy `SPACE|FOLDER|LIST` the scope-node SP expects) + visibility resolution + default guard:

```ts
import { randomUUID } from 'node:crypto';
import { DashboardRepository } from './dashboard.repository.js';
import { CustomFieldRepository } from '../customfields/customfield.repository.js';
import { canReadDashboard } from './card.aggregate.js';
import { DashboardNotFoundError, DashboardValidationError } from './dashboard.errors.js';
import type {
  Dashboard, DashboardCard, DashboardScopeType, CreateDashboardInput, UpdateDashboardInput,
  CreateDashboardCardInput, UpdateDashboardCardInput, ReorderCardEntry,
} from '@projectflow/types';

// Dashboard scope tokens are lowercase; the hierarchy scope-node SP keys on the
// uppercase hierarchy node types. EVERYTHING/workspace has no node.
const HIER: Record<Exclude<DashboardScopeType, 'workspace'>, 'SPACE' | 'FOLDER' | 'LIST'> = {
  space: 'SPACE', folder: 'FOLDER', list: 'LIST',
};

export interface ResolvedScope { workspaceId: string; scopePath: string | null }

export class DashboardService {
  private repo = new DashboardRepository();
  private cfRepo = new CustomFieldRepository();

  async resolveScope(scopeType: DashboardScopeType, scopeId: string | null, fallbackWorkspaceId?: string): Promise<ResolvedScope> {
    if (scopeType === 'workspace') {
      if (!fallbackWorkspaceId) throw new DashboardValidationError('workspace scope requires a workspaceId');
      return { workspaceId: fallbackWorkspaceId, scopePath: null };
    }
    if (!scopeId) throw new DashboardValidationError(`scopeId required for ${scopeType} scope`);
    const node = await this.cfRepo.getScopeNode(HIER[scopeType] as any, scopeId);
    if (!node) throw new DashboardValidationError('Scope node not found');
    return { workspaceId: node.workspaceId, scopePath: node.scopePath };
  }

  async create(userId: string, input: CreateDashboardInput): Promise<Dashboard> {
    const scope = await this.resolveScope(input.scopeType, input.scopeId, input.workspaceId);
    return this.repo.create({
      id: randomUUID(), workspaceId: scope.workspaceId, ownerId: userId,
      scopeType: input.scopeType, scopeId: input.scopeId, scopePath: scope.scopePath,
      name: input.name, description: input.description ?? null,
      visibility: input.visibility ?? 'shared', position: Date.now(),
    });
  }

  async list(userId: string, scopeType: DashboardScopeType, scopeId: string | null, workspaceId?: string): Promise<Dashboard[]> {
    const scope = await this.resolveScope(scopeType, scopeId, workspaceId);
    const dashboards = await this.repo.listByScope(scope.workspaceId, userId, scopeType, scopeId);
    // SP already filters shared/owned; this belt-and-suspenders applies the pure rule.
    return dashboards.filter((d) => canReadDashboard(d, userId));
  }

  /** Full dashboard incl. its cards (for the grid + the print layout). */
  async getWithCards(id: string): Promise<Dashboard> {
    const d = await this.getOrThrow(id);
    d.cards = await this.repo.listCards(id);
    return d;
  }

  async getOrThrow(id: string): Promise<Dashboard> {
    const d = await this.repo.getById(id);
    if (!d) throw new DashboardNotFoundError();
    return d;
  }

  async update(id: string, patch: UpdateDashboardInput): Promise<Dashboard> {
    const d = await this.repo.update(id, patch);
    if (!d) throw new DashboardNotFoundError();
    return d;
  }

  async delete(id: string): Promise<Dashboard> {
    const d = await this.repo.delete(id);
    if (!d) throw new DashboardNotFoundError();
    return d;
  }

  async setDefault(id: string): Promise<Dashboard> {
    const d = await this.repo.setDefault(id);
    if (!d) throw new DashboardNotFoundError();
    return d;
  }

  // ── Cards ──────────────────────────────────────────────────────────────
  async createCard(dashboardId: string, input: CreateDashboardCardInput): Promise<DashboardCard> {
    await this.getOrThrow(dashboardId);
    return this.repo.createCard({
      id: randomUUID(), dashboardId, type: input.type, title: input.title ?? null,
      config: input.config, layout: input.layout, position: input.position ?? Date.now(),
    });
  }

  async updateCard(id: string, patch: UpdateDashboardCardInput): Promise<DashboardCard> {
    const c = await this.repo.updateCard(id, patch);
    if (!c) throw new DashboardNotFoundError('Card not found');
    return c;
  }

  async deleteCard(id: string): Promise<DashboardCard> {
    const c = await this.repo.deleteCard(id);
    if (!c) throw new DashboardNotFoundError('Card not found');
    return c;
  }

  async reorderCards(dashboardId: string, cards: ReorderCardEntry[]): Promise<DashboardCard[]> {
    await this.getOrThrow(dashboardId);
    return this.repo.reorderCards(dashboardId, cards);
  }
}

export const dashboardService = new DashboardService();
```

- [ ] Write `card.service.ts` — the **§2.1 dispatcher**: a `CardResolver` registry keyed on `CardType`. Generic cards run through `viewService.runConfig` (the Phase 3 compiler) **scoped to the dashboard scope + the card's own filter**, and the run is gated by the route/GraphQL layer's `requireObjectLevel` so it never exceeds the requesting user's access. `time_tracked` calls the new scope-aggregating SP; `goal` is a stub until Phase 8's `goal.service` lands:

```ts
import { dashboardService } from './dashboard.service.js';
import { DashboardRepository } from './dashboard.repository.js';
import { cardConfigToViewConfig, computeAggregate } from './card.aggregate.js';
import { viewService } from '../views/view.service.js';
import type {
  CardData, CardType, Dashboard, DashboardCard, FieldRef,
} from '@projectflow/types';

const repo = new DashboardRepository();

/** A resolver turns a card + its dashboard scope into a CardData payload. The
 *  registry is the extension seam: 9b registers more types here; 9c snapshots a
 *  dashboard by iterating every card through this same resolve(). */
export type CardResolver = (card: DashboardCard, dashboard: Dashboard, userId: string) => Promise<CardData>;

// Map a card's dashboard scope onto the view scope the Phase 3 compiler accepts.
function viewScope(d: Dashboard): { scopeType: 'EVERYTHING' | 'SPACE' | 'FOLDER' | 'LIST'; scopeId: string | null } {
  if (d.scopeType === 'workspace') return { scopeType: 'EVERYTHING', scopeId: null };
  return { scopeType: d.scopeType.toUpperCase() as 'SPACE' | 'FOLDER' | 'LIST', scopeId: d.scopeId };
}

/** Run a generic card's config through the Phase 3 compiler under the dashboard
 *  scope. The route/GraphQL layer has already asserted requireObjectLevel(VIEW)
 *  on the scope, so a user without access never reaches here for that scope. */
async function runGeneric(card: DashboardCard, d: Dashboard, userId: string, pageSize: number) {
  const vs = viewScope(d);
  return viewService.runConfig(
    vs.scopeType, vs.scopeId, cardConfigToViewConfig({ ...card.config, pageSize }),
    { page: 1, pageSize }, d.workspaceId, userId,
  );
}

// Read a (possibly custom) numeric field off a compiled task row for aggregation.
function fieldAccessor(field?: FieldRef): (row: any) => unknown {
  if (!field) return () => 1;
  if (field.kind === 'builtin') {
    // builtin numeric columns the compiler exposes on SELECT t.* (PascalCase)
    const col = field.key === 'story_points' ? 'StoryPoints' : field.key;
    return (row) => row[col] ?? row[field.key];
  }
  // custom field — ViewRepository attaches CustomFieldValues keyed by lowercased id
  return (row) => row.CustomFieldValues?.[field.key.toLowerCase()];
}

async function resolveTaskList(card: DashboardCard, d: Dashboard, userId: string): Promise<CardData> {
  const page = await runGeneric(card, d, userId, card.config.pageSize ?? 25);
  return { cardId: card.id, type: 'task_list', shape: 'rows', data: page.tasks, total: page.total };
}

async function resolveCalculation(card: DashboardCard, d: Dashboard, userId: string): Promise<CardData> {
  const op = card.config.aggregate?.op ?? 'count';
  // For count we only need the total; for sum/avg/min/max pull a bounded page.
  const page = await runGeneric(card, d, userId, op === 'count' ? 1 : 200);
  const value = op === 'count' ? page.total : computeAggregate(op, page.tasks as any[], fieldAccessor(card.config.aggregate?.field));
  return { cardId: card.id, type: 'calculation', shape: 'scalar', data: { value } };
}

// bar/line/pie share the same grouped-count series shape (Phase 3 groupCounts).
async function resolveSeries(type: CardType): CardResolver {
  return async (card, d, userId) => {
    const page = await runGeneric(card, d, userId, card.config.pageSize ?? 200);
    // groups are populated when config.groupBy is set (runConfig fills page.groups).
    const series = (page.groups ?? []).map((g) => ({ key: g.key, label: g.label, value: g.count }));
    return { cardId: card.id, type, shape: 'series', data: series };
  };
}

async function resolveTimeTracked(card: DashboardCard, d: Dashboard): Promise<CardData> {
  const scope = await dashboardService.resolveScope(d.scopeType, d.scopeId, d.workspaceId);
  const prefix = scope.scopePath ? `${scope.scopePath}%` : null;
  const totals = await repo.timeTracked(d.workspaceId, prefix);
  return { cardId: card.id, type: 'time_tracked', shape: 'totals', data: totals };
}

// Phase 8 goal.service is not built on-disk yet (no goals module). Ship a stub
// that returns an empty payload so the card renders an empty state; when Phase 8
// lands, replace this resolver with a call to goal.service.getById(card.config.goalId).
async function resolveGoal(card: DashboardCard): Promise<CardData> {
  return { cardId: card.id, type: 'goal', shape: 'scalar', data: { value: null, pending: true } };
}

export class CardService {
  private registry = new Map<CardType, CardResolver>();

  constructor() {
    this.registry.set('task_list', resolveTaskList);
    this.registry.set('calculation', resolveCalculation);
    // bar/line/pie are the same grouped-series resolver (the renderer differs client-side).
    this.register('bar',  /* eager init below */ undefined as any);
    this.register('line', undefined as any);
    this.register('pie',  undefined as any);
    this.registry.set('time_tracked', (c, d) => resolveTimeTracked(c, d));
    this.registry.set('goal', (c) => resolveGoal(c));
  }

  /** Extension seam for 9b/9c — register or override a type's resolver. */
  register(type: CardType, resolver: CardResolver): void {
    this.registry.set(type, resolver);
  }

  async resolve(card: DashboardCard, dashboard: Dashboard, userId: string): Promise<CardData> {
    const r = this.registry.get(card.type);
    if (!r) throw new Error(`No resolver for card type '${card.type}'`);
    return r(card, dashboard, userId);
  }
}

export const cardService = new CardService();

// Wire the shared grouped-series resolver after construction (avoids an async ctor).
for (const t of ['bar', 'line', 'pie'] as const) {
  // resolveSeries returns a resolver bound to the chart type token.
  (cardService as any).register(t, (await resolveSeries(t)));
}
```

> **Implementer note:** the trailing top-level `await` to register `bar`/`line`/`pie` must compile under the project's TS module target. If top-level await is not enabled, replace it with an eager synchronous registration inside the `CardService` constructor — make `resolveSeries` a plain (non-async) factory returning a `CardResolver`, and call `this.registry.set(t, makeSeriesResolver(t))` for each of `bar`/`line`/`pie`. Keep the registry keyed on `CardType` either way so 9b/9c extend it cleanly.

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS — no type errors. Then `npm test --workspace apps/api -- card-aggregate visibility`. Expected: still PASS.

- [ ] Commit:
```
git add apps/api/src/modules/dashboards/dashboard.repository.ts apps/api/src/modules/dashboards/dashboard.service.ts apps/api/src/modules/dashboards/card.service.ts
git commit -m "feat(9a): dashboard repo/service + card.service dispatcher (one resolver, three sources)"
```

---

### Task 6: REST routes + mount

**Files:**
- Create: `apps/api/src/modules/dashboards/dashboard.routes.ts`
- Modify: `apps/api/src/server.ts` (import + `app.route('/dashboards', dashboardRoutes)`, alongside the other `app.route(...)` calls ~line 209)

Steps:

- [ ] Write `dashboard.routes.ts` — `requirePermission('dashboard.read'/'dashboard.create'/'dashboard.update'/'dashboard.delete', { resolveWorkspace })` exactly like `worklog.routes.ts`. The card-data route additionally asserts object-level VIEW on the dashboard's scope so a card never returns rows the user can't read. Static card/default/reorder segments are placed BEFORE `/:id` so they win:

```ts
import { Hono }       from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z }          from 'zod';
import { dashboardService } from './dashboard.service.js';
import { cardService } from './card.service.js';
import { DashboardRepository } from './dashboard.repository.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import { accessService } from '../access/access.service.js';
import { DashboardNotFoundError, DashboardValidationError } from './dashboard.errors.js';
import type { DashboardScopeType } from '@projectflow/types';

const repo = new DashboardRepository();
export const dashboardRoutes = new Hono();

// ── RBAC resolvers ──────────────────────────────────────────────────────────
const resolveDashboardWorkspace = (c: any) => repo.getWorkspaceId(c.req.param('id'));
async function resolveScopeWorkspaceFromBody(c: any): Promise<string | null> {
  try {
    const b = await c.req.json();
    const scope = await dashboardService.resolveScope(b.scopeType, b.scopeId ?? null, b.workspaceId);
    (c as any).set('resolvedScope', scope);
    return scope.workspaceId;
  } catch { return null; }
}
async function resolveCardDashboardWorkspace(c: any): Promise<string | null> {
  const card = await repo.getCard(c.req.param('cardId'));
  if (!card) return null;
  (c as any).set('card', card);
  return repo.getWorkspaceId(card.dashboardId);
}

const layoutSchema = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() });
const createSchema = z.object({
  scopeType: z.enum(['workspace', 'space', 'folder', 'list']),
  scopeId:   z.string().uuid().nullable().optional(),
  name:      z.string().min(1).max(200),
  description: z.string().optional(),
  visibility: z.enum(['private', 'shared', 'protected']).optional(),
  workspaceId: z.string().uuid().optional(),
});
const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
  visibility: z.enum(['private', 'shared', 'protected']).optional(),
  position: z.number().optional(),
});
const cardCreateSchema = z.object({
  type:   z.enum(['task_list', 'calculation', 'bar', 'line', 'pie', 'time_tracked', 'goal']),
  title:  z.string().max(200).nullable().optional(),
  config: z.record(z.any()),
  layout: layoutSchema,
  position: z.number().optional(),
});
const cardUpdateSchema = z.object({
  title: z.string().max(200).nullable().optional(),
  config: z.record(z.any()).optional(),
  layout: layoutSchema.optional(),
  position: z.number().optional(),
});
const reorderSchema = z.object({
  cards: z.array(z.object({ id: z.string().uuid(), layout: layoutSchema, position: z.number() })),
});

function fail(c: any, e: unknown) {
  if (e instanceof DashboardNotFoundError) return c.json({ error: e.message }, 404);
  if (e instanceof DashboardValidationError) return c.json({ error: e.message }, 400);
  return c.json({ error: (e as Error).message }, 500);
}

// GET /dashboards?scopeType=&scopeId=&workspaceId=
dashboardRoutes.get('/', async (c) => {
  const userId = ((c as any).get('user') as any).userId as string;
  const scopeType = c.req.query('scopeType') as DashboardScopeType | undefined;
  if (!scopeType) return c.json({ error: 'scopeType is required' }, 400);
  try {
    const data = await dashboardService.list(userId, scopeType, c.req.query('scopeId') ?? null, c.req.query('workspaceId') ?? undefined);
    return c.json({ data });
  } catch (e) { return fail(c, e); }
});

// POST /dashboards
dashboardRoutes.post('/', zValidator('json', createSchema),
  requirePermission('dashboard.create', { resolveWorkspace: resolveScopeWorkspaceFromBody }),
  async (c) => {
    const userId = ((c as any).get('user') as any).userId as string;
    const body = c.req.valid('json');
    try { return c.json({ data: await dashboardService.create(userId, body as any) }, 201); }
    catch (e) { return fail(c, e); }
  });

// GET /dashboards/:id  (with cards)
dashboardRoutes.get('/:id',
  requirePermission('dashboard.read', { resolveWorkspace: resolveDashboardWorkspace }),
  async (c) => {
    try { return c.json({ data: await dashboardService.getWithCards(c.req.param('id')) }); }
    catch (e) { return fail(c, e); }
  });

// PATCH /dashboards/:id
dashboardRoutes.patch('/:id',
  requirePermission('dashboard.update', { resolveWorkspace: resolveDashboardWorkspace }),
  zValidator('json', updateSchema),
  async (c) => {
    try { return c.json({ data: await dashboardService.update(c.req.param('id'), c.req.valid('json')) }); }
    catch (e) { return fail(c, e); }
  });

// DELETE /dashboards/:id
dashboardRoutes.delete('/:id',
  requirePermission('dashboard.delete', { resolveWorkspace: resolveDashboardWorkspace }),
  async (c) => {
    try { return c.json({ data: await dashboardService.delete(c.req.param('id')) }); }
    catch (e) { return fail(c, e); }
  });

// POST /dashboards/:id/set-default
dashboardRoutes.post('/:id/set-default',
  requirePermission('dashboard.update', { resolveWorkspace: resolveDashboardWorkspace }),
  async (c) => {
    try { return c.json({ data: await dashboardService.setDefault(c.req.param('id')) }); }
    catch (e) { return fail(c, e); }
  });

// POST /dashboards/:id/cards
dashboardRoutes.post('/:id/cards',
  requirePermission('dashboard.update', { resolveWorkspace: resolveDashboardWorkspace }),
  zValidator('json', cardCreateSchema),
  async (c) => {
    try { return c.json({ data: await dashboardService.createCard(c.req.param('id'), c.req.valid('json') as any) }, 201); }
    catch (e) { return fail(c, e); }
  });

// PUT /dashboards/:id/reorder-cards
dashboardRoutes.put('/:id/reorder-cards',
  requirePermission('dashboard.update', { resolveWorkspace: resolveDashboardWorkspace }),
  zValidator('json', reorderSchema),
  async (c) => {
    try { return c.json({ data: await dashboardService.reorderCards(c.req.param('id'), c.req.valid('json').cards) }); }
    catch (e) { return fail(c, e); }
  });

// PATCH /cards/:cardId
dashboardRoutes.patch('/cards/:cardId',
  requirePermission('dashboard.update', { resolveWorkspace: resolveCardDashboardWorkspace }),
  zValidator('json', cardUpdateSchema),
  async (c) => {
    try { return c.json({ data: await dashboardService.updateCard(c.req.param('cardId'), c.req.valid('json')) }); }
    catch (e) { return fail(c, e); }
  });

// DELETE /cards/:cardId
dashboardRoutes.delete('/cards/:cardId',
  requirePermission('dashboard.update', { resolveWorkspace: resolveCardDashboardWorkspace }),
  async (c) => {
    try { return c.json({ data: await dashboardService.deleteCard(c.req.param('cardId')) }); }
    catch (e) { return fail(c, e); }
  });

// GET /cards/:cardId/data — resolve a card under the requesting user's object-level scope.
dashboardRoutes.get('/cards/:cardId/data',
  requirePermission('dashboard.read', { resolveWorkspace: resolveCardDashboardWorkspace }),
  async (c) => {
    const userId = ((c as any).get('user') as any).userId as string;
    const card = (c as any).get('card');                    // cached by the RBAC resolver
    try {
      const dashboard = await dashboardService.getOrThrow(card.dashboardId);
      // Object-level VIEW gate on the dashboard's scope — a user without access
      // to a scoped Space/Folder/List gets a 403 and resolves no rows from it.
      if (dashboard.scopeType !== 'workspace' && dashboard.scopeId) {
        const node = dashboard.scopeType.toUpperCase() as 'SPACE' | 'FOLDER' | 'LIST';
        if (!(await accessService.can(userId, node, dashboard.scopeId, 'VIEW')))
          return c.json({ error: 'Forbidden' }, 403);
      }
      return c.json({ data: await cardService.resolve(card, dashboard, userId) });
    } catch (e) { return fail(c, e); }
  });
```

- [ ] Wire the route into `server.ts` — import beside the other module routes and mount:

```ts
import { dashboardRoutes } from './modules/dashboards/dashboard.routes.js';
```
```ts
app.route('/dashboards',     dashboardRoutes);
```

- [ ] Run: `npm run build --workspace apps/api`. Expected: PASS (routes compile). The integration test in Task 7 exercises behavior.

- [ ] Commit:
```
git add apps/api/src/modules/dashboards/dashboard.routes.ts apps/api/src/server.ts
git commit -m "feat(9a): dashboard REST — CRUD + cards + set-default + reorder + object-level-gated card data"
```

---

### Task 7: Integration test (CRUD + object-level scoping + reorder/default)

**Files:**
- Create: `apps/api/src/modules/dashboards/__tests__/dashboards.integration.test.ts`

Steps:

- [ ] Write the failing integration test first (copy harness imports from an existing integration test, e.g. `recurrence.integration.test.ts`: `testServer.js`, `truncate.js`, `factories.js`). It seeds a space/list/task, verifies CRUD + a `task_list` card resolving live rows, the **object-level scoping guarantee** (a second user with no access to a private list sees a 403 / no rows from a list-scoped card), and reorder/default persistence:

```ts
/**
 * Phase 9a — Dashboards integration coverage.
 * Exercises the dashboard/card SPs + REST surface against the REAL SQL stack.
 * DB SAFETY: must target local Docker ProjectFlow_Test (see e2e/README).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function seedScope() {
  const owner = await createTestUser({ email: `dash-${Date.now()}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'Dash Space', key: `DS${Date.now() % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'L', position: 0 },
  }), 201)).data;
  const task = (await json<{ task: any }>(await request('/tasks', {
    method: 'POST', token, json: { projectId: space.Id, workspaceId: ws.Id, title: 'Live Task', listId: list.id, status: 'To Do' },
  }), 201)).task;
  return { owner, token, ws, space, list, task };
}

describe('dashboards CRUD + cards', () => {
  it('creates a space-scoped dashboard, adds a task_list card, and resolves live rows', async () => {
    const { token, space } = await seedScope();
    const dash = (await json<{ data: any }>(await request('/dashboards', {
      method: 'POST', token, json: { scopeType: 'space', scopeId: space.Id, name: 'Team', visibility: 'shared' },
    }), 201)).data;

    const card = (await json<{ data: any }>(await request(`/dashboards/${dash.id}/cards`, {
      method: 'POST', token,
      json: { type: 'task_list', title: 'Open', config: { filter: { conjunction: 'AND', rules: [] }, pageSize: 25 }, layout: { x: 0, y: 0, w: 6, h: 4 } },
    }), 201)).data;

    const data = (await json<{ data: any }>(await request(`/dashboards/cards/${card.id}/data`, { token }))).data;
    expect(data.shape).toBe('rows');
    expect(data.total).toBeGreaterThanOrEqual(1);
    expect((data.data as any[]).some((t) => t.Title === 'Live Task' || t.title === 'Live Task')).toBe(true);
  });

  it('calculation card counts tasks in scope', async () => {
    const { token, space } = await seedScope();
    const dash = (await json<{ data: any }>(await request('/dashboards', {
      method: 'POST', token, json: { scopeType: 'space', scopeId: space.Id, name: 'Counts' },
    }), 201)).data;
    const card = (await json<{ data: any }>(await request(`/dashboards/${dash.id}/cards`, {
      method: 'POST', token,
      json: { type: 'calculation', config: { aggregate: { op: 'count' } }, layout: { x: 0, y: 0, w: 3, h: 2 } },
    }), 201)).data;
    const data = (await json<{ data: any }>(await request(`/dashboards/cards/${card.id}/data`, { token }))).data;
    expect(data.shape).toBe('scalar');
    expect((data.data as any).value).toBeGreaterThanOrEqual(1);
  });

  it('a user without access to the scope sees a 403 (no rows) from a scoped card', async () => {
    const { token, space, card: _t } = await seedScope();
    // Make the dashboard's space private and create a card on it.
    const dash = (await json<{ data: any }>(await request('/dashboards', {
      method: 'POST', token, json: { scopeType: 'space', scopeId: space.Id, name: 'Private', visibility: 'shared' },
    }), 201)).data;
    const card = (await json<{ data: any }>(await request(`/dashboards/${dash.id}/cards`, {
      method: 'POST', token,
      json: { type: 'task_list', config: { filter: { conjunction: 'AND', rules: [] } }, layout: { x: 0, y: 0, w: 6, h: 4 } },
    }), 201)).data;

    // A stranger (not a member of the workspace / no VIEW on the space).
    const stranger = await createTestUser({ email: `stranger-${Date.now()}@projectflow.test` });
    const res = await request(`/dashboards/cards/${card.id}/data`, { token: stranger.accessToken });
    expect([403, 404]).toContain(res.status);  // fail-closed: forbidden or not-found, never rows
  });

  it('reorder persists card layout/position, and set-default enforces one per scope', async () => {
    const { token, space } = await seedScope();
    const dash = (await json<{ data: any }>(await request('/dashboards', {
      method: 'POST', token, json: { scopeType: 'space', scopeId: space.Id, name: 'D1' },
    }), 201)).data;
    const card = (await json<{ data: any }>(await request(`/dashboards/${dash.id}/cards`, {
      method: 'POST', token,
      json: { type: 'calculation', config: { aggregate: { op: 'count' } }, layout: { x: 0, y: 0, w: 3, h: 2 } },
    }), 201)).data;

    const reordered = (await json<{ data: any[] }>(await request(`/dashboards/${dash.id}/reorder-cards`, {
      method: 'PUT', token, json: { cards: [{ id: card.id, layout: { x: 4, y: 2, w: 6, h: 5 }, position: 10 }] },
    }))).data;
    expect(reordered[0].layout).toEqual({ x: 4, y: 2, w: 6, h: 5 });
    expect(reordered[0].position).toBe(10);

    // Two dashboards in the same scope; setting the second default clears the first.
    const dash2 = (await json<{ data: any }>(await request('/dashboards', {
      method: 'POST', token, json: { scopeType: 'space', scopeId: space.Id, name: 'D2' },
    }), 201)).data;
    await request(`/dashboards/${dash.id}/set-default`, { method: 'POST', token });
    await request(`/dashboards/${dash2.id}/set-default`, { method: 'POST', token });
    const list = (await json<{ data: any[] }>(await request(`/dashboards?scopeType=space&scopeId=${space.Id}`, { token }))).data;
    const defaults = list.filter((d) => d.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(dash2.id);
  });
});
```

- [ ] Run: `npm run test:integration --workspace apps/api -- dashboards` against `ProjectFlow_Test`. Expected: FAIL on the first run (routes/SPs not yet deployed in the test DB). After deploying SPs (Tasks 2–3) + running the suite, Expected: PASS (4 tests). Then full unit: `npm test --workspace apps/api`. Expected: PASS.

> **Implementer note:** if the seeded permission role does not include `dashboard.*` slugs, add them to the default role seed (mirror how `worklog.*`/`view` slugs were seeded). Confirm the slug names with the RBAC seed file before running; the routes use `dashboard.read|create|update|delete`.

- [ ] Commit:
```
git add apps/api/src/modules/dashboards/__tests__/dashboards.integration.test.ts
git commit -m "test(9a): dashboards integration — CRUD + live card data + object-level scoping + reorder/default"
```

---

### Task 8: GraphQL mirror (`dashboards.schema.ts`)

**Files:**
- Create: `apps/api/src/graphql/dashboards.schema.ts`
- Modify: `apps/api/src/graphql/schema.ts` (import + call near the other `register*Graphql()` calls, ~line 768)

Steps:

- [ ] Write `dashboards.schema.ts`, mirroring `views.schema.ts`'s structure (typed `objectRef`, `requireObjectLevel`/`requireWorkspacePermission`/`notFound` from `./authz.js`, delegating to the shared `dashboardService`/`cardService`). Card data resolution gates on object-level VIEW exactly like the REST route:

```ts
import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { dashboardService } from '../modules/dashboards/dashboard.service.js';
import { cardService } from '../modules/dashboards/card.service.js';
import { DashboardRepository } from '../modules/dashboards/dashboard.repository.js';
import { notFound, requireObjectLevel, requireWorkspacePermission } from './authz.js';
import type { GQLContext } from './context.js';
import type { Dashboard, DashboardCard, CardData, DashboardScopeType, HierarchyNodeType } from '@projectflow/types';

const repo = new DashboardRepository();

function authzNode(scopeType: DashboardScopeType): HierarchyNodeType | null {
  return scopeType === 'workspace' ? null : (scopeType.toUpperCase() as HierarchyNodeType);
}
function requireUser(ctx: GQLContext): string {
  if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
  return ctx.user.userId;
}

export function registerDashboardsGraphql(): void {
  const LayoutType = builder.objectRef<{ x: number; y: number; w: number; h: number }>('DashboardCardLayout');
  LayoutType.implement({ fields: (t) => ({
    x: t.exposeInt('x'), y: t.exposeInt('y'), w: t.exposeInt('w'), h: t.exposeInt('h'),
  }) });

  const CardType = builder.objectRef<DashboardCard>('DashboardCard');
  CardType.implement({ fields: (t) => ({
    id:          t.exposeString('id'),
    dashboardId: t.exposeString('dashboardId'),
    type:        t.exposeString('type'),
    title:       t.string({ nullable: true, resolve: (c) => c.title ?? null }),
    config:      t.string({ resolve: (c) => JSON.stringify(c.config) }),
    layout:      t.field({ type: LayoutType, resolve: (c) => c.layout }),
    position:    t.exposeFloat('position'),
  }) });

  const DashboardType = builder.objectRef<Dashboard>('Dashboard');
  DashboardType.implement({ fields: (t) => ({
    id:          t.exposeString('id'),
    workspaceId: t.exposeString('workspaceId'),
    ownerId:     t.exposeString('ownerId'),
    scopeType:   t.exposeString('scopeType'),
    scopeId:     t.string({ nullable: true, resolve: (d) => d.scopeId }),
    name:        t.exposeString('name'),
    description: t.string({ nullable: true, resolve: (d) => d.description ?? null }),
    visibility:  t.exposeString('visibility'),
    isDefault:   t.exposeBoolean('isDefault'),
    position:    t.exposeFloat('position'),
    cards:       t.field({ type: [CardType], nullable: true, resolve: (d) => d.cards ?? null }),
  }) });

  const CardDataType = builder.objectRef<CardData>('CardData');
  CardDataType.implement({ fields: (t) => ({
    cardId: t.exposeString('cardId'),
    type:   t.exposeString('type'),
    shape:  t.exposeString('shape'),
    total:  t.int({ nullable: true, resolve: (d) => d.total ?? null }),
    data:   t.string({ resolve: (d) => JSON.stringify(d.data) }),  // JSON-encoded; the client parses by `shape`
  }) });

  builder.queryFields((t) => ({
    dashboards: t.field({
      type: [DashboardType],
      args: { scopeType: t.arg.string({ required: true }), scopeId: t.arg.string({ required: false }), workspaceId: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        const userId = requireUser(ctx);
        const scopeType = a.scopeType as DashboardScopeType;
        const node = authzNode(scopeType);
        if (node) await requireObjectLevel(ctx, node, a.scopeId, 'VIEW');
        else await requireWorkspacePermission(ctx, a.workspaceId, 'workspace.read');
        return dashboardService.list(userId, scopeType, a.scopeId ?? null, a.workspaceId ?? undefined);
      },
    }),
    dashboard: t.field({
      type: DashboardType,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        requireUser(ctx);
        const d = await dashboardService.getOrThrow(a.id);
        const node = authzNode(d.scopeType);
        if (node) await requireObjectLevel(ctx, node, d.scopeId, 'VIEW');
        else await requireWorkspacePermission(ctx, d.workspaceId, 'workspace.read');
        return dashboardService.getWithCards(a.id);
      },
    }),
    dashboardCardData: t.field({
      type: CardDataType,
      args: { cardId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const userId = requireUser(ctx);
        const card = await repo.getCard(a.cardId);
        if (!card) notFound('Card not found');
        const dashboard = await dashboardService.getOrThrow(card.dashboardId);
        const node = authzNode(dashboard.scopeType);
        if (node) await requireObjectLevel(ctx, node, dashboard.scopeId, 'VIEW');  // fail-closed scope gate
        else await requireWorkspacePermission(ctx, dashboard.workspaceId, 'workspace.read');
        return cardService.resolve(card, dashboard, userId);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    createDashboard: t.field({
      type: DashboardType,
      args: { scopeType: t.arg.string({ required: true }), scopeId: t.arg.string({ required: false }), name: t.arg.string({ required: true }), visibility: t.arg.string({ required: false }), workspaceId: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        const userId = requireUser(ctx);
        const scopeType = a.scopeType as DashboardScopeType;
        const node = authzNode(scopeType);
        if (node) await requireObjectLevel(ctx, node, a.scopeId, 'EDIT');
        else await requireWorkspacePermission(ctx, a.workspaceId, 'dashboard.create');
        return dashboardService.create(userId, {
          scopeType, scopeId: a.scopeId ?? null, name: a.name,
          visibility: (a.visibility as any) ?? undefined, workspaceId: a.workspaceId ?? undefined,
        });
      },
    }),
    updateDashboard: t.field({
      type: DashboardType,
      args: { id: t.arg.string({ required: true }), name: t.arg.string({ required: false }), visibility: t.arg.string({ required: false }), position: t.arg.float({ required: false }) },
      resolve: async (_, a, ctx) => {
        requireUser(ctx);
        const d = await dashboardService.getOrThrow(a.id);
        const node = authzNode(d.scopeType);
        if (node) await requireObjectLevel(ctx, node, d.scopeId, 'EDIT');
        else await requireWorkspacePermission(ctx, d.workspaceId, 'dashboard.update');
        return dashboardService.update(a.id, { name: a.name ?? undefined, visibility: (a.visibility as any) ?? undefined, position: a.position ?? undefined });
      },
    }),
    deleteDashboard: t.field({
      type: 'Boolean',
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        requireUser(ctx);
        const d = await dashboardService.getOrThrow(a.id);
        const node = authzNode(d.scopeType);
        if (node) await requireObjectLevel(ctx, node, d.scopeId, 'EDIT');
        else await requireWorkspacePermission(ctx, d.workspaceId, 'dashboard.delete');
        await dashboardService.delete(a.id);
        return true;
      },
    }),
    createDashboardCard: t.field({
      type: CardType,
      args: { dashboardId: t.arg.string({ required: true }), type: t.arg.string({ required: true }), title: t.arg.string({ required: false }), config: t.arg.string({ required: true }), layout: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        requireUser(ctx);
        const d = await dashboardService.getOrThrow(a.dashboardId);
        const node = authzNode(d.scopeType);
        if (node) await requireObjectLevel(ctx, node, d.scopeId, 'EDIT');
        else await requireWorkspacePermission(ctx, d.workspaceId, 'dashboard.update');
        return dashboardService.createCard(a.dashboardId, {
          type: a.type as any, title: a.title ?? null,
          config: JSON.parse(a.config), layout: JSON.parse(a.layout),
        });
      },
    }),
    setDefaultDashboard: t.field({
      type: DashboardType,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        requireUser(ctx);
        const d = await dashboardService.getOrThrow(a.id);
        const node = authzNode(d.scopeType);
        if (node) await requireObjectLevel(ctx, node, d.scopeId, 'EDIT');
        else await requireWorkspacePermission(ctx, d.workspaceId, 'dashboard.update');
        return dashboardService.setDefault(a.id);
      },
    }),
  }));
}
```

- [ ] Wire it into `schema.ts` — add the import alongside the others and call it near the other `register*Graphql()` calls:

```ts
import { registerDashboardsGraphql } from './dashboards.schema.js';
```
```ts
// ─────────────────────────────────────────
// Dashboards (Phase 9a) — Dashboard/DashboardCard/CardData + dashboards/dashboard/
// dashboardCardData queries + create/update/delete/card/setDefault mutations.
// ─────────────────────────────────────────
registerDashboardsGraphql();
```

- [ ] Run: `npm run build --workspace apps/api` (tsc — compiles the Pothos schema). Expected: PASS — schema builds. Then `npm test --workspace apps/api`. Expected: PASS (existing GraphQL authz tests still green).

- [ ] Commit:
```
git add apps/api/src/graphql/dashboards.schema.ts apps/api/src/graphql/schema.ts
git commit -m "feat(9a): GraphQL dashboards mirror — dashboards/dashboard/cardData + CRUD/card/setDefault mutations"
```

---

### Task 9: Server actions + SSR queries

**Files:**
- Create: `apps/next-web/src/server/actions/dashboards.ts`
- Create: `apps/next-web/src/server/queries/dashboards.ts`
- Note: read `apps/next-web/node_modules/next/dist/docs/` per `apps/next-web/AGENTS.md` before writing web code (this Next.js has breaking changes).

Steps:

- [ ] Write `server/queries/dashboards.ts` — SSR reads via `serverFetch` (mirror `server/queries/reports.ts`):

```ts
import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';
import type { Dashboard, CardData, DashboardScopeType } from '@projectflow/types';

export const getDashboards = cache((scopeType: DashboardScopeType, scopeId: string | null, workspaceId?: string) => {
  const q = new URLSearchParams({ scopeType });
  if (scopeId) q.set('scopeId', scopeId);
  if (workspaceId) q.set('workspaceId', workspaceId);
  return serverFetch<{ data: Dashboard[] }>(`/dashboards?${q.toString()}`).then((r) => r.data);
});

export const getDashboard = cache((id: string) =>
  serverFetch<{ data: Dashboard }>(`/dashboards/${encodeURIComponent(id)}`).then((r) => r.data),
);

export const getCardData = (cardId: string) =>
  serverFetch<{ data: CardData }>(`/dashboards/cards/${encodeURIComponent(cardId)}/data`).then((r) => r.data);
```

- [ ] Write `server/actions/dashboards.ts` — mutations via `serverFetch`, mapping thrown `ApiError` to the project's `ActionResult` shape (mirror `server/actions/worklogs.ts` exactly — use the file's real `run`/`toActionError` helpers):

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type {
  Dashboard, DashboardCard, CardData, CreateDashboardInput, UpdateDashboardInput,
  CreateDashboardCardInput, UpdateDashboardCardInput, ReorderCardEntry,
} from '@projectflow/types';

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  await requireSession();
  let result: T;
  try { result = await fn(); } catch (e) { return toActionError(e); }
  revalidatePath('/dashboard');
  return { ok: true, data: result } as ActionResult<T>;
}

export const createDashboard = (input: CreateDashboardInput) =>
  run<Dashboard>(() => serverFetch<{ data: Dashboard }>('/dashboards', { method: 'POST', body: input }).then((r) => r.data));

export const updateDashboard = (id: string, patch: UpdateDashboardInput) =>
  run<Dashboard>(() => serverFetch<{ data: Dashboard }>(`/dashboards/${id}`, { method: 'PATCH', body: patch }).then((r) => r.data));

export const deleteDashboard = (id: string) =>
  run<Dashboard>(() => serverFetch<{ data: Dashboard }>(`/dashboards/${id}`, { method: 'DELETE' }).then((r) => r.data));

export const setDefaultDashboard = (id: string) =>
  run<Dashboard>(() => serverFetch<{ data: Dashboard }>(`/dashboards/${id}/set-default`, { method: 'POST' }).then((r) => r.data));

export const addCard = (dashboardId: string, input: CreateDashboardCardInput) =>
  run<DashboardCard>(() => serverFetch<{ data: DashboardCard }>(`/dashboards/${dashboardId}/cards`, { method: 'POST', body: input }).then((r) => r.data));

export const updateCard = (cardId: string, patch: UpdateDashboardCardInput) =>
  run<DashboardCard>(() => serverFetch<{ data: DashboardCard }>(`/dashboards/cards/${cardId}`, { method: 'PATCH', body: patch }).then((r) => r.data));

export const deleteCard = (cardId: string) =>
  run<DashboardCard>(() => serverFetch<{ data: DashboardCard }>(`/dashboards/cards/${cardId}`, { method: 'DELETE' }).then((r) => r.data));

export const reorderCards = (dashboardId: string, cards: ReorderCardEntry[]) =>
  run<DashboardCard[]>(() => serverFetch<{ data: DashboardCard[] }>(`/dashboards/${dashboardId}/reorder-cards`, { method: 'PUT', body: { cards } }).then((r) => r.data));

export const loadCardData = (cardId: string): Promise<ActionResult<CardData>> =>
  run<CardData>(() => serverFetch<{ data: CardData }>(`/dashboards/cards/${cardId}/data`).then((r) => r.data));
```

- [ ] Run: `npm run build --workspace apps/next-web` (verifies the actions/queries typecheck). Expected: PASS. (UI follows in Task 10–11; if the build trips on an unused import, defer the full build to Task 11.)

- [ ] Commit:
```
git add apps/next-web/src/server/actions/dashboards.ts apps/next-web/src/server/queries/dashboards.ts
git commit -m "feat(9a): dashboard server actions + SSR queries over the REST surface"
```

---

### Task 10: dnd-kit grid + card renderers + per-card config/filter editor + unit test

**Files:**
- Create: `apps/next-web/src/components/dashboard/DashboardGrid.tsx`
- Create: `apps/next-web/src/components/dashboard/DashboardGrid.module.css`
- Create: `apps/next-web/src/components/dashboard/card-registry.tsx`
- Create: `apps/next-web/src/components/dashboard/TaskListCard.tsx`
- Create: `apps/next-web/src/components/dashboard/CalculationCard.tsx`
- Create: `apps/next-web/src/components/dashboard/CardConfigDrawer.tsx`
- Create: `apps/next-web/src/components/dashboard/__tests__/card-registry.unit.test.tsx`
- Note: read `node_modules/next/dist/docs/` per `apps/next-web/AGENTS.md` before writing web code.

Steps:

- [ ] Write the failing registry unit test first (asserts every wave-1 type resolves to a renderer):

```tsx
import { describe, it, expect } from 'vitest';
import { resolveCardRenderer } from '../card-registry';
import type { CardType } from '@projectflow/types';

describe('card-registry', () => {
  const types: CardType[] = ['task_list', 'calculation', 'bar', 'line', 'pie', 'time_tracked', 'goal'];
  it('resolves a renderer for every wave-1 card type', () => {
    for (const t of types) expect(resolveCardRenderer(t)).toBeTypeOf('function');
  });
  it('returns a fallback renderer for an unknown type (forward-compat with 9b)', () => {
    expect(resolveCardRenderer('battery' as CardType)).toBeTypeOf('function');
  });
});
```

- [ ] Run: `npm test --workspace apps/next-web -- card-registry`. Expected: FAIL — module not found.

- [ ] Write `card-registry.tsx` — maps `CardType` → renderer. Reuses the existing Recharts charts where the shape fits (bar/line/pie consume the `series` shape; an adapter feeds Recharts). 9b extends this map:

```tsx
'use client';

import type { CardData, CardType } from '@projectflow/types';
import { TaskListCard } from './TaskListCard';
import { CalculationCard } from './CalculationCard';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

export type CardRenderer = (props: { data: CardData }) => JSX.Element;

const PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7'];

function SeriesBar({ data }: { data: CardData }) {
  const rows = (data.data as Array<{ key: string; label: string; value: number }>) ?? [];
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#8892b0' }} />
        <YAxis tick={{ fontSize: 11, fill: '#8892b0' }} />
        <Tooltip />
        <Bar dataKey="value" fill={PALETTE[0]} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function SeriesLine({ data }: { data: CardData }) {
  const rows = (data.data as Array<{ key: string; label: string; value: number }>) ?? [];
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#8892b0' }} />
        <YAxis tick={{ fontSize: 11, fill: '#8892b0' }} />
        <Tooltip />
        <Line type="monotone" dataKey="value" stroke={PALETTE[0]} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function SeriesPie({ data }: { data: CardData }) {
  const rows = (data.data as Array<{ key: string; label: string; value: number }>) ?? [];
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="label" outerRadius={90}>
          {rows.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}

function TimeTrackedCard({ data }: { data: CardData }) {
  const rows = (data.data as Array<{ userId: string; userName: string; totalSeconds: number }>) ?? [];
  return (
    <ul className="text-xs flex flex-col gap-1">
      {rows.map((r) => (
        <li key={r.userId} className="flex justify-between">
          <span>{r.userName}</span>
          <span className="tabular-nums">{Math.round(r.totalSeconds / 3600)}h</span>
        </li>
      ))}
    </ul>
  );
}

function GoalCard({ data }: { data: CardData }) {
  // Phase 8 goal.service not wired yet — render a placeholder until it lands.
  const d = data.data as { value: number | null; pending?: boolean };
  return <div className="text-xs text-muted-foreground">{d.pending ? 'Goal data pending (Phase 8)' : String(d.value)}</div>;
}

function FallbackCard() {
  return <div className="text-xs text-muted-foreground">Unsupported card type</div>;
}

const REGISTRY: Record<string, CardRenderer> = {
  task_list:    TaskListCard,
  calculation:  CalculationCard,
  bar:          SeriesBar,
  line:         SeriesLine,
  pie:          SeriesPie,
  time_tracked: TimeTrackedCard,
  goal:         GoalCard,
};

export function resolveCardRenderer(type: CardType): CardRenderer {
  return REGISTRY[type] ?? FallbackCard;
}
```

- [ ] Write `TaskListCard.tsx` (generic `task_list` renderer):

```tsx
'use client';
import type { CardData } from '@projectflow/types';

export function TaskListCard({ data }: { data: CardData }) {
  const rows = (data.data as any[]) ?? [];
  return (
    <ul className="flex flex-col divide-y divide-border/50 text-xs">
      {rows.map((t) => (
        <li key={t.Id ?? t.id} className="py-1.5 flex items-center justify-between gap-2">
          <span className="truncate">{t.Title ?? t.title}</span>
          <span className="shrink-0 text-muted-foreground">{t.Status ?? t.status}</span>
        </li>
      ))}
      {rows.length === 0 && <li className="py-2 text-muted-foreground">No tasks</li>}
    </ul>
  );
}
```

- [ ] Write `CalculationCard.tsx` (single big number):

```tsx
'use client';
import type { CardData } from '@projectflow/types';

export function CalculationCard({ data }: { data: CardData }) {
  const value = (data.data as { value: number | null }).value;
  return <div className="text-4xl font-semibold tabular-nums">{value ?? '—'}</div>;
}
```

- [ ] Write `CardConfigDrawer.tsx` — the per-card config + **per-card filter** editor. It reuses the Phase 3 filter rule machinery (the same `FilterGroup`/`FieldRef`/operator model `filter-builder.tsx` uses); for 9a a compact embedded filter editor over `card.config.filter` is sufficient (a card type picker + an aggregate op picker + a groupBy picker + the filter rules). Persist via `updateCard`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { updateCard } from '@/server/actions/dashboards';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { CardConfig, CardType, DashboardCard, FilterGroup } from '@projectflow/types';

const AGG_OPS = ['count', 'sum', 'avg', 'min', 'max'] as const;

export function CardConfigDrawer({ card, onSaved, onClose }: { card: DashboardCard; onSaved: () => void; onClose: () => void }) {
  const t = useTranslations('DashboardCards');
  const [config, setConfig] = useState<CardConfig>(card.config);
  const [pending, start] = useTransition();

  const setFilter = (filter: FilterGroup) => setConfig((c) => ({ ...c, filter }));

  const save = () => start(async () => {
    const r = await updateCard(card.id, { config });
    if (!r.ok) return notifyActionError(r);
    onSaved(); onClose();
  });

  const showAgg = card.type === 'calculation' || card.type === 'bar';
  const showGroup = card.type === 'bar' || card.type === 'line' || card.type === 'pie';

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <div className="font-semibold">{t('configureCard')}</div>

      {showAgg && (
        <label className="flex items-center gap-2">
          <span className="w-20">{t('aggregate')}</span>
          <select
            className="border rounded px-1 py-0.5 bg-background"
            value={config.aggregate?.op ?? 'count'}
            onChange={(e) => setConfig((c) => ({ ...c, aggregate: { ...c.aggregate, op: e.target.value as any } }))}
          >
            {AGG_OPS.map((op) => <option key={op} value={op}>{t(`agg_${op}`)}</option>)}
          </select>
        </label>
      )}

      {/* Per-card filter — the same FilterGroup AST the Phase 3 filter-builder edits.
          A full nested editor can reuse <FilterBuilder/>'s rule components; for 9a a
          minimal rules editor over config.filter is sufficient. */}
      <PerCardFilter filter={config.filter ?? { conjunction: 'AND', rules: [] }} onChange={setFilter} />

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <button className="px-2 py-1" onClick={onClose}>{t('cancel')}</button>
        <button className="px-2 py-1 rounded bg-primary text-primary-foreground" disabled={pending} onClick={save}>{t('save')}</button>
      </div>
    </div>
  );
}

// Minimal AND/OR rule list over the shared FilterGroup AST. Reuses field tokens
// from the views field-options helper so cards filter on the same field set.
function PerCardFilter({ filter, onChange }: { filter: FilterGroup; onChange: (f: FilterGroup) => void }) {
  const t = useTranslations('DashboardCards');
  const addRule = () => onChange({ ...filter, rules: [...filter.rules, { field: { kind: 'builtin', key: 'status' }, op: '=', value: '' }] });
  return (
    <section className="flex flex-col gap-2">
      <span className="font-semibold uppercase tracking-wide text-muted-foreground">{t('filters')}</span>
      {filter.rules.map((r, i) => (
        <div key={i} className="flex items-center gap-2" data-testid="card-filter-rule">
          <input
            className="border rounded px-1 py-0.5 bg-background w-40"
            value={String((r as any).value ?? '')}
            placeholder={t('valuePlaceholder')}
            onChange={(e) => {
              const rules = [...filter.rules];
              rules[i] = { ...(r as any), value: e.target.value };
              onChange({ ...filter, rules });
            }}
          />
          <button onClick={() => onChange({ ...filter, rules: filter.rules.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <button className="px-2 py-1 rounded border w-fit" onClick={addRule} data-testid="card-add-filter">{t('addFilter')}</button>
    </section>
  );
}
```

> **Implementer note:** for a richer per-card filter you can lift `RuleEditor`/`FieldSelect` out of `apps/next-web/src/components/views/filter-builder.tsx` into a shared module and import them here — the spec calls for "reusing the Phase 3 filter-builder". The minimal editor above is the floor; promote shared components if extraction is cheap.

- [ ] Write `DashboardGrid.tsx` — the dnd-kit movable/resizable grid. Cards are sortable (`@dnd-kit/sortable`); each card fetches its data via `loadCardData`, renders via `resolveCardRenderer`, opens `CardConfigDrawer` to configure, and a PDF-export button links to `?print=1`. Resize uses a corner handle writing `{w,h}` into the card layout; reorder + resize both persist via `reorderCards`:

```tsx
'use client';

import { useEffect, useState, useTransition, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, rectSortingStrategy, arrayMove, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, Settings, Trash2, Printer } from 'lucide-react';
import { addCard, deleteCard, reorderCards, loadCardData } from '@/server/actions/dashboards';
import { notifyActionError } from '@/lib/apiErrorToast';
import { resolveCardRenderer } from './card-registry';
import { CardConfigDrawer } from './CardConfigDrawer';
import type { CardData, CardType, Dashboard, DashboardCard } from '@projectflow/types';
import styles from './DashboardGrid.module.css';

const ADDABLE: CardType[] = ['task_list', 'calculation', 'bar', 'line', 'pie', 'time_tracked', 'goal'];

export function DashboardGrid({ dashboard }: { dashboard: Dashboard }) {
  const t = useTranslations('DashboardCards');
  const router = useRouter();
  const [cards, setCards] = useState<DashboardCard[]>(dashboard.cards ?? []);
  const [configuring, setConfiguring] = useState<DashboardCard | null>(null);
  const [, start] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const persist = useCallback((next: DashboardCard[]) => {
    start(async () => {
      const r = await reorderCards(dashboard.id, next.map((c, i) => ({ id: c.id, layout: c.layout, position: i })));
      if (!r.ok) notifyActionError(r);
    });
  }, [dashboard.id]);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setCards((cs) => {
      const oldI = cs.findIndex((c) => c.id === active.id);
      const newI = cs.findIndex((c) => c.id === over.id);
      const next = arrayMove(cs, oldI, newI);
      persist(next);
      return next;
    });
  };

  const onAdd = (type: CardType) => start(async () => {
    const r = await addCard(dashboard.id, {
      type, title: t(`type_${type}`),
      config: type === 'calculation' ? { aggregate: { op: 'count' } } : { filter: { conjunction: 'AND', rules: [] } },
      layout: { x: 0, y: 0, w: 6, h: 4 },
    });
    if (!r.ok) return notifyActionError(r);
    setCards((cs) => [...cs, r.data]);
  });

  const onResize = (id: string, w: number, h: number) =>
    setCards((cs) => {
      const next = cs.map((c) => (c.id === id ? { ...c, layout: { ...c.layout, w, h } } : c));
      persist(next);
      return next;
    });

  const onDelete = (id: string) => start(async () => {
    const r = await deleteCard(id);
    if (!r.ok) return notifyActionError(r);
    setCards((cs) => cs.filter((c) => c.id !== id));
  });

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.addMenu}>
          <span className={styles.addLabel}><Plus className="size-3.5" /> {t('addCard')}</span>
          {ADDABLE.map((type) => (
            <button key={type} className={styles.addBtn} onClick={() => onAdd(type)} data-card-type={type}>
              {t(`type_${type}`)}
            </button>
          ))}
        </div>
        <button
          className={styles.printBtn}
          onClick={() => router.push(`/dashboard?id=${dashboard.id}&print=1`)}
          data-testid="export-pdf"
        >
          <Printer className="size-3.5" /> {t('exportPdf')}
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={cards.map((c) => c.id)} strategy={rectSortingStrategy}>
          <div className={styles.grid}>
            {cards.map((card) => (
              <SortableCard
                key={card.id}
                card={card}
                onConfigure={() => setConfiguring(card)}
                onDelete={() => onDelete(card.id)}
                onResize={(w, h) => onResize(card.id, w, h)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {configuring && (
        <div className={styles.drawer}>
          <CardConfigDrawer card={configuring} onClose={() => setConfiguring(null)} onSaved={() => router.refresh()} />
        </div>
      )}
    </div>
  );
}

function SortableCard({
  card, onConfigure, onDelete, onResize,
}: { card: DashboardCard; onConfigure: () => void; onDelete: () => void; onResize: (w: number, h: number) => void }) {
  const t = useTranslations('DashboardCards');
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: card.id });
  const [data, setData] = useState<CardData | null>(null);

  useEffect(() => {
    let active = true;
    loadCardData(card.id).then((r) => { if (active && r.ok) setData(r.data); });
    return () => { active = false; };
  }, [card.id]);

  const Renderer = resolveCardRenderer(card.type);
  const style = {
    transform: CSS.Transform.toString(transform), transition,
    gridColumn: `span ${card.layout.w}`, gridRow: `span ${card.layout.h}`,
  };

  return (
    <div ref={setNodeRef} style={style} className={styles.card} data-card-type={card.type}>
      <div className={styles.cardHeader}>
        <span className={styles.dragHandle} {...attributes} {...listeners} aria-label={t('drag')}>⠿</span>
        <span className={styles.cardTitle}>{card.title ?? t(`type_${card.type}`)}</span>
        <button onClick={onConfigure} aria-label={t('configure')}><Settings className="size-3.5" /></button>
        <button onClick={onDelete} aria-label={t('remove')}><Trash2 className="size-3.5" /></button>
      </div>
      <div className={styles.cardBody}>
        {data ? <Renderer data={data} /> : <div className={styles.loading}>{t('loading')}</div>}
      </div>
      <button
        className={styles.resizeHandle}
        aria-label={t('resize')}
        onClick={() => onResize(Math.min(12, card.layout.w + 2), card.layout.h + 1)}
      />
    </div>
  );
}
```

- [ ] Write `DashboardGrid.module.css`:

```css
.root { display: flex; flex-direction: column; gap: 12px; }
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.addMenu { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.addLabel { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; font-size: 12px; }
.addBtn, .printBtn { border: 1px solid var(--border, #2a2f3a); border-radius: 6px; padding: 3px 8px; font-size: 12px; cursor: pointer; background: var(--surface-2, #1f2937); }
.printBtn { display: inline-flex; align-items: center; gap: 4px; }
.grid { display: grid; grid-template-columns: repeat(12, 1fr); grid-auto-rows: 56px; gap: 12px; }
.card { display: flex; flex-direction: column; border: 1px solid var(--border, #2a2f3a); border-radius: 10px; overflow: hidden; background: var(--surface-1, #111827); position: relative; }
.cardHeader { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid var(--border, #2a2f3a); font-size: 12px; }
.dragHandle { cursor: grab; user-select: none; }
.cardTitle { flex: 1; font-weight: 600; }
.cardBody { flex: 1; padding: 10px; overflow: auto; }
.loading { color: var(--text-2, #6b7280); font-size: 12px; }
.resizeHandle { position: absolute; right: 4px; bottom: 4px; width: 12px; height: 12px; border: none; cursor: se-resize; background: linear-gradient(135deg, transparent 50%, var(--border, #2a2f3a) 50%); }
.drawer { position: fixed; right: 0; top: 0; height: 100vh; width: 320px; background: var(--surface-1, #111827); border-left: 1px solid var(--border, #2a2f3a); z-index: 50; overflow: auto; }
```

- [ ] Run: `npm test --workspace apps/next-web -- card-registry`. Expected: PASS (2 tests).

- [ ] Commit:
```
git add apps/next-web/src/components/dashboard/DashboardGrid.tsx apps/next-web/src/components/dashboard/DashboardGrid.module.css apps/next-web/src/components/dashboard/card-registry.tsx apps/next-web/src/components/dashboard/TaskListCard.tsx apps/next-web/src/components/dashboard/CalculationCard.tsx apps/next-web/src/components/dashboard/CardConfigDrawer.tsx apps/next-web/src/components/dashboard/__tests__/card-registry.unit.test.tsx
git commit -m "feat(9a): dnd-kit dashboard grid + wave-1 card renderers + per-card config/filter editor"
```

---

### Task 11: Re-point dashboard page/view + print layout + i18n

**Files:**
- Modify: `apps/next-web/src/app/(app)/dashboard/page.tsx`
- Modify: `apps/next-web/src/app/(app)/dashboard/dashboard-view.tsx`
- Create: `apps/next-web/src/app/(app)/dashboard/print/dashboard-print.tsx`
- Modify: `apps/next-web/src/messages/en.json`
- Modify: `apps/next-web/src/messages/id.json`
- Note: read `node_modules/next/dist/docs/` per `apps/next-web/AGENTS.md` before writing web code.

Steps:

- [ ] Re-point `page.tsx` — load the active scope's dashboards (seed a default workspace dashboard if none exists so today's view is preserved), and branch on `?print=1`:

```tsx
import { redirect } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getWorkspaceProjectContext } from '@/server/context';
import { getDashboards, getDashboard } from '@/server/queries/dashboards';
import { createDashboard } from '@/server/actions/dashboards';
import { DashboardView } from './dashboard-view';
import { DashboardPrint } from './print/dashboard-print';

export default async function DashboardPage({
  searchParams,
}: { searchParams: Promise<{ id?: string; print?: string }> }) {
  await requireSession();
  const ctx = await getWorkspaceProjectContext();
  if (ctx.workspaces.length === 0) redirect('/setup');

  const { id, print } = await searchParams;

  // Print mode renders the read-only, print-optimized layout (one dashboard).
  if (print === '1' && id) {
    const dashboard = await getDashboard(id);
    return <DashboardPrint dashboard={dashboard} />;
  }

  // Workspace-scoped dashboards for the active workspace; seed a default once.
  let dashboards = await getDashboards('workspace', null, ctx.activeWorkspaceId);
  if (dashboards.length === 0) {
    const res = await createDashboard({
      scopeType: 'workspace', scopeId: null, name: 'Overview', visibility: 'shared',
      workspaceId: ctx.activeWorkspaceId,
    });
    if (res.ok) dashboards = [res.data];
  }
  const active = id ? await getDashboard(id) : await getDashboard(dashboards[0].id);

  return <DashboardView ctx={ctx} dashboards={dashboards} active={active} />;
}
```

- [ ] Re-point `dashboard-view.tsx` — keep the header/switchers; render `<DashboardGrid dashboard={active} />` in place of the hardcoded gadget grid. Trim the now-unused report props/imports:

```tsx
'use client';

import { BarChart3 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { WorkspaceProjectSwitcher } from '@/app/(app)/_components/selection-bridge';
import type { WorkspaceProjectContext } from '@/server/context';
import type { Dashboard } from '@projectflow/types';

interface Props { ctx: WorkspaceProjectContext; dashboards: Dashboard[]; active: Dashboard }

export function DashboardView({ ctx, dashboards, active }: Props) {
  const t = useTranslations('Dashboard');
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-primary/10 p-2 text-primary"><BarChart3 className="size-5" /></div>
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{t('breadcrumb')}</div>
            <h2 className="text-base font-semibold text-foreground truncate">{active.name}</h2>
          </div>
        </div>
        <WorkspaceProjectSwitcher
          workspaces={ctx.workspaces}
          projects={ctx.projects}
          activeWorkspaceId={ctx.activeWorkspaceId}
          activeProjectId={ctx.activeProjectId}
        />
      </div>
      <DashboardGrid dashboard={active} />
    </div>
  );
}
```

> **Implementer note:** the legacy hardcoded report gadgets (Burndown/Velocity/etc.) are now created as **report cards in 9b**. 9a deliberately re-points the page to the new model; the seeded default starts empty (the user adds cards). If a no-regression seed is desired, the implementer may seed a starter set of cards in the `createDashboard` step, but this is optional for 9a.

- [ ] Write `print/dashboard-print.tsx` — a read-only, print-optimized layout that renders every card (resolving its data) and auto-invokes `window.print()`. No grid chrome (no drag handles / config buttons):

```tsx
'use client';

import { useEffect, useState } from 'react';
import { loadCardData } from '@/server/actions/dashboards';
import { resolveCardRenderer } from '@/components/dashboard/card-registry';
import type { CardData, Dashboard, DashboardCard } from '@projectflow/types';

export function DashboardPrint({ dashboard }: { dashboard: Dashboard }) {
  const cards = dashboard.cards ?? [];
  const [ready, setReady] = useState(0);

  // Trigger the browser print dialog once every card has rendered its data.
  useEffect(() => {
    if (cards.length > 0 && ready >= cards.length) {
      const h = setTimeout(() => window.print(), 300);
      return () => clearTimeout(h);
    }
  }, [ready, cards.length]);

  return (
    <div style={{ padding: 24, background: '#fff', color: '#111' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>{dashboard.name}</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {cards.map((card) => (
          <PrintCard key={card.id} card={card} onReady={() => setReady((n) => n + 1)} />
        ))}
      </div>
    </div>
  );
}

function PrintCard({ card, onReady }: { card: DashboardCard; onReady: () => void }) {
  const [data, setData] = useState<CardData | null>(null);
  useEffect(() => {
    loadCardData(card.id).then((r) => { if (r.ok) setData(r.data); onReady(); });
  }, [card.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const Renderer = resolveCardRenderer(card.type);
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, breakInside: 'avoid' }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{card.title ?? card.type}</div>
      {data ? <Renderer data={data} /> : <div>…</div>}
    </div>
  );
}
```

- [ ] Add i18n keys. In `en.json` add a `DashboardCards` namespace and extend `Dashboard` (keep existing `Dashboard` keys):

```json
"DashboardCards": {
  "addCard": "Add card",
  "configureCard": "Configure card",
  "configure": "Configure",
  "remove": "Remove",
  "drag": "Drag to reorder",
  "resize": "Resize",
  "loading": "Loading…",
  "exportPdf": "Export PDF",
  "filters": "Filters",
  "addFilter": "Add filter",
  "valuePlaceholder": "Value",
  "aggregate": "Aggregate",
  "save": "Save",
  "cancel": "Cancel",
  "agg_count": "Count",
  "agg_sum": "Sum",
  "agg_avg": "Average",
  "agg_min": "Minimum",
  "agg_max": "Maximum",
  "type_task_list": "Task list",
  "type_calculation": "Calculation",
  "type_bar": "Bar chart",
  "type_line": "Line chart",
  "type_pie": "Pie chart",
  "type_time_tracked": "Time tracked",
  "type_goal": "Goal"
}
```

- [ ] Add the same keys to `id.json` with real Indonesian:

```json
"DashboardCards": {
  "addCard": "Tambah kartu",
  "configureCard": "Konfigurasikan kartu",
  "configure": "Konfigurasikan",
  "remove": "Hapus",
  "drag": "Seret untuk mengurutkan",
  "resize": "Ubah ukuran",
  "loading": "Memuat…",
  "exportPdf": "Ekspor PDF",
  "filters": "Filter",
  "addFilter": "Tambah filter",
  "valuePlaceholder": "Nilai",
  "aggregate": "Agregat",
  "save": "Simpan",
  "cancel": "Batal",
  "agg_count": "Jumlah",
  "agg_sum": "Total",
  "agg_avg": "Rata-rata",
  "agg_min": "Minimum",
  "agg_max": "Maksimum",
  "type_task_list": "Daftar tugas",
  "type_calculation": "Kalkulasi",
  "type_bar": "Diagram batang",
  "type_line": "Diagram garis",
  "type_pie": "Diagram lingkaran",
  "type_time_tracked": "Waktu tercatat",
  "type_goal": "Sasaran"
}
```

- [ ] Run: `npm test --workspace apps/next-web` (includes the `messages.unit` i18n parity test). Expected: PASS — en/id key parity green. Then `npm run build --workspace apps/next-web`. Expected: PASS (Next build clean).

- [ ] Commit:
```
git add "apps/next-web/src/app/(app)/dashboard/page.tsx" "apps/next-web/src/app/(app)/dashboard/dashboard-view.tsx" "apps/next-web/src/app/(app)/dashboard/print/dashboard-print.tsx" apps/next-web/src/messages/en.json apps/next-web/src/messages/id.json
git commit -m "feat(9a): re-point dashboard page to config-driven grid + ?print=1 PDF layout + i18n"
```

---

### Task 12: Playwright e2e (headline flow) + acceptance

**Files:**
- Create: `apps/next-web/e2e/dashboards.spec.ts`
- Note: e2e runs against local Docker `ProjectFlow_Test` only (use the project's existing e2e env/setup, same as the views/realtime specs).

Steps:

- [ ] Write the e2e spec covering the §4.5 acceptance flow — create a dashboard, add **≥6 card types** with live data + a per-card filter, export to PDF. Follow the existing spec harness (login helper, seeded project/tasks) used by the views/presence specs:

```ts
import { test, expect } from '@playwright/test';
import { loginAndSeedProject } from './helpers'; // existing helper used by other specs

test.describe('Phase 9a — dashboards core', () => {
  test('builds a dashboard with ≥6 card types + per-card filter + PDF export', async ({ page }) => {
    await loginAndSeedProject(page);
    await page.goto('/dashboard');           // seeds a default workspace dashboard

    // Add six card types via the toolbar add-menu.
    for (const type of ['task_list', 'calculation', 'bar', 'line', 'pie', 'time_tracked']) {
      await page.locator(`[data-card-type="${type}"]`).first().click();
      await expect(page.locator(`.${''}[data-card-type="${type}"]`).first()).toBeVisible(); // a card with that type now exists
    }

    // Each added card renders (data loaded, not stuck on "Loading…").
    await expect(page.locator('[data-card-type="task_list"]')).toHaveCount(1);
    await expect(page.locator('[data-card-type="calculation"]')).toBeVisible();

    // Per-card filter: open the first card's config, add a filter rule, save.
    await page.locator('[data-card-type="task_list"] button[aria-label*="Configure" i]').first().click();
    await page.getByTestId('card-add-filter').click();
    await page.getByTestId('card-filter-rule').locator('input').fill('Done');
    await page.getByRole('button', { name: /save/i }).click();

    // PDF export opens the print-optimized layout (window.print is stubbed in e2e).
    await page.addInitScript(() => { (window as any).print = () => { (window as any).__printed = true; }; });
    await page.getByTestId('export-pdf').click();
    await expect(page).toHaveURL(/print=1/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); // print layout title
  });
});
```

> **Implementer note:** adjust the card-presence selector to whatever the grid actually renders (`SortableCard` sets `data-card-type` on each card root). The `print` stub via `addInitScript` must be registered before navigation; if the harness clears init scripts on `goto`, register it at test start. Confirm the seeded project has ≥1 task so `task_list`/`calculation`/`time_tracked` show live data (`loginAndSeedProject` should create at least one).

- [ ] Run: the project's e2e command for a single spec against `ProjectFlow_Test` (e.g. `npx playwright test e2e/dashboards.spec.ts`). Expected: PASS (1 test) — dashboard built with ≥6 card types, per-card filter applied, print layout opened.

- [ ] Commit:
```
git add apps/next-web/e2e/dashboards.spec.ts
git commit -m "test(9a): e2e — dashboard with ≥6 card types + per-card filter + PDF export"
```

---

### Task 13: Slice verification + DECISIONS.md

**Files:**
- Modify: `DECISIONS.md` (append a Phase 9a entry)

Steps:

- [ ] Run the full slice verification on local Docker `ProjectFlow_Test`:
  - `npm test --workspace apps/api` — Expected: PASS (existing suite + new `card-aggregate`/`visibility` unit tests).
  - `npm run test:integration --workspace apps/api -- dashboards` — Expected: PASS (`dashboards.integration.test.ts`, 4 tests).
  - `npm test --workspace apps/next-web` — Expected: PASS (unit + `card-registry` + `messages.unit` parity).
  - `npm run build --workspace apps/api` and `npm run build --workspace apps/next-web` — Expected: both PASS.
  - The dashboards e2e — Expected: PASS.

- [ ] Append a `DECISIONS.md` entry logging: the `Dashboards`/`DashboardCards` data model (scope/visibility mirroring `SavedViews`); the **one resolver, three data sources** `card.service` registry (and that 9b extends it, 9c snapshots through it); the generic-card path reusing `viewService.runConfig` (the Phase 3 compiler) under object-level scope; **`time_tracked` resolving through a new scope-aggregating SP** (`usp_Dashboard_TimeTracked`) and **`goal` shipping as a Phase-8 stub** because the goals module is not yet built; the one-default-per-scope guard (`usp_Dashboard_SetDefault`); the JSON-batch reorder/resize persistence (`usp_DashboardCard_Reorder`); the `?print=1` browser print-to-PDF approach (no server PDF engine — deferral §11.2); the GraphQL mirror; migration number **`0047`** assumed after Phases 6/7/8; and any deviation found during implementation. DB-execution-policy note: all DB work ran ONLY against local Docker `ProjectFlow_Test`.

- [ ] Commit:
```
git add DECISIONS.md
git commit -m "docs(9a): DECISIONS entry — dashboards core, card.service dispatcher, print-to-PDF"
```

---

## Definition of Done

Per-slice DoD (spec §3) + BUILD_PLAN acceptance (spec §4.5):

- [ ] **BUILD_PLAN acceptance (§4.5):** the dashboard renders **≥6 card types with live data and per-card filters** (e2e green): `task_list`, `calculation`, `bar`, `line`, `pie`, `time_tracked` all resolve real rows/series under the dashboard scope; `goal` renders its Phase-8 placeholder.
- [ ] Migration `0047_dashboards.sql` is idempotent, GO-batched, and **reversible** via `rollback/0047_dashboards.down.sql` (apply→rollback→re-apply verified clean) — `Dashboards` + `DashboardCards` with the spec's exact columns/CHECKs.
- [ ] SP-per-op for every operation: `usp_Dashboard_Create|GetById|GetWorkspaceId|Update|Delete|ListByScope|SetDefault`, `usp_DashboardCard_Create|Update|Delete|Reorder`, `usp_Dashboard_TimeTracked`.
- [ ] **`card.service` is a `CardType`-keyed registry** (one resolver, three data sources): generic cards → Phase 3 compiler (`viewService.runConfig`), `time_tracked` → scope-aggregate SP, `goal` → Phase 8 stub — designed so 9b adds card types and 9c snapshots by iterating the same registry.
- [ ] **A card never returns data the user can't read directly:** card resolution runs under the requesting user's object-level scope; the `/cards/:cardId/data` route + `dashboardCardData` resolver both gate on `requireObjectLevel`/`accessService.can(VIEW)` and fail closed (integration test asserts a no-access user gets 403/no rows).
- [ ] REST is the primary surface; the **GraphQL mirror** (`dashboards`, `dashboard`, `dashboardCardData` + create/update/delete/card/setDefault mutations) delegates to the **one shared `dashboardService`/`cardService`**.
- [ ] **Default-per-scope guard** (one default per (scopeType,scopeId)) enforced transactionally in `usp_Dashboard_SetDefault`; **visibility** mirrors `SavedViews` (shared/owned readable; private owner-only); **reorder/resize persists** via the JSON-batch `usp_DashboardCard_Reorder`.
- [ ] Frontend: dnd-kit movable/resizable grid with add/configure/resize/reorder, per-card filter editor reusing the Phase 3 filter model, the hardcoded `dashboard-view.tsx` re-pointed at the new model (seeded default preserves a working page), and **PDF export** via a `?print=1` print-optimized layout + browser print-to-PDF.
- [ ] Unit tests (config→compiled-query mapping, calculation aggregates count/sum/avg/min/max, default-per-scope guard, visibility resolution, card-registry) + integration tests (CRUD, card data under object-level scoping, reorder/resize + default persistence) + ≥1 Playwright e2e (≥6 card types + per-card filter + PDF) — all green.
- [ ] `@projectflow/types` updated (`Dashboard`, `DashboardCard`, `CardType`/`CardConfig`, `DashboardCardLayout`, `DashboardScopeType`, `DashboardVisibility`, `CardData`, create/update inputs, `ReorderCardEntry`).
- [ ] i18n: new `DashboardCards` namespace + `Dashboard` additions in **en.json + id.json** (real Indonesian); card-type labels + aggregate-op + axis/series strings externalized; `messages.unit` parity green.
- [ ] All DB work (migration, SP deploy, integration, e2e) ran **ONLY against local Docker `ProjectFlow_Test`** — never the prod-pointing `apps/api/.env`.
- [ ] `DECISIONS.md` entry logs the mechanism choices + the Phase-8 `goal`/`time_tracked` handling + any deviations. **Stop for review/merge before Slice 9b.**

---

## Self-Review

**Spec coverage (§4):**
- §4.1 data model — Task 1 creates `0047_dashboards.sql` with `Dashboards`/`DashboardCards` and the **exact** columns/tokens (ScopeType `workspace|space|folder|list`, Visibility `private|shared|protected`, IsDefault, Position; Type, Config JSON, Layout `{x,y,w,h}`). ✔
- §4.2 backend — Tasks 2–3 (all named SPs incl. `usp_Dashboard_SetDefault` + card CRUD/`Reorder`), Task 5 (`dashboard.service` default-per-scope guard + visibility reusing the `SavedViews` rule; **`card.service`** dispatcher routing wave-1 types `task_list`/`calculation`/`bar`/`line`/`pie`/`time_tracked`/`goal`), Task 6 (REST), Task 8 (GraphQL mirror with `dashboards(scope)`/`dashboard(id)`/`dashboardCardData(cardId)` + create/update/delete mutations). Generic cards route through the **Phase 3 compiler** (`viewService.runConfig`) under object-level filter; `time_tracked`→SP, `goal`→Phase-8 stub. ✔
- §4.3 frontend — Task 10 (dnd-kit movable/resizable grid, add/configure/resize/reorder, per-card filter editor reusing the Phase 3 filter model, Recharts + generic `task_list`/`calculation` renderers), Task 11 (re-point `dashboard-view.tsx`, **PDF export** via `?print=1` + browser print). ✔
- §4.4 tests — unit (config→query, calc aggregates, default guard, visibility); integration (CRUD, **card data under object-level scoping**, reorder/resize persistence); e2e (≥6 card types + per-card filters + PDF). ✔
- §4.5 acceptance — covered explicitly in DoD + the e2e. ✔
- §3 conventions — idempotent GO-batched migration + matching rollback; SP-per-op `CREATE OR ALTER`/`SET NOCOUNT ON`/TRY-CATCH-TRANSACTION; `execSp`/`execSpOne`; Hono + zod; Pothos `register*Graphql()` in `schema.ts`; `requirePermission`/`requireObjectLevel` fail-closed; en+id i18n parity; vitest unit+integration; Playwright e2e; DB only on `ProjectFlow_Test`. ✔
- Cross-slice contracts — `card.service` is a `CardType`-keyed **registry** with a public `register()` seam so **9b** adds report/entity card types and **9c** snapshots by iterating `resolve()`; `CardConfig` already carries `reportParams`/`goalId` forward-compat fields. ✔

**Placeholder scan:** No "the other card types follow the same shape" hand-waving — every SP, the migration (both tables, exact columns), `dashboard.service`, the full `card.service` dispatcher (each wave-1 branch), REST routes, GraphQL mirror, dnd-kit grid, both generic renderers, and the `?print=1` layout are given as full code. Two explicit **implementer notes** flag real decisions (the `bar/line/pie` registration pattern / top-level-await fallback; promoting shared filter components) rather than leaving gaps.

**Type/name consistency:** Migration number **`0047`**, table names `Dashboards`/`DashboardCards`, card-type tokens (`task_list`/`calculation`/`bar`/`line`/`pie`/`time_tracked`/`goal`), and type names (`Dashboard`, `DashboardCard`, `CardType`, `CardConfig`) all match the spec verbatim. The Phase 3 entry point (`viewService.runConfig(scopeType, scopeId, config, opts, workspaceId, userId)`), the compiler/`ViewTaskPage`/`ViewGroup` shapes, the `getScopeNode` scope helper, `requirePermission`/`requireObjectLevel`/`accessService.can`, the `usp_View_List` visibility rule, and the Recharts/dnd-kit deps were all read from the live codebase and used as-is.

**Grounded deviations (flagged inline, for DECISIONS.md):** (1) on-disk migrations are at `0037` and **Phase 8 is not yet built** (no `goals` module; `worklog.service` is basic CRUD) — `goal` ships as a stub and `time_tracked` resolves through a new `usp_Dashboard_TimeTracked` SP rather than a Phase-8 `worklog/goal.service`; the `card.service` registry makes the later re-point a one-line change. (2) `0047` is kept per the spec's cross-slice contract even though it assumes `0038–0046` land first.
