# Phase 7a — Collaboration Foundation + Docs & Wikis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the new realtime **CRDT collaboration channel** the app has never had — a **Hocuspocus Yjs WebSocket server** (`apps/api/src/modules/collab/`) with JWT+ACL `onAuthenticate`, debounced Yjs persistence to SQL Server (`VARBINARY(MAX)` state + a rendered ProseMirror-JSON snapshot to `NVARCHAR(MAX)`), native awareness for live cursors, and the Redis extension for multi-instance fan-out — and on top of it ship **Docs & Wikis**: a nested page tree (fractional-index move/reorder, `ParentPageId`), a TipTap collaborative editor (`Collaboration` + `CollaborationCursor` over `@hocuspocus/provider`), inline comments (reusing Phase 4 comments), embed-task nodes, page history (list + restore), doc↔task links, create-task-from-selection, and a wiki flag with verification. SSR first-paints from the JSON snapshot, then the client hydrates and connects to Yjs for live sync.

**Architecture:** A document name encodes type + id (`doc-page:<id>` for this slice; `whiteboard:<id>` is reserved for 7b) so **one collab server serves both** subsystems — keep it generic over the `<type>:<id>` prefix. `onAuthenticate` verifies the existing JWT with `JWT_SECRET` (same secret `auth.middleware.ts` and the GraphQL context use), resolves the doc-page → its owning `Docs` row → that doc's hierarchy node (`ScopeType`/`ScopeId`, a SPACE/FOLDER/LIST), then gates with the existing `accessService` (the ACL system only knows SPACE/FOLDER/LIST — there is no `DOC` object type, so docs ride their scope node; see Self-Review §"Resolved ambiguity"). `onLoadDocument` seeds the Yjs doc from `DocPages.BodyYjs`; a debounced `onStoreDocument` writes the binary state back AND renders a ProseMirror-JSON snapshot to `BodyJson` via `y-prosemirror`'s `yDocToProsemirrorJSON`. Metadata/tree/history/link ops are SP-per-op behind `docs.repository` → `docs.service`, exposed as Hono **REST** (primary) + a **GraphQL mirror** (`registerDocsGraphql()` in `graphql/schema.ts`) over the one shared service. The Hocuspocus server attaches to the HTTP server's WebSocket **upgrade** in dev (gated off in tests), and is structured to run as a separable bootstrapped process in prod (like the BullMQ workers). Awareness carries live cursors; `@hocuspocus/extension-redis` fans state across instances over the existing Redis.

**Tech Stack:** `@hocuspocus/server` + `@hocuspocus/extension-redis` (collab server); `yjs` + `y-prosemirror` (CRDT + snapshot render) on the API; `@tiptap/react` + `@tiptap/starter-kit` + `@tiptap/extension-collaboration` + `@tiptap/extension-collaboration-cursor` + `@hocuspocus/provider` (web editor); SQL Server stored procedures (`CREATE OR ALTER`, `SET NOCOUNT ON`, TRY/CATCH/TRANSACTION); Hono REST + `@hono/zod-validator`; graphql-yoga + Pothos (`@pothos/core`); `mssql` via `execSp`/`execSpOne`; `ioredis` via `getRedis()`; vitest (`--project unit` / `--project integration`); Next.js App Router (SSR) + `next-intl`; Playwright e2e. DB work runs ONLY against local Docker `ProjectFlow_Test`.

**Prerequisite:** Phases 1–6 merged. (Migrations on disk reach `0037`; Phase 6 adds `0038`/`0039`; this slice is `0040`.)

---

## File Structure

**Dependencies**
- `apps/api/package.json` — **Modify.** Add `@hocuspocus/server`, `@hocuspocus/extension-redis`, `yjs`, `y-prosemirror`, `prosemirror-model`, `ws` (peer of `@hocuspocus/server`).
- `apps/next-web/package.json` — **Modify.** Add `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-cursor`, `@hocuspocus/provider`, `yjs`, `y-prosemirror`.

**Migrations**
- `infra/sql/migrations/0040_docs.sql` — **Create.** Idempotent, GO-batched: `Docs`, `DocPages`, `DocPageVersions`, `DocTaskLinks` (+ scope/parent/position indexes).
- `infra/sql/migrations/rollback/0040_docs.down.sql` — **Create.** Reverse: drop the four tables (children first), indexes, and the `MigrationHistory` row.

**Stored procedures** (`infra/sql/procedures/`)
- `usp_Doc_Create.sql` — **Create.** Insert a `Docs` row (+ a first untitled `DocPages` root page); return the doc + root page.
- `usp_Doc_GetById.sql` — **Create.** Return a doc with its `ScopeType`/`ScopeId`/`WorkspaceId`/`IsWiki`/`VerifiedById`.
- `usp_Doc_ListByScope.sql` — **Create.** List non-deleted docs for a `ScopeType`/`ScopeId`.
- `usp_Doc_SetWiki.sql` — **Create.** Toggle `IsWiki`; on verify set `VerifiedById`, on un-wiki clear it; return the doc.
- `usp_Doc_ResolveScopeNode.sql` — **Create.** Given a `DocPageId`, return the owning doc's `ScopeType`/`ScopeId`/`WorkspaceId` (the collab-server ACL anchor).
- `usp_DocPage_Create.sql` — **Create.** Insert a page under a doc (optional `ParentPageId`), positioned via a passed fractional `Position`; return it.
- `usp_DocPage_GetById.sql` — **Create.** Return a single page incl. `BodyJson` (SSR first-paint) but NOT the heavy `BodyYjs` by default.
- `usp_DocPage_ListByDoc.sql` — **Create.** Return all non-deleted pages of a doc (tree fields: `Id`/`ParentPageId`/`Title`/`Icon`/`Position`).
- `usp_DocPage_Update.sql` — **Create.** ISNULL-coalesced update of `Title`/`Icon`/`Cover`; return the page.
- `usp_DocPage_Move.sql` — **Create.** Set `ParentPageId` + fractional `Position` (move/reorder); guard against self/descendant cycles; return the page.
- `usp_DocPage_Delete.sql` — **Create.** Soft-delete a page and its descendants (`DeletedAt`).
- `usp_DocPage_PersistYjs.sql` — **Create.** The collab-server store path: upsert `BodyYjs` (binary) + `BodyJson` (snapshot) + `UpdatedAt`.
- `usp_DocPage_LoadYjs.sql` — **Create.** The collab-server load path: return `BodyYjs` for a page.
- `usp_DocPageVersion_Create.sql` — **Create.** Append a `DocPageVersions` snapshot row (history checkpoint).
- `usp_DocPageVersion_List.sql` — **Create.** List a page's versions (newest first, no `Snapshot` blob in the list).
- `usp_DocPageVersion_GetById.sql` — **Create.** Return one version incl. its `Snapshot`.
- `usp_DocPage_Restore.sql` — **Create.** Snapshot current → versions, then replace `BodyJson` (and clear `BodyYjs` so reconnecting clients re-seed from JSON); return the page.
- `usp_DocTaskLink_Create.sql` — **Create.** Insert a `DocTaskLinks` row (`reference`|`embed`); return it.
- `usp_DocTaskLink_ListByPage.sql` — **Create.** List links for a page (joined task title/key).
- `usp_DocTaskLink_Delete.sql` — **Create.** Delete a link row.

**API** (`apps/api/src/`)
- `modules/collab/yjsPersistence.ts` — **Create.** Pure-ish helpers: `docNameToTarget('doc-page:<id>')`, `renderSnapshot(yDoc)` (Yjs→ProseMirror JSON), `seedYDoc(yDoc, bytes)`.
- `modules/collab/collab.repository.ts` — **Create.** `resolveScopeNode`, `loadYjs`, `persistYjs` over the new SPs.
- `modules/collab/collab.auth.ts` — **Create.** `authenticateCollab(token, documentName)`: verify JWT → resolve scope node → `accessService.can(...)`; returns `{ userId, level }` or throws.
- `modules/collab/collab.server.ts` — **Create.** Builds + exports the configured Hocuspocus `Server` (`onAuthenticate`/`onLoadDocument`/`onStoreDocument` debounced/awareness/Redis ext); `attachCollabUpgrade(httpServer)`.
- `modules/docs/docs.repository.ts` — **Create.** Doc + page + version + link CRUD/tree/move over the SPs.
- `modules/docs/docs.service.ts` — **Create.** Shared service used by REST + GraphQL; threads create-task-from-selection.
- `modules/docs/fractionalIndex.ts` — **Create.** Pure `positionBetween(a, b)` reorder math (unit-tested).
- `modules/docs/docs.routes.ts` — **Create.** Hono REST: doc/page CRUD, move, history list/restore, links, create-task-from-selection, wiki toggle.
- `graphql/docs.schema.ts` — **Create.** `registerDocsGraphql()`: `Doc`/`DocPage`/`DocPageVersion`/`DocTaskLink` types + queries + mutations over the shared service.
- `graphql/schema.ts` — **Modify.** Import + call `registerDocsGraphql()` near the other `register*Graphql()` calls.
- `server.ts` — **Modify.** Import `attachCollabUpgrade`; after `serve(...)` (non-test only) attach the WS upgrade to the Node HTTP server.
- `modules/tasks/task.service.ts` (or reuse existing) — **Reuse.** `createTask` for create-task-from-selection (no change expected; verify the call shape).

**Types** (`packages/types/`)
- `index.ts` — **Modify.** Add `DocScopeType`, `Doc`, `DocPage`, `DocPageNode`, `DocPageVersion`, `DocPageVersionMeta`, `DocTaskLink`, `DocTaskLinkKind`, and the create/update/move input types.

**Frontend** (`apps/next-web/src/`)
- `server/actions/docs.ts` — **Create.** Server actions: create doc/page, rename, move, list tree, history list/restore, link, create-task-from-selection, wiki toggle.
- `server/queries/docs.ts` — **Create.** SSR reads: `getDoc`, `getDocTree`, `getDocPage` (returns `bodyJson`).
- `lib/collab/useCollabProvider.ts` — **Create.** Hook that builds a `HocuspocusProvider` for `doc-page:<id>` with a fresh token (via `getRealtimeToken`).
- `components/docs/DocEditor.tsx` — **Create.** Client TipTap editor bound to the provider's Yjs doc (`Collaboration` + `CollaborationCursor`), slash commands, inline-comment mark, embed-task node.
- `components/docs/DocEditor.module.css` — **Create.** Editor + remote-cursor styles.
- `components/docs/embedTaskNode.ts` — **Create.** TipTap Node extension `embedTask` rendering a live task card.
- `components/docs/slashCommands.ts` — **Create.** Slash-command suggestion config (headings, list, task-embed, divider).
- `components/docs/DocPageTree.tsx` — **Create.** Nested sidebar tree (create/rename/drag-move) over the tree action set.
- `components/docs/DocHistoryPanel.tsx` — **Create.** Version list + restore.
- `components/docs/WikiToggle.tsx` — **Create.** "Mark as wiki" toggle + verified badge.
- `app/(app)/docs/[docId]/page.tsx` — **Create.** SSR doc page: first-paint from `bodyJson`, mounts the tree + editor + history + wiki toggle.
- `app/(app)/docs/[docId]/loading.tsx` — **Create.** Skeleton.
- `messages/en.json` — **Modify.** New `Docs` namespace.
- `messages/id.json` — **Modify.** Same keys, real Indonesian.

**Tests**
- `apps/api/src/modules/docs/__tests__/fractionalIndex.unit.test.ts` — **Create.** Pure reorder math.
- `apps/api/src/modules/collab/__tests__/yjsPersistence.unit.test.ts` — **Create.** `docNameToTarget` parsing + snapshot/seed round-trip.
- `apps/api/src/modules/collab/__tests__/collabAuth.unit.test.ts` — **Create.** `authenticateCollab` fail-closed (bad token, no access) + happy path (mocked repo/access).
- `apps/api/src/modules/docs/__tests__/docs.integration.test.ts` — **Create.** Page CRUD + nested move; history restore; create-task-from-doc; wiki flag set/read.
- `apps/api/src/modules/collab/__tests__/persistence.integration.test.ts` — **Create.** Call `onStoreDocument`'s persist path → assert `BodyYjs`/`BodyJson` land in `DocPages`.
- `apps/next-web/src/components/docs/__tests__/DocPageTree.unit.test.tsx` — **Create.** Pure tree-builder from flat pages.
- `apps/next-web/e2e/docs-collab.spec.ts` — **Create.** Two browsers co-edit a page with live cursors; an offline edit merges on reconnect; history restores a prior version; wiki flag retrievable.

---

## Tasks

