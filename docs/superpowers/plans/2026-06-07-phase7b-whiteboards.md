# Phase 7b — Whiteboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add **Whiteboards** to ProjectFlow — a tldraw canvas bound to Yjs over the **shared Hocuspocus collab server that Phase 7a stood up** (doc name `whiteboard:<id>`, persisting the tldraw snapshot to `Whiteboards.DocYjs VARBINARY(MAX)` + a JSON snapshot to `Whiteboards.DocJson NVARCHAR(MAX)`). Whiteboard CRUD is a normal scoped-object REST module (primary) + a GraphQL mirror over one shared service. The headline feature is **convert a shape/sticky/text → a real task**: an endpoint that creates a task in a target List with the shape's text as the title and links it back via `WhiteboardTaskLinks`. The frontend mounts the tldraw canvas (Yjs-bound via the shared `@hocuspocus/provider`), a convert-to-task action with a target-List picker, and live task/doc **embed** cards as custom tldraw shapes.

**Architecture:** Whiteboards are **scoped objects** (`ScopeType` ∈ `SPACE|FOLDER|LIST`, `ScopeId`) exactly like `SavedViews` (Phase 3) — metadata + tree ops live in REST/GraphQL; the **live canvas sync** rides the collab WebSocket, NOT REST. The collab server's `onLoadDocument`/`onStoreDocument` (built in 7a, keyed by document name) gains a `whiteboard:<id>` branch that reads/writes `Whiteboards.DocYjs` (binary Yjs state) + `Whiteboards.DocJson` (the rendered tldraw snapshot for SSR first-paint + future search/AI indexing) — reusing 7a's persistence path verbatim, only switching the table/columns. New behavior is SP-per-op in `infra/sql/procedures/` surfaced through `whiteboard.repository` → `whiteboard.service`, exposed as Hono REST (primary) and a `whiteboard.schema.ts` Pothos mirror, both delegating to the one shared service. The **convert-to-task** path reuses the existing `TaskService.createTask(input, actorId)` (so notifications/webhooks/progress rollups fire normally) and then writes a `WhiteboardTaskLinks` row; the shape→task title is derived by a **pure, unit-tested** extractor that walks tldraw's shape JSON (sticky/text/geo-with-label) for its text. Authorization mirrors `SavedViews`: REST gates on the **scope's** hierarchy object level via `requireObjectAccess` (VIEW to read, EDIT to mutate); convert-to-task additionally requires `task.create` on the workspace **and** EDIT on the **target List**.

**Tech Stack:** SQL Server stored procedures (`CREATE OR ALTER`, `SET NOCOUNT ON`, TRY/CATCH/TRANSACTION, `SELECT *` of affected rows); Hono REST + `@hono/zod-validator`; graphql-yoga + Pothos (`@pothos/core`); `mssql` via `execSp`/`execSpOne`; vitest (`--project unit` / `--project integration`); Next.js App Router (SSR) + `next-intl`; `tldraw` + `yjs` + `@hocuspocus/provider` (installed in 7a); Playwright e2e. DB work runs ONLY against local Docker `ProjectFlow_Test`.

**Prerequisite:** **Phase 7a merged** (the collab server + `@hocuspocus/provider` + `tldraw` installed, the `apps/api/src/modules/collab/` Hocuspocus server with `onAuthenticate` JWT+ACL, `onLoadDocument`/`onStoreDocument` debounced persistence keyed by document name, the Redis extension, and `0040_docs.sql` applied). 7b **reuses** that collab server's interface + doc-name encoding + persistence contract — do not fork it.

---

## File Structure

**Migrations**
- `infra/sql/migrations/0041_whiteboards.sql` — **Create.** Idempotent, GO-batched: create `Whiteboards` (with `DocYjs VARBINARY(MAX)` / `DocJson NVARCHAR(MAX)`) + `WhiteboardTaskLinks`; supporting indexes; scope-type CHECK.
- `infra/sql/migrations/rollback/0041_whiteboards.down.sql` — **Create.** Reverse: drop `WhiteboardTaskLinks`, the indexes, `Whiteboards`, and the `MigrationHistory` row.

**Stored procedures** (`infra/sql/procedures/`)
- `usp_Whiteboard_Create.sql` — **Create.** Insert a whiteboard (scope + name), return `SELECT *`.
- `usp_Whiteboard_GetById.sql` — **Create.** Return one whiteboard (incl. `DocYjs`/`DocJson`) or no rows.
- `usp_Whiteboard_ListForScope.sql` — **Create.** List non-deleted whiteboards for a scope (or whole workspace), newest first; excludes the heavy `DocYjs` blob.
- `usp_Whiteboard_Update.sql` — **Create.** Rename (ISNULL-coalesced), return `SELECT *`.
- `usp_Whiteboard_Delete.sql` — **Create.** Soft-delete (`DeletedAt`), return the row.
- `usp_Whiteboard_GetWorkspaceId.sql` — **Create.** Resolve a whiteboard's `WorkspaceId` (for RBAC) or no rows.
- `usp_Whiteboard_GetDoc.sql` — **Create.** Return `DocYjs`/`DocJson` for the collab `onLoadDocument` branch.
- `usp_Whiteboard_SaveDoc.sql` — **Create.** Persist `DocYjs` (+ `DocJson` snapshot) + bump `UpdatedAt` for the collab `onStoreDocument` branch.
- `usp_WhiteboardTaskLink_Create.sql` — **Create.** Link a created task back to the whiteboard + originating shape; idempotent on `(WhiteboardId, TaskId, ShapeId)`.
- `usp_WhiteboardTaskLink_ListForWhiteboard.sql` — **Create.** List a whiteboard's task links (for re-hydrating embed cards).

**API — whiteboards module** (`apps/api/src/modules/whiteboards/`)
- `whiteboard.repository.ts` — **Create.** `execSp`/`execSpOne` wrappers + row mappers (`mapWhiteboardRow`, `mapLinkRow`); `create`/`getById`/`listForScope`/`update`/`softDelete`/`getWorkspaceId`/`getDoc`/`saveDoc`/`createTaskLink`/`listTaskLinks`.
- `whiteboard.service.ts` — **Create.** Thin orchestration; `convertShapeToTask` delegates to `TaskService.createTask` then writes the link.
- `whiteboard.shape.ts` — **Create.** Pure `extractShapeTitle(shape)` helper (sticky/text/geo-label/fallback) + `WhiteboardShapeInput` type.
- `whiteboard.routes.ts` — **Create.** Hono REST: list/create/get/update/delete + `POST /whiteboards/:id/convert-to-task`.

**API — collab-server registration** (`apps/api/src/modules/collab/`)
- `collab.persistence.ts` — **Modify.** Add the `whiteboard:<id>` branch to the document-name dispatcher used by `onLoadDocument`/`onStoreDocument` (reuses 7a's debounced persist path; routes to `whiteboard.repository.getDoc/saveDoc`). *(If 7a named this file differently — e.g. the load/store hooks live inline in `collab.server.ts` — add the branch there; note the actual filename inline and proceed.)*

**API — GraphQL mirror** (`apps/api/src/graphql/`)
- `whiteboard.schema.ts` — **Create.** `registerWhiteboardGraphql()`: `WhiteboardType` + `WhiteboardTaskLinkType` + `whiteboards`/`whiteboard` queries + `createWhiteboard`/`updateWhiteboard`/`deleteWhiteboard`/`convertShapeToTask` mutations.
- `schema.ts` — **Modify.** Import + call `registerWhiteboardGraphql()` near the other `register*Graphql()` calls.

**Routing**
- `apps/api/src/server.ts` — **Modify.** Import `whiteboardRoutes` + `app.route('/whiteboards', whiteboardRoutes)`.

**Types** (`packages/types/`)
- `index.ts` — **Modify.** Add `WhiteboardScopeType`, `Whiteboard`, `WhiteboardSummary`, `WhiteboardTaskLink`, `CreateWhiteboardInput`, `UpdateWhiteboardInput`, `ConvertShapeToTaskInput`, `ConvertShapeToTaskResult`.

**Frontend** (`apps/next-web/src/`)
- `server/actions/whiteboards.ts` — **Create.** `'use server'` actions: `createWhiteboard`/`renameWhiteboard`/`deleteWhiteboard`/`convertShapeToTask` (+ `loadWhiteboards`/`loadWhiteboard` query wrappers).
- `server/queries/whiteboards.ts` — **Create.** `getWhiteboards(scope)` / `getWhiteboard(id)` server fetchers.
- `components/whiteboards/WhiteboardCanvas.tsx` — **Create.** `'use client'` tldraw canvas bound to Yjs over the shared `@hocuspocus/provider`; selection → convert-to-task panel; embeds task/doc cards as custom shapes.
- `components/whiteboards/WhiteboardCanvas.module.css` — **Create.** Canvas + convert-panel styles.
- `components/whiteboards/ConvertToTaskPanel.tsx` — **Create.** Target-List picker + convert button; calls the `convertShapeToTask` action.
- `components/whiteboards/useWhiteboardYProvider.ts` — **Create.** Hook that builds the `HocuspocusProvider` (doc name `whiteboard:<id>`, JWT token) + a tldraw↔Yjs store binding; SSRs from `DocJson`, then hydrates.
- `app/(app)/whiteboards/[id]/page.tsx` — **Create.** SSR page: load whiteboard meta + `DocJson` snapshot, render `<WhiteboardCanvas />`. *(Confirm the authenticated route group segment name from the repo before writing — see `apps/next-web/AGENTS.md`.)*
- `messages/en.json` — **Modify.** New `Whiteboard` namespace keys.
- `messages/id.json` — **Modify.** Same keys, real Indonesian.

**Tests**
- `apps/api/src/modules/whiteboards/__tests__/shape.unit.test.ts` — **Create.** Pure `extractShapeTitle` cases (sticky/text/geo-label/empty/whitespace/length-clamp).
- `apps/api/src/modules/whiteboards/__tests__/whiteboard.integration.test.ts` — **Create.** CRUD + **convert a sticky → task created in the chosen list + linked**; cross-scope/authz 404; doc save/load round-trip.
- `apps/next-web/src/components/whiteboards/__tests__/extractShapeTitle.unit.test.ts` — **Create.** Web-side mirror of the title extractor used by the convert panel (kept in sync with the API helper).
- `e2e/whiteboards.spec.ts` — **Create.** Headline: a whiteboard sticky converts into a real task in the chosen list (asserts the task exists via API); plus a **two-browser co-edit** sync check.

---

## Tasks

### Task 1: Migration + rollback (`0041_whiteboards.sql`)

**Files:**
- Create: `infra/sql/migrations/0041_whiteboards.sql`
- Create: `infra/sql/migrations/rollback/0041_whiteboards.down.sql`
- Test: manual deploy against local Docker `ProjectFlow_Test` (migrations have no unit harness; verified via the integration suite in Task 6).

Steps:

- [ ] Write the migration. Idempotent (`sys.tables` / `sys.indexes` guards), GO-batched, matching the `0032_saved_views.sql` style. Columns are EXACTLY the spec's §5.1 set plus the `WhiteboardTaskLinks` link table the convert-to-task path needs:

```sql
-- =============================================================================
-- Migration 0041: Whiteboards (Phase 7b)
-- A whiteboard is a scoped object (SPACE/FOLDER/LIST) whose live canvas is a
-- tldraw document synced over the shared Hocuspocus/Yjs collab server (7a),
-- doc name `whiteboard:<id>`.
--   * Whiteboards          — metadata + persisted tldraw state
--       DocYjs  VARBINARY(MAX) — live Yjs binary state (onStoreDocument)
--       DocJson NVARCHAR(MAX)  — rendered tldraw snapshot (SSR + search/AI)
--   * WhiteboardTaskLinks  — convert shape→task links it back (re-hydrate embeds)
-- Idempotent (catalog guards), GO-batched.
-- Rollback in rollback/0041_whiteboards.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Whiteboards')
BEGIN
    CREATE TABLE dbo.Whiteboards (
        Id          UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL,
        ScopeType   NVARCHAR(12)     NOT NULL,
        ScopeId     UNIQUEIDENTIFIER NOT NULL,
        Name        NVARCHAR(255)    NOT NULL,
        DocYjs      VARBINARY(MAX)   NULL,
        DocJson     NVARCHAR(MAX)    NULL,
        CreatedById UNIQUEIDENTIFIER NOT NULL,
        CreatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        DeletedAt   DATETIME2        NULL,
        CONSTRAINT CK_Whiteboards_ScopeType CHECK (ScopeType IN ('SPACE','FOLDER','LIST')),
        CONSTRAINT FK_Whiteboards_Workspace FOREIGN KEY (WorkspaceId) REFERENCES dbo.Workspaces(Id),
        CONSTRAINT FK_Whiteboards_CreatedBy FOREIGN KEY (CreatedById) REFERENCES dbo.Users(Id)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Whiteboards_Scope' AND object_id = OBJECT_ID('dbo.Whiteboards'))
    CREATE NONCLUSTERED INDEX IX_Whiteboards_Scope
        ON dbo.Whiteboards (WorkspaceId, ScopeType, ScopeId) WHERE DeletedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WhiteboardTaskLinks')
BEGIN
    CREATE TABLE dbo.WhiteboardTaskLinks (
        Id           UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        WhiteboardId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_WhiteboardTaskLinks_Whiteboard REFERENCES dbo.Whiteboards(Id) ON DELETE CASCADE,
        TaskId       UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_WhiteboardTaskLinks_Task       REFERENCES dbo.Tasks(Id)       ON DELETE CASCADE,
        ShapeId      NVARCHAR(100)    NOT NULL,   -- tldraw shape id the task was minted from
        CreatedById  UNIQUEIDENTIFIER NOT NULL,
        CreatedAt    DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_WhiteboardTaskLinks UNIQUE (WhiteboardId, TaskId, ShapeId)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WhiteboardTaskLinks_Whiteboard' AND object_id = OBJECT_ID('dbo.WhiteboardTaskLinks'))
    CREATE NONCLUSTERED INDEX IX_WhiteboardTaskLinks_Whiteboard
        ON dbo.WhiteboardTaskLinks (WhiteboardId);
GO
```

- [ ] Write the rollback `rollback/0041_whiteboards.down.sql` (reverse order — link table first, then indexes, then `Whiteboards`; finally remove the `MigrationHistory` row, matching `0032`'s rollback):

```sql
-- =============================================================================
-- Rollback for 0041_whiteboards.sql. Run manually (forward-only runner).
-- Drops the link table + indexes before the parent table. Idempotent.
-- =============================================================================

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WhiteboardTaskLinks_Whiteboard' AND object_id = OBJECT_ID('dbo.WhiteboardTaskLinks'))
    DROP INDEX IX_WhiteboardTaskLinks_Whiteboard ON dbo.WhiteboardTaskLinks;
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WhiteboardTaskLinks')
    DROP TABLE dbo.WhiteboardTaskLinks;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Whiteboards_Scope' AND object_id = OBJECT_ID('dbo.Whiteboards'))
    DROP INDEX IX_Whiteboards_Scope ON dbo.Whiteboards;
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Whiteboards')
    DROP TABLE dbo.Whiteboards;
GO

DELETE FROM dbo.MigrationHistory WHERE [FileName] = '0041_whiteboards.sql';
GO
```

- [ ] Run against local Docker `ProjectFlow_Test` only (explicit local DB env, never `apps/api/.env`). Apply `0041_whiteboards.sql`, then immediately the `.down.sql`, then re-apply `0041` to prove idempotency + reversibility. Expected: all three runs succeed with no errors; the second `0041` apply is a clean no-op (guards skip everything).

- [ ] Commit:
```
git add infra/sql/migrations/0041_whiteboards.sql infra/sql/migrations/rollback/0041_whiteboards.down.sql
git commit -m "feat(7b): whiteboards migration — Whiteboards (DocYjs/DocJson) + WhiteboardTaskLinks"
```

---

### Task 2: Whiteboard CRUD SPs

**Files:**
- Create: `infra/sql/procedures/usp_Whiteboard_Create.sql`
- Create: `infra/sql/procedures/usp_Whiteboard_GetById.sql`
- Create: `infra/sql/procedures/usp_Whiteboard_ListForScope.sql`
- Create: `infra/sql/procedures/usp_Whiteboard_Update.sql`
- Create: `infra/sql/procedures/usp_Whiteboard_Delete.sql`
- Create: `infra/sql/procedures/usp_Whiteboard_GetWorkspaceId.sql`
- Test: covered by `whiteboard.integration.test.ts` (Task 6); deploy via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`.

Steps:

- [ ] Write `usp_Whiteboard_Create.sql` — insert + `SELECT *` of the new row (mirrors `usp_View_Create`'s shape):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Whiteboard_Create
    @Id          UNIQUEIDENTIFIER,
    @WorkspaceId UNIQUEIDENTIFIER,
    @ScopeType   NVARCHAR(12),
    @ScopeId     UNIQUEIDENTIFIER,
    @Name        NVARCHAR(255),
    @CreatedById UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRANSACTION;
    BEGIN TRY
        INSERT INTO dbo.Whiteboards (Id, WorkspaceId, ScopeType, ScopeId, Name, CreatedById)
        VALUES (@Id, @WorkspaceId, @ScopeType, @ScopeId, @Name, @CreatedById);

        COMMIT TRANSACTION;
        SELECT * FROM dbo.Whiteboards WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO
```

- [ ] Write `usp_Whiteboard_GetById.sql` — single non-deleted whiteboard (includes the blobs; the canvas page needs `DocJson` for SSR):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Whiteboard_GetById
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.Whiteboards WHERE Id = @Id AND DeletedAt IS NULL;
END;
GO
```

- [ ] Write `usp_Whiteboard_ListForScope.sql` — list whiteboards in a scope (or the whole workspace when `@ScopeId IS NULL`), newest first, **excluding** the heavy `DocYjs` blob from the list payload:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Whiteboard_ListForScope
    @WorkspaceId UNIQUEIDENTIFIER,
    @ScopeType   NVARCHAR(12)     = NULL,
    @ScopeId     UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, WorkspaceId, ScopeType, ScopeId, Name, CreatedById, CreatedAt, UpdatedAt
    FROM dbo.Whiteboards
    WHERE WorkspaceId = @WorkspaceId
      AND DeletedAt IS NULL
      AND (@ScopeType IS NULL OR ScopeType = @ScopeType)
      AND (@ScopeId   IS NULL OR ScopeId   = @ScopeId)
    ORDER BY CreatedAt DESC;
END;
GO
```

- [ ] Write `usp_Whiteboard_Update.sql` — rename (ISNULL-coalesced), bump `UpdatedAt`, return `SELECT *`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Whiteboard_Update
    @Id   UNIQUEIDENTIFIER,
    @Name NVARCHAR(255) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.Whiteboards
       SET Name      = ISNULL(@Name, Name),
           UpdatedAt = SYSUTCDATETIME()
     WHERE Id = @Id AND DeletedAt IS NULL;

    SELECT * FROM dbo.Whiteboards WHERE Id = @Id;
END;
GO
```

- [ ] Write `usp_Whiteboard_Delete.sql` — soft-delete, return the row (so the caller sees the new `DeletedAt`):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Whiteboard_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.Whiteboards
       SET DeletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
     WHERE Id = @Id AND DeletedAt IS NULL;

    SELECT * FROM dbo.Whiteboards WHERE Id = @Id;
END;
GO
```

- [ ] Write `usp_Whiteboard_GetWorkspaceId.sql` — RBAC lookup (mirrors `usp_View_GetWorkspaceId`):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Whiteboard_GetWorkspaceId
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT WorkspaceId FROM dbo.Whiteboards WHERE Id = @Id AND DeletedAt IS NULL;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test` (local DB env only). Expected: all six procedures created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_Whiteboard_Create.sql infra/sql/procedures/usp_Whiteboard_GetById.sql infra/sql/procedures/usp_Whiteboard_ListForScope.sql infra/sql/procedures/usp_Whiteboard_Update.sql infra/sql/procedures/usp_Whiteboard_Delete.sql infra/sql/procedures/usp_Whiteboard_GetWorkspaceId.sql
git commit -m "feat(7b): whiteboard CRUD SPs — Create/GetById/ListForScope/Update/Delete/GetWorkspaceId"
```

---

### Task 3: Doc-persistence SPs + task-link SPs

**Files:**
- Create: `infra/sql/procedures/usp_Whiteboard_GetDoc.sql`
- Create: `infra/sql/procedures/usp_Whiteboard_SaveDoc.sql`
- Create: `infra/sql/procedures/usp_WhiteboardTaskLink_Create.sql`
- Create: `infra/sql/procedures/usp_WhiteboardTaskLink_ListForWhiteboard.sql`
- Test: covered by `whiteboard.integration.test.ts` (Task 6); deploy via `scripts/db-deploy-sps.ts`.

Steps:

- [ ] Write `usp_Whiteboard_GetDoc.sql` — the collab `onLoadDocument` branch reads the Yjs binary (and JSON, available for diagnostics) for `whiteboard:<id>`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Whiteboard_GetDoc
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, DocYjs, DocJson FROM dbo.Whiteboards WHERE Id = @Id AND DeletedAt IS NULL;
END;
GO
```

- [ ] Write `usp_Whiteboard_SaveDoc.sql` — the collab `onStoreDocument` (debounced) branch persists the Yjs binary + the rendered JSON snapshot transactionally (mirrors the doc-page persistence path 7a established — same contract, this table/columns):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Whiteboard_SaveDoc
    @Id      UNIQUEIDENTIFIER,
    @DocYjs  VARBINARY(MAX),
    @DocJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.Whiteboards
       SET DocYjs    = @DocYjs,
           DocJson   = ISNULL(@DocJson, DocJson),
           UpdatedAt = SYSUTCDATETIME()
     WHERE Id = @Id AND DeletedAt IS NULL;
END;
GO
```

- [ ] Write `usp_WhiteboardTaskLink_Create.sql` — link a freshly-created task back to the whiteboard + originating shape; idempotent on the `UQ_WhiteboardTaskLinks` triple (re-convert of the same shape is a no-op that still returns the existing link):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_WhiteboardTaskLink_Create
    @WhiteboardId UNIQUEIDENTIFIER,
    @TaskId       UNIQUEIDENTIFIER,
    @ShapeId      NVARCHAR(100),
    @CreatedById  UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

    BEGIN TRANSACTION;
    BEGIN TRY
        IF NOT EXISTS (
            SELECT 1 FROM dbo.WhiteboardTaskLinks
            WHERE WhiteboardId = @WhiteboardId AND TaskId = @TaskId AND ShapeId = @ShapeId
        )
            INSERT INTO dbo.WhiteboardTaskLinks (Id, WhiteboardId, TaskId, ShapeId, CreatedById)
            VALUES (@NewId, @WhiteboardId, @TaskId, @ShapeId, @CreatedById);

        COMMIT TRANSACTION;

        SELECT TOP 1 * FROM dbo.WhiteboardTaskLinks
        WHERE WhiteboardId = @WhiteboardId AND TaskId = @TaskId AND ShapeId = @ShapeId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO
```

- [ ] Write `usp_WhiteboardTaskLink_ListForWhiteboard.sql` — list links joined to a thin task summary so the canvas can re-hydrate embed cards (title/status to render):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_WhiteboardTaskLink_ListForWhiteboard
    @WhiteboardId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        l.Id, l.WhiteboardId, l.TaskId, l.ShapeId, l.CreatedAt,
        t.Title  AS TaskTitle,
        t.Status AS TaskStatus,
        t.IssueKey AS TaskIssueKey
    FROM dbo.WhiteboardTaskLinks l
    JOIN dbo.Tasks t ON t.Id = l.TaskId
    WHERE l.WhiteboardId = @WhiteboardId
    ORDER BY l.CreatedAt DESC;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`. Expected: all four procedures created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_Whiteboard_GetDoc.sql infra/sql/procedures/usp_Whiteboard_SaveDoc.sql infra/sql/procedures/usp_WhiteboardTaskLink_Create.sql infra/sql/procedures/usp_WhiteboardTaskLink_ListForWhiteboard.sql
git commit -m "feat(7b): whiteboard doc-persistence SPs (GetDoc/SaveDoc) + task-link SPs"
```

---

### Task 4: Types + pure shape→task title extractor + unit test

**Files:**
- Modify: `packages/types/index.ts` (add a Whiteboards block near the SavedViews block, ~after `ViewScopeType`)
- Create: `apps/api/src/modules/whiteboards/whiteboard.shape.ts`
- Create: `apps/api/src/modules/whiteboards/__tests__/shape.unit.test.ts`

Steps:

- [ ] Write the failing unit test first. `shape.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractShapeTitle, type WhiteboardShapeInput } from '../whiteboard.shape.js';

describe('extractShapeTitle', () => {
  it('reads a sticky note (props.text)', () => {
    const shape: WhiteboardShapeInput = { id: 'shape:1', type: 'note', props: { text: 'Ship the API' } };
    expect(extractShapeTitle(shape)).toBe('Ship the API');
  });

  it('reads a text shape (props.text)', () => {
    const shape: WhiteboardShapeInput = { id: 'shape:2', type: 'text', props: { text: 'Write tests' } };
    expect(extractShapeTitle(shape)).toBe('Write tests');
  });

  it('reads a geo shape label (props.text on a rectangle)', () => {
    const shape: WhiteboardShapeInput = { id: 'shape:3', type: 'geo', props: { geo: 'rectangle', text: 'Idea card' } };
    expect(extractShapeTitle(shape)).toBe('Idea card');
  });

  it('reads tldraw rich-text (props.richText) by joining plain text runs', () => {
    const shape: WhiteboardShapeInput = {
      id: 'shape:4', type: 'note',
      props: { richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }] }] } },
    };
    expect(extractShapeTitle(shape)).toBe('Hello world');
  });

  it('trims surrounding whitespace and collapses newlines to spaces', () => {
    const shape: WhiteboardShapeInput = { id: 'shape:5', type: 'text', props: { text: '  multi\nline  ' } };
    expect(extractShapeTitle(shape)).toBe('multi line');
  });

  it('clamps to 500 chars (the Tasks.Title cap)', () => {
    const long = 'x'.repeat(600);
    const shape: WhiteboardShapeInput = { id: 'shape:6', type: 'text', props: { text: long } };
    expect(extractShapeTitle(shape)).toHaveLength(500);
  });

  it('falls back to a default for an empty/whitespace shape', () => {
    expect(extractShapeTitle({ id: 'shape:7', type: 'note', props: { text: '   ' } })).toBe('Untitled');
    expect(extractShapeTitle({ id: 'shape:8', type: 'geo', props: {} })).toBe('Untitled');
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- shape`. Expected: FAIL — `Cannot find module '../whiteboard.shape.js'`.

- [ ] Write `apps/api/src/modules/whiteboards/whiteboard.shape.ts`:

```ts
/**
 * Pure shape→task title extraction. tldraw shapes carry their text either as a
 * flat `props.text` (note/text/geo-with-label) or, in newer tldraw, a
 * ProseMirror-ish `props.richText` doc. We read both, collapse whitespace, clamp
 * to the Tasks.Title cap (500), and fall back to a stable default. Kept PURE +
 * dependency-free so it unit-tests trivially and can be mirrored client-side.
 */
export interface WhiteboardShapeInput {
  id:    string;
  type:  string;
  props?: Record<string, unknown> & {
    text?:     unknown;
    richText?: unknown;
  };
}

const TITLE_MAX = 500;        // matches Tasks.Title NVARCHAR(500)
const FALLBACK  = 'Untitled';

/** Recursively collect plain `text` runs from a tldraw/ProseMirror rich-text doc. */
function collectRichText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { text?: unknown; content?: unknown };
  let out = typeof n.text === 'string' ? n.text : '';
  if (Array.isArray(n.content)) {
    for (const child of n.content) out += collectRichText(child);
  }
  return out;
}

export function extractShapeTitle(shape: WhiteboardShapeInput): string {
  const props = shape.props ?? {};
  let raw = '';
  if (typeof props.text === 'string' && props.text.trim()) {
    raw = props.text;
  } else if (props.richText) {
    raw = collectRichText(props.richText);
  }
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) return FALLBACK;
  return cleaned.length > TITLE_MAX ? cleaned.slice(0, TITLE_MAX) : cleaned;
}
```

- [ ] Run: `npm test --workspace apps/api -- shape`. Expected: PASS (7 tests).

- [ ] Extend `packages/types/index.ts` — add the Whiteboards block (place it after the SavedViews/`ViewScopeType` block, ~line 1001):

```ts
// ── Whiteboards (Phase 7b) ────────────────────────────────────────────────────