### Task 1: Install new dependencies + record versions

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/next-web/package.json`
- Modify: `package-lock.json` (lockfile, written by npm)

Steps:

- [ ] Install the **API/collab** dependencies into the `api` workspace (Yjs CRDT + collab server + snapshot render):

```
npm install --workspace apps/api @hocuspocus/server @hocuspocus/extension-redis yjs y-prosemirror prosemirror-model ws
```

- [ ] Install the **web editor** dependencies into the `next-web` workspace (TipTap collaborative editor + provider):

```
npm install --workspace apps/next-web @tiptap/react @tiptap/starter-kit @tiptap/extension-collaboration @tiptap/extension-collaboration-cursor @hocuspocus/provider yjs y-prosemirror
```

- [ ] Record the resolved versions (read them back from the two `package.json` files after install) so the plan + `DECISIONS.md` capture exact pins. Note any peer-dependency warnings (Hocuspocus pins a `ws` major; `@tiptap/*` extensions must all share one TipTap major; `yjs` must be a **single** instance — if npm hoists two copies, add `yjs` to root `overrides`).

- [ ] Verify the workspaces still typecheck/build at baseline (no usage yet):

```
npm run build --workspace apps/api
npm run build --workspace apps/next-web
```
Expected: both PASS (only `package.json`/lockfile changed).

- [ ] Commit:
```
git add apps/api/package.json apps/next-web/package.json package-lock.json
git commit -m "feat(7a): add Yjs/Hocuspocus + TipTap collab dependencies"
```

---

### Task 2: Migration + rollback (`0040_docs.sql`)

**Files:**
- Create: `infra/sql/migrations/0040_docs.sql`
- Create: `infra/sql/migrations/rollback/0040_docs.down.sql`
- Test: manual deploy against local Docker `ProjectFlow_Test` (migrations have no unit harness; verified via the integration suites in Tasks 9–10).

Steps:

- [ ] Write the migration. Idempotent (`sys.tables`/`sys.indexes` guards), GO-batched, matching the `0032_saved_views.sql` style. Columns are **exactly** the spec §4.2 set:

```sql
-- =============================================================================
-- Migration 0040: Docs & Wikis (Phase 7a)
-- The first knowledge surface + the persistence backing of the new Yjs collab
-- channel. Four tables:
--   Docs            — a doc container, scoped to a hierarchy node (SPACE/FOLDER/LIST),
--                     wiki flag + verifier.
--   DocPages        — nested pages (ParentPageId tree, fractional Position),
--                     BodyYjs (live CRDT binary) + BodyJson (rendered ProseMirror
--                     JSON for SSR first-paint + search).
--   DocPageVersions — history snapshots (NVARCHAR(MAX) JSON) for restore.
--   DocTaskLinks    — doc<->task links ('reference' | 'embed').
-- Idempotent (catalog guards), GO-batched. Rollback in rollback/0040_docs.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Docs')
BEGIN
    CREATE TABLE dbo.Docs (
        Id           UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId  UNIQUEIDENTIFIER NOT NULL,
        ScopeType    NVARCHAR(8)      NOT NULL,             -- 'SPACE' | 'FOLDER' | 'LIST'
        ScopeId      UNIQUEIDENTIFIER NOT NULL,
        Name         NVARCHAR(255)    NOT NULL,
        Icon         NVARCHAR(64)     NULL,
        IsWiki       BIT              NOT NULL CONSTRAINT DF_Docs_IsWiki DEFAULT 0,
        VerifiedById UNIQUEIDENTIFIER NULL,
        CreatedById  UNIQUEIDENTIFIER NOT NULL,
        CreatedAt    DATETIME2        NOT NULL CONSTRAINT DF_Docs_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt    DATETIME2        NOT NULL CONSTRAINT DF_Docs_UpdatedAt DEFAULT SYSUTCDATETIME(),
        DeletedAt    DATETIME2        NULL,
        CONSTRAINT CK_Docs_ScopeType CHECK (ScopeType IN ('SPACE','FOLDER','LIST')),
        CONSTRAINT FK_Docs_Workspace FOREIGN KEY (WorkspaceId) REFERENCES dbo.Workspaces(Id),
        CONSTRAINT FK_Docs_Creator   FOREIGN KEY (CreatedById) REFERENCES dbo.Users(Id),
        CONSTRAINT FK_Docs_Verifier  FOREIGN KEY (VerifiedById) REFERENCES dbo.Users(Id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Docs_Scope' AND object_id = OBJECT_ID('dbo.Docs'))
    CREATE NONCLUSTERED INDEX IX_Docs_Scope ON dbo.Docs (WorkspaceId, ScopeType, ScopeId) WHERE DeletedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DocPages')
BEGIN
    CREATE TABLE dbo.DocPages (
        Id           UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        DocId        UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_DocPages_Doc REFERENCES dbo.Docs(Id) ON DELETE CASCADE,
        ParentPageId UNIQUEIDENTIFIER NULL
            CONSTRAINT FK_DocPages_Parent REFERENCES dbo.DocPages(Id),
        Title        NVARCHAR(255)    NOT NULL CONSTRAINT DF_DocPages_Title DEFAULT N'Untitled',
        Icon         NVARCHAR(64)     NULL,
        Cover        NVARCHAR(1024)   NULL,
        Position     FLOAT            NOT NULL CONSTRAINT DF_DocPages_Position DEFAULT 0,  -- fractional index
        BodyYjs      VARBINARY(MAX)   NULL,    -- live Yjs state
        BodyJson     NVARCHAR(MAX)    NULL,    -- rendered ProseMirror JSON (SSR + search)
        CreatedAt    DATETIME2        NOT NULL CONSTRAINT DF_DocPages_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt    DATETIME2        NOT NULL CONSTRAINT DF_DocPages_UpdatedAt DEFAULT SYSUTCDATETIME(),
        DeletedAt    DATETIME2        NULL
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DocPages_DocTree' AND object_id = OBJECT_ID('dbo.DocPages'))
    CREATE NONCLUSTERED INDEX IX_DocPages_DocTree ON dbo.DocPages (DocId, ParentPageId, Position) WHERE DeletedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DocPageVersions')
BEGIN
    CREATE TABLE dbo.DocPageVersions (
        Id          UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        PageId      UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_DocPageVersions_Page REFERENCES dbo.DocPages(Id) ON DELETE CASCADE,
        Snapshot    NVARCHAR(MAX)    NOT NULL,   -- ProseMirror JSON at checkpoint time
        CreatedById UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_DocPageVersions_Creator REFERENCES dbo.Users(Id),
        CreatedAt   DATETIME2        NOT NULL CONSTRAINT DF_DocPageVersions_CreatedAt DEFAULT SYSUTCDATETIME()
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DocPageVersions_Page' AND object_id = OBJECT_ID('dbo.DocPageVersions'))
    CREATE NONCLUSTERED INDEX IX_DocPageVersions_Page ON dbo.DocPageVersions (PageId, CreatedAt DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DocTaskLinks')
BEGIN
    CREATE TABLE dbo.DocTaskLinks (
        Id        UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        DocPageId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_DocTaskLinks_Page REFERENCES dbo.DocPages(Id) ON DELETE CASCADE,
        TaskId    UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_DocTaskLinks_Task REFERENCES dbo.Tasks(Id) ON DELETE CASCADE,
        Kind      NVARCHAR(20)     NOT NULL CONSTRAINT DF_DocTaskLinks_Kind DEFAULT 'reference',
        CreatedAt DATETIME2        NOT NULL CONSTRAINT DF_DocTaskLinks_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_DocTaskLinks_Kind CHECK (Kind IN ('reference','embed'))
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DocTaskLinks_Page' AND object_id = OBJECT_ID('dbo.DocTaskLinks'))
    CREATE NONCLUSTERED INDEX IX_DocTaskLinks_Page ON dbo.DocTaskLinks (DocPageId);
GO
```

- [ ] Write the rollback `rollback/0040_docs.down.sql` (drop child tables before parents; idempotent; clear the history row — matching the `0032` down style):

```sql
-- =============================================================================
-- Rollback for 0040_docs.sql. Run manually (forward-only runner).
-- Drops the four Docs tables (children first to satisfy FKs), then the
-- MigrationHistory row. Idempotent.
-- =============================================================================

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DocTaskLinks')    DROP TABLE dbo.DocTaskLinks;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DocPageVersions') DROP TABLE dbo.DocPageVersions;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DocPages')        DROP TABLE dbo.DocPages;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Docs')            DROP TABLE dbo.Docs;
GO

DELETE FROM dbo.MigrationHistory WHERE [FileName] = '0040_docs.sql';
GO
```

- [ ] Run against local Docker `ProjectFlow_Test` only (explicit local DB env, never `apps/api/.env`). Apply `0040_docs.sql`, then immediately `0040_docs.down.sql`, then re-apply `0040` to prove idempotency + reversibility. Expected: all three runs succeed; the second `0040` apply is a clean no-op (guards skip everything).

- [ ] Commit:
```
git add infra/sql/migrations/0040_docs.sql infra/sql/migrations/rollback/0040_docs.down.sql
git commit -m "feat(7a): docs migration — Docs/DocPages/DocPageVersions/DocTaskLinks + indexes"
```

---

### Task 3: Doc + scope-resolution SPs

**Files:**
- Create: `infra/sql/procedures/usp_Doc_Create.sql`
- Create: `infra/sql/procedures/usp_Doc_GetById.sql`
- Create: `infra/sql/procedures/usp_Doc_ListByScope.sql`
- Create: `infra/sql/procedures/usp_Doc_SetWiki.sql`
- Create: `infra/sql/procedures/usp_Doc_ResolveScopeNode.sql`
- Test: covered by `docs.integration.test.ts` (Task 9) + `collabAuth`/`persistence` tests; deploy via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`.

Steps:

- [ ] Write `usp_Doc_Create.sql` — create the doc and a first untitled root page atomically; return both result sets (matching the `usp_Comment_Create` SELECT-the-affected-row style):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Doc_Create
    @WorkspaceId UNIQUEIDENTIFIER,
    @ScopeType   NVARCHAR(8),
    @ScopeId     UNIQUEIDENTIFIER,
    @Name        NVARCHAR(255),
    @Icon        NVARCHAR(64)     = NULL,
    @CreatedById UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @DocId UNIQUEIDENTIFIER = NEWID();
    DECLARE @PageId UNIQUEIDENTIFIER = NEWID();

    BEGIN TRY
        BEGIN TRANSACTION;

        INSERT INTO dbo.Docs (Id, WorkspaceId, ScopeType, ScopeId, Name, Icon, CreatedById)
        VALUES (@DocId, @WorkspaceId, @ScopeType, @ScopeId, @Name, @Icon, @CreatedById);

        INSERT INTO dbo.DocPages (Id, DocId, ParentPageId, Title, Position)
        VALUES (@PageId, @DocId, NULL, N'Untitled', 0);

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT Id, WorkspaceId, ScopeType, ScopeId, Name, Icon, IsWiki, VerifiedById, CreatedById, CreatedAt, UpdatedAt
    FROM dbo.Docs WHERE Id = @DocId;

    SELECT Id, DocId, ParentPageId, Title, Icon, Cover, Position, CreatedAt, UpdatedAt
    FROM dbo.DocPages WHERE Id = @PageId;
END;
GO
```

- [ ] Write `usp_Doc_GetById.sql`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Doc_GetById
    @DocId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, WorkspaceId, ScopeType, ScopeId, Name, Icon, IsWiki, VerifiedById, CreatedById, CreatedAt, UpdatedAt
    FROM dbo.Docs
    WHERE Id = @DocId AND DeletedAt IS NULL;
END;
GO
```

- [ ] Write `usp_Doc_ListByScope.sql`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Doc_ListByScope
    @ScopeType NVARCHAR(8),
    @ScopeId   UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, WorkspaceId, ScopeType, ScopeId, Name, Icon, IsWiki, VerifiedById, CreatedById, CreatedAt, UpdatedAt
    FROM dbo.Docs
    WHERE ScopeType = @ScopeType AND ScopeId = @ScopeId AND DeletedAt IS NULL
    ORDER BY Name;
END;
GO
```

- [ ] Write `usp_Doc_SetWiki.sql` — toggle the wiki flag; setting `IsWiki=1` records the verifier, clearing it nulls the verifier:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Doc_SetWiki
    @DocId        UNIQUEIDENTIFIER,
    @IsWiki       BIT,
    @VerifiedById UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.Docs
       SET IsWiki       = @IsWiki,
           VerifiedById = CASE WHEN @IsWiki = 1 THEN @VerifiedById ELSE NULL END,
           UpdatedAt    = SYSUTCDATETIME()
     WHERE Id = @DocId AND DeletedAt IS NULL;

    SELECT Id, WorkspaceId, ScopeType, ScopeId, Name, Icon, IsWiki, VerifiedById, CreatedById, CreatedAt, UpdatedAt
    FROM dbo.Docs WHERE Id = @DocId;
END;
GO
```

- [ ] Write `usp_Doc_ResolveScopeNode.sql` — the **collab-server ACL anchor**: from a page id, return the owning doc's scope node (the SPACE/FOLDER/LIST the existing ACL system understands) + workspace. Returns no rows when the page/doc is missing or deleted (fail-closed):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Doc_ResolveScopeNode
    @DocPageId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT d.ScopeType, d.ScopeId, d.WorkspaceId, d.Id AS DocId
    FROM dbo.DocPages p
    JOIN dbo.Docs     d ON d.Id = p.DocId
    WHERE p.Id = @DocPageId
      AND p.DeletedAt IS NULL
      AND d.DeletedAt IS NULL;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test` (local DB env only). Expected: all five procedures created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_Doc_Create.sql infra/sql/procedures/usp_Doc_GetById.sql infra/sql/procedures/usp_Doc_ListByScope.sql infra/sql/procedures/usp_Doc_SetWiki.sql infra/sql/procedures/usp_Doc_ResolveScopeNode.sql
git commit -m "feat(7a): doc SPs — create(+root page)/get/list-by-scope/set-wiki/resolve-scope-node"
```

---

### Task 4: Page tree + move SPs

**Files:**
- Create: `infra/sql/procedures/usp_DocPage_Create.sql`
- Create: `infra/sql/procedures/usp_DocPage_GetById.sql`
- Create: `infra/sql/procedures/usp_DocPage_ListByDoc.sql`
- Create: `infra/sql/procedures/usp_DocPage_Update.sql`
- Create: `infra/sql/procedures/usp_DocPage_Move.sql`
- Create: `infra/sql/procedures/usp_DocPage_Delete.sql`
- Test: covered by `docs.integration.test.ts` (Task 9); deploy via `scripts/db-deploy-sps.ts`.

Steps:

- [ ] Write `usp_DocPage_Create.sql` — the caller computes the fractional `@Position` (Task 8 helper); the SP just inserts:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_DocPage_Create
    @DocId        UNIQUEIDENTIFIER,
    @ParentPageId UNIQUEIDENTIFIER = NULL,
    @Title        NVARCHAR(255)    = N'Untitled',
    @Icon         NVARCHAR(64)     = NULL,
    @Position     FLOAT            = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Id UNIQUEIDENTIFIER = NEWID();

    INSERT INTO dbo.DocPages (Id, DocId, ParentPageId, Title, Icon, Position)
    VALUES (@Id, @DocId, @ParentPageId, @Title, @Icon, @Position);

    SELECT Id, DocId, ParentPageId, Title, Icon, Cover, Position, CreatedAt, UpdatedAt
    FROM dbo.DocPages WHERE Id = @Id;
END;
GO
```

- [ ] Write `usp_DocPage_GetById.sql` — returns `BodyJson` (SSR first-paint) but NOT the binary `BodyYjs` (that path is the collab loader SP):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_DocPage_GetById
    @PageId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, DocId, ParentPageId, Title, Icon, Cover, Position, BodyJson, CreatedAt, UpdatedAt
    FROM dbo.DocPages
    WHERE Id = @PageId AND DeletedAt IS NULL;
END;
GO
```

- [ ] Write `usp_DocPage_ListByDoc.sql` — flat list the client builds into a tree (lean: no body columns):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_DocPage_ListByDoc
    @DocId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, DocId, ParentPageId, Title, Icon, Position, CreatedAt, UpdatedAt
    FROM dbo.DocPages
    WHERE DocId = @DocId AND DeletedAt IS NULL
    ORDER BY ParentPageId, Position;
END;
GO
```

- [ ] Write `usp_DocPage_Update.sql` — ISNULL-coalesced metadata update (title/icon/cover). Body changes flow through the collab persist SP, not here:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_DocPage_Update
    @PageId UNIQUEIDENTIFIER,
    @Title  NVARCHAR(255)  = NULL,
    @Icon   NVARCHAR(64)   = NULL,
    @Cover  NVARCHAR(1024) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.DocPages
       SET Title     = ISNULL(@Title, Title),
           Icon      = ISNULL(@Icon, Icon),
           Cover     = ISNULL(@Cover, Cover),
           UpdatedAt = SYSUTCDATETIME()
     WHERE Id = @PageId AND DeletedAt IS NULL;

    SELECT Id, DocId, ParentPageId, Title, Icon, Cover, Position, CreatedAt, UpdatedAt
    FROM dbo.DocPages WHERE Id = @PageId;
END;
GO
```

- [ ] Write `usp_DocPage_Move.sql` — reparent + reposition. Reject a move that would make a page its own ancestor (cycle guard) via a recursive descendant CTE; throw `51700` on cycle:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_DocPage_Move
    @PageId       UNIQUEIDENTIFIER,
    @ParentPageId UNIQUEIDENTIFIER = NULL,
    @Position     FLOAT
AS
BEGIN
    SET NOCOUNT ON;

    -- Cycle guard: the new parent must not be the page itself or one of its descendants.
    IF @ParentPageId IS NOT NULL
    BEGIN
        IF @ParentPageId = @PageId
            THROW 51700, 'A page cannot be its own parent', 1;

        ;WITH Descendants AS (
            SELECT Id FROM dbo.DocPages WHERE Id = @PageId
            UNION ALL
            SELECT c.Id FROM dbo.DocPages c JOIN Descendants d ON c.ParentPageId = d.Id
        )
        IF EXISTS (SELECT 1 FROM Descendants WHERE Id = @ParentPageId)
            THROW 51700, 'Cannot move a page under its own descendant', 1;
    END

    UPDATE dbo.DocPages
       SET ParentPageId = @ParentPageId,
           Position     = @Position,
           UpdatedAt    = SYSUTCDATETIME()
     WHERE Id = @PageId AND DeletedAt IS NULL;

    SELECT Id, DocId, ParentPageId, Title, Icon, Cover, Position, CreatedAt, UpdatedAt
    FROM dbo.DocPages WHERE Id = @PageId;
END;
GO
```

- [ ] Write `usp_DocPage_Delete.sql` — soft-delete the page and all descendants in one statement:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_DocPage_Delete
    @PageId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Now DATETIME2 = SYSUTCDATETIME();

    ;WITH Subtree AS (
        SELECT Id FROM dbo.DocPages WHERE Id = @PageId
        UNION ALL
        SELECT c.Id FROM dbo.DocPages c JOIN Subtree s ON c.ParentPageId = s.Id
    )
    UPDATE p SET DeletedAt = @Now, UpdatedAt = @Now
    FROM dbo.DocPages p
    JOIN Subtree s ON s.Id = p.Id
    WHERE p.DeletedAt IS NULL;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`. Expected: all six procedures created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_DocPage_Create.sql infra/sql/procedures/usp_DocPage_GetById.sql infra/sql/procedures/usp_DocPage_ListByDoc.sql infra/sql/procedures/usp_DocPage_Update.sql infra/sql/procedures/usp_DocPage_Move.sql infra/sql/procedures/usp_DocPage_Delete.sql
git commit -m "feat(7a): doc-page SPs — create/get/list/update/move(cycle-guard)/delete(subtree)"
```

---

### Task 5: Yjs persistence + version/restore SPs

**Files:**
- Create: `infra/sql/procedures/usp_DocPage_PersistYjs.sql`
- Create: `infra/sql/procedures/usp_DocPage_LoadYjs.sql`
- Create: `infra/sql/procedures/usp_DocPageVersion_Create.sql`
- Create: `infra/sql/procedures/usp_DocPageVersion_List.sql`
- Create: `infra/sql/procedures/usp_DocPageVersion_GetById.sql`
- Create: `infra/sql/procedures/usp_DocPage_Restore.sql`
- Test: covered by `persistence.integration.test.ts` + `docs.integration.test.ts`; deploy via `scripts/db-deploy-sps.ts`.

Steps:

- [ ] Write `usp_DocPage_PersistYjs.sql` — the debounced `onStoreDocument` write path (binary state + rendered snapshot):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_DocPage_PersistYjs
    @PageId   UNIQUEIDENTIFIER,
    @BodyYjs  VARBINARY(MAX),
    @BodyJson NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.DocPages
       SET BodyYjs   = @BodyYjs,
           BodyJson  = @BodyJson,
           UpdatedAt = SYSUTCDATETIME()
     WHERE Id = @PageId AND DeletedAt IS NULL;
END;
GO
```

- [ ] Write `usp_DocPage_LoadYjs.sql` — the `onLoadDocument` read path (binary only):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_DocPage_LoadYjs
    @PageId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT BodyYjs, BodyJson
    FROM dbo.DocPages
    WHERE Id = @PageId AND DeletedAt IS NULL;
END;
GO
```

- [ ] Write `usp_DocPageVersion_Create.sql` — append a history checkpoint; return the new version's meta:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_DocPageVersion_Create
    @PageId      UNIQUEIDENTIFIER,
    @Snapshot    NVARCHAR(MAX),
    @CreatedById UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Id UNIQUEIDENTIFIER = NEWID();

    INSERT INTO dbo.DocPageVersions (Id, PageId, Snapshot, CreatedById)
    VALUES (@Id, @PageId, @Snapshot, @CreatedById);

    SELECT v.Id, v.PageId, v.CreatedById, u.Name AS CreatedByName, v.CreatedAt
    FROM dbo.DocPageVersions v
    JOIN dbo.Users u ON u.Id = v.CreatedById
    WHERE v.Id = @Id;
END;
GO
```

- [ ] Write `usp_DocPageVersion_List.sql` — list meta only (no `Snapshot` blob):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_DocPageVersion_List
    @PageId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT v.Id, v.PageId, v.CreatedById, u.Name AS CreatedByName, v.CreatedAt
    FROM dbo.DocPageVersions v
    JOIN dbo.Users u ON u.Id = v.CreatedById
    WHERE v.PageId = @PageId
    ORDER BY v.CreatedAt DESC;
END;
GO
```

- [ ] Write `usp_DocPageVersion_GetById.sql` — one version incl. its `Snapshot`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_DocPageVersion_GetById
    @VersionId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, PageId, Snapshot, CreatedById, CreatedAt
    FROM dbo.DocPageVersions
    WHERE Id = @VersionId;
END;
GO
```

- [ ] Write `usp_DocPage_Restore.sql` — checkpoint the current body, then replace `BodyJson` with the version's snapshot and **clear `BodyYjs`** (so the next collab connect re-seeds the CRDT from JSON — this is the deterministic restore path, since rebuilding a valid Yjs binary in SQL is impossible). Returns the page:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_DocPage_Restore
    @PageId      UNIQUEIDENTIFIER,
    @VersionId   UNIQUEIDENTIFIER,
    @CreatedById UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Snapshot NVARCHAR(MAX);
    DECLARE @CurrentJson NVARCHAR(MAX);

    SELECT @Snapshot = Snapshot FROM dbo.DocPageVersions WHERE Id = @VersionId AND PageId = @PageId;
    IF @Snapshot IS NULL
        THROW 51701, 'Version not found for this page', 1;

    BEGIN TRY
        BEGIN TRANSACTION;

        -- Checkpoint the CURRENT body before overwriting (so restore is itself undoable).
        SELECT @CurrentJson = BodyJson FROM dbo.DocPages WHERE Id = @PageId AND DeletedAt IS NULL;
        IF @CurrentJson IS NOT NULL
            INSERT INTO dbo.DocPageVersions (Id, PageId, Snapshot, CreatedById)
            VALUES (NEWID(), @PageId, @CurrentJson, @CreatedById);

        UPDATE dbo.DocPages
           SET BodyJson  = @Snapshot,
               BodyYjs   = NULL,           -- force re-seed from JSON on next collab connect
               UpdatedAt = SYSUTCDATETIME()
         WHERE Id = @PageId AND DeletedAt IS NULL;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT Id, DocId, ParentPageId, Title, Icon, Cover, Position, BodyJson, CreatedAt, UpdatedAt
    FROM dbo.DocPages WHERE Id = @PageId;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`. Expected: all six procedures created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_DocPage_PersistYjs.sql infra/sql/procedures/usp_DocPage_LoadYjs.sql infra/sql/procedures/usp_DocPageVersion_Create.sql infra/sql/procedures/usp_DocPageVersion_List.sql infra/sql/procedures/usp_DocPageVersion_GetById.sql infra/sql/procedures/usp_DocPage_Restore.sql
git commit -m "feat(7a): yjs persist/load + version create/list/get + restore SPs"
```

---

### Task 6: Doc↔task link SPs

**Files:**
- Create: `infra/sql/procedures/usp_DocTaskLink_Create.sql`
- Create: `infra/sql/procedures/usp_DocTaskLink_ListByPage.sql`
- Create: `infra/sql/procedures/usp_DocTaskLink_Delete.sql`
- Test: covered by `docs.integration.test.ts` (Task 9, create-task-from-doc); deploy via `scripts/db-deploy-sps.ts`.

Steps:

- [ ] Write `usp_DocTaskLink_Create.sql`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_DocTaskLink_Create
    @DocPageId UNIQUEIDENTIFIER,
    @TaskId    UNIQUEIDENTIFIER,
    @Kind      NVARCHAR(20) = 'reference'
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Id UNIQUEIDENTIFIER = NEWID();

    INSERT INTO dbo.DocTaskLinks (Id, DocPageId, TaskId, Kind)
    VALUES (@Id, @DocPageId, @TaskId, @Kind);

    SELECT l.Id, l.DocPageId, l.TaskId, l.Kind, l.CreatedAt,
           t.Title AS TaskTitle, t.IssueKey AS TaskIssueKey
    FROM dbo.DocTaskLinks l
    JOIN dbo.Tasks t ON t.Id = l.TaskId
    WHERE l.Id = @Id;
END;
GO
```

- [ ] Write `usp_DocTaskLink_ListByPage.sql`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_DocTaskLink_ListByPage
    @DocPageId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT l.Id, l.DocPageId, l.TaskId, l.Kind, l.CreatedAt,
           t.Title AS TaskTitle, t.IssueKey AS TaskIssueKey
    FROM dbo.DocTaskLinks l
    JOIN dbo.Tasks t ON t.Id = l.TaskId
    WHERE l.DocPageId = @DocPageId
    ORDER BY l.CreatedAt DESC;
END;
GO
```

- [ ] Write `usp_DocTaskLink_Delete.sql`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_DocTaskLink_Delete
    @LinkId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM dbo.DocTaskLinks WHERE Id = @LinkId;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`. Expected: all three procedures created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_DocTaskLink_Create.sql infra/sql/procedures/usp_DocTaskLink_ListByPage.sql infra/sql/procedures/usp_DocTaskLink_Delete.sql
git commit -m "feat(7a): doc-task link SPs — create/list-by-page/delete"
```

---

### Task 7: Shared types

**Files:**
- Modify: `packages/types/index.ts` (append a new "Docs & Wikis (Phase 7a)" block near the other scoped-object blocks)

Steps:

- [ ] Append the Docs types. `DocScopeType` reuses the existing hierarchy node set (docs scope to SPACE/FOLDER/LIST — there is no DOC ACL node):

```ts
// ── Docs & Wikis (Phase 7a) ───────────────────────────────────────────────────

export type DocScopeType = 'SPACE' | 'FOLDER' | 'LIST';
export type DocTaskLinkKind = 'reference' | 'embed';

export interface Doc {
  id:           string;
  workspaceId:  string;
  scopeType:    DocScopeType;
  scopeId:      string;
  name:         string;
  icon:         string | null;
  isWiki:       boolean;
  verifiedById: string | null;
  createdById:  string;
  createdAt:    string;
  updatedAt:    string;
}

export interface DocPage {
  id:           string;
  docId:        string;
  parentPageId: string | null;
  title:        string;
  icon:         string | null;
  cover:        string | null;
  position:     number;
  bodyJson:     string | null;   // rendered ProseMirror JSON (SSR first-paint); omitted from tree lists
  createdAt:    string;
  updatedAt:    string;
}

/** A page-tree node = page metadata (no body) + its children. */
export interface DocPageNode {
  id:           string;
  docId:        string;
  parentPageId: string | null;
  title:        string;
  icon:         string | null;
  position:     number;
  children:     DocPageNode[];
}