export type WhiteboardScopeType = 'SPACE' | 'FOLDER' | 'LIST';

/** A whiteboard's metadata. DocYjs is never serialized to the API; DocJson is
 *  the rendered tldraw snapshot used for SSR first-paint. */
export interface Whiteboard {
  id:          string;
  workspaceId: string;
  scopeType:   WhiteboardScopeType;
  scopeId:     string;
  name:        string;
  docJson:     string | null;   // rendered tldraw snapshot (SSR)
  createdById: string;
  createdAt:   string;
  updatedAt:   string;
}

/** Lightweight list row (no DocJson/DocYjs). */
export interface WhiteboardSummary {
  id:          string;
  workspaceId: string;
  scopeType:   WhiteboardScopeType;
  scopeId:     string;
  name:        string;
  createdById: string;
  createdAt:   string;
  updatedAt:   string;
}

export interface WhiteboardTaskLink {
  id:           string;
  whiteboardId: string;
  taskId:       string;
  shapeId:      string;
  createdAt:    string;
  taskTitle:    string;
  taskStatus:   string;
  taskIssueKey: string | null;
}

export interface CreateWhiteboardInput {
  workspaceId: string;
  scopeType:   WhiteboardScopeType;
  scopeId:     string;
  name:        string;
}

export interface UpdateWhiteboardInput {
  name?: string;
}

/** Convert a tldraw shape into a task in a target List. `shape` is the raw
 *  tldraw shape JSON; the server derives the title via extractShapeTitle. */
export interface ConvertShapeToTaskInput {
  targetListId: string;
  shapeId:      string;
  shape:        { id: string; type: string; props?: Record<string, unknown> };
}

export interface ConvertShapeToTaskResult {
  task: Task;
  link: WhiteboardTaskLink;
}
```

- [ ] Run: `npm run build --workspace packages/types` (or the repo's types build) and `npm test --workspace apps/api -- shape`. Expected: PASS — types compile; shape tests still green.

- [ ] Commit:
```
git add packages/types/index.ts apps/api/src/modules/whiteboards/whiteboard.shape.ts apps/api/src/modules/whiteboards/__tests__/shape.unit.test.ts
git commit -m "feat(7b): whiteboard types + pure shape->task title extractor + unit tests"
```

---

### Task 5: Repository + service

**Files:**
- Create: `apps/api/src/modules/whiteboards/whiteboard.repository.ts`
- Create: `apps/api/src/modules/whiteboards/whiteboard.service.ts`

Steps:

- [ ] Write `whiteboard.repository.ts` — `execSp`/`execSpOne` wrappers + PascalCase→camelCase mappers (the SPs return `SELECT *`, so map defensively, mirroring `recurrence.repository.ts`):

```ts
import sql from 'mssql';
import { randomUUID } from 'node:crypto';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type {
  Whiteboard, WhiteboardSummary, WhiteboardTaskLink, WhiteboardScopeType,
} from '@projectflow/types';

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

/** Map a Whiteboards SELECT * row (PascalCase) → the Whiteboard contract. */
export function mapWhiteboardRow(r: any): Whiteboard {
  return {
    id:          r.Id,
    workspaceId: r.WorkspaceId,
    scopeType:   r.ScopeType as WhiteboardScopeType,
    scopeId:     r.ScopeId,
    name:        r.Name,
    docJson:     r.DocJson ?? null,
    createdById: r.CreatedById,
    createdAt:   iso(r.CreatedAt),
    updatedAt:   iso(r.UpdatedAt),
  };
}

function mapSummaryRow(r: any): WhiteboardSummary {
  return {
    id:          r.Id,
    workspaceId: r.WorkspaceId,
    scopeType:   r.ScopeType as WhiteboardScopeType,
    scopeId:     r.ScopeId,
    name:        r.Name,
    createdById: r.CreatedById,
    createdAt:   iso(r.CreatedAt),
    updatedAt:   iso(r.UpdatedAt),
  };
}

function mapLinkRow(r: any): WhiteboardTaskLink {
  return {
    id:           r.Id,
    whiteboardId: r.WhiteboardId,
    taskId:       r.TaskId,
    shapeId:      r.ShapeId,
    createdAt:    iso(r.CreatedAt),
    taskTitle:    r.TaskTitle ?? '',
    taskStatus:   r.TaskStatus ?? '',
    taskIssueKey: r.TaskIssueKey ?? null,
  };
}

export class WhiteboardRepository {
  async create(p: {
    workspaceId: string; scopeType: WhiteboardScopeType; scopeId: string; name: string; createdById: string;
  }): Promise<Whiteboard> {
    const rows = await execSpOne('usp_Whiteboard_Create', [
      { name: 'Id',          type: sql.UniqueIdentifier, value: randomUUID() },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: p.workspaceId },
      { name: 'ScopeType',   type: sql.NVarChar(12),     value: p.scopeType },
      { name: 'ScopeId',     type: sql.UniqueIdentifier, value: p.scopeId },
      { name: 'Name',        type: sql.NVarChar(255),    value: p.name },
      { name: 'CreatedById', type: sql.UniqueIdentifier, value: p.createdById },
    ]);
    return mapWhiteboardRow(rows[0]);
  }

  async getById(id: string): Promise<Whiteboard | null> {
    const rows = await execSpOne('usp_Whiteboard_GetById', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ? mapWhiteboardRow(rows[0]) : null;
  }

  async listForScope(
    workspaceId: string, scopeType: WhiteboardScopeType | null, scopeId: string | null,
  ): Promise<WhiteboardSummary[]> {
    const rows = await execSpOne('usp_Whiteboard_ListForScope', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'ScopeType',   type: sql.NVarChar(12),     value: scopeType },
      { name: 'ScopeId',     type: sql.UniqueIdentifier, value: scopeId },
    ]);
    return (rows as any[]).map(mapSummaryRow);
  }

  async update(id: string, name?: string): Promise<Whiteboard | null> {
    const rows = await execSpOne('usp_Whiteboard_Update', [
      { name: 'Id',   type: sql.UniqueIdentifier, value: id },
      { name: 'Name', type: sql.NVarChar(255),    value: name ?? null },
    ]);
    return rows[0] ? mapWhiteboardRow(rows[0]) : null;
  }

  async softDelete(id: string): Promise<Whiteboard | null> {
    const rows = await execSpOne('usp_Whiteboard_Delete', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ? mapWhiteboardRow(rows[0]) : null;
  }

  async getWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_Whiteboard_GetWorkspaceId', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0]?.WorkspaceId ?? null;
  }

  /** Collab onLoadDocument: read the persisted Yjs binary (+ JSON) for whiteboard:<id>. */
  async getDoc(id: string): Promise<{ docYjs: Buffer | null; docJson: string | null } | null> {
    const rows = await execSpOne<{ DocYjs: Buffer | null; DocJson: string | null }>('usp_Whiteboard_GetDoc', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    const r = rows[0];
    return r ? { docYjs: r.DocYjs ?? null, docJson: r.DocJson ?? null } : null;
  }

  /** Collab onStoreDocument (debounced): persist Yjs binary + rendered JSON snapshot. */
  async saveDoc(id: string, docYjs: Buffer, docJson: string | null): Promise<void> {
    await execSpOne('usp_Whiteboard_SaveDoc', [
      { name: 'Id',      type: sql.UniqueIdentifier,  value: id },
      { name: 'DocYjs',  type: sql.VarBinary(sql.MAX), value: docYjs },
      { name: 'DocJson', type: sql.NVarChar(sql.MAX),  value: docJson },
    ]);
  }

  async createTaskLink(p: {
    whiteboardId: string; taskId: string; shapeId: string; createdById: string;
  }): Promise<WhiteboardTaskLink> {
    const rows = await execSpOne('usp_WhiteboardTaskLink_Create', [
      { name: 'WhiteboardId', type: sql.UniqueIdentifier, value: p.whiteboardId },
      { name: 'TaskId',       type: sql.UniqueIdentifier, value: p.taskId },
      { name: 'ShapeId',      type: sql.NVarChar(100),    value: p.shapeId },
      { name: 'CreatedById',  type: sql.UniqueIdentifier, value: p.createdById },
    ]);
    return mapLinkRow(rows[0]);
  }

  async listTaskLinks(whiteboardId: string): Promise<WhiteboardTaskLink[]> {
    const rows = await execSpOne('usp_WhiteboardTaskLink_ListForWhiteboard', [
      { name: 'WhiteboardId', type: sql.UniqueIdentifier, value: whiteboardId },
    ]);
    return (rows as any[]).map(mapLinkRow);
  }
}

export const whiteboardRepository = new WhiteboardRepository();
```

- [ ] Write `whiteboard.service.ts` — thin orchestration; `convertShapeToTask` reuses the existing `TaskService.createTask` (so notifications/webhooks/progress-rollups fire) then writes the link. The title comes from the **pure** `extractShapeTitle`:

```ts
import { WhiteboardRepository } from './whiteboard.repository.js';
import { extractShapeTitle, type WhiteboardShapeInput } from './whiteboard.shape.js';
import { TaskService } from '../tasks/task.service.js';
import { TaskRepository } from '../tasks/task.repository.js';
import type {
  Whiteboard, WhiteboardSummary, WhiteboardTaskLink, WhiteboardScopeType,
  ConvertShapeToTaskResult,
} from '@projectflow/types';

const repo = new WhiteboardRepository();
const taskService = new TaskService(new TaskRepository());

export class WhiteboardService {
  create(p: { workspaceId: string; scopeType: WhiteboardScopeType; scopeId: string; name: string; createdById: string }): Promise<Whiteboard> {
    return repo.create(p);
  }

  getById(id: string): Promise<Whiteboard | null> {
    return repo.getById(id);
  }

  listForScope(workspaceId: string, scopeType: WhiteboardScopeType | null, scopeId: string | null): Promise<WhiteboardSummary[]> {
    return repo.listForScope(workspaceId, scopeType, scopeId);
  }

  update(id: string, name?: string): Promise<Whiteboard | null> {
    return repo.update(id, name);
  }

  softDelete(id: string): Promise<Whiteboard | null> {
    return repo.softDelete(id);
  }

  getWorkspaceId(id: string): Promise<string | null> {
    return repo.getWorkspaceId(id);
  }

  listTaskLinks(whiteboardId: string): Promise<WhiteboardTaskLink[]> {
    return repo.listTaskLinks(whiteboardId);
  }

  // Collab persistence passthrough (used by the collab onLoad/onStore branch).
  getDoc(id: string) { return repo.getDoc(id); }
  saveDoc(id: string, docYjs: Buffer, docJson: string | null) { return repo.saveDoc(id, docYjs, docJson); }

  /**
   * Convert a tldraw shape into a real task in `targetListId` (within the
   * whiteboard's workspace) and link it back. The title is derived from the
   * shape's text by the pure extractor; createTask runs the normal task-creation
   * path (notifications/webhooks/progress).
   */
  async convertShapeToTask(
    whiteboardId: string,
    workspaceId: string,
    targetListId: string,
    shape: WhiteboardShapeInput,
    actorId: string,
  ): Promise<ConvertShapeToTaskResult> {
    const title = extractShapeTitle(shape);
    const task = await taskService.createTask(
      { workspaceId, listId: targetListId, title, reporterId: actorId } as any,
      actorId,
    );
    const link = await repo.createTaskLink({
      whiteboardId,
      taskId: (task as any).id ?? (task as any).Id,
      shapeId: shape.id,
      createdById: actorId,
    });
    return { task, link };
  }
}

export const whiteboardService = new WhiteboardService();
```

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS — no type errors. Then `npm test --workspace apps/api -- shape`. Expected: still PASS.

- [ ] Commit:
```
git add apps/api/src/modules/whiteboards/whiteboard.repository.ts apps/api/src/modules/whiteboards/whiteboard.service.ts
git commit -m "feat(7b): whiteboard repository + service (CRUD, doc persistence, convert-shape->task)"
```

---

### Task 6: REST routes + integration test

**Files:**
- Create: `apps/api/src/modules/whiteboards/whiteboard.routes.ts`
- Modify: `apps/api/src/server.ts` (import + `app.route('/whiteboards', whiteboardRoutes)`)
- Create: `apps/api/src/modules/whiteboards/__tests__/whiteboard.integration.test.ts`

Steps:

- [ ] Write the failing integration test first (copy the harness imports the worklog/recurrence integration tests use: `__tests__/setup/testServer.js`, `__tests__/fixtures/truncate.js`, `__tests__/fixtures/factories.js`). It covers CRUD, the convert-to-task headline (§5.5), the doc round-trip, and an authz 404:

```ts
/**
 * Phase 7b — Whiteboards integration coverage.
 * Exercises whiteboard CRUD + convert-shape->task + doc persistence against the
 * REAL SQL stack. DB SAFETY: must target local Docker ProjectFlow_Test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { whiteboardRepository } from '../whiteboard.repository.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function seedScope() {
  const owner = await createTestUser({ email: `wb-${Date.now()}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'WB Space', key: `WB${Date.now() % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'L', position: 0 },
  }), 201)).data;
  return { token, userId: owner.id, workspaceId: ws.Id, spaceId: space.Id, listId: list.id ?? list.Id };
}

describe('whiteboards', () => {
  it('creates, lists, renames, and soft-deletes a whiteboard', async () => {
    const { token, workspaceId, spaceId } = await seedScope();
    const wb = (await json<{ data: any }>(await request('/whiteboards', {
      method: 'POST', token, json: { workspaceId, scopeType: 'SPACE', scopeId: spaceId, name: 'Brainstorm' },
    }), 201)).data;
    expect(wb.name).toBe('Brainstorm');

    const list = (await json<{ data: any[] }>(await request(`/whiteboards?scopeType=SPACE&scopeId=${spaceId}`, { token }))).data;
    expect(list.map((w) => w.id)).toContain(wb.id);

    const renamed = (await json<{ data: any }>(await request(`/whiteboards/${wb.id}`, {
      method: 'PATCH', token, json: { name: 'Brainstorm v2' },
    }))).data;
    expect(renamed.name).toBe('Brainstorm v2');

    await request(`/whiteboards/${wb.id}`, { method: 'DELETE', token });
    const after = (await json<{ data: any[] }>(await request(`/whiteboards?scopeType=SPACE&scopeId=${spaceId}`, { token }))).data;
    expect(after.map((w) => w.id)).not.toContain(wb.id);
  });

  it('converts a sticky into a real task in the chosen list and links it back', async () => {
    const { token, userId, workspaceId, spaceId, listId } = await seedScope();
    const wb = (await json<{ data: any }>(await request('/whiteboards', {
      method: 'POST', token, json: { workspaceId, scopeType: 'SPACE', scopeId: spaceId, name: 'WB' },
    }), 201)).data;

    const result = (await json<{ data: any }>(await request(`/whiteboards/${wb.id}/convert-to-task`, {
      method: 'POST', token,
      json: {
        targetListId: listId,
        shapeId: 'shape:abc',
        shape: { id: 'shape:abc', type: 'note', props: { text: 'Design the onboarding flow' } },
      },
    }), 201)).data;

    // A real task exists in the chosen list with the sticky's text as its title.
    expect(result.task.title).toBe('Design the onboarding flow');
    const fetched = (await json<{ data: any }>(await request(`/tasks/${result.task.id}`, { token }))).data;
    expect((fetched.listId ?? fetched.ListId)).toBe(listId);

    // And the link ties the new task back to the originating shape.
    expect(result.link.taskId).toBe(result.task.id);
    expect(result.link.shapeId).toBe('shape:abc');
    const links = await whiteboardRepository.listTaskLinks(wb.id);
    expect(links.map((l) => l.taskId)).toContain(result.task.id);
    expect(userId).toBeTruthy();
  });

  it('persists and reloads the tldraw Yjs doc (collab persistence contract)', async () => {
    const { token, workspaceId, spaceId } = await seedScope();
    const wb = (await json<{ data: any }>(await request('/whiteboards', {
      method: 'POST', token, json: { workspaceId, scopeType: 'SPACE', scopeId: spaceId, name: 'WB' },
    }), 201)).data;

    const yjs = Buffer.from([1, 2, 3, 4]);
    await whiteboardRepository.saveDoc(wb.id, yjs, JSON.stringify({ document: {} }));
    const doc = await whiteboardRepository.getDoc(wb.id);
    expect(doc?.docYjs?.equals(yjs)).toBe(true);
    expect(doc?.docJson).toContain('document');
  });

  it('404s a whiteboard the caller has no access to', async () => {
    const { token: tokenA, workspaceId: wsA, spaceId: spaceA } = await seedScope();
    const wb = (await json<{ data: any }>(await request('/whiteboards', {
      method: 'POST', token: tokenA, json: { workspaceId: wsA, scopeType: 'SPACE', scopeId: spaceA, name: 'Private' },
    }), 201)).data;

    const outsider = await createTestUser({ email: `wb-out-${Date.now()}@projectflow.test` });
    const res = await request(`/whiteboards/${wb.id}`, { token: outsider.accessToken });
    expect(res.status).toBe(404); // fail-closed: no existence leak across scopes
  });
});
```

- [ ] Run: `npm run test:integration --workspace apps/api -- whiteboard` against `ProjectFlow_Test`. Expected: FAIL — the routes 404 (not yet mounted).

- [ ] Write `whiteboard.routes.ts` — Hono REST. Reads gate on VIEW of the whiteboard's **scope** (via `requireObjectAccess`, resolving the scope from the whiteboard); writes gate on EDIT of the scope; create gates on EDIT of the **target scope** in the body; convert-to-task gates on `task.create` (workspace) **and** EDIT on the target List. Mirrors the worklog/views authz idioms exactly:

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { WhiteboardService } from './whiteboard.service.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import { requireObjectAccess } from '../access/access.middleware.js';
import type { HierarchyNodeType } from '@projectflow/types';

const svc = new WhiteboardService();

// Resolve the SCOPE hierarchy object (SPACE/FOLDER/LIST) a whiteboard belongs to,
// so reads/writes can be object-level gated (parity with SavedViews). 404 → null.
async function resolveWhiteboardScope(c: any): Promise<{ type: HierarchyNodeType; id: string } | null> {
  const wb = await svc.getById(c.req.param('id')!);
  return wb ? { type: wb.scopeType as HierarchyNodeType, id: wb.scopeId } : null;
}
const resolveWhiteboardWorkspace = (c: any) => svc.getWorkspaceId(c.req.param('id')!);

const createSchema = z.object({
  workspaceId: z.string().uuid(),
  scopeType:   z.enum(['SPACE', 'FOLDER', 'LIST']),
  scopeId:     z.string().uuid(),
  name:        z.string().min(1).max(255),
});
const updateSchema = z.object({ name: z.string().min(1).max(255).optional() });
const convertSchema = z.object({
  targetListId: z.string().uuid(),
  shapeId:      z.string().min(1).max(100),
  shape: z.object({
    id:    z.string().min(1).max(100),
    type:  z.string().min(1).max(50),
    props: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const whiteboardRoutes = new Hono();

// GET /whiteboards?scopeType=&scopeId=  — list whiteboards in a scope.
// Gated on VIEW of that scope object.
whiteboardRoutes.get(
  '/',
  requireObjectAccess('VIEW', (c) => {
    const scopeType = c.req.query('scopeType') as HierarchyNodeType | undefined;
    const scopeId   = c.req.query('scopeId');
    return scopeType && scopeId ? { type: scopeType, id: scopeId } : null;
  }),
  async (c) => {
    const scopeType = c.req.query('scopeType') as any;
    const scopeId   = c.req.query('scopeId')!;
    // Workspace is derived from the scope by the SP-free list path; we look it up
    // via the first matching whiteboard's workspace is unnecessary — the SP filters
    // by workspace, so resolve the workspace from the scope's own access record.
    const wsId = (c as any).get('objectWorkspaceId') as string | undefined
      ?? c.req.query('workspaceId'); // callers pass workspaceId alongside the scope
    const list = await svc.listForScope(wsId!, scopeType, scopeId);
    return c.json({ data: list });
  },
);

// POST /whiteboards  — create. Gated on EDIT of the target scope (in the body).
whiteboardRoutes.post(
  '/',
  zValidator('json', createSchema),
  requireObjectAccess('EDIT', (c) => {
    const b = (c.req as any).valid('json');
    return { type: b.scopeType as HierarchyNodeType, id: b.scopeId };
  }),
  async (c) => {
    const b = c.req.valid('json');
    const user = (c as any).get('user') as any;
    const wb = await svc.create({ ...b, createdById: user.userId });
    return c.json({ data: wb }, 201);
  },
);

// GET /whiteboards/:id — VIEW on the whiteboard's scope.
whiteboardRoutes.get(
  '/:id',
  requireObjectAccess('VIEW', resolveWhiteboardScope),
  async (c) => {
    const wb = await svc.getById(c.req.param('id')!);
    if (!wb) return c.json({ error: { code: 'NOT_FOUND', message: 'Whiteboard not found' } }, 404);
    return c.json({ data: wb });
  },
);

// GET /whiteboards/:id/links — task-link cards. VIEW on the scope.
whiteboardRoutes.get(
  '/:id/links',
  requireObjectAccess('VIEW', resolveWhiteboardScope),
  async (c) => c.json({ data: await svc.listTaskLinks(c.req.param('id')!) }),
);

// PATCH /whiteboards/:id — rename. EDIT on the scope.
whiteboardRoutes.patch(
  '/:id',
  requireObjectAccess('EDIT', resolveWhiteboardScope),
  zValidator('json', updateSchema),
  async (c) => {
    const wb = await svc.update(c.req.param('id')!, c.req.valid('json').name);
    if (!wb) return c.json({ error: { code: 'NOT_FOUND', message: 'Whiteboard not found' } }, 404);
    return c.json({ data: wb });
  },
);

// DELETE /whiteboards/:id — soft-delete. EDIT on the scope.
whiteboardRoutes.delete(
  '/:id',
  requireObjectAccess('EDIT', resolveWhiteboardScope),
  async (c) => {
    const wb = await svc.softDelete(c.req.param('id')!);
    if (!wb) return c.json({ error: { code: 'NOT_FOUND', message: 'Whiteboard not found' } }, 404);
    return c.json({ data: wb });
  },
);

// POST /whiteboards/:id/convert-to-task — mint a task in the target List from a
// shape. Two gates: task.create (workspace RBAC) AND EDIT on the destination List.
whiteboardRoutes.post(
  '/:id/convert-to-task',
  requireObjectAccess('VIEW', resolveWhiteboardScope), // must be able to see the board
  requirePermission('task.create', { resolveWorkspace: resolveWhiteboardWorkspace }),
  requireObjectAccess('EDIT', (c) => {
    const b = (c.req as any).valid('json');
    return b?.targetListId ? { type: 'LIST', id: b.targetListId } : null;
  }),
  zValidator('json', convertSchema),
  async (c) => {
    const id = c.req.param('id')!;
    const user = (c as any).get('user') as any;
    const workspaceId = await svc.getWorkspaceId(id);
    if (!workspaceId) return c.json({ error: { code: 'NOT_FOUND', message: 'Whiteboard not found' } }, 404);
    const { targetListId, shape } = c.req.valid('json');
    try {
      const result = await svc.convertShapeToTask(id, workspaceId, targetListId, shape, user.userId);
      return c.json({ data: result }, 201);
    } catch (err: any) {
      // usp_Task_Create hierarchy error mapping (mirrors /tasks POST).
      if (err.number === 51230) return c.json({ error: { code: 'UNPROCESSABLE', message: err.message } }, 422);
      if (err.number === 51213) return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
      if (err.number === 51214) return c.json({ error: { code: 'BAD_REQUEST', message: err.message } }, 400);
      throw err;
    }
  },
);
```

> **Note on the GET-list authz:** `requireObjectAccess` validates VIEW on the scope and the integration test passes `workspaceId` as a query param alongside the scope. If 7a/Phase-3 exposes a helper that resolves a scope's `workspaceId` from its access record (e.g. on `accessService`/`hierarchyRepo`), prefer that over the query param to drop the client-supplied `workspaceId` — note the chosen approach inline and keep the route's behavior identical.

- [ ] Mount the routes in `server.ts` — add the import beside the others and the `app.route` beside `app.route('/worklogs', worklogRoutes)`:

```ts
import { whiteboardRoutes } from './modules/whiteboards/whiteboard.routes.js';
```
```ts
app.route('/whiteboards',    whiteboardRoutes);
```

- [ ] Run: `npm run test:integration --workspace apps/api -- whiteboard` against `ProjectFlow_Test`. Expected: PASS (4 tests). Then `npm test --workspace apps/api`. Expected: PASS (unit suite incl. `shape` still green).

- [ ] Commit:
```
git add apps/api/src/modules/whiteboards/whiteboard.routes.ts apps/api/src/server.ts apps/api/src/modules/whiteboards/__tests__/whiteboard.integration.test.ts
git commit -m "feat(7b): whiteboard REST — CRUD + convert-to-task + scope/list authz + integration test"
```

---

### Task 7: Collab-server `whiteboard:<id>` registration (reuse 7a persistence)

**Files:**
- Modify: `apps/api/src/modules/collab/collab.persistence.ts` (the document-name dispatcher 7a uses inside `onLoadDocument`/`onStoreDocument`). *(If 7a placed the load/store logic elsewhere — e.g. inline in `collab.server.ts` or a `collab.hooks.ts` — add the branch there; record the actual filename in `DECISIONS.md` and proceed. Do NOT introduce a second collab server.)*

Steps:

- [ ] Read 7a's collab module first to learn the EXACT document-name parsing + persistence-callback shape it established (`grep` for `doc-page:` / `whiteboard:` and the `onLoadDocument`/`onStoreDocument` hook signatures). The branch you add MUST mirror the doc-page branch's structure (same debounce, same transaction discipline) — only the table/columns differ.

- [ ] Add the `whiteboard:<id>` branch to the dispatcher. Conceptually (adapt names to 7a's actual helpers):

```ts
import { whiteboardService } from '../whiteboards/whiteboard.service.js';
// ...existing doc-page imports from 7a...

/** Parse a Hocuspocus document name → a typed target. 7a already handles
 *  `doc-page:<id>`; 7b adds `whiteboard:<id>`. */