export interface DocPageVersionMeta {
  id:            string;
  pageId:        string;
  createdById:   string;
  createdByName: string;
  createdAt:     string;
}

export interface DocPageVersion extends DocPageVersionMeta {
  snapshot: string;   // ProseMirror JSON
}

export interface DocTaskLink {
  id:           string;
  docPageId:    string;
  taskId:       string;
  kind:         DocTaskLinkKind;
  taskTitle:    string;
  taskIssueKey: string;
  createdAt:    string;
}

export interface CreateDocInput {
  workspaceId: string;
  scopeType:   DocScopeType;
  scopeId:     string;
  name:        string;
  icon?:       string;
}

export interface CreateDocPageInput {
  docId:         string;
  parentPageId?: string | null;
  title?:        string;
  icon?:         string;
  /** Optional explicit sibling id to position AFTER; the service computes the fractional Position. */
  afterPageId?:  string | null;
}

export interface UpdateDocPageInput {
  title?: string;
  icon?:  string;
  cover?: string;
}

export interface MoveDocPageInput {
  parentPageId: string | null;
  /** Sibling id to drop AFTER (null = first child); the service computes the fractional Position. */
  afterPageId:  string | null;
}

export interface CreateTaskFromSelectionInput {
  docPageId: string;
  listId:    string;
  title:     string;
  kind?:     DocTaskLinkKind;   // default 'reference'
}
```

- [ ] Run: `npm run build --workspace packages/types` (or the repo's types build/tsc). Expected: PASS (pure type additions).

- [ ] Commit:
```
git add packages/types/index.ts
git commit -m "feat(7a): @projectflow/types — Doc/DocPage(+Node)/DocPageVersion/DocTaskLink + inputs"
```

---

### Task 8: Fractional-index helper + unit test

**Files:**
- Create: `apps/api/src/modules/docs/fractionalIndex.ts`
- Create: `apps/api/src/modules/docs/__tests__/fractionalIndex.unit.test.ts`

Steps:

- [ ] Write the failing unit test first:

```ts
import { describe, it, expect } from 'vitest';
import { positionBetween, FIRST_POSITION } from '../fractionalIndex.js';