export function parseDocName(name: string): { kind: 'doc-page' | 'whiteboard'; id: string } | null {
  const [prefix, id] = name.split(':');
  if (prefix === 'doc-page' && id)   return { kind: 'doc-page', id };
  if (prefix === 'whiteboard' && id) return { kind: 'whiteboard', id };
  return null;
}

// Inside onLoadDocument(name) — return the stored Yjs binary so Hocuspocus seeds
// the room (returns null/empty for a brand-new board):
//   const target = parseDocName(name);
//   if (target?.kind === 'whiteboard') {
//     const doc = await whiteboardService.getDoc(target.id);
//     return doc?.docYjs ?? null;   // Buffer | null — apply via 7a's helper
//   }

// Inside onStoreDocument(name, document) (debounced) — persist the Yjs binary +
// a rendered tldraw JSON snapshot:
//   const target = parseDocName(name);
//   if (target?.kind === 'whiteboard') {
//     const yjs  = Buffer.from(Y.encodeStateAsUpdate(document));   // 7a's encode helper
//     const json = renderTldrawSnapshotJson(document);             // best-effort; null on failure
//     await whiteboardService.saveDoc(target.id, yjs, json);
//     return;
//   }
```

For the JSON snapshot, derive the tldraw store JSON from the Yjs doc the same way 7a derives ProseMirror JSON for doc-pages. If a faithful render isn't cheaply available server-side, persist `null` for `DocJson` (the SP coalesces with `ISNULL`, so a later client-side snapshot can fill it) and note the deferral — the binary `DocYjs` remains the source of truth for live sync; `DocJson` is the SSR/search convenience.

- [ ] Ensure `onAuthenticate` already covers whiteboards. 7a validates the JWT + object ACL by document name. Confirm its ACL check resolves a `whiteboard:<id>` to its **scope** and requires the scope's level (VIEW to connect read-only, EDIT to mutate) — i.e. it uses `whiteboardService.getById(id)` → scope → `accessService`. If 7a's `onAuthenticate` only knows `doc-page:`, extend its switch with a `whiteboard` case that gates on the whiteboard's scope (fail-closed; reject the socket on no access). Mirror the doc-page case exactly.

- [ ] Run: `npm run build --workspace apps/api` (tsc — the collab module compiles with the new branch). Expected: PASS. (Live WS round-trip is exercised by the two-browser e2e in Task 10.)

- [ ] Commit:
```
git add apps/api/src/modules/collab/collab.persistence.ts
git commit -m "feat(7b): collab server — whiteboard:<id> load/store branch over shared Hocuspocus persistence"
```

---

### Task 8: GraphQL mirror (`whiteboard.schema.ts`)

**Files:**
- Create: `apps/api/src/graphql/whiteboard.schema.ts`
- Modify: `apps/api/src/graphql/schema.ts` (import + call near the other `register*Graphql()` calls, ~line 18)

Steps:

- [ ] Write `whiteboard.schema.ts`, mirroring `recurrence.schema.ts`'s structure (typed `objectRef`, `notFound`/`requireObjectLevel`/`requireWorkspacePermission` from `./authz.js`, delegating to the one shared `WhiteboardService`). Reads gate on `requireObjectLevel(scopeType, scopeId, 'VIEW')`; writes on the scope `'EDIT'`; convert on `task.create` workspace permission + `requireObjectLevel('LIST', targetListId, 'EDIT')`:

```ts
import { builder } from './builder.js';
import { WhiteboardService } from '../modules/whiteboards/whiteboard.service.js';
import { notFound, requireObjectLevel, requireWorkspacePermission } from './authz.js';
import type {
  Whiteboard, WhiteboardSummary, WhiteboardTaskLink, ConvertShapeToTaskResult,
} from '@projectflow/types';
import type { HierarchyNodeType } from '@projectflow/types';

const svc = new WhiteboardService();

export function registerWhiteboardGraphql(): void {
  const WhiteboardType = builder.objectRef<Whiteboard>('Whiteboard');
  WhiteboardType.implement({ fields: (t) => ({
    id:          t.exposeString('id'),
    workspaceId: t.exposeString('workspaceId'),
    scopeType:   t.exposeString('scopeType'),
    scopeId:     t.exposeString('scopeId'),
    name:        t.exposeString('name'),
    docJson:     t.string({ nullable: true, resolve: (w) => w.docJson ?? null }),
    createdById: t.exposeString('createdById'),
    createdAt:   t.field({ type: 'Date', resolve: (w) => new Date(w.createdAt) }),
    updatedAt:   t.field({ type: 'Date', resolve: (w) => new Date(w.updatedAt) }),
  }) });

  const WhiteboardSummaryType = builder.objectRef<WhiteboardSummary>('WhiteboardSummary');
  WhiteboardSummaryType.implement({ fields: (t) => ({
    id:          t.exposeString('id'),
    workspaceId: t.exposeString('workspaceId'),
    scopeType:   t.exposeString('scopeType'),
    scopeId:     t.exposeString('scopeId'),
    name:        t.exposeString('name'),
    createdById: t.exposeString('createdById'),
    createdAt:   t.field({ type: 'Date', resolve: (w) => new Date(w.createdAt) }),
    updatedAt:   t.field({ type: 'Date', resolve: (w) => new Date(w.updatedAt) }),
  }) });

  const LinkType = builder.objectRef<WhiteboardTaskLink>('WhiteboardTaskLink');
  LinkType.implement({ fields: (t) => ({
    id:           t.exposeString('id'),
    whiteboardId: t.exposeString('whiteboardId'),
    taskId:       t.exposeString('taskId'),
    shapeId:      t.exposeString('shapeId'),
    taskTitle:    t.exposeString('taskTitle'),
    taskStatus:   t.exposeString('taskStatus'),
    taskIssueKey: t.string({ nullable: true, resolve: (l) => l.taskIssueKey ?? null }),
    createdAt:    t.field({ type: 'Date', resolve: (l) => new Date(l.createdAt) }),
  }) });

  const ConvertResultType = builder.objectRef<ConvertShapeToTaskResult>('ConvertShapeToTaskResult');
  ConvertResultType.implement({ fields: (t) => ({
    taskId:    t.string({ resolve: (r) => (r.task as any).id ?? (r.task as any).Id }),
    taskTitle: t.string({ resolve: (r) => (r.task as any).title ?? (r.task as any).Title }),
    link:      t.field({ type: LinkType, resolve: (r) => r.link }),
  }) });

  builder.queryFields((t) => ({
    whiteboards: t.field({
      type: [WhiteboardSummaryType],
      args: {
        workspaceId: t.arg.string({ required: true }),
        scopeType:   t.arg.string({ required: true }),
        scopeId:     t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        await requireObjectLevel(ctx, a.scopeType as HierarchyNodeType, a.scopeId, 'VIEW');
        return svc.listForScope(a.workspaceId, a.scopeType as any, a.scopeId);
      },
    }),
    whiteboard: t.field({
      type: WhiteboardType,
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const wb = await svc.getById(a.id);
        if (!wb) notFound('Whiteboard not found');
        await requireObjectLevel(ctx, wb.scopeType as HierarchyNodeType, wb.scopeId, 'VIEW');
        return wb;
      },
    }),
  }));

  builder.mutationFields((t) => ({
    createWhiteboard: t.field({
      type: WhiteboardType,
      args: {
        workspaceId: t.arg.string({ required: true }),
        scopeType:   t.arg.string({ required: true }),
        scopeId:     t.arg.string({ required: true }),
        name:        t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        await requireObjectLevel(ctx, a.scopeType as HierarchyNodeType, a.scopeId, 'EDIT');
        return svc.create({
          workspaceId: a.workspaceId, scopeType: a.scopeType as any, scopeId: a.scopeId,
          name: a.name, createdById: (ctx.user as any).userId,
        });
      },
    }),
    updateWhiteboard: t.field({
      type: WhiteboardType,
      nullable: true,
      args: { id: t.arg.string({ required: true }), name: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        const wb = await svc.getById(a.id);
        if (!wb) notFound('Whiteboard not found');
        await requireObjectLevel(ctx, wb.scopeType as HierarchyNodeType, wb.scopeId, 'EDIT');
        return svc.update(a.id, a.name ?? undefined);
      },
    }),
    deleteWhiteboard: t.field({
      type: 'Boolean',
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const wb = await svc.getById(a.id);
        if (!wb) notFound('Whiteboard not found');
        await requireObjectLevel(ctx, wb.scopeType as HierarchyNodeType, wb.scopeId, 'EDIT');
        await svc.softDelete(a.id);
        return true;
      },
    }),
    convertShapeToTask: t.field({
      type: ConvertResultType,
      args: {
        whiteboardId: t.arg.string({ required: true }),
        targetListId: t.arg.string({ required: true }),
        shapeId:      t.arg.string({ required: true }),
        shapeJson:    t.arg.string({ required: true }), // raw tldraw shape JSON
      },
      resolve: async (_, a, ctx) => {
        const workspaceId = await svc.getWorkspaceId(a.whiteboardId);
        if (!workspaceId) notFound('Whiteboard not found');
        await requireWorkspacePermission(ctx, workspaceId, 'task.create');
        await requireObjectLevel(ctx, 'LIST', a.targetListId, 'EDIT');
        let shape: any;
        try { shape = JSON.parse(a.shapeJson); } catch { shape = { id: a.shapeId, type: 'note', props: {} }; }
        shape.id = a.shapeId;
        return svc.convertShapeToTask(a.whiteboardId, workspaceId, a.targetListId, shape, (ctx.user as any).userId);
      },
    }),
  }));
}
```

- [ ] Wire it into `schema.ts` — add the import alongside the others and call it near the other `register*Graphql()` calls:

```ts
import { registerWhiteboardGraphql } from './whiteboard.schema.js';
```
```ts
// ─────────────────────────────────────────
// Whiteboards (Phase 7b) — Whiteboard/Summary/Link/ConvertResult types +
// whiteboards/whiteboard queries + create/update/delete/convertShapeToTask.
// ─────────────────────────────────────────
registerWhiteboardGraphql();
```

- [ ] Run: `npm run build --workspace apps/api` (tsc — compiles the Pothos schema). Expected: PASS — schema builds. Then `npm test --workspace apps/api`. Expected: PASS (existing GraphQL authz tests still green).

- [ ] Commit:
```
git add apps/api/src/graphql/whiteboard.schema.ts apps/api/src/graphql/schema.ts
git commit -m "feat(7b): GraphQL whiteboard mirror — whiteboards/whiteboard + CRUD + convertShapeToTask"
```

---

### Task 9: Frontend — tldraw canvas (Yjs-bound) + convert-to-task + embeds + i18n

**Files:**
- Create: `apps/next-web/src/server/queries/whiteboards.ts`
- Create: `apps/next-web/src/server/actions/whiteboards.ts`
- Create: `apps/next-web/src/components/whiteboards/useWhiteboardYProvider.ts`
- Create: `apps/next-web/src/components/whiteboards/WhiteboardCanvas.tsx`
- Create: `apps/next-web/src/components/whiteboards/WhiteboardCanvas.module.css`
- Create: `apps/next-web/src/components/whiteboards/ConvertToTaskPanel.tsx`
- Create: `apps/next-web/src/components/whiteboards/__tests__/extractShapeTitle.unit.test.ts`
- Create: `apps/next-web/src/app/(app)/whiteboards/[id]/page.tsx` *(confirm the authenticated route-group segment name from the repo first)*
- Modify: `apps/next-web/src/messages/en.json`
- Modify: `apps/next-web/src/messages/id.json`
- **Note:** read `node_modules/next/dist/docs/` per `apps/next-web/AGENTS.md` before writing web code (this Next.js has breaking changes — App Router conventions, `params` shape, server/client boundaries may differ from training data). Also read how 7a's TipTap editor obtains its collab JWT + builds the `@hocuspocus/provider` (the Doc canvas mirrors that wiring) and reuse the SAME provider URL/token plumbing.

Steps:

- [ ] Write `server/queries/whiteboards.ts` — server fetchers used by the SSR page (mirror `queries/worklogs.ts` shape, using the repo's `serverFetch`):

```ts
import 'server-only';
import { serverFetch } from '../api';
import type { Whiteboard, WhiteboardSummary } from '@projectflow/types';

export async function getWhiteboard(id: string): Promise<Whiteboard | null> {
  const res = await serverFetch(`/whiteboards/${encodeURIComponent(id)}`);
  const body = await res.json();
  return body?.data ?? null;
}

export async function getWhiteboards(
  workspaceId: string, scopeType: string, scopeId: string,
): Promise<WhiteboardSummary[]> {
  const qs = new URLSearchParams({ workspaceId, scopeType, scopeId });
  const res = await serverFetch(`/whiteboards?${qs.toString()}`);
  const body = await res.json();
  return body?.data ?? [];
}
```

- [ ] Write `server/actions/whiteboards.ts` — `'use server'` actions mirroring `actions/worklogs.ts` (`requireSession`, `serverFetch`, `toActionError`, `ActionResult`):

```ts
'use server';

import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type { ConvertShapeToTaskResult } from '@projectflow/types';

export async function createWhiteboard(input: {
  workspaceId: string; scopeType: 'SPACE' | 'FOLDER' | 'LIST'; scopeId: string; name: string;
}): Promise<ActionResult<{ id: string }>> {
  await requireSession();
  try {
    const res = await serverFetch('/whiteboards', { method: 'POST', body: JSON.stringify(input) });
    const body = await res.json();
    return { ok: true, data: { id: body.data.id } };
  } catch (e) { return toActionError(e); }
}

export async function renameWhiteboard(id: string, name: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/whiteboards/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) });
  } catch (e) { return toActionError(e); }
  return { ok: true };
}

export async function deleteWhiteboard(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/whiteboards/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) { return toActionError(e); }
  return { ok: true };
}

/** Convert a tldraw shape into a real task in the chosen list. */
export async function convertShapeToTask(
  whiteboardId: string,
  input: { targetListId: string; shapeId: string; shape: { id: string; type: string; props?: Record<string, unknown> } },
): Promise<ActionResult<ConvertShapeToTaskResult>> {
  await requireSession();
  try {
    const res = await serverFetch(`/whiteboards/${encodeURIComponent(whiteboardId)}/convert-to-task`, {
      method: 'POST', body: JSON.stringify(input),
    });
    const body = await res.json();
    return { ok: true, data: body.data };
  } catch (e) { return toActionError(e); }
}
```

> If `ActionResult` is not generic in the repo, add the `<T>` param to `result.ts` (a non-breaking widening) or return `{ ok, data?: unknown }` and cast at the call site — match the file's existing convention; note the choice in the commit.

- [ ] Write the web-side title-extractor test, kept in lockstep with the API helper (the convert panel previews the derived title client-side before posting). `components/whiteboards/__tests__/extractShapeTitle.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractShapeTitle } from '../useWhiteboardYProvider'; // re-exported from the hook module

describe('extractShapeTitle (web mirror)', () => {
  it('reads a sticky note', () => {
    expect(extractShapeTitle({ id: 'shape:1', type: 'note', props: { text: 'Ship it' } })).toBe('Ship it');
  });
  it('falls back to Untitled for empty shapes', () => {
    expect(extractShapeTitle({ id: 'shape:2', type: 'geo', props: {} })).toBe('Untitled');
  });
  it('clamps to 500 chars', () => {
    expect(extractShapeTitle({ id: 'shape:3', type: 'text', props: { text: 'y'.repeat(700) } })).toHaveLength(500);
  });
});
```

- [ ] Run: `npm test --workspace apps/next-web -- extractShapeTitle`. Expected: FAIL — module not found.

- [ ] Write `components/whiteboards/useWhiteboardYProvider.ts` — builds the Hocuspocus provider (doc name `whiteboard:<id>`, JWT token from the same source 7a's editor uses) + a tldraw↔Yjs store binding, and re-exports a client copy of `extractShapeTitle` (verbatim from the API helper so previews match the server). Sketch (adapt the tldraw store binding to the installed tldraw + 7a's provider helper):

```ts
'use client';

import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { COLLAB_WS_URL, getCollabToken } from '@/lib/collab'; // the helpers 7a added for the Doc editor

/** Client mirror of apps/api .../whiteboard.shape.ts — keep in sync. */
export function extractShapeTitle(shape: { id: string; type: string; props?: Record<string, unknown> }): string {
  const props = shape.props ?? {};
  const collect = (node: any): string => {
    if (!node || typeof node !== 'object') return '';
    let out = typeof node.text === 'string' ? node.text : '';
    if (Array.isArray(node.content)) for (const c of node.content) out += collect(c);
    return out;
  };
  let raw = '';
  if (typeof props.text === 'string' && props.text.trim()) raw = props.text;
  else if ((props as any).richText) raw = collect((props as any).richText);
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Untitled';
  return cleaned.length > 500 ? cleaned.slice(0, 500) : cleaned;
}

/** Connect a whiteboard's Yjs doc over the shared collab server and expose it +
 *  connection state. The tldraw store binding is created by the caller from
 *  `doc`/`provider` (tldraw's Yjs integration). */