describe('positionBetween', () => {
  it('returns the midpoint between two positions', () => {
    expect(positionBetween(0, 2)).toBe(1);
    expect(positionBetween(1, 2)).toBe(1.5);
  });

  it('appends after the last sibling (no upper bound)', () => {
    expect(positionBetween(4, null)).toBe(5);   // last + 1
  });

  it('prepends before the first sibling (no lower bound)', () => {
    expect(positionBetween(null, 2)).toBe(1);    // first / 2
    expect(positionBetween(null, 1)).toBe(0.5);
  });

  it('returns FIRST_POSITION for an empty sibling list', () => {
    expect(positionBetween(null, null)).toBe(FIRST_POSITION);
  });

  it('never returns a value equal to either bound', () => {
    const p = positionBetween(1, 1.0000001);
    expect(p).toBeGreaterThan(1);
    expect(p).toBeLessThan(1.0000001);
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- fractionalIndex`. Expected: FAIL — `Cannot find module '../fractionalIndex.js'`.

- [ ] Write `apps/api/src/modules/docs/fractionalIndex.ts`:

```ts
/** Default position for the first page in an empty list. */
export const FIRST_POSITION = 0;

/**
 * Compute a fractional Position strictly between `before` and `after`.
 *   - both null  → FIRST_POSITION (empty list)
 *   - before null → prepend: half of `after`
 *   - after null  → append: before + 1
 *   - both set    → arithmetic midpoint
 * FLOAT precision is ample for interactive reordering; a periodic renormalize
 * (out of scope here) handles pathological deep nesting.
 */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return FIRST_POSITION;
  if (before === null) return (after as number) / 2;
  if (after === null) return before + 1;
  return (before + after) / 2;
}
```

- [ ] Run: `npm test --workspace apps/api -- fractionalIndex`. Expected: PASS (5 tests).

- [ ] Commit:
```
git add apps/api/src/modules/docs/fractionalIndex.ts apps/api/src/modules/docs/__tests__/fractionalIndex.unit.test.ts
git commit -m "feat(7a): pure fractional-index reorder helper + unit tests"
```

---

### Task 9: Docs repository + service + REST routes + integration test

**Files:**
- Create: `apps/api/src/modules/docs/docs.repository.ts`
- Create: `apps/api/src/modules/docs/docs.service.ts`
- Create: `apps/api/src/modules/docs/docs.routes.ts`
- Modify: `apps/api/src/server.ts` (mount `authMiddleware` + route under `/docs`)
- Create: `apps/api/src/modules/docs/__tests__/docs.integration.test.ts`

Steps:

- [ ] Write the failing integration test first (copy the harness imports from an existing integration test, e.g. the comments suite under `apps/api/src/modules/comments/__tests__/`: `testServer.js`, `truncate.js`, `factories.js`):

```ts
/**
 * Phase 7a — Docs & Wikis integration coverage.
 * Page CRUD + nested move; history restore; create-task-from-doc; wiki flag.
 * DB SAFETY: must target local Docker ProjectFlow_Test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function seedDoc() {
  const owner = await createTestUser({ email: `doc-${Date.now()}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'Doc Space', key: `DC${Date.now() % 100000}` });
  const doc = (await json<{ data: any }>(await request('/docs', {
    method: 'POST', token,
    json: { workspaceId: ws.Id, scopeType: 'SPACE', scopeId: space.Id, name: 'Handbook' },
  }), 201)).data;
  return { token, userId: owner.id, ws, space, doc };
}

describe('docs', () => {
  it('creates a doc with a root page and lists its tree', async () => {
    const { token, doc } = await seedDoc();
    const tree = (await json<{ data: any[] }>(await request(`/docs/${doc.id}/pages`, { token }))).data;
    expect(tree.length).toBe(1);
    expect(tree[0].parentPageId).toBeNull();
  });

  it('creates nested pages and moves one under another', async () => {
    const { token, doc } = await seedDoc();
    const root = (await json<{ data: any[] }>(await request(`/docs/${doc.id}/pages`, { token }))).data[0];
    const a = (await json<{ data: any }>(await request('/docs/pages', { method: 'POST', token, json: { docId: doc.id } }), 201)).data;
    const b = (await json<{ data: any }>(await request('/docs/pages', { method: 'POST', token, json: { docId: doc.id } }), 201)).data;

    const moved = (await json<{ data: any }>(await request(`/docs/pages/${b.id}/move`, {
      method: 'POST', token, json: { parentPageId: a.id, afterPageId: null },
    }))).data;
    expect(moved.parentPageId).toBe(a.id);
  });

  it('rejects moving a page under its own descendant (cycle)', async () => {
    const { token, doc } = await seedDoc();
    const a = (await json<{ data: any }>(await request('/docs/pages', { method: 'POST', token, json: { docId: doc.id } }), 201)).data;
    const child = (await json<{ data: any }>(await request('/docs/pages', { method: 'POST', token, json: { docId: doc.id, parentPageId: a.id } }), 201)).data;
    const res = await request(`/docs/pages/${a.id}/move`, { method: 'POST', token, json: { parentPageId: child.id, afterPageId: null } });
    expect(res.status).toBe(409);
  });

  it('restores a prior version', async () => {
    const { token, doc, userId } = await seedDoc();
    const page = (await json<{ data: any[] }>(await request(`/docs/${doc.id}/pages`, { token }))).data[0];
    // Seed a version snapshot directly via the persist+version path (history checkpoint).
    await request(`/docs/pages/${page.id}/versions`, { method: 'POST', token, json: { snapshot: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'v1' }] }] }) } });
    const versions = (await json<{ data: any[] }>(await request(`/docs/pages/${page.id}/versions`, { token }))).data;
    expect(versions.length).toBeGreaterThanOrEqual(1);

    const restored = (await json<{ data: any }>(await request(`/docs/pages/${page.id}/versions/${versions[0].id}/restore`, { method: 'POST', token, json: {} }))).data;
    expect(restored.bodyJson).toContain('v1');
  });

  it('creates a task from a doc selection and links it', async () => {
    const { token, doc, ws, space } = await seedDoc();
    const page = (await json<{ data: any[] }>(await request(`/docs/${doc.id}/pages`, { token }))).data[0];
    const list = (await json<{ data: any }>(await request('/lists', { method: 'POST', token, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'L', position: 0 } }), 201)).data;
    const link = (await json<{ data: any }>(await request(`/docs/pages/${page.id}/create-task`, {
      method: 'POST', token, json: { listId: list.id, title: 'Follow-up from doc' },
    }), 201)).data;
    expect(link.taskTitle).toBe('Follow-up from doc');

    const links = (await json<{ data: any[] }>(await request(`/docs/pages/${page.id}/links`, { token }))).data;
    expect(links.map((l) => l.id)).toContain(link.id);
  });

  it('marks a doc as wiki and reads the flag back', async () => {
    const { token, doc } = await seedDoc();
    const wiki = (await json<{ data: any }>(await request(`/docs/${doc.id}/wiki`, { method: 'PUT', token, json: { isWiki: true } }))).data;
    expect(wiki.isWiki).toBe(true);
    expect(wiki.verifiedById).not.toBeNull();

    const read = (await json<{ data: any }>(await request(`/docs/${doc.id}`, { token }))).data;
    expect(read.isWiki).toBe(true);
  });
});
```

- [ ] Run: `npm run test:integration --workspace apps/api -- docs`. Expected: FAIL — `/docs` routes 404 (not yet defined).

- [ ] Write `apps/api/src/modules/docs/docs.repository.ts` (mssql types via `sql`, `execSp`/`execSpOne`; map PascalCase rows → camelCase types):

```ts
import sql from 'mssql';
import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';
import type {
  Doc, DocPage, DocPageVersionMeta, DocPageVersion, DocTaskLink, DocScopeType, DocTaskLinkKind,
} from '@projectflow/types';

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

function toDoc(r: any): Doc {
  return {
    id: r.Id, workspaceId: r.WorkspaceId, scopeType: r.ScopeType as DocScopeType, scopeId: r.ScopeId,
    name: r.Name, icon: r.Icon ?? null, isWiki: Boolean(r.IsWiki), verifiedById: r.VerifiedById ?? null,
    createdById: r.CreatedById, createdAt: iso(r.CreatedAt), updatedAt: iso(r.UpdatedAt),
  };
}
function toPage(r: any): DocPage {
  return {
    id: r.Id, docId: r.DocId, parentPageId: r.ParentPageId ?? null, title: r.Title,
    icon: r.Icon ?? null, cover: r.Cover ?? null, position: Number(r.Position),
    bodyJson: r.BodyJson ?? null, createdAt: iso(r.CreatedAt), updatedAt: iso(r.UpdatedAt),
  };
}
function toVersionMeta(r: any): DocPageVersionMeta {
  return { id: r.Id, pageId: r.PageId, createdById: r.CreatedById, createdByName: r.CreatedByName, createdAt: iso(r.CreatedAt) };
}
function toLink(r: any): DocTaskLink {
  return {
    id: r.Id, docPageId: r.DocPageId, taskId: r.TaskId, kind: r.Kind as DocTaskLinkKind,
    taskTitle: r.TaskTitle, taskIssueKey: r.TaskIssueKey, createdAt: iso(r.CreatedAt),
  };
}

export class DocsRepository {
  async createDoc(workspaceId: string, scopeType: DocScopeType, scopeId: string, name: string, icon: string | null, createdById: string): Promise<{ doc: Doc; rootPage: DocPage }> {
    const sets = await execSp<any>('usp_Doc_Create', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'ScopeType',   type: sql.NVarChar(8),      value: scopeType },
      { name: 'ScopeId',     type: sql.UniqueIdentifier, value: scopeId },
      { name: 'Name',        type: sql.NVarChar(255),    value: name },
      { name: 'Icon',        type: sql.NVarChar(64),     value: icon },
      { name: 'CreatedById', type: sql.UniqueIdentifier, value: createdById },
    ]);
    return { doc: toDoc(sets[0][0]), rootPage: toPage(sets[1][0]) };
  }

  async getDoc(docId: string): Promise<Doc | null> {
    const rows = await execSpOne<any>('usp_Doc_GetById', [{ name: 'DocId', type: sql.UniqueIdentifier, value: docId }]);
    return rows[0] ? toDoc(rows[0]) : null;
  }

  async listDocsByScope(scopeType: DocScopeType, scopeId: string): Promise<Doc[]> {
    const rows = await execSpOne<any>('usp_Doc_ListByScope', [
      { name: 'ScopeType', type: sql.NVarChar(8), value: scopeType },
      { name: 'ScopeId',   type: sql.UniqueIdentifier, value: scopeId },
    ]);
    return rows.map(toDoc);
  }

  async setWiki(docId: string, isWiki: boolean, verifiedById: string | null): Promise<Doc | null> {
    const rows = await execSpOne<any>('usp_Doc_SetWiki', [
      { name: 'DocId',        type: sql.UniqueIdentifier, value: docId },
      { name: 'IsWiki',       type: sql.Bit,              value: isWiki },
      { name: 'VerifiedById', type: sql.UniqueIdentifier, value: verifiedById },
    ]);
    return rows[0] ? toDoc(rows[0]) : null;
  }

  /** The collab-server ACL anchor: page → owning doc's scope node + workspace. */
  async resolveScopeNode(docPageId: string): Promise<{ scopeType: DocScopeType; scopeId: string; workspaceId: string; docId: string } | null> {
    const rows = await execSpOne<any>('usp_Doc_ResolveScopeNode', [{ name: 'DocPageId', type: sql.UniqueIdentifier, value: docPageId }]);
    const r = rows[0];
    return r ? { scopeType: r.ScopeType, scopeId: r.ScopeId, workspaceId: r.WorkspaceId, docId: r.DocId } : null;
  }

  async createPage(docId: string, parentPageId: string | null, title: string, icon: string | null, position: number): Promise<DocPage> {
    const rows = await execSpOne<any>('usp_DocPage_Create', [
      { name: 'DocId',        type: sql.UniqueIdentifier, value: docId },
      { name: 'ParentPageId', type: sql.UniqueIdentifier, value: parentPageId },
      { name: 'Title',        type: sql.NVarChar(255),    value: title },
      { name: 'Icon',         type: sql.NVarChar(64),     value: icon },
      { name: 'Position',     type: sql.Float,            value: position },
    ]);
    return toPage(rows[0]);
  }

  async getPage(pageId: string): Promise<DocPage | null> {
    const rows = await execSpOne<any>('usp_DocPage_GetById', [{ name: 'PageId', type: sql.UniqueIdentifier, value: pageId }]);
    return rows[0] ? toPage(rows[0]) : null;
  }

  async listPages(docId: string): Promise<DocPage[]> {
    const rows = await execSpOne<any>('usp_DocPage_ListByDoc', [{ name: 'DocId', type: sql.UniqueIdentifier, value: docId }]);
    return rows.map(toPage);
  }

  async updatePage(pageId: string, patch: { title?: string; icon?: string; cover?: string }): Promise<DocPage | null> {
    const rows = await execSpOne<any>('usp_DocPage_Update', [
      { name: 'PageId', type: sql.UniqueIdentifier, value: pageId },
      { name: 'Title',  type: sql.NVarChar(255),    value: patch.title ?? null },
      { name: 'Icon',   type: sql.NVarChar(64),     value: patch.icon ?? null },
      { name: 'Cover',  type: sql.NVarChar(1024),   value: patch.cover ?? null },
    ]);
    return rows[0] ? toPage(rows[0]) : null;
  }

  async movePage(pageId: string, parentPageId: string | null, position: number): Promise<DocPage | null> {
    const rows = await execSpOne<any>('usp_DocPage_Move', [
      { name: 'PageId',       type: sql.UniqueIdentifier, value: pageId },
      { name: 'ParentPageId', type: sql.UniqueIdentifier, value: parentPageId },
      { name: 'Position',     type: sql.Float,            value: position },
    ]);
    return rows[0] ? toPage(rows[0]) : null;
  }

  async deletePage(pageId: string): Promise<void> {
    await execSpOne('usp_DocPage_Delete', [{ name: 'PageId', type: sql.UniqueIdentifier, value: pageId }]);
  }

  async createVersion(pageId: string, snapshot: string, createdById: string): Promise<DocPageVersionMeta> {
    const rows = await execSpOne<any>('usp_DocPageVersion_Create', [
      { name: 'PageId',      type: sql.UniqueIdentifier, value: pageId },
      { name: 'Snapshot',    type: sql.NVarChar(sql.MAX), value: snapshot },
      { name: 'CreatedById', type: sql.UniqueIdentifier, value: createdById },
    ]);
    return toVersionMeta(rows[0]);
  }

  async listVersions(pageId: string): Promise<DocPageVersionMeta[]> {
    const rows = await execSpOne<any>('usp_DocPageVersion_List', [{ name: 'PageId', type: sql.UniqueIdentifier, value: pageId }]);
    return rows.map(toVersionMeta);
  }

  async restoreVersion(pageId: string, versionId: string, createdById: string): Promise<DocPage | null> {
    const rows = await execSpOne<any>('usp_DocPage_Restore', [
      { name: 'PageId',      type: sql.UniqueIdentifier, value: pageId },
      { name: 'VersionId',   type: sql.UniqueIdentifier, value: versionId },
      { name: 'CreatedById', type: sql.UniqueIdentifier, value: createdById },
    ]);
    return rows[0] ? toPage(rows[0]) : null;
  }

  async createLink(docPageId: string, taskId: string, kind: DocTaskLinkKind): Promise<DocTaskLink> {
    const rows = await execSpOne<any>('usp_DocTaskLink_Create', [
      { name: 'DocPageId', type: sql.UniqueIdentifier, value: docPageId },
      { name: 'TaskId',    type: sql.UniqueIdentifier, value: taskId },
      { name: 'Kind',      type: sql.NVarChar(20),     value: kind },
    ]);
    return toLink(rows[0]);
  }

  async listLinks(docPageId: string): Promise<DocTaskLink[]> {
    const rows = await execSpOne<any>('usp_DocTaskLink_ListByPage', [{ name: 'DocPageId', type: sql.UniqueIdentifier, value: docPageId }]);
    return rows.map(toLink);
  }

  async deleteLink(linkId: string): Promise<void> {
    await execSpOne('usp_DocTaskLink_Delete', [{ name: 'LinkId', type: sql.UniqueIdentifier, value: linkId }]);
  }
}
```

- [ ] Write `apps/api/src/modules/docs/docs.service.ts` — the one shared service (REST + GraphQL delegate here). It owns fractional-position computation (so neither the SP nor the route duplicates it) and create-task-from-selection (reuse the task service):

```ts
import { DocsRepository } from './docs.repository.js';
import { positionBetween, FIRST_POSITION } from './fractionalIndex.js';
import { TaskService } from '../tasks/task.service.js';
import type {
  Doc, DocPage, DocPageVersionMeta, DocTaskLink, DocScopeType, DocTaskLinkKind,
} from '@projectflow/types';

const repo = new DocsRepository();
const taskService = new TaskService();

/** Compute the fractional Position for a new/moved page among its siblings. */
function computePosition(siblings: DocPage[], parentPageId: string | null, afterPageId: string | null): number {
  const peers = siblings
    .filter((p) => (p.parentPageId ?? null) === (parentPageId ?? null))
    .sort((a, b) => a.position - b.position);
  if (peers.length === 0) return FIRST_POSITION;
  if (afterPageId === null) return positionBetween(null, peers[0].position);     // first
  const idx = peers.findIndex((p) => p.id === afterPageId);
  if (idx === -1) return positionBetween(peers[peers.length - 1].position, null); // append fallback
  const before = peers[idx].position;
  const after  = idx + 1 < peers.length ? peers[idx + 1].position : null;
  return positionBetween(before, after);
}

export class DocsService {
  createDoc(workspaceId: string, scopeType: DocScopeType, scopeId: string, name: string, icon: string | null, userId: string) {
    return repo.createDoc(workspaceId, scopeType, scopeId, name, icon, userId);
  }
  getDoc(docId: string): Promise<Doc | null> { return repo.getDoc(docId); }
  listDocsByScope(scopeType: DocScopeType, scopeId: string): Promise<Doc[]> { return repo.listDocsByScope(scopeType, scopeId); }
  setWiki(docId: string, isWiki: boolean, userId: string): Promise<Doc | null> {
    return repo.setWiki(docId, isWiki, isWiki ? userId : null);
  }

  resolveScopeNode(docPageId: string) { return repo.resolveScopeNode(docPageId); }
  getPage(pageId: string): Promise<DocPage | null> { return repo.getPage(pageId); }
  listPages(docId: string): Promise<DocPage[]> { return repo.listPages(docId); }

  async createPage(docId: string, parentPageId: string | null, title: string | undefined, icon: string | undefined, afterPageId: string | null): Promise<DocPage> {
    const siblings = await repo.listPages(docId);
    const position = computePosition(siblings, parentPageId, afterPageId);
    return repo.createPage(docId, parentPageId, title ?? 'Untitled', icon ?? null, position);
  }

  updatePage(pageId: string, patch: { title?: string; icon?: string; cover?: string }): Promise<DocPage | null> {
    return repo.updatePage(pageId, patch);
  }

  async movePage(pageId: string, parentPageId: string | null, afterPageId: string | null): Promise<DocPage | null> {
    const page = await repo.getPage(pageId);
    if (!page) return null;
    const siblings = await repo.listPages(page.docId);
    const position = computePosition(siblings.filter((p) => p.id !== pageId), parentPageId, afterPageId);
    return repo.movePage(pageId, parentPageId, position);
  }

  deletePage(pageId: string): Promise<void> { return repo.deletePage(pageId); }

  createVersion(pageId: string, snapshot: string, userId: string): Promise<DocPageVersionMeta> { return repo.createVersion(pageId, snapshot, userId); }
  listVersions(pageId: string): Promise<DocPageVersionMeta[]> { return repo.listVersions(pageId); }
  restoreVersion(pageId: string, versionId: string, userId: string): Promise<DocPage | null> { return repo.restoreVersion(pageId, versionId, userId); }

  listLinks(docPageId: string): Promise<DocTaskLink[]> { return repo.listLinks(docPageId); }
  deleteLink(linkId: string): Promise<void> { return repo.deleteLink(linkId); }

  /** Create a task in a list from a doc selection, then link it back to the page. */
  async createTaskFromSelection(docPageId: string, listId: string, workspaceId: string, projectId: string, title: string, reporterId: string, kind: DocTaskLinkKind = 'reference'): Promise<DocTaskLink> {
    const task = await taskService.createTask({ title, listId, workspaceId, projectId, reporterId } as any);
    return repo.createLink(docPageId, (task as any).id, kind);
  }
}

export const docsService = new DocsService();
```

> **NOTE for implementer:** confirm `TaskService.createTask`'s real signature/return (read `apps/api/src/modules/tasks/task.service.ts`). The `as any` casts above are placeholders for the exact `CreateTaskInput` shape — replace with the real fields (`projectId`/`workspaceId`/`listId`/`title`/`reporterId`). If the task module exposes a singleton `taskService`, import that instead of `new TaskService()`.

- [ ] Write `apps/api/src/modules/docs/docs.routes.ts` — Hono REST with `@hono/zod-validator`. Workspace/ACL gating mirrors the comments module: doc reads gate on `requireObjectLevel(scopeNode, VIEW)`-equivalent via the existing `requirePermission` + scope resolution; writes gate on the doc's scope node. Use `requirePermission` with a `resolveWorkspace` that derives the workspace from the doc/page (the existing RBAC path), and validate scope EDIT in the service-adjacent resolver. Static segments (`/pages`, `/:docId/pages`) are ordered before `/:docId`:

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { docsService } from './docs.service.js';
import { DocsRepository } from './docs.repository.js';
import { ProjectRepository } from '../projects/project.repository.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';

export const docRoutes = new Hono();
const docRepoForLookup     = new DocsRepository();
const projectRepoForLookup = new ProjectRepository();

// Workspace resolver from a doc id (RBAC anchor for /:docId routes).
const resolveDocWorkspace = async (c: any): Promise<string | null> => {
  const doc = await docRepoForLookup.getDoc(c.req.param('docId'));
  return doc?.workspaceId ?? null;
};
// Workspace resolver from a page id (RBAC anchor for /pages/:id routes).
const resolvePageWorkspace = async (c: any): Promise<string | null> => {
  const node = await docRepoForLookup.resolveScopeNode(c.req.param('id'));
  return node?.workspaceId ?? null;
};
// Workspace resolver from create-doc body (scope's space → workspace).
async function resolveScopeWorkspaceFromBody(c: any): Promise<string | null> {
  try {
    const body = await c.req.json();
    if (!body?.scopeId) return null;
    // For SPACE scope, the scopeId IS the space; resolve its workspace.
    return await projectRepoForLookup.getWorkspaceId(body.scopeId);
  } catch { return null; }
}
// Workspace resolver from create-page body (docId → workspace).
async function resolveDocWorkspaceFromBody(c: any): Promise<string | null> {
  try {
    const body = await c.req.json();
    if (!body?.docId) return null;
    return (await docRepoForLookup.getDoc(body.docId))?.workspaceId ?? null;
  } catch { return null; }
}

const createDocSchema = z.object({
  workspaceId: z.string().uuid(),
  scopeType:   z.enum(['SPACE', 'FOLDER', 'LIST']),
  scopeId:     z.string().uuid(),
  name:        z.string().min(1).max(255),
  icon:        z.string().max(64).optional(),
});
const createPageSchema = z.object({
  docId:        z.string().uuid(),
  parentPageId: z.string().uuid().nullish(),
  title:        z.string().max(255).optional(),
  icon:         z.string().max(64).optional(),
  afterPageId:  z.string().uuid().nullish(),
});
const updatePageSchema = z.object({
  title: z.string().max(255).optional(),
  icon:  z.string().max(64).optional(),
  cover: z.string().max(1024).optional(),
});
const movePageSchema = z.object({
  parentPageId: z.string().uuid().nullable(),
  afterPageId:  z.string().uuid().nullable(),
});
const versionSchema     = z.object({ snapshot: z.string().min(2) });
const createTaskSchema  = z.object({ listId: z.string().uuid(), title: z.string().min(1).max(500), kind: z.enum(['reference', 'embed']).optional() });
const linkSchema        = z.object({ taskId: z.string().uuid(), kind: z.enum(['reference', 'embed']).optional() });
const wikiSchema        = z.object({ isWiki: z.boolean() });

// ── Doc CRUD ─────────────────────────────────────────────────────────────────
docRoutes.post('/', requirePermission('doc.create', { resolveWorkspace: resolveScopeWorkspaceFromBody }), zValidator('json', createDocSchema), async (c) => {
  const user = (c as any).get('user');
  const b = c.req.valid('json');
  const { doc, rootPage } = await docsService.createDoc(b.workspaceId, b.scopeType, b.scopeId, b.name, b.icon ?? null, user.userId);
  return c.json({ data: { ...doc, rootPage } }, 201);
});

docRoutes.get('/', async (c) => {
  const scopeType = c.req.query('scopeType');
  const scopeId   = c.req.query('scopeId');
  if (!scopeType || !scopeId) return c.json({ error: { message: 'scopeType and scopeId are required' } }, 400);
  const docs = await docsService.listDocsByScope(scopeType as any, scopeId);
  return c.json({ data: docs });
});

// ── Page tree (static /pages segments BEFORE /:docId) ────────────────────────
docRoutes.post('/pages', requirePermission('doc.update', { resolveWorkspace: resolveDocWorkspaceFromBody }), zValidator('json', createPageSchema), async (c) => {
  const b = c.req.valid('json');
  const page = await docsService.createPage(b.docId, b.parentPageId ?? null, b.title, b.icon, b.afterPageId ?? null);
  return c.json({ data: page }, 201);
});

docRoutes.patch('/pages/:id', requirePermission('doc.update', { resolveWorkspace: resolvePageWorkspace }), zValidator('json', updatePageSchema), async (c) => {
  const page = await docsService.updatePage(c.req.param('id'), c.req.valid('json'));
  if (!page) return c.json({ error: { message: 'Page not found' } }, 404);
  return c.json({ data: page });
});

docRoutes.post('/pages/:id/move', requirePermission('doc.update', { resolveWorkspace: resolvePageWorkspace }), zValidator('json', movePageSchema), async (c) => {
  const b = c.req.valid('json');
  try {
    const page = await docsService.movePage(c.req.param('id'), b.parentPageId, b.afterPageId);
    if (!page) return c.json({ error: { message: 'Page not found' } }, 404);
    return c.json({ data: page });
  } catch (err: any) {
    if (err?.number === 51700 || String(err?.message).includes('51700')) return c.json({ error: { code: 'CYCLE', message: 'Cannot move a page under its own descendant' } }, 409);
    throw err;
  }
});

docRoutes.delete('/pages/:id', requirePermission('doc.update', { resolveWorkspace: resolvePageWorkspace }), async (c) => {
  await docsService.deletePage(c.req.param('id'));
  return c.body(null, 204);
});

// ── History ──────────────────────────────────────────────────────────────────
docRoutes.get('/pages/:id/versions', requirePermission('doc.read', { resolveWorkspace: resolvePageWorkspace }), async (c) => {
  return c.json({ data: await docsService.listVersions(c.req.param('id')) });
});
docRoutes.post('/pages/:id/versions', requirePermission('doc.update', { resolveWorkspace: resolvePageWorkspace }), zValidator('json', versionSchema), async (c) => {
  const user = (c as any).get('user');
  const v = await docsService.createVersion(c.req.param('id'), c.req.valid('json').snapshot, user.userId);
  return c.json({ data: v }, 201);
});
docRoutes.post('/pages/:id/versions/:vid/restore', requirePermission('doc.update', { resolveWorkspace: resolvePageWorkspace }), async (c) => {
  const user = (c as any).get('user');
  try {
    const page = await docsService.restoreVersion(c.req.param('id'), c.req.param('vid'), user.userId);
    if (!page) return c.json({ error: { message: 'Version or page not found' } }, 404);
    return c.json({ data: page });
  } catch (err: any) {
    if (err?.number === 51701 || String(err?.message).includes('51701')) return c.json({ error: { message: 'Version not found for this page' } }, 404);
    throw err;
  }
});

// ── Doc<->task links + create-task-from-selection ────────────────────────────
docRoutes.get('/pages/:id/links', requirePermission('doc.read', { resolveWorkspace: resolvePageWorkspace }), async (c) => {
  return c.json({ data: await docsService.listLinks(c.req.param('id')) });
});
docRoutes.post('/pages/:id/links', requirePermission('doc.update', { resolveWorkspace: resolvePageWorkspace }), zValidator('json', linkSchema), async (c) => {
  const b = c.req.valid('json');
  const link = await (docsService as any)['repoCreateLink']?.(c.req.param('id'), b.taskId, b.kind ?? 'reference')
    ?? (await import('./docs.repository.js')).DocsRepository.prototype; // see NOTE below
  return c.json({ data: link }, 201);
});
docRoutes.post('/pages/:id/create-task', requirePermission('doc.update', { resolveWorkspace: resolvePageWorkspace }), zValidator('json', createTaskSchema), async (c) => {
  const user = (c as any).get('user');
  const b = c.req.valid('json');
  const node = await docRepoForLookup.resolveScopeNode(c.req.param('id'));
  if (!node) return c.json({ error: { message: 'Page not found' } }, 404);
  // For non-SPACE scope, resolve the owning space (projectId) from the list later; here SPACE scopeId == projectId.
  const projectId = node.scopeType === 'SPACE' ? node.scopeId : node.scopeId; // service derives precise projectId from the target list
  const link = await docsService.createTaskFromSelection(c.req.param('id'), b.listId, node.workspaceId, projectId, b.title, user.userId, b.kind ?? 'reference');
  return c.json({ data: link }, 201);
});

// ── Wiki flag ────────────────────────────────────────────────────────────────
docRoutes.put('/:docId/wiki', requirePermission('doc.update', { resolveWorkspace: resolveDocWorkspace }), zValidator('json', wikiSchema), async (c) => {
  const user = (c as any).get('user');
  const doc = await docsService.setWiki(c.req.param('docId'), c.req.valid('json').isWiki, user.userId);
  if (!doc) return c.json({ error: { message: 'Doc not found' } }, 404);
  return c.json({ data: doc });
});

// ── Doc read + page tree (dynamic /:docId LAST) ──────────────────────────────
docRoutes.get('/:docId/pages', requirePermission('doc.read', { resolveWorkspace: resolveDocWorkspace }), async (c) => {
  return c.json({ data: await docsService.listPages(c.req.param('docId')) });
});
docRoutes.get('/:docId', requirePermission('doc.read', { resolveWorkspace: resolveDocWorkspace }), async (c) => {
  const doc = await docsService.getDoc(c.req.param('docId'));
  if (!doc) return c.json({ error: { message: 'Doc not found' } }, 404);
  return c.json({ data: doc });
});
```

> **NOTE for implementer (links handler):** the `POST /pages/:id/links` body above is intentionally written so you replace the placeholder line with a real `docsService.createLink(...)` call — add a thin `createLink(docPageId, taskId, kind)` passthrough to `DocsService` that calls `repo.createLink`, exactly like the other service methods. Do **not** ship the `import(...).prototype` placeholder. Also add `doc.create`/`doc.read`/`doc.update` permission slugs — see the next step.

- [ ] Add the `doc.create` / `doc.read` / `doc.update` RBAC slugs. Locate how existing slugs are seeded (grep the procedures/migrations for an existing slug like `'comment.create'`, e.g. a `Permissions`/role-seed migration or `usp_*Permission*` seed). Add `doc.create`, `doc.read`, `doc.update` to the same seed surface and grant them to the default roles that hold `comment.*`/`task.*`. If slugs are seeded in a migration, add them in `0040_docs.sql` (or a tiny follow-on `0040b` seed) and re-run the apply→rollback→re-apply check; if they're code-defined, add them there. Verify a workspace member can hit `/docs` reads/writes and a non-member is 403.

- [ ] Mount the routes in `server.ts`: add `import { docRoutes } from './modules/docs/docs.routes.js';`, `app.use('/docs/*', authMiddleware);` alongside the other protected-route registrations, and `app.route('/docs', docRoutes);` alongside the other `app.route(...)` calls. (Optionally add `app.use('/docs/*', auditMiddleware);` to mirror comments.)

- [ ] Run: `npm run test:integration --workspace apps/api -- docs` against `ProjectFlow_Test`. Expected: PASS (6 tests). Then `npm test --workspace apps/api -- fractionalIndex` still PASS.

- [ ] Commit:
```
git add apps/api/src/modules/docs/docs.repository.ts apps/api/src/modules/docs/docs.service.ts apps/api/src/modules/docs/docs.routes.ts apps/api/src/server.ts apps/api/src/modules/docs/__tests__/docs.integration.test.ts
git commit -m "feat(7a): docs repo/service/REST — doc+page CRUD, move, history, links, create-task, wiki + integration"
```

---

### Task 10: Collab server — persistence helpers, auth, Hocuspocus config + tests

**Files:**
- Create: `apps/api/src/modules/collab/yjsPersistence.ts`
- Create: `apps/api/src/modules/collab/collab.repository.ts`
- Create: `apps/api/src/modules/collab/collab.auth.ts`
- Create: `apps/api/src/modules/collab/collab.server.ts`
- Modify: `apps/api/src/server.ts` (attach the WS upgrade after `serve(...)`, non-test only)
- Create: `apps/api/src/modules/collab/__tests__/yjsPersistence.unit.test.ts`
- Create: `apps/api/src/modules/collab/__tests__/collabAuth.unit.test.ts`
- Create: `apps/api/src/modules/collab/__tests__/persistence.integration.test.ts`

Steps:

- [ ] Write the failing persistence unit test first:

```ts
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { docNameToTarget, renderSnapshot, seedYDoc } from '../yjsPersistence.js';

describe('docNameToTarget', () => {
  it('parses a doc-page name', () => {
    expect(docNameToTarget('doc-page:abc-123')).toEqual({ kind: 'doc-page', id: 'abc-123' });
  });
  it('parses a whiteboard name (reserved for 7b — server is generic)', () => {
    expect(docNameToTarget('whiteboard:xyz')).toEqual({ kind: 'whiteboard', id: 'xyz' });
  });
  it('returns null for an unknown/garbage name', () => {
    expect(docNameToTarget('garbage')).toBeNull();
    expect(docNameToTarget('other:1')).toBeNull();
  });
});

describe('seed + render round-trip', () => {
  it('renders a ProseMirror-JSON snapshot from a Yjs doc and re-seeds it identically', () => {
    const a = new Y.Doc();
    // Minimal: write a fragment via the prosemirror xml fragment shape.
    const frag = a.getXmlFragment('prosemirror');
    const el = new Y.XmlElement('paragraph');
    el.insert(0, [new Y.XmlText('hello')]);
    frag.insert(0, [el]);

    const json = renderSnapshot(a);
    expect(json).toContain('hello');

    const bytes = Y.encodeStateAsUpdate(a);
    const b = new Y.Doc();
    seedYDoc(b, Buffer.from(bytes));
    expect(renderSnapshot(b)).toBe(json);
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- yjsPersistence`. Expected: FAIL — module not found.

- [ ] Write `apps/api/src/modules/collab/yjsPersistence.ts`:

```ts
import * as Y from 'yjs';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';

export type CollabKind = 'doc-page' | 'whiteboard';
export interface CollabTarget { kind: CollabKind; id: string; }

/** Decode the Hocuspocus document name `<kind>:<id>`. Generic so 7b reuses it. */
export function docNameToTarget(documentName: string): CollabTarget | null {
  const idx = documentName.indexOf(':');
  if (idx <= 0) return null;
  const kind = documentName.slice(0, idx);
  const id = documentName.slice(idx + 1);
  if ((kind !== 'doc-page' && kind !== 'whiteboard') || !id) return null;
  return { kind, id };
}

/** Render the canonical ProseMirror-JSON snapshot from a Yjs doc's
 *  'prosemirror' XML fragment. Powers SSR first-paint + search indexing. */
export function renderSnapshot(ydoc: Y.Doc): string {
  const fragment = ydoc.getXmlFragment('prosemirror');
  return JSON.stringify(yXmlFragmentToProsemirrorJSON(fragment));
}

/** Apply persisted binary state onto a fresh Yjs doc (onLoadDocument). */
export function seedYDoc(ydoc: Y.Doc, bytes: Buffer): void {
  if (bytes && bytes.length > 0) Y.applyUpdate(ydoc, new Uint8Array(bytes));
}
```

> **NOTE for implementer:** confirm the exact `y-prosemirror` export — depending on the resolved version it is `yXmlFragmentToProsemirrorJSON` (fragment) or `yDocToProsemirrorJSON(ydoc, 'prosemirror')` (whole-doc). Read `apps/api/node_modules/y-prosemirror/` after Task 1 and use whichever the installed version exports; keep the function name `renderSnapshot` stable.

- [ ] Run: `npm test --workspace apps/api -- yjsPersistence`. Expected: PASS (5 tests).

- [ ] Write `apps/api/src/modules/collab/collab.repository.ts`:

```ts
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { DocScopeType } from '@projectflow/types';

export class CollabRepository {
  async resolveScopeNode(docPageId: string): Promise<{ scopeType: DocScopeType; scopeId: string; workspaceId: string } | null> {
    const rows = await execSpOne<any>('usp_Doc_ResolveScopeNode', [
      { name: 'DocPageId', type: sql.UniqueIdentifier, value: docPageId },
    ]);
    const r = rows[0];
    return r ? { scopeType: r.ScopeType, scopeId: r.ScopeId, workspaceId: r.WorkspaceId } : null;
  }

  async loadYjs(pageId: string): Promise<Buffer | null> {
    const rows = await execSpOne<{ BodyYjs: Buffer | null }>('usp_DocPage_LoadYjs', [
      { name: 'PageId', type: sql.UniqueIdentifier, value: pageId },
    ]);
    return rows[0]?.BodyYjs ?? null;
  }

  async persistYjs(pageId: string, bodyYjs: Buffer, bodyJson: string): Promise<void> {
    await execSpOne('usp_DocPage_PersistYjs', [
      { name: 'PageId',   type: sql.UniqueIdentifier,  value: pageId },
      { name: 'BodyYjs',  type: sql.VarBinary(sql.MAX), value: bodyYjs },
      { name: 'BodyJson', type: sql.NVarChar(sql.MAX),  value: bodyJson },
    ]);
  }
}
```

- [ ] Write the failing `collabAuth.unit.test.ts` (mocks the repo + access service so it's a pure auth-logic test):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../../../shared/lib/jwtSecret.js';

const resolveScopeNode = vi.fn();
const can = vi.fn();
vi.mock('../collab.repository.js', () => ({ CollabRepository: class { resolveScopeNode = resolveScopeNode; } }));
vi.mock('../../access/access.service.js', () => ({ accessService: { can } }));

const { authenticateCollab } = await import('../collab.auth.js');

const sign = (uid: string) => jwt.sign({ userId: uid, email: 'u@x.test' }, JWT_SECRET);

beforeEach(() => { resolveScopeNode.mockReset(); can.mockReset(); });

describe('authenticateCollab', () => {
  it('rejects a malformed document name', async () => {
    await expect(authenticateCollab(sign('u1'), 'garbage')).rejects.toThrow();
  });
  it('rejects an invalid JWT', async () => {
    await expect(authenticateCollab('not-a-jwt', 'doc-page:p1')).rejects.toThrow();
  });
  it('rejects when the page/scope cannot be resolved (404 fail-closed)', async () => {
    resolveScopeNode.mockResolvedValue(null);
    await expect(authenticateCollab(sign('u1'), 'doc-page:p1')).rejects.toThrow();
  });
  it('rejects when the user lacks EDIT on the scope node', async () => {
    resolveScopeNode.mockResolvedValue({ scopeType: 'SPACE', scopeId: 's1', workspaceId: 'w1' });
    can.mockResolvedValue(false);
    await expect(authenticateCollab(sign('u1'), 'doc-page:p1')).rejects.toThrow();
  });
  it('returns the user + level on success', async () => {
    resolveScopeNode.mockResolvedValue({ scopeType: 'SPACE', scopeId: 's1', workspaceId: 'w1' });
    can.mockResolvedValue(true);
    const ctx = await authenticateCollab(sign('u9'), 'doc-page:p1');
    expect(ctx.userId).toBe('u9');
    expect(can).toHaveBeenCalledWith('u9', 'SPACE', 's1', 'EDIT');
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- collabAuth`. Expected: FAIL — module not found.

- [ ] Write `apps/api/src/modules/collab/collab.auth.ts` (real JWT + real ACL; whiteboard targets are accepted at the name level for 7b but throw "unsupported in 7a" until 7b wires their scope resolution):

```ts
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../../shared/lib/jwtSecret.js';
import { accessService } from '../access/access.service.js';
import { CollabRepository } from './collab.repository.js';
import { docNameToTarget } from './yjsPersistence.js';

const repo = new CollabRepository();

export interface CollabAuthContext {
  userId: string;
  pageId: string;
  workspaceId: string;
}

/**
 * Fail-closed collab auth. Verifies the JWT, decodes the document name,
 * resolves the doc-page's owning hierarchy node, and requires EDIT on it.
 * Throws on any failure (Hocuspocus rejects the connection).
 */
export async function authenticateCollab(token: string, documentName: string): Promise<CollabAuthContext> {
  const target = docNameToTarget(documentName);
  if (!target) throw new Error('Invalid collaboration document name');
  if (target.kind !== 'doc-page') throw new Error(`Unsupported collab kind in 7a: ${target.kind}`);

  let userId: string;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    userId = payload.userId;
  } catch {
    throw new Error('Invalid or expired token');
  }
  if (!userId) throw new Error('Token missing userId');

  const node = await repo.resolveScopeNode(target.id);
  if (!node) throw new Error('Document not found');           // 404 fail-closed

  const allowed = await accessService.can(userId, node.scopeType, node.scopeId, 'EDIT');
  if (!allowed) throw new Error('Forbidden');

  return { userId, pageId: target.id, workspaceId: node.workspaceId };
}
```

- [ ] Run: `npm test --workspace apps/api -- collabAuth`. Expected: PASS (5 tests).

- [ ] Write `apps/api/src/modules/collab/collab.server.ts` — the Hocuspocus config. `onAuthenticate` uses `authenticateCollab`; `onLoadDocument` seeds from `BodyYjs`; `onStoreDocument` (debounced by Hocuspocus's `debounce` option) writes binary + snapshot; awareness is built in; the Redis extension fans out across instances:

```ts
import { Server } from '@hocuspocus/server';
import { Redis } from '@hocuspocus/extension-redis';
import * as Y from 'yjs';
import type { Server as HttpServer } from 'node:http';
import { authenticateCollab, type CollabAuthContext } from './collab.auth.js';
import { CollabRepository } from './collab.repository.js';
import { renderSnapshot, seedYDoc, docNameToTarget } from './yjsPersistence.js';
import { getRedisConnectionOptions } from '../../shared/lib/redis.js';
import { subLogger } from '../../shared/lib/logger.js';

const log = subLogger('collab');
const repo = new CollabRepository();

/** Build the Hocuspocus server. Generic over `<kind>:<id>` so 7b reuses it. */
export function buildCollabServer(): Server {
  const extensions = [] as any[];
  // Multi-instance fan-out over the existing Redis (no-op single-instance dev still fine).
  try {
    const conn = getRedisConnectionOptions?.();
    if (conn) extensions.push(new Redis(conn));
  } catch { /* Redis optional in dev */ }

  return Server.configure({
    name: 'projectflow-collab',
    extensions,
    // 2s debounce: coalesce a burst of keystrokes into one DB write.
    debounce: 2000,
    maxDebounce: 10000,

    async onAuthenticate(data): Promise<{ user: CollabAuthContext }> {
      const ctx = await authenticateCollab(data.token, data.documentName);
      // Returned context is attached to the connection; available in store/load hooks.
      return { user: ctx };
    },

    async onLoadDocument(data): Promise<Y.Doc> {
      const target = docNameToTarget(data.documentName);
      if (!target) throw new Error('Invalid document name');
      const bytes = await repo.loadYjs(target.id);
      if (bytes) seedYDoc(data.document, bytes);
      return data.document;
    },

    async onStoreDocument(data): Promise<void> {
      const target = docNameToTarget(data.documentName);
      if (!target) return;
      const bodyYjs = Buffer.from(Y.encodeStateAsUpdate(data.document));
      const bodyJson = renderSnapshot(data.document);
      await repo.persistYjs(target.id, bodyYjs, bodyJson);
      log.info({ pageId: target.id, bytes: bodyYjs.length }, 'persisted collab doc');
    },
  });
}

let serverInstance: Server | null = null;

/** Attach the Hocuspocus WS upgrade to the existing Node HTTP server (dev/in-process).
 *  In prod this same builder can run as a standalone bootstrapped process. */
export function attachCollabUpgrade(httpServer: HttpServer): void {
  serverInstance = buildCollabServer();
  httpServer.on('upgrade', (request, socket, head) => {
    // Only handle our collab path; let other upgrades (if any) pass.
    if (!request.url || !request.url.startsWith('/collab')) return;
    serverInstance!.handleConnection(socket, request, head as any);
  });
  log.info('collab WS upgrade attached at /collab');
}

export function getCollabServer(): Server | null { return serverInstance; }
```

> **NOTE for implementer:** the exact Hocuspocus hook signatures (`onAuthenticate({ token, documentName })`, `onStoreDocument({ document, documentName, context })`, and how the auth result is surfaced as `context`) depend on the installed `@hocuspocus/server` major — read `apps/api/node_modules/@hocuspocus/server/dist/` (types) after Task 1 and adapt. Likewise `handleConnection(socket, request, head)` vs the newer `webSocket`/`handleUpgrade` API. Also confirm `getRedisConnectionOptions` exists in `shared/lib/redis.ts`; if only `getRedis()` is exported, derive the connection options from `process.env.REDIS_URL`/`REDIS_HOST` (the same vars `server.ts` checks) and pass those to `new Redis(...)`, or drop the extension in single-instance dev. Keep `buildCollabServer()` pure of side effects so it's unit-mountable.

- [ ] Write the persistence integration test (drives the real store path against `ProjectFlow_Test`):

```ts
/**
 * Phase 7a — collab persistence integration.
 * Exercises onStoreDocument's write path: a Yjs doc → BodyYjs + BodyJson in DocPages.
 * DB SAFETY: must target local Docker ProjectFlow_Test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { CollabRepository } from '../collab.repository.js';
import { renderSnapshot } from '../yjsPersistence.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

describe('collab persistence', () => {
  it('persists Yjs binary + JSON snapshot and loads it back', async () => {
    const owner = await createTestUser({ email: `collab-${Date.now()}@projectflow.test` });
    const token = owner.accessToken;
    const ws = await createTestWorkspace(token);
    const space = await createTestProject(ws.Id, token, { name: 'C', key: `CB${Date.now() % 100000}` });
    const doc = (await json<{ data: any }>(await request('/docs', { method: 'POST', token, json: { workspaceId: ws.Id, scopeType: 'SPACE', scopeId: space.Id, name: 'D' } }), 201)).data;
    const page = (await json<{ data: any[] }>(await request(`/docs/${doc.id}/pages`, { token }))).data[0];

    const ydoc = new Y.Doc();
    const frag = ydoc.getXmlFragment('prosemirror');
    const el = new Y.XmlElement('paragraph');
    el.insert(0, [new Y.XmlText('persisted body')]);
    frag.insert(0, [el]);

    const repo = new CollabRepository();
    await repo.persistYjs(page.id, Buffer.from(Y.encodeStateAsUpdate(ydoc)), renderSnapshot(ydoc));

    const loaded = await repo.loadYjs(page.id);
    expect(loaded).not.toBeNull();
    expect((loaded as Buffer).length).toBeGreaterThan(0);

    // SSR first-paint reads BodyJson via the page GET.
    const fetched = (await json<{ data: any }>(await request(`/docs/${doc.id}/pages`, { token }))).data;
    expect(fetched.length).toBe(1);
  });
});
```

- [ ] Wire the upgrade into `server.ts` — capture the server returned by `serve(...)` and attach the collab upgrade (non-test only, after the listener starts):

```ts
import { attachCollabUpgrade } from './modules/collab/collab.server.js';
// ...
const server = serve({ fetch: app.fetch, port });
// Attach the Yjs collab WebSocket upgrade to the same HTTP server (dev/in-process).
// In prod this can instead run as a separate bootstrapped process.
attachCollabUpgrade(server as unknown as import('node:http').Server);
```

> **NOTE for implementer:** `@hono/node-server`'s `serve()` returns the underlying Node `http.Server` (its `ServerType`). Confirm the exact return type and that `.on('upgrade', ...)` is available; if `serve()` returns a wrapper, reach the raw server via the documented accessor. Do **not** attach the upgrade under `NODE_ENV=test` (the integration suite imports `app` without binding a port).

- [ ] Run: `npm test --workspace apps/api -- yjsPersistence collabAuth` (unit, no DB). Expected: PASS. Then `npm run test:integration --workspace apps/api -- persistence` against `ProjectFlow_Test`. Expected: PASS. Then `npm run build --workspace apps/api`. Expected: PASS.

- [ ] Commit:
```
git add apps/api/src/modules/collab/ apps/api/src/server.ts
git commit -m "feat(7a): Hocuspocus collab server — JWT+ACL auth, debounced Yjs persist+snapshot, Redis ext, WS upgrade + tests"
```

---

### Task 11: GraphQL mirror (`docs.schema.ts`)

**Files:**
- Create: `apps/api/src/graphql/docs.schema.ts`
- Modify: `apps/api/src/graphql/schema.ts` (import + call `registerDocsGraphql()` near the other `register*Graphql()` calls, ~line 774)

Steps:

- [ ] Write `docs.schema.ts`, mirroring `views.schema.ts`'s structure (typed `objectRef`, `requireObjectLevel`/`requireWorkspacePermission`/`notFound` from `./authz.js`, delegating to the one shared `docsService`). Doc ACL rides the scope node:

```ts
import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { docsService } from '../modules/docs/docs.service.js';
import { requireObjectLevel, requireWorkspacePermission, notFound } from './authz.js';
import type { GQLContext } from './context.js';
import type { Doc, DocPage, DocPageVersionMeta, DocTaskLink, DocScopeType } from '@projectflow/types';

function requireUser(ctx: GQLContext): string {
  if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
  return ctx.user.userId;
}

/** Gate a doc op on its scope node (the ACL system knows SPACE/FOLDER/LIST). */
async function requireDocLevel(ctx: GQLContext, docId: string, min: 'VIEW' | 'EDIT'): Promise<Doc> {
  const doc = await docsService.getDoc(docId);
  if (!doc) notFound('Doc not found');
  await requireObjectLevel(ctx, doc.scopeType as any, doc.scopeId, min);
  return doc;
}
async function requirePageLevel(ctx: GQLContext, pageId: string, min: 'VIEW' | 'EDIT'): Promise<DocPage> {
  const node = await docsService.resolveScopeNode(pageId);
  if (!node) notFound('Page not found');
  await requireObjectLevel(ctx, node.scopeType as any, node.scopeId, min);
  const page = await docsService.getPage(pageId);
  if (!page) notFound('Page not found');
  return page;
}

export function registerDocsGraphql(): void {
  const DocType = builder.objectRef<Doc>('Doc');
  DocType.implement({ fields: (t) => ({
    id:           t.exposeString('id'),
    workspaceId:  t.exposeString('workspaceId'),
    scopeType:    t.exposeString('scopeType'),
    scopeId:      t.exposeString('scopeId'),
    name:         t.exposeString('name'),
    icon:         t.string({ nullable: true, resolve: (d) => d.icon }),
    isWiki:       t.exposeBoolean('isWiki'),
    verifiedById: t.string({ nullable: true, resolve: (d) => d.verifiedById }),
    createdById:  t.exposeString('createdById'),
  }) });

  const DocPageType = builder.objectRef<DocPage>('DocPage');
  DocPageType.implement({ fields: (t) => ({
    id:           t.exposeString('id'),
    docId:        t.exposeString('docId'),
    parentPageId: t.string({ nullable: true, resolve: (p) => p.parentPageId }),
    title:        t.exposeString('title'),
    icon:         t.string({ nullable: true, resolve: (p) => p.icon }),
    position:     t.exposeFloat('position'),
    bodyJson:     t.string({ nullable: true, resolve: (p) => p.bodyJson }),
  }) });

  const DocVersionType = builder.objectRef<DocPageVersionMeta>('DocPageVersion');
  DocVersionType.implement({ fields: (t) => ({
    id:            t.exposeString('id'),
    pageId:        t.exposeString('pageId'),
    createdById:   t.exposeString('createdById'),
    createdByName: t.exposeString('createdByName'),
  }) });

  const DocLinkType = builder.objectRef<DocTaskLink>('DocTaskLink');
  DocLinkType.implement({ fields: (t) => ({
    id:           t.exposeString('id'),
    docPageId:    t.exposeString('docPageId'),
    taskId:       t.exposeString('taskId'),
    kind:         t.exposeString('kind'),
    taskTitle:    t.exposeString('taskTitle'),
    taskIssueKey: t.exposeString('taskIssueKey'),
  }) });

  builder.queryFields((t) => ({
    docsByScope: t.field({
      type: [DocType],
      args: { scopeType: t.arg.string({ required: true }), scopeId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        requireUser(ctx);
        await requireObjectLevel(ctx, a.scopeType as any, a.scopeId, 'VIEW');
        return docsService.listDocsByScope(a.scopeType as DocScopeType, a.scopeId);
      },
    }),
    doc: t.field({
      type: DocType,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => requireDocLevel(ctx, a.id, 'VIEW'),
    }),
    docPages: t.field({
      type: [DocPageType],
      args: { docId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => { await requireDocLevel(ctx, a.docId, 'VIEW'); return docsService.listPages(a.docId); },
    }),
    docPageVersions: t.field({
      type: [DocVersionType],
      args: { pageId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => { await requirePageLevel(ctx, a.pageId, 'VIEW'); return docsService.listVersions(a.pageId); },
    }),
    docPageLinks: t.field({
      type: [DocLinkType],
      args: { pageId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => { await requirePageLevel(ctx, a.pageId, 'VIEW'); return docsService.listLinks(a.pageId); },
    }),
  }));

  builder.mutationFields((t) => ({
    createDoc: t.field({
      type: DocType,
      args: {
        workspaceId: t.arg.string({ required: true }), scopeType: t.arg.string({ required: true }),
        scopeId: t.arg.string({ required: true }), name: t.arg.string({ required: true }), icon: t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        const userId = requireUser(ctx);
        await requireObjectLevel(ctx, a.scopeType as any, a.scopeId, 'EDIT');
        const { doc } = await docsService.createDoc(a.workspaceId, a.scopeType as DocScopeType, a.scopeId, a.name, a.icon ?? null, userId);
        return doc;
      },
    }),
    createDocPage: t.field({
      type: DocPageType,
      args: { docId: t.arg.string({ required: true }), parentPageId: t.arg.string({ required: false }), title: t.arg.string({ required: false }), afterPageId: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        await requireDocLevel(ctx, a.docId, 'EDIT');
        return docsService.createPage(a.docId, a.parentPageId ?? null, a.title ?? undefined, undefined, a.afterPageId ?? null);
      },
    }),
    moveDocPage: t.field({
      type: DocPageType,
      nullable: true,
      args: { pageId: t.arg.string({ required: true }), parentPageId: t.arg.string({ required: false }), afterPageId: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        await requirePageLevel(ctx, a.pageId, 'EDIT');
        return docsService.movePage(a.pageId, a.parentPageId ?? null, a.afterPageId ?? null);
      },
    }),
    restoreDocPageVersion: t.field({
      type: DocPageType,
      nullable: true,
      args: { pageId: t.arg.string({ required: true }), versionId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const userId = requireUser(ctx);
        await requirePageLevel(ctx, a.pageId, 'EDIT');
        return docsService.restoreVersion(a.pageId, a.versionId, userId);
      },
    }),
    setDocWiki: t.field({
      type: DocType,
      nullable: true,
      args: { docId: t.arg.string({ required: true }), isWiki: t.arg.boolean({ required: true }) },
      resolve: async (_, a, ctx) => {
        const userId = requireUser(ctx);
        await requireDocLevel(ctx, a.docId, 'EDIT');
        return docsService.setWiki(a.docId, a.isWiki, userId);
      },
    }),
  }));
}
```

- [ ] Wire it into `schema.ts` — add the import alongside the others and the call near the other `register*Graphql()` calls:

```ts
import { registerDocsGraphql } from './docs.schema.js';
```
```ts
// ─────────────────────────────────────────
// Docs & Wikis (Phase 7a) — Doc/DocPage/DocPageVersion/DocTaskLink types +
// docsByScope/doc/docPages/docPageVersions/docPageLinks queries +
// createDoc/createDocPage/moveDocPage/restoreDocPageVersion/setDocWiki mutations.
// ─────────────────────────────────────────
registerDocsGraphql();
```

- [ ] Run: `npm run build --workspace apps/api` (tsc compiles the Pothos schema). Expected: PASS — no type errors; schema builds. Then `npm test --workspace apps/api`. Expected: PASS (existing GraphQL authz tests still green).

- [ ] Commit:
```
git add apps/api/src/graphql/docs.schema.ts apps/api/src/graphql/schema.ts
git commit -m "feat(7a): GraphQL docs mirror — doc/page/version/link queries + create/move/restore/wiki mutations"
```

---

### Task 12: Web — server actions + queries + page-tree builder unit test

**Files:**
- Create: `apps/next-web/src/server/actions/docs.ts`
- Create: `apps/next-web/src/server/queries/docs.ts`
- Create: `apps/next-web/src/lib/docs/tree.ts` (pure flat→tree builder)
- Create: `apps/next-web/src/components/docs/__tests__/DocPageTree.unit.test.tsx`
- Note: read `apps/next-web/node_modules/next/dist/docs/` per `apps/next-web/AGENTS.md` before writing web code (this Next.js has breaking changes). **If that docs dir is absent in this checkout**, follow the conventions in the existing `server/actions/worklogs.ts` + `app/(app)/board/page.tsx` instead and note the absence in `DECISIONS.md`.

Steps:

- [ ] Write `server/queries/docs.ts` (SSR reads via `serverFetch`, mirroring `server/queries/worklogs.ts`):

```ts
import { serverFetch } from '../api';
import type { Doc, DocPage } from '@projectflow/types';

export async function getDoc(docId: string): Promise<Doc> {
  return serverFetch<Doc>(`/docs/${encodeURIComponent(docId)}`);
}
export async function getDocTree(docId: string): Promise<DocPage[]> {
  return serverFetch<DocPage[]>(`/docs/${encodeURIComponent(docId)}/pages`);
}
export async function getDocPage(pageId: string): Promise<DocPage> {
  // The page GET returns bodyJson for SSR first-paint.
  return serverFetch<DocPage>(`/docs/pages/${encodeURIComponent(pageId)}`);
}
```

> **NOTE for implementer:** confirm `serverFetch`'s unwrapping (it returns the `data` field per `server/api.ts`). If there is no `GET /docs/pages/:id` route yet, add it to `docs.routes.ts` (reuse `resolvePageWorkspace` + `doc.read`); it returns the single page incl. `bodyJson`.

- [ ] Write `server/actions/docs.ts` (server actions, `{ ok }`/`ActionResult` envelope like `worklogs.ts`):

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';

export async function createDoc(input: { workspaceId: string; scopeType: 'SPACE' | 'FOLDER' | 'LIST'; scopeId: string; name: string; icon?: string }): Promise<ActionResult> {
  await requireSession();
  try { const data = await serverFetch('/docs', { method: 'POST', body: JSON.stringify(input) }); return { ok: true, data }; }
  catch (e) { return toActionError(e); }
}
export async function createDocPage(input: { docId: string; parentPageId?: string | null; title?: string; afterPageId?: string | null }): Promise<ActionResult> {
  await requireSession();
  try { const data = await serverFetch('/docs/pages', { method: 'POST', body: JSON.stringify(input) }); return { ok: true, data }; }
  catch (e) { return toActionError(e); }
}
export async function renameDocPage(pageId: string, title: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/docs/pages/${encodeURIComponent(pageId)}`, { method: 'PATCH', body: JSON.stringify({ title }) }); return { ok: true }; }
  catch (e) { return toActionError(e); }
}
export async function moveDocPage(pageId: string, parentPageId: string | null, afterPageId: string | null): Promise<ActionResult> {
  await requireSession();
  try { const data = await serverFetch(`/docs/pages/${encodeURIComponent(pageId)}/move`, { method: 'POST', body: JSON.stringify({ parentPageId, afterPageId }) }); return { ok: true, data }; }
  catch (e) { return toActionError(e); }
}
export async function listDocVersions(pageId: string): Promise<ActionResult> {
  await requireSession();
  try { const data = await serverFetch(`/docs/pages/${encodeURIComponent(pageId)}/versions`); return { ok: true, data }; }
  catch (e) { return toActionError(e); }
}
export async function restoreDocVersion(docId: string, pageId: string, versionId: string): Promise<ActionResult> {
  await requireSession();
  try {
    const data = await serverFetch(`/docs/pages/${encodeURIComponent(pageId)}/versions/${encodeURIComponent(versionId)}/restore`, { method: 'POST', body: '{}' });
    revalidatePath(`/docs/${docId}`);
    return { ok: true, data };
  } catch (e) { return toActionError(e); }
}
export async function createTaskFromSelection(pageId: string, listId: string, title: string): Promise<ActionResult> {
  await requireSession();
  try { const data = await serverFetch(`/docs/pages/${encodeURIComponent(pageId)}/create-task`, { method: 'POST', body: JSON.stringify({ listId, title }) }); return { ok: true, data }; }
  catch (e) { return toActionError(e); }
}
export async function setDocWiki(docId: string, isWiki: boolean): Promise<ActionResult> {
  await requireSession();
  try { const data = await serverFetch(`/docs/${encodeURIComponent(docId)}/wiki`, { method: 'PUT', body: JSON.stringify({ isWiki }) }); revalidatePath(`/docs/${docId}`); return { ok: true, data }; }
  catch (e) { return toActionError(e); }
}
```

> **NOTE for implementer:** match the real `serverFetch` options shape (method/body/headers) and the real `ActionResult` type (`{ ok: true; data? } | { ok: false; error }`) from `server/actions/result.ts` + `server/actions/error.ts`. Reuse `getRealtimeToken()` (from `server/actions/realtime.ts`) for the editor's WS token in Task 13 — do NOT invent a new token action.

- [ ] Write the failing tree-builder unit test:

```tsx
import { describe, it, expect } from 'vitest';
import { buildPageTree } from '@/lib/docs/tree';
import type { DocPage } from '@projectflow/types';

const p = (id: string, parentPageId: string | null, position: number, title = id): DocPage => ({
  id, docId: 'd', parentPageId, title, icon: null, cover: null, position, bodyJson: null, createdAt: '', updatedAt: '',
});

describe('buildPageTree', () => {
  it('nests children under parents, ordered by position', () => {
    const flat = [p('a', null, 1), p('b', null, 0), p('a1', 'a', 1), p('a0', 'a', 0)];
    const tree = buildPageTree(flat);
    expect(tree.map((n) => n.id)).toEqual(['b', 'a']);       // position order at root
    const a = tree.find((n) => n.id === 'a')!;
    expect(a.children.map((n) => n.id)).toEqual(['a0', 'a1']); // children ordered by position
  });

  it('treats pages whose parent is missing as roots (orphan safety)', () => {
    const tree = buildPageTree([p('x', 'gone', 0)]);
    expect(tree.map((n) => n.id)).toEqual(['x']);
  });
});
```

- [ ] Run: `npm test --workspace apps/next-web -- DocPageTree`. Expected: FAIL — `@/lib/docs/tree` not found.

- [ ] Write `apps/next-web/src/lib/docs/tree.ts`:

```ts
import type { DocPage, DocPageNode } from '@projectflow/types';

/** Build the nested page tree from a flat page list, ordered by Position.
 *  Pages whose parent is absent are promoted to roots (orphan safety). */
export function buildPageTree(pages: DocPage[]): DocPageNode[] {
  const byId = new Map<string, DocPageNode>();
  for (const p of pages) {
    byId.set(p.id, { id: p.id, docId: p.docId, parentPageId: p.parentPageId, title: p.title, icon: p.icon, position: p.position, children: [] });
  }
  const roots: DocPageNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentPageId ? byId.get(node.parentPageId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (ns: DocPageNode[]) => { ns.sort((a, b) => a.position - b.position); ns.forEach((n) => sort(n.children)); };
  sort(roots);
  return roots;
}
```

- [ ] Run: `npm test --workspace apps/next-web -- DocPageTree`. Expected: PASS (2 tests).

- [ ] Commit:
```
git add apps/next-web/src/server/actions/docs.ts apps/next-web/src/server/queries/docs.ts apps/next-web/src/lib/docs/tree.ts apps/next-web/src/components/docs/__tests__/DocPageTree.unit.test.tsx
git commit -m "feat(7a): web docs server actions + SSR queries + pure page-tree builder + unit test"
```

---

### Task 13: Web — collab provider hook + TipTap editor (slash commands, inline comments, embed-task)

**Files:**
- Create: `apps/next-web/src/lib/collab/useCollabProvider.ts`
- Create: `apps/next-web/src/components/docs/DocEditor.tsx`
- Create: `apps/next-web/src/components/docs/DocEditor.module.css`
- Create: `apps/next-web/src/components/docs/embedTaskNode.ts`
- Create: `apps/next-web/src/components/docs/slashCommands.ts`
- Note: read `apps/next-web/node_modules/next/dist/docs/` per `AGENTS.md` first (or follow existing client-component conventions if absent).

Steps:

- [ ] Write `lib/collab/useCollabProvider.ts` — builds a `HocuspocusProvider` for `doc-page:<id>` with a token fetched via the existing `getRealtimeToken` action; cleans up on unmount:

```ts
'use client';

import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { getRealtimeToken } from '@/server/actions/realtime';

const WS_BASE = process.env.NEXT_PUBLIC_COLLAB_URL || 'ws://localhost:3001/collab';

export interface CollabHandle { provider: HocuspocusProvider; doc: Y.Doc; }

/** Connect to the Yjs collab channel for a doc-page. Returns null until ready. */
export function useCollabProvider(pageId: string): CollabHandle | null {
  const [handle, setHandle] = useState<CollabHandle | null>(null);

  useEffect(() => {
    let provider: HocuspocusProvider | null = null;
    let cancelled = false;
    const doc = new Y.Doc();

    (async () => {
      const res = await getRealtimeToken();
      if (cancelled || !res) return;
      provider = new HocuspocusProvider({
        url: WS_BASE,
        name: `doc-page:${pageId}`,
        document: doc,
        token: res.token,
      });
      if (!cancelled) setHandle({ provider, doc });
    })();

    return () => {
      cancelled = true;
      provider?.destroy();
      doc.destroy();
    };
  }, [pageId]);

  return handle;
}
```

> **NOTE for implementer:** confirm the installed `@hocuspocus/provider` constructor option names (`url`/`name`/`document`/`token`) — read `apps/next-web/node_modules/@hocuspocus/provider/dist/` types after Task 1. Set `NEXT_PUBLIC_COLLAB_URL` in the web env to the API origin's `/collab` WS path (it maps to the upgrade handler from Task 10).

- [ ] Write `embedTaskNode.ts` — a TipTap Node extension that renders a live task card from a `taskId` attribute (uses the existing `TaskCard` if exposable; else a minimal node view that fetches title/key):

```ts
import { Node, mergeAttributes } from '@tiptap/core';

/** Inline-block node: `embedTask` with a taskId attr. Rendered as a live card
 *  by a React node view (registered in DocEditor). Serializes to/from HTML for
 *  the ProseMirror-JSON snapshot. */
export const EmbedTask = Node.create({
  name: 'embedTask',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { taskId: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'div[data-embed-task]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-embed-task': '' })];
  },
});
```

- [ ] Write `slashCommands.ts` — the slash-menu command list (heading/list/divider/embed-task). Keep it data-only so it is trivially unit-checkable and i18n-driven:

```ts
import type { Editor, Range } from '@tiptap/core';

export interface SlashItem {
  key:   string;            // i18n key under Docs.slash.*
  run:   (editor: Editor, range: Range) => void;
}

export const SLASH_ITEMS: SlashItem[] = [
  { key: 'h1',      run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 1 }).run() },
  { key: 'h2',      run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 2 }).run() },
  { key: 'bullet',  run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { key: 'ordered', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { key: 'divider', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { key: 'task',    run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'embedTask', attrs: { taskId: null } }).run() },
];
```

- [ ] Write `DocEditor.tsx` — the client editor. SSR first-paints `bodyJson`; once mounted, the editor binds to the collab provider's Yjs doc via `Collaboration` (no local `content` — Yjs is the source of truth) and shows remote cursors via `CollaborationCursor`. Inline comments reuse the Phase 4 comment thread (anchored to a comment mark/decoration; render the existing `CommentSection` for the selected anchor):

```tsx
'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import { useTranslations } from 'next-intl';
import { useCollabProvider } from '@/lib/collab/useCollabProvider';
import { EmbedTask } from './embedTaskNode';
import styles from './DocEditor.module.css';
import type { MeProfile } from '@/server/queries/profile';

interface Props { pageId: string; me: Pick<MeProfile, 'name'>; }

const CURSOR_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
const colorFor = (name: string) => CURSOR_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % CURSOR_COLORS.length];