export function useWhiteboardYProvider(whiteboardId: string) {
  const [connected, setConnected] = useState(false);
  const doc = useMemo(() => new Y.Doc(), [whiteboardId]);

  const provider = useMemo(() => new HocuspocusProvider({
    url:   COLLAB_WS_URL,
    name:  `whiteboard:${whiteboardId}`,
    document: doc,
    token: getCollabToken,           // async JWT supplier 7a established
    onConnect: () => setConnected(true),
    onDisconnect: () => setConnected(false),
  }), [whiteboardId, doc]);

  useEffect(() => () => { provider.destroy(); doc.destroy(); }, [provider, doc]);

  return { doc, provider, connected };
}
```

- [ ] Write `components/whiteboards/WhiteboardCanvas.tsx` — the `'use client'` tldraw canvas. SSR-seed from `initialDocJson`, mount tldraw, bind its store to the Yjs doc (via the provider above), wire selection → `ConvertToTaskPanel`, and render link "embed" cards as custom shapes. Sketch:

```tsx
'use client';

import { useState } from 'react';
import { Tldraw, type Editor, type TLShape } from 'tldraw';
import 'tldraw/tldraw.css';
import { useTranslations } from 'next-intl';
import { useWhiteboardYProvider } from './useWhiteboardYProvider';
import { ConvertToTaskPanel } from './ConvertToTaskPanel';
import styles from './WhiteboardCanvas.module.css';
import type { WhiteboardTaskLink } from '@projectflow/types';

interface Props {
  whiteboardId: string;
  workspaceId:  string;
  scopeId:      string;            // the Space the target-list picker lists Lists from
  initialDocJson: string | null;   // SSR first-paint snapshot
  links: WhiteboardTaskLink[];     // existing shape→task embeds
}

export function WhiteboardCanvas({ whiteboardId, workspaceId, scopeId, initialDocJson, links }: Props) {
  const t = useTranslations('Whiteboard');
  const { doc, provider, connected } = useWhiteboardYProvider(whiteboardId);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selected, setSelected] = useState<TLShape | null>(null);

  const onMount = (ed: Editor) => {
    setEditor(ed);
    // Bind tldraw's store to the Yjs doc + provider (tldraw Yjs integration from
    // 7a's install). On first load, if the room is empty, hydrate from
    // initialDocJson so SSR↔CRDT agree; thereafter Yjs is the source of truth.
    bindTldrawToYjs(ed, doc, provider, initialDocJson); // helper colocated below
    ed.addListener('change', () => {
      const ids = ed.getSelectedShapeIds();
      setSelected(ids.length === 1 ? ed.getShape(ids[0]) ?? null : null);
    });
  };

  return (
    <div className={styles.root}>
      <div className={styles.canvas}>
        <Tldraw onMount={onMount} />
      </div>
      {!connected && <div className={styles.status}>{t('connecting')}</div>}
      {selected && (
        <ConvertToTaskPanel
          whiteboardId={whiteboardId}
          workspaceId={workspaceId}
          scopeId={scopeId}
          shape={{ id: selected.id, type: selected.type, props: (selected as any).props }}
          onConverted={() => setSelected(null)}
        />
      )}
      {/* Existing embeds re-hydrate as cards; full custom-shape rendering can be
          iterated after the headline flow is green. */}
      {links.length > 0 && (
        <ul className={styles.embeds} aria-label={t('linkedTasks')}>
          {links.map((l) => <li key={l.id} className={styles.embed}>{l.taskIssueKey ?? ''} {l.taskTitle}</li>)}
        </ul>
      )}
    </div>
  );
}

/** Seed tldraw's store from the SSR snapshot the first time the Yjs room is
 *  empty, then let the Yjs binding own all subsequent edits. */
function bindTldrawToYjs(editor: Editor, doc: import('yjs').Doc, provider: unknown, initialDocJson: string | null): void {
  // tldraw's Yjs store binding (the exact API ships with the tldraw version 7a
  // installed). If the shared Yjs doc has no tldraw records yet AND we have an
  // SSR snapshot, load it once so first-paint matches; otherwise trust Yjs.
  if (initialDocJson) {
    try {
      const snapshot = JSON.parse(initialDocJson);
      // Only load if the live store is empty (avoid clobbering a populated room).
      if (editor.store.allRecords().length <= 1) editor.store.loadSnapshot(snapshot);
    } catch { /* ignore a malformed snapshot — Yjs remains source of truth */ }
  }
}
```

> The exact tldraw↔Yjs store binding API depends on the tldraw version 7a installed. Read 7a's install + the tldraw docs (and `node_modules/tldraw`) to wire the store sync helper; the headline acceptance only requires that two browsers on the same `whiteboard:<id>` see each other's shapes (Task 10's co-edit check) and that a selected shape converts to a task. Keep the binding in `bindTldrawToYjs` so it is the single place to adjust.

- [ ] Write `components/whiteboards/ConvertToTaskPanel.tsx` — target-List picker (lists the scope's Lists) + a convert button that previews the derived title and calls the action:

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { convertShapeToTask } from '@/server/actions/whiteboards';
import { getListsForSpace } from '@/server/actions/hierarchy'; // existing list-fetch action
import { notifyActionError } from '@/lib/apiErrorToast';
import { extractShapeTitle } from './useWhiteboardYProvider';
import styles from './WhiteboardCanvas.module.css';

interface Props {
  whiteboardId: string;
  workspaceId:  string;
  scopeId:      string;
  shape: { id: string; type: string; props?: Record<string, unknown> };
  onConverted: () => void;
}

export function ConvertToTaskPanel({ whiteboardId, scopeId, shape, onConverted }: Props) {
  const t = useTranslations('Whiteboard');
  const [lists, setLists] = useState<Array<{ id: string; name: string }>>([]);
  const [listId, setListId] = useState('');
  const [pending, start] = useTransition();
  const title = extractShapeTitle(shape);

  useEffect(() => {
    getListsForSpace(scopeId).then((r: any) => {
      const items = (r?.data ?? r ?? []).map((l: any) => ({ id: l.id ?? l.Id, name: l.name ?? l.Name }));
      setLists(items);
      if (items[0]) setListId(items[0].id);
    });
  }, [scopeId]);

  const onConvert = () => start(async () => {
    const r = await convertShapeToTask(whiteboardId, { targetListId: listId, shapeId: shape.id, shape });
    if (!r.ok) return notifyActionError(r);
    onConverted();
  });

  return (
    <div className={styles.convertPanel} aria-label={t('convertToTask')}>
      <span className={styles.previewTitle}>{title}</span>
      <select className={styles.listPicker} value={listId} onChange={(e) => setListId(e.target.value)} aria-label={t('targetList')}>
        {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <button className={styles.convertBtn} onClick={onConvert} disabled={pending || !listId}>
        {pending ? t('converting') : t('convertToTask')}
      </button>
    </div>
  );
}
```

> `getListsForSpace` stands in for the repo's existing "lists in a space" fetch (the hierarchy/list server action). Confirm the real action/query name (`actions/hierarchy.ts` or `queries/hierarchy.ts`) and use it; the picker only needs `{ id, name }` per List.

- [ ] Write `components/whiteboards/WhiteboardCanvas.module.css` (minimal, theme-token based):

```css
.root { position: relative; width: 100%; height: calc(100vh - 56px); }
.canvas { position: absolute; inset: 0; }
.status { position: absolute; top: 8px; left: 8px; padding: 2px 8px; border-radius: 6px; background: var(--surface-2, #1f2937); font-size: 12px; }
.convertPanel { position: absolute; right: 12px; top: 12px; z-index: 5; display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: 8px; background: var(--surface-1, #111827); box-shadow: 0 2px 12px rgba(0,0,0,.25); }
.previewTitle { font-weight: 600; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.listPicker { padding: 4px 6px; }
.convertBtn { border: none; border-radius: 6px; padding: 4px 10px; cursor: pointer; background: #6366f1; color: #fff; }
.convertBtn:disabled { opacity: .6; cursor: default; }
.embeds { position: absolute; left: 12px; bottom: 12px; z-index: 4; list-style: none; margin: 0; padding: 8px; border-radius: 8px; background: var(--surface-2, #1f2937); font-size: 12px; }
.embed { white-space: nowrap; }
```

- [ ] Write the SSR page `app/(app)/whiteboards/[id]/page.tsx` — load whiteboard meta + `DocJson` + links server-side, render the client canvas. **Read `node_modules/next/dist/docs/` first** to confirm the `params`/`searchParams` shape (this Next.js may pass `params` as a Promise) and the route-group segment for the authenticated shell:

```tsx
import { notFound } from 'next/navigation';
import { getWhiteboard } from '@/server/queries/whiteboards';
import { serverFetch } from '@/server/api';
import { WhiteboardCanvas } from '@/components/whiteboards/WhiteboardCanvas';
import type { WhiteboardTaskLink } from '@projectflow/types';

// NOTE: params shape per this Next.js version — verify in node_modules/next/dist/docs/.
export default async function WhiteboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wb = await getWhiteboard(id);
  if (!wb) notFound();
  const links: WhiteboardTaskLink[] = await serverFetch(`/whiteboards/${id}/links`).then((r) => r.json()).then((b) => b?.data ?? []);
  return (
    <WhiteboardCanvas
      whiteboardId={wb.id}
      workspaceId={wb.workspaceId}
      scopeId={wb.scopeId}
      initialDocJson={wb.docJson}
      links={links}
    />
  );
}
```

- [ ] Run: `npm test --workspace apps/next-web -- extractShapeTitle`. Expected: PASS (3 tests).

- [ ] Add i18n keys. In `en.json` add a `Whiteboard` namespace:

```json
"Whiteboard": {
  "title": "Whiteboard",
  "connecting": "Connecting…",
  "convertToTask": "Convert to task",
  "converting": "Converting…",
  "targetList": "Target list",
  "linkedTasks": "Linked tasks",
  "create": "New whiteboard",
  "rename": "Rename",
  "delete": "Delete"
}
```

In `id.json` add the same keys with real Indonesian:

```json
"Whiteboard": {
  "title": "Papan tulis",
  "connecting": "Menghubungkan…",
  "convertToTask": "Ubah jadi tugas",
  "converting": "Mengubah…",
  "targetList": "Daftar tujuan",
  "linkedTasks": "Tugas tertaut",
  "create": "Papan tulis baru",
  "rename": "Ganti nama",
  "delete": "Hapus"
}
```

- [ ] Run: `npm test --workspace apps/next-web` (includes the `messages.unit` i18n parity test). Expected: PASS — en/id key parity green; `extractShapeTitle` test green. Then `npm run build --workspace apps/next-web`. Expected: PASS (Next build clean).

- [ ] Commit:
```
git add apps/next-web/src/server/queries/whiteboards.ts apps/next-web/src/server/actions/whiteboards.ts apps/next-web/src/components/whiteboards apps/next-web/src/app apps/next-web/src/messages/en.json apps/next-web/src/messages/id.json
git commit -m "feat(7b): whiteboard canvas (tldraw+Yjs) + convert-to-task panel + embeds + SSR page + i18n"
```

---

### Task 10: Playwright e2e — sticky→task + two-browser co-edit