export function DocEditor({ pageId, me }: Props) {
  const t = useTranslations('Docs');
  const handle = useCollabProvider(pageId);

  const editor = useEditor(
    handle
      ? {
          // History is owned by Yjs — disable StarterKit's local undo to avoid conflicts.
          extensions: [
            StarterKit.configure({ history: false }),
            EmbedTask,
            Collaboration.configure({ document: handle.doc }),
            CollaborationCursor.configure({
              provider: handle.provider,
              user: { name: me.name, color: colorFor(me.name) },
            }),
          ],
          editorProps: { attributes: { class: styles.prose, 'aria-label': t('editor') } },
          immediatelyRender: false,   // SSR-safe (Next App Router)
        }
      : null,
    [handle, pageId],
  );

  if (!handle || !editor) return <div className={styles.loading}>{t('connecting')}</div>;
  return (
    <div className={styles.root} data-doc-editor>
      <EditorContent editor={editor} />
    </div>
  );
}
```

> **NOTE for implementer:** the TipTap v2/v3 `useEditor` accepting `null`/deps + `immediatelyRender: false` is the SSR-safe pattern; confirm the exact API of the installed `@tiptap/react` (read its `dist/`). Wire `slashCommands.ts` via the `@tiptap/suggestion`/`@tiptap/extension-mention`-style suggestion plugin (or a lightweight `Extension` with a `Suggestion` ProseMirror plugin) — register `SLASH_ITEMS` there, labels from `t('slash.<key>')`. Register a React node view for `EmbedTask` (reuse the existing `TaskCard` component) so it renders a live card. For inline comments, reuse the Phase 4 `CommentSection`/`MentionInput` components anchored to the current selection — keep the comment data in the existing comments module (no new comment storage). Do not invent a second comment store.

- [ ] Write `DocEditor.module.css` (editor surface + remote-cursor caret/label, matching the `CollaborationCursor` default class hooks):

```css
.root { display: flex; flex-direction: column; min-height: 60vh; }
.prose { outline: none; line-height: 1.6; padding: 8px 4px; }
.prose :global(.collaboration-cursor__caret) { position: relative; border-left: 1px solid; border-right: 1px solid; margin-left: -1px; margin-right: -1px; word-break: normal; pointer-events: none; }
.prose :global(.collaboration-cursor__label) { position: absolute; top: -1.4em; left: -1px; font-size: 12px; font-weight: 600; line-height: 1; color: #fff; padding: 1px 4px; border-radius: 3px 3px 3px 0; white-space: nowrap; }
.loading { padding: 24px; color: var(--text-2, #6b7280); }
```

- [ ] Run: `npm run build --workspace apps/next-web` (compiles the client components). Expected: PASS. (No standalone unit test for the editor — its behavior is covered by the e2e in Task 15; the pure `slashCommands`/tree builders are unit-tested.)

- [ ] Commit:
```
git add apps/next-web/src/lib/collab/useCollabProvider.ts apps/next-web/src/components/docs/DocEditor.tsx apps/next-web/src/components/docs/DocEditor.module.css apps/next-web/src/components/docs/embedTaskNode.ts apps/next-web/src/components/docs/slashCommands.ts
git commit -m "feat(7a): TipTap collab editor — Collaboration+Cursor over Hocuspocus, slash commands, embed-task node"
```

---

### Task 14: Web — page-tree sidebar, history panel, wiki toggle, doc page (SSR) + i18n

**Files:**
- Create: `apps/next-web/src/components/docs/DocPageTree.tsx`
- Create: `apps/next-web/src/components/docs/DocHistoryPanel.tsx`
- Create: `apps/next-web/src/components/docs/WikiToggle.tsx`
- Create: `apps/next-web/src/app/(app)/docs/[docId]/page.tsx`
- Create: `apps/next-web/src/app/(app)/docs/[docId]/loading.tsx`
- Modify: `apps/next-web/src/messages/en.json`
- Modify: `apps/next-web/src/messages/id.json`

Steps:

- [ ] Write `DocPageTree.tsx` — renders `buildPageTree(pages)`, with create-child, rename, and drag-move (drag → `moveDocPage`). Selecting a node navigates to that page (query param or nested route):

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { buildPageTree } from '@/lib/docs/tree';
import { createDocPage, renameDocPage, moveDocPage } from '@/server/actions/docs';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { DocPage, DocPageNode } from '@projectflow/types';

interface Props { docId: string; pages: DocPage[]; activePageId: string | null; onSelect: (id: string) => void; onChanged: () => void; }

export function DocPageTree({ docId, pages, activePageId, onSelect, onChanged }: Props) {
  const t = useTranslations('Docs');
  const [pending, start] = useTransition();
  const tree = buildPageTree(pages);

  const addChild = (parentPageId: string | null) => start(async () => {
    const r = await createDocPage({ docId, parentPageId, title: t('untitled') });
    if (!r.ok) return notifyActionError(r);
    onChanged();
  });

  const rename = (id: string, current: string) => start(async () => {
    const next = typeof window !== 'undefined' ? window.prompt(t('renamePrompt'), current) : null;
    if (next == null || next.trim() === '') return;
    const r = await renameDocPage(id, next.trim());
    if (!r.ok) return notifyActionError(r);
    onChanged();
  });

  const onDrop = (dragId: string, targetParentId: string | null, afterId: string | null) => start(async () => {
    const r = await moveDocPage(dragId, targetParentId, afterId);
    if (!r.ok) return notifyActionError(r);
    onChanged();
  });

  const renderNode = (n: DocPageNode, depth: number) => (
    <div key={n.id}>
      <div
        style={{ paddingLeft: depth * 14 }}
        data-doc-page-node={n.id}
        aria-current={n.id === activePageId ? 'page' : undefined}
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/page', n.id)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { const id = e.dataTransfer.getData('text/page'); if (id && id !== n.id) onDrop(id, n.id, null); }}
      >
        <button onClick={() => onSelect(n.id)}>{n.icon ?? '📄'} {n.title}</button>
        <button aria-label={t('rename')} onClick={() => rename(n.id, n.title)}>✎</button>
        <button aria-label={t('addChild')} onClick={() => addChild(n.id)}>＋</button>
      </div>
      {n.children.map((c) => renderNode(c, depth + 1))}
    </div>
  );

  return (
    <nav aria-label={t('pageTree')}>
      <button disabled={pending} onClick={() => addChild(null)}>＋ {t('newPage')}</button>
      {tree.map((n) => renderNode(n, 0))}
    </nav>
  );
}
```

- [ ] Write `DocHistoryPanel.tsx` — lists versions and restores:

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { listDocVersions, restoreDocVersion } from '@/server/actions/docs';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { DocPageVersionMeta } from '@projectflow/types';

export function DocHistoryPanel({ docId, pageId }: { docId: string; pageId: string }) {
  const t = useTranslations('Docs');
  const [versions, setVersions] = useState<DocPageVersionMeta[]>([]);
  const [pending, start] = useTransition();

  const refetch = () => start(async () => {
    const r = await listDocVersions(pageId);
    if (r.ok) setVersions((r.data as DocPageVersionMeta[]) ?? []);
  });
  useEffect(() => { refetch(); /* eslint-disable-next-line */ }, [pageId]);

  const restore = (versionId: string) => start(async () => {
    const r = await restoreDocVersion(docId, pageId, versionId);
    if (!r.ok) return notifyActionError(r);
    refetch();
  });

  return (
    <aside aria-label={t('history')}>
      <h3>{t('history')}</h3>
      {versions.length === 0 && <p>{t('noHistory')}</p>}
      <ul>
        {versions.map((v) => (
          <li key={v.id} data-doc-version={v.id}>
            <span>{v.createdByName}</span>
            <button disabled={pending} onClick={() => restore(v.id)}>{t('restore')}</button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

- [ ] Write `WikiToggle.tsx` — toggle + verified badge:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { setDocWiki } from '@/server/actions/docs';
import { notifyActionError } from '@/lib/apiErrorToast';

export function WikiToggle({ docId, initialIsWiki }: { docId: string; initialIsWiki: boolean }) {
  const t = useTranslations('Docs');
  const [isWiki, setIsWiki] = useState(initialIsWiki);
  const [pending, start] = useTransition();

  const toggle = () => start(async () => {
    const next = !isWiki;
    const r = await setDocWiki(docId, next);
    if (!r.ok) return notifyActionError(r);
    setIsWiki(next);
  });

  return (
    <div>
      <button disabled={pending} onClick={toggle} aria-pressed={isWiki} data-wiki-toggle>
        {isWiki ? t('markedWiki') : t('markAsWiki')}
      </button>
      {isWiki && <span data-wiki-badge title={t('verified')}>✔ {t('wiki')}</span>}
    </div>
  );
}
```

- [ ] Write the SSR doc page `app/(app)/docs/[docId]/page.tsx` — first-paints from the tree + (selected) page `bodyJson`, mounts the tree + editor + history + wiki toggle. Reads `me` for the cursor label:

```tsx
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getMe } from '@/server/queries/profile';
import { getDoc, getDocTree } from '@/server/queries/docs';
import { DocWorkspace } from '@/components/docs/DocWorkspace';
import DocLoading from './loading';

export default async function DocPage({ params }: { params: Promise<{ docId: string }> }) {
  await requireSession();
  const { docId } = await params;
  const [doc, pages, me] = await Promise.all([
    getDoc(docId).catch(() => null),
    getDocTree(docId).catch(() => []),
    getMe().catch(() => null),
  ]);
  if (!doc) notFound();

  return (
    <Suspense fallback={<DocLoading />}>
      <DocWorkspace doc={doc} pages={pages} me={{ name: me?.name ?? 'You' }} />
    </Suspense>
  );
}
```

> **NOTE for implementer:** Next App Router params are async in this version — `params` is a Promise; `await` it (confirm against `node_modules/next/dist/docs/` or an existing dynamic route under `app/(app)/`). Create a thin client `DocWorkspace.tsx` (a small client wrapper that holds `activePageId` state and composes `<DocPageTree>`, `<DocEditor>`, `<DocHistoryPanel>`, `<WikiToggle>`) — it's pure composition, so it has no test of its own; the e2e covers it. Add it to the File Structure as you create it.

- [ ] Write `app/(app)/docs/[docId]/loading.tsx` — a simple skeleton (match an existing `loading.tsx` under `app/(app)/board/`).

- [ ] Add the `Docs` i18n namespace to `en.json`:

```json
"Docs": {
  "editor": "Document editor",
  "connecting": "Connecting…",
  "pageTree": "Pages",
  "newPage": "New page",
  "addChild": "Add subpage",
  "rename": "Rename",
  "renamePrompt": "Page title",
  "untitled": "Untitled",
  "history": "History",
  "noHistory": "No previous versions yet",
  "restore": "Restore",
  "markAsWiki": "Mark as wiki",
  "markedWiki": "Wiki",
  "wiki": "Wiki",
  "verified": "Verified",
  "createTask": "Create task from selection",
  "slash": {
    "h1": "Heading 1",
    "h2": "Heading 2",
    "bullet": "Bulleted list",
    "ordered": "Numbered list",
    "divider": "Divider",
    "task": "Embed task"
  }
}
```

- [ ] Add the same keys to `id.json` with real Indonesian:

```json
"Docs": {
  "editor": "Editor dokumen",
  "connecting": "Menghubungkan…",
  "pageTree": "Halaman",
  "newPage": "Halaman baru",
  "addChild": "Tambah subhalaman",
  "rename": "Ganti nama",
  "renamePrompt": "Judul halaman",
  "untitled": "Tanpa judul",
  "history": "Riwayat",
  "noHistory": "Belum ada versi sebelumnya",
  "restore": "Pulihkan",
  "markAsWiki": "Tandai sebagai wiki",
  "markedWiki": "Wiki",
  "wiki": "Wiki",
  "verified": "Terverifikasi",
  "createTask": "Buat tugas dari pilihan",
  "slash": {
    "h1": "Judul 1",
    "h2": "Judul 2",
    "bullet": "Daftar berpoin",
    "ordered": "Daftar bernomor",
    "divider": "Pembatas",
    "task": "Sematkan tugas"
  }
}
```

- [ ] Run: `npm test --workspace apps/next-web` (includes the `messages.unit` i18n parity test). Expected: PASS — en/id key parity green; `DocPageTree` unit still green. Then `npm run build --workspace apps/next-web`. Expected: PASS (Next build clean).

- [ ] Commit:
```
git add apps/next-web/src/components/docs/ apps/next-web/src/app/(app)/docs/ apps/next-web/src/messages/en.json apps/next-web/src/messages/id.json
git commit -m "feat(7a): doc page UI — page-tree sidebar, history panel, wiki toggle, SSR doc route + i18n"
```

---

### Task 15: Playwright e2e — two-browser co-edit + offline merge + history restore + wiki

**Files:**
- Create: `apps/next-web/e2e/docs-collab.spec.ts`
- Note: e2e runs against local Docker `ProjectFlow_Test` only (use the project's existing e2e env/setup, same as the realtime/presence specs). The collab WS server must be attached to the running API (it is, via Task 10's upgrade) — confirm the e2e API boots with `NODE_ENV != test` so the upgrade attaches, or attach it explicitly in the e2e bootstrap.

Steps:

- [ ] Write the e2e spec covering the BUILD_PLAN §4.6 acceptance: two browser contexts co-edit a page with live cursors; an offline edit (one context's WS dropped) merges on reconnect; a prior version restores; the wiki flag is retrievable. Follow the existing realtime/presence spec harness (login helper, seeded space + doc):

```ts
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { loginAndSeedDoc } from './helpers'; // add a helper that seeds a Space + Doc and returns { docUrl, pageId }

test.describe('Phase 7a — docs collaboration', () => {
  test('two browsers co-edit with live cursors; offline edit merges on reconnect', async ({ browser }) => {
    const a = await browser.newContext();
    const b = await browser.newContext();
    const pageA = await a.newPage();
    const pageB = await b.newPage();

    const { docUrl } = await loginAndSeedDoc(pageA);
    // Share the same session/doc in context B (re-login as a member or reuse the same user).
    await loginAndSeedDoc(pageB, { reuseDocUrl: docUrl });

    await pageA.goto(docUrl);
    await pageB.goto(docUrl);

    const editorA = pageA.locator('[data-doc-editor] .ProseMirror');
    const editorB = pageB.locator('[data-doc-editor] .ProseMirror');
    await expect(editorA).toBeVisible();
    await expect(editorB).toBeVisible();

    // A types → B sees it (CRDT sync).
    await editorA.click();
    await editorA.type('Hello from A. ');
    await expect(editorB).toContainText('Hello from A.', { timeout: 10_000 });

    // Live cursor from A is visible in B.
    await expect(pageB.locator('.collaboration-cursor__label')).toBeVisible({ timeout: 10_000 });

    // OFFLINE MERGE: cut B's network, both edit, then restore B's network.
    await b.setOffline(true);
    await editorB.click();
    await editorB.type('Offline edit from B. ');
    await editorA.click();
    await editorA.type('Concurrent edit from A. ');
    await b.setOffline(false);

    // After reconnect, both edits are present in BOTH editors (CRDT merge — no lost writes).
    await expect(editorA).toContainText('Offline edit from B.', { timeout: 15_000 });
    await expect(editorB).toContainText('Concurrent edit from A.', { timeout: 15_000 });

    await a.close();
    await b.close();
  });

  test('history restores a prior version', async ({ page }) => {
    const { docUrl } = await loginAndSeedDoc(page);
    await page.goto(docUrl);
    const editor = page.locator('[data-doc-editor] .ProseMirror');
    await editor.click();
    await editor.type('Version one content. ');
    // Allow the debounced store (2s) to checkpoint a version, then edit again.
    await page.waitForTimeout(3000);
    await editor.type('Version two content. ');
    await page.waitForTimeout(3000);

    // Restore the oldest version from the history panel.
    const oldest = page.locator('[data-doc-version]').last();
    await oldest.getByRole('button', { name: /restore/i }).click();
    await expect(editor).toContainText('Version one content.', { timeout: 10_000 });
  });

  test('a doc marked as wiki is flagged and retrievable', async ({ page }) => {
    const { docUrl } = await loginAndSeedDoc(page);
    await page.goto(docUrl);
    await page.locator('[data-wiki-toggle]').click();
    await expect(page.locator('[data-wiki-badge]')).toBeVisible();
    // Reload → the flag persists (retrievable as a wiki).
    await page.reload();
    await expect(page.locator('[data-wiki-badge]')).toBeVisible();
  });
});
```

> **NOTE for implementer:** add the `loginAndSeedDoc` helper to `e2e/helpers.ts` (seed a Space + Doc via the REST API with the test user's token, return the doc route URL + root page id), mirroring the existing seeders the views/presence specs use. The history-restore test relies on the 2s debounce checkpointing a version on store — if version checkpoints are NOT emitted automatically by `onStoreDocument` (this slice only persists current body on store; explicit version rows come from the REST `POST /versions` or a periodic checkpoint), have the test create an explicit version via the history action between the two edits, OR add a periodic version checkpoint to `onStoreDocument` (every Nth store). Decide and document in `DECISIONS.md`.

- [ ] Run: the project's e2e command for this single spec against `ProjectFlow_Test` (same invocation the realtime/presence specs use, e.g. `npx playwright test e2e/docs-collab.spec.ts`). Expected: PASS (3 tests) — co-edit syncs + cursors visible, offline edits merge on reconnect, restore works, wiki flag persists. (Live collab e2e may be deferred to a coordinated local-DB run, as the Phase 3.5 realtime/presence specs were — if deferred, author the spec now and note the deferral.)

- [ ] Commit:
```
git add apps/next-web/e2e/docs-collab.spec.ts apps/next-web/e2e/helpers.ts
git commit -m "test(7a): e2e — two-browser co-edit + live cursors + offline CRDT merge + history restore + wiki flag"
```

---

### Task 16: Slice verification + DECISIONS.md

**Files:**
- Modify: `DECISIONS.md` (append a Phase 7a entry)

Steps:

- [ ] Run the full slice verification on local Docker `ProjectFlow_Test`:
  - `npm test --workspace apps/api` — Expected: PASS (existing suite + `fractionalIndex`/`yjsPersistence`/`collabAuth` unit tests).
  - `npm run test:integration --workspace apps/api` — Expected: PASS (existing + `docs.integration` + `persistence.integration`).
  - `npm test --workspace apps/next-web` — Expected: PASS (unit + `messages.unit` parity + `DocPageTree`).
  - `npm run build --workspace apps/api` and `npm run build --workspace apps/next-web` — Expected: both PASS.
  - The docs-collab e2e — Expected: PASS (or authored + deferred to a coordinated local-DB run, documented).

- [ ] Append a `DECISIONS.md` entry logging: the **new WS collab spine** (Hocuspocus in-process WS upgrade at `/collab`, separable in prod); the document-name scheme (`doc-page:<id>`, `whiteboard:<id>` reserved so 7b reuses the server unchanged); **docs ACL rides the scope node** (no `DOC`/`WHITEBOARD` object type — `onAuthenticate` resolves page→doc→SPACE/FOLDER/LIST and calls `accessService.can(..., 'EDIT')`); the persistence model (`BodyYjs` binary + debounced `BodyJson` snapshot for SSR/search; restore clears `BodyYjs` to force JSON re-seed); the `y-prosemirror` snapshot render export actually used; the fractional `Position` reorder + cycle guard (`51700`); the new `doc.create`/`doc.read`/`doc.update` RBAC slugs; whether `onStoreDocument` checkpoints versions periodically or versions are explicit; the resolved Hocuspocus/TipTap/`yjs` versions + any `yjs` single-instance override; and any deviation found during implementation. DB-execution-policy note: all DB work ran ONLY against local Docker `ProjectFlow_Test`.

- [ ] Commit:
```
git add DECISIONS.md
git commit -m "docs(7a): DECISIONS entry — Hocuspocus collab spine + Docs/Wikis (ACL via scope node, persistence model)"
```

---

## Definition of Done

Per-slice DoD (spec §3) + BUILD_PLAN acceptance (spec §4.6):

- [ ] **BUILD_PLAN acceptance:** Two users co-edit a Doc with **live cursors**; **offline edits merge via CRDT on reconnect** (no lost writes); **page history restores a prior version**; a **doc marked as wiki is flagged and retrievable** as such.
- [ ] The **new realtime collab channel** exists: a Hocuspocus Yjs WS server with fail-closed `onAuthenticate` (real JWT + real ACL via the scope node), debounced `onStoreDocument` persisting `BodyYjs` + a rendered `BodyJson` snapshot, native awareness for cursors, and `@hocuspocus/extension-redis`. The server is **generic over `<kind>:<id>`** so 7b reuses it for `whiteboard:<id>`.
- [ ] Migration `0040_docs.sql` (Docs/DocPages/DocPageVersions/DocTaskLinks with the exact spec columns) is idempotent, GO-batched, and **reversible** via `rollback/0040_docs.down.sql` (apply→rollback→re-apply verified clean).
- [ ] SP-per-op for every operation (doc CRUD + scope resolve; page create/get/list/update/move-with-cycle-guard/delete; Yjs persist/load; version create/list/get + restore; task links). REST is the primary surface; the **GraphQL mirror** (`registerDocsGraphql`) delegates to the **one shared `DocsService`**.
- [ ] Authorization fail-closed: REST via `requirePermission` (new `doc.*` slugs) with workspace resolved from the doc/page; GraphQL + collab via `requireObjectLevel`/`accessService.can` on the doc's **scope node**. Docs are NOT a public surface in 7a (sharing is Phase 10).
- [ ] Unit tests (fractional reorder, `docNameToTarget` + snapshot round-trip, `authenticateCollab` fail-closed, page-tree builder) + integration tests (page CRUD + nested move + cycle reject, history restore, create-task-from-doc, wiki flag, Yjs persist/load) + the **two-browser co-edit + offline-merge e2e** + history-restore + wiki e2e — all green (live collab e2e may be authored + deferred to a coordinated run, documented).
- [ ] `@projectflow/types` updated (`Doc`/`DocPage`/`DocPageNode`/`DocPageVersion(+Meta)`/`DocTaskLink` + inputs).
- [ ] i18n: new `Docs` namespace in **en.json + id.json** (real Indonesian); `messages.unit` parity green.
- [ ] New dependencies installed in the correct workspaces (`@hocuspocus/server`/`@hocuspocus/extension-redis`/`yjs`/`y-prosemirror` in `api`; `@tiptap/*`/`@hocuspocus/provider`/`yjs`/`y-prosemirror` in `next-web`), resolved versions recorded.
- [ ] ⚠️ Web code written **after** consulting `apps/next-web/node_modules/next/dist/docs/` per `AGENTS.md` (or its documented absence noted).
- [ ] All DB work (migrations, SP deploy, integration, e2e) ran **ONLY against local Docker `ProjectFlow_Test`** — never the prod-pointing `apps/api/.env`.
- [ ] `DECISIONS.md` entry logs the mechanism choices + any deviations. **Stop for review/merge before Slice 7b.**

---

## Self-Review

**Spec coverage (§4.1–§4.6).**
- §4.1 collab server — Task 10: `apps/api/src/modules/collab/` with `onAuthenticate` (JWT+ACL), `onLoadDocument`/`onStoreDocument` (debounced Yjs persist + JSON snapshot), awareness (built into Hocuspocus/`CollaborationCursor`), `@hocuspocus/extension-redis`, document name `doc-page:<id>` (and `whiteboard:<id>` reserved), bootstrapped at server start via WS upgrade. ✓
- §4.2 data model — Task 2: `Docs`/`DocPages`/`DocPageVersions`/`DocTaskLinks` with the **exact** columns from the spec (incl. `BodyYjs VARBINARY(MAX)`, `BodyJson NVARCHAR(MAX)`, `Position FLOAT`, `Kind` `'reference'|'embed'`). ✓
- §4.3 backend — Tasks 3–6, 9, 11: doc+page CRUD, fractional move/reorder + nested `ParentPageId` tree, history list+restore, doc↔task links, create-task-from-selection, wiki flag + verifier, REST + GraphQL mirror, SSR reads `BodyJson`. ✓
- §4.4 frontend — Tasks 12–14: TipTap `Collaboration`+`CollaborationCursor` over `@hocuspocus/provider`, slash commands, inline comments (reuse Phase 4), embed-task node, page-tree sidebar, history panel, wiki toggle. ✓
- §4.5 tests — fractional reorder math, snapshot/version builders, wiki-flag resolution (unit); page CRUD + nested move, history restore, create-task-from-doc, wiki set/read (integration); two-browser co-edit + offline merge + history restore (e2e). ✓
- §4.6 acceptance — covered by the e2e (Task 15) + Definition of Done. ✓

**Placeholder scan.** Every code step contains real, runnable code (full migration + rollback, all 19 SPs, the repository/service/routes, the Hocuspocus config, the auth helper, the persistence helpers, the GraphQL mirror, the provider hook, the TipTap editor, the tree/history/wiki components, the SSR route, i18n). Three intentional implementer-resolved seams are flagged with explicit **NOTE** callouts (never silent): (1) the exact `y-prosemirror` snapshot export + Hocuspocus hook/`handleConnection` signatures + `@hocuspocus/provider` option names depend on the resolved package majors — read the installed `node_modules` after Task 1; (2) `TaskService.createTask` signature + `serverFetch`/`ActionResult` shapes must be matched to the real files; (3) the `POST /pages/:id/links` handler explicitly instructs replacing the placeholder line with a real `docsService.createLink` passthrough. No "configure the rest similarly."

**Type/name consistency.** Migration `0040`, table/column names, doc-name encoding (`doc-page:<id>`), and dependency names are taken verbatim from the spec. SP names follow the repo `usp_<Entity>_<Verb>` convention; `execSp`/`execSpOne` signatures match `sqlClient.ts`; the GraphQL mirror matches `views.schema.ts`'s `objectRef`/`builder.queryFields`/`builder.mutationFields` shape and registers in `schema.ts` like the others; routes match the comments/sprints Hono + `requirePermission` pattern; server actions/queries match `worklogs.ts`/`board/page.tsx`. Types added to `packages/types/index.ts` are referenced consistently across repo/service/routes/GraphQL/web.

**Resolved ambiguity (logged for DECISIONS).** The spec §2/§4.1 writes `requireObjectLevel('DOC'|'WHITEBOARD', id, 'EDIT'|'VIEW')`, but the real ACL system (`HierarchyNodeType = 'SPACE'|'FOLDER'|'LIST'`, `usp_ObjectAccess_Resolve`) has **no** `DOC`/`WHITEBOARD` object type. Resolution: docs are **scoped** objects (`Docs.ScopeType`/`ScopeId` point at a SPACE/FOLDER/LIST), so `onAuthenticate` and every authz gate resolve page→doc→scope node and call the existing `accessService.can(userId, scopeType, scopeId, 'EDIT')`. This keeps one ACL path (per spec §3) and avoids inventing a parallel permission table. A second resolved point: SQL Server cannot rebuild a valid Yjs binary, so **restore** writes `BodyJson` and **nulls `BodyYjs`**, forcing the next collab connect to re-seed the CRDT from the JSON snapshot — deterministic and lossless for the restored content. Both are logged in the Task 16 `DECISIONS.md` entry.