**Files:**
- Create: `e2e/whiteboards.spec.ts`
- Note: e2e runs against local Docker `ProjectFlow_Test` only (use the project's existing e2e env/setup — same API-seed + UI-login pattern as `e2e/views.spec.ts` / `e2e/presence.spec.ts`).

Steps:

- [ ] Write the e2e spec. Two scenarios: (a) the §5.5 headline — a sticky converts into a real task in the chosen list (assert the task exists via the REST API so the check is deterministic regardless of canvas internals); (b) a two-browser co-edit sanity check (a shape drawn in browser A appears in browser B on the same `whiteboard:<id>`). Follow the `views.spec.ts` harness (register → login → workspace → Space → List over API; create the whiteboard over the API; UI-login both pages):

```ts
import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';
const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

interface Seed {
  s: string; email: string; password: string; token: string; api: APIRequestContext;
  wsId: string; spaceId: string; listId: string; whiteboardId: string;
}

async function apiSetup(): Promise<Seed> {
  const s = uniq();
  const email = `e2e-wb-${s}@projectflow.test`;
  const password = 'E2EPass123!';
  const api = await pwRequest.newContext();
  await api.post(`${API_BASE}/auth/register`, { data: { email, name: `WB ${s}`, password } });
  const { data: { token } } = await (await api.post(`${API_BASE}/auth/login`, { data: { email, password } })).json();
  const auth = { Authorization: `Bearer ${token}` };

  const ws = await (await api.post(`${API_BASE}/workspaces`, { headers: auth, data: { name: `WS ${s}`, slug: `ws-${s}` } })).json();
  const wsId = ws.data.Id;
  const space = await (await api.post(`${API_BASE}/projects`, { headers: auth, data: { workspaceId: wsId, name: `Space ${s}`, key: `WB${s.slice(-4)}`, type: 'KANBAN' } })).json();
  const spaceId = space.data.Id;
  const list = await (await api.post(`${API_BASE}/lists`, { headers: auth, data: { workspaceId: wsId, spaceId, folderId: null, name: `List ${s}`, position: 0 } })).json();
  const listId = list.data.Id;
  const wb = await (await api.post(`${API_BASE}/whiteboards`, { headers: auth, data: { workspaceId: wsId, scopeType: 'SPACE', scopeId: spaceId, name: `Board ${s}` } })).json();

  return { s, email, password, token, api, wsId, spaceId, listId, whiteboardId: wb.data.id };
}

async function uiLogin(page: any, email: string, password: string) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u: URL) => !u.pathname.startsWith('/login'), { timeout: 15000 });
}

test.describe('Phase 7b — whiteboards', () => {
  test('a sticky converts into a real task in the chosen list', async ({ page }) => {
    const seed = await apiSetup();
    await uiLogin(page, seed.email, seed.password);
    await page.goto(`/whiteboards/${seed.whiteboardId}`);

    // Draw a sticky with text using tldraw's note tool, then select it.
    await page.getByTestId('tools.note').click().catch(() => {});
    await page.locator('.tl-canvas, [data-testid="canvas"]').first().click({ position: { x: 300, y: 220 } });
    await page.keyboard.type('Design the onboarding flow');
    await page.keyboard.press('Escape');

    // The convert panel appears for the single selected shape.
    await page.getByRole('button', { name: /convert to task/i }).click();

    // Assert deterministically via the API that a task now exists in the list
    // with the sticky's text as its title.
    await expect.poll(async () => {
      const res = await seed.api.get(`${API_BASE}/tasks?projectId=${seed.spaceId}`, {
        headers: { Authorization: `Bearer ${seed.token}` },
      });
      const body = await res.json();
      return (body.data ?? []).some((t: any) => (t.title ?? t.Title) === 'Design the onboarding flow');
    }, { timeout: 15000 }).toBe(true);
  });

  test('two browsers co-edit the same whiteboard', async ({ browser }) => {
    const seed = await apiSetup();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await uiLogin(pageA, seed.email, seed.password);
    await uiLogin(pageB, seed.email, seed.password);
    await pageA.goto(`/whiteboards/${seed.whiteboardId}`);
    await pageB.goto(`/whiteboards/${seed.whiteboardId}`);

    // Draw a shape in A; it should sync into B's canvas over the shared Yjs room.
    await pageA.getByTestId('tools.note').click().catch(() => {});
    await pageA.locator('.tl-canvas, [data-testid="canvas"]').first().click({ position: { x: 280, y: 200 } });
    await pageA.keyboard.type('synced-note');
    await pageA.keyboard.press('Escape');

    await expect(pageB.getByText('synced-note')).toBeVisible({ timeout: 15000 });
    await ctxA.close(); await ctxB.close();
  });
});
```

> The tldraw tool/canvas selectors above are best-effort (`tools.note` is tldraw's default note-tool test id). Verify the actual selectors against the installed tldraw version; if a selector differs, adjust — the load-bearing assertions are (a) the task exists via API after convert, and (b) `synced-note` appears in the second browser.

- [ ] Run: the project's e2e command for a single spec against `ProjectFlow_Test` (same invocation `views`/`presence` specs use, e.g. `npx playwright test e2e/whiteboards.spec.ts`). Expected: PASS (2 tests) — sticky→task creates a real task; the second browser sees the synced note.

- [ ] Commit:
```
git add e2e/whiteboards.spec.ts
git commit -m "test(7b): e2e — sticky converts to a real task in the chosen list + two-browser co-edit"
```

---

### Task 11: Slice verification + DECISIONS.md

**Files:**
- Modify: `DECISIONS.md` (append a Phase 7b entry)

Steps:

- [ ] Run the full slice verification on local Docker `ProjectFlow_Test`:
  - `npm test --workspace apps/api` — Expected: PASS (existing suite + new `shape` unit tests).
  - `npm run test:integration --workspace apps/api` — Expected: PASS (existing + `whiteboard.integration.test.ts`).
  - `npm test --workspace apps/next-web` — Expected: PASS (unit + `extractShapeTitle` + `messages.unit` parity).
  - `npm run build --workspace apps/api` and `npm run build --workspace apps/next-web` — Expected: both PASS.
  - The whiteboards e2e (sticky→task + two-browser co-edit) — Expected: PASS.

- [ ] Append a `DECISIONS.md` entry logging: whiteboards as **scoped objects** (SPACE/FOLDER/LIST) authz'd on their scope like SavedViews; the `whiteboard:<id>` doc-name branch riding **7a's** Hocuspocus persistence (no second server); `DocYjs` (binary, source of truth) + `DocJson` (SSR/search convenience, possibly deferred-null at first); the **pure** `extractShapeTitle` shared API↔web (and where richText vs text is read); convert-to-task reusing `TaskService.createTask` + idempotent `WhiteboardTaskLinks`; the dual gate on convert (`task.create` workspace + EDIT on the **target List**); the GET-list workspace-resolution choice; the GraphQL mirror; the actual collab filename touched; and any deviation found during implementation. DB-execution-policy note: all DB work (migrations, SP-deploy, integration, e2e) ran ONLY against local Docker `ProjectFlow_Test`.

- [ ] Commit:
```
git add DECISIONS.md
git commit -m "docs(7b): DECISIONS entry — whiteboards (tldraw+Yjs) + convert-shape->task + collab reuse"
```

---

## Definition of Done

Per-slice DoD (spec §3) + BUILD_PLAN acceptance (spec §5.5):

- [ ] **BUILD_PLAN acceptance:** a whiteboard **sticky converts into a real task in the chosen list** (verified by the integration test + the e2e asserting the task via API), and the new task is **linked back** via `WhiteboardTaskLinks`.
- [ ] Migration `0041_whiteboards.sql` is idempotent, GO-batched, and **reversible** via `rollback/0041_whiteboards.down.sql` (apply→rollback→re-apply verified clean) with the EXACT spec columns (`Whiteboards.DocYjs VARBINARY(MAX)` / `DocJson NVARCHAR(MAX)`).
- [ ] SP-per-op for every operation (`usp_Whiteboard_Create`/`GetById`/`ListForScope`/`Update`/`Delete`/`GetWorkspaceId`/`GetDoc`/`SaveDoc`, `usp_WhiteboardTaskLink_Create`/`ListForWhiteboard`).
- [ ] Whiteboard live sync rides the **shared 7a Hocuspocus server** under doc name `whiteboard:<id>`; persistence reuses 7a's debounced `onLoadDocument`/`onStoreDocument` path (binary `DocYjs` + `DocJson` snapshot) — **no second collab server**.
- [ ] REST is the primary surface; the **GraphQL mirror** (`whiteboards`, `whiteboard`, `createWhiteboard`, `updateWhiteboard`, `deleteWhiteboard`, `convertShapeToTask`) delegates to the **one shared `WhiteboardService`**.
- [ ] Authorization fail-closed: reads gate on **VIEW of the scope**, writes on **EDIT of the scope**, convert on `task.create` (workspace RBAC) **and EDIT on the target List**; the collab `onAuthenticate` resolves `whiteboard:<id>` to its scope ACL.
- [ ] Unit tests (pure `extractShapeTitle`, API + web mirror) + integration tests (CRUD, convert-sticky→task-in-list + link, doc save/load round-trip, cross-scope 404) + Playwright e2e (sticky→task + **two-browser co-edit**) — all green.
- [ ] `@projectflow/types` updated (`Whiteboard`/`WhiteboardSummary`/`WhiteboardTaskLink`/`WhiteboardScopeType` + `CreateWhiteboardInput`/`UpdateWhiteboardInput`/`ConvertShapeToTaskInput`/`ConvertShapeToTaskResult`).
- [ ] i18n: new `Whiteboard` keys in **en.json + id.json** (real Indonesian); `messages.unit` parity green.
- [ ] All DB work (migrations, SP deploy, integration, e2e) ran **ONLY against local Docker `ProjectFlow_Test`** — never the prod-pointing `apps/api/.env`.
- [ ] `DECISIONS.md` entry logs the mechanism choices + any deviations. **Stop for review/merge before Slice 7c.**

---

## Self-Review

**Spec coverage (§5):**
- §5.1 data model — `0041_whiteboards.sql` creates `Whiteboards(Id, WorkspaceId, ScopeType, ScopeId, Name, DocYjs VARBINARY(MAX), DocJson NVARCHAR(MAX), CreatedById, CreatedAt, UpdatedAt, DeletedAt)` EXACTLY as specified, plus the `WhiteboardTaskLinks` table the §5.2 convert-and-link endpoint requires (Task 1). ✅
- §5.2 backend — CRUD via the same collab server (doc name `whiteboard:<id>`) in Task 7; convert shape/sticky/text→task creating a task in a target list with the shape's text as title + linking it back (Tasks 5/6); REST + GraphQL mirror (Tasks 6/8). ✅
- §5.3 frontend — tldraw canvas bound to Yjs over the shared `@hocuspocus/provider` (Task 9 `useWhiteboardYProvider`/`WhiteboardCanvas`); convert-to-task action with a target-list picker (`ConvertToTaskPanel`); embed live task/doc cards as custom tldraw shapes (links rendered as embed cards, with a noted iteration path to full custom shapes). ✅
- §5.4 tests — unit (shape→task title extraction + snapshot persistence shape via the doc round-trip test); integration (convert a sticky → task created in the chosen list + linked); e2e (sticky→task + two-browser co-edit). ✅
- §5.5 acceptance — covered by the integration `converts a sticky into a real task` test and the e2e's API-asserted convert. ✅
- §2/§4 collab contract — Task 7 explicitly **reuses** 7a's Hocuspocus server, doc-name encoding, and debounced persistence path; no second server; `onAuthenticate` extended to whiteboards. ✅

**Placeholder scan:** Full code is provided for the migration (exact columns) + rollback, all 10 SPs, the repository, the service (incl. `convertShapeToTask`), the routes (incl. convert-to-task + authz), the GraphQL mirror, the pure `extractShapeTitle` + its tests, and the frontend hook/canvas/panel/page/actions/queries. The deliberately version-dependent seams — the tldraw↔Yjs **store binding** and 7a's **exact collab persistence filename/helpers** — are isolated to `bindTldrawToYjs` and the Task 7 dispatcher with explicit "read 7a / read tldraw + `node_modules/next/dist/docs/`" instructions and a note to record the real filename; these depend on the 7a/tldraw API surface that doesn't exist in-repo until 7a merges, so they are grounded against the spec rather than hard-coded. No "wire the rest similarly" hand-waves remain for the load-bearing API/DB code.

**Type/name consistency:** Migration `0041`; table/columns `Whiteboards`/`DocYjs`/`DocJson` + `WhiteboardTaskLinks`; doc-name `whiteboard:<id>`; types `Whiteboard`/`WhiteboardSummary`/`WhiteboardTaskLink`/`WhiteboardScopeType`/`ConvertShapeToTask{Input,Result}` all match the spec. SP/repo/route/GraphQL naming follows repo conventions (`usp_<Entity>_<Op>`, `execSp`/`execSpOne`, `requireObjectAccess`/`requirePermission` REST + `requireObjectLevel`/`requireWorkspacePermission` GraphQL, `register*Graphql()` in `schema.ts`, `app.route('/whiteboards', …)` in `server.ts`). Note recorded in-plan: `requireObjectLevel`/`HierarchyNodeType` only accept `SPACE|FOLDER|LIST` — whiteboards therefore authz on their **scope** node (like `SavedViews`), NOT a `WHITEBOARD` node type; the spec's `requireObjectLevel('WHITEBOARD', …)` phrasing refers to 7a's collab `onAuthenticate`, which resolves a whiteboard to its scope ACL.
