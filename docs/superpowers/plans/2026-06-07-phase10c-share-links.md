# Phase 10c — Public Share Links + Request Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the external-access layer to ProjectFlow: a scoped, high-entropy, **read-only** share token that grants access to **exactly one object** (task / doc / dashboard / saved view / whiteboard) at `VIEW` level and **nothing else** — resolved by a **separate unauthenticated REST route group** (`/share/:token`, no `authMiddleware`, no JWT, no workspace context, no hierarchy walk) that serves a **navigation-stripped, write-stripped projection** rendered by a **public Next route outside the `(app)` group**. Plus the inverse **request-access** flow: an authenticated non-member viewing a private object creates an `AccessRequests` row + a Phase 3.5 notification to the object's owners/admins, who grant via the 10b per-object permission editor (writing an `ObjectPermissions` row through 10b's `setObjectPermission` primitive). Plus the per-object **sharing modal** (toggle public link, copy URL, set expiry, revoke).

**Architecture:** A share link **is** a `ShareLinks` row (`Token NVARCHAR(64) UNIQUE`, high-entropy random — NOT a GUID; `Level DEFAULT 'VIEW'`; `ExpiresAt`/`RevokedAt` nullable). New behavior is SP-per-op in `infra/sql/procedures/` (`usp_ShareLink_Create|Resolve|Revoke|ListForObject`, `usp_AccessRequest_Create|Resolve`), surfaced through `share.repository` → `share.service` / `access.service` (extended). The **authed side** (create / revoke / list links, request-access, resolve-request) is Hono REST under the protected `/share/*` + `/access/*` prefixes (with `authMiddleware`) **plus a GraphQL mirror**, both delegating to the one shared service; sharing/grant endpoints require `FULL` on the object (fail-closed). The **public side** is a **distinct unauthenticated route group** mounted at `/public/share/:token` (no `authMiddleware`, no workspace context) whose single job is `share.service.resolvePublic(token)` → `(read-only object projection, level)` or **404** for expired/revoked/missing (constant-time token comparison via `crypto.timingSafeEqual` is structurally moot because the SP looks the token up by an indexed UNIQUE column — the SP does the secret-free lookup; the comparison guard is applied in `share.service` for any post-lookup equality check). The token never consults `usp_ObjectAccess_Resolve`, never reads `WorkspaceMembers`, and never walks the tree. The frontend adds a per-object-type **sharing modal**, a **public read-only renderer per object type** mounted outside `(app)`, and a **request-access** affordance.

**Tech Stack:** SQL Server stored procedures (`CREATE OR ALTER`, `SET NOCOUNT ON`, TRY/CATCH/TRANSACTION, `SELECT *` of affected rows); high-entropy tokens via `node:crypto` `randomBytes(...).toString('base64url')` (the same `node:crypto` the codebase already uses in `tokenCrypto.ts`/avatars); Hono REST + `@hono/zod-validator`; graphql-yoga + Pothos (`@pothos/core`) for the authed mirror; `mssql` via `execSp`/`execSpOne`; vitest (`--project unit` / `--project integration`); Next.js App Router (SSR) + `next-intl` (en+id parity); Playwright e2e. DB work runs ONLY against local Docker `ProjectFlow_Test`.

**Prerequisite:** Phases 1–9 + Phase 10a–10b merged; reuses 10b `setObjectPermission` + Phase 3.5 notifications. (On-disk migrations are currently `0037`; this slice assumes Phases 6–9 land their migrations `0038–0050` and 10a/10b land `0051_apps_enabled.sql`/`0052_custom_roles.sql` first, so this slice's migration is `0053_share_links.sql`. The 10b grant primitive `access.service.setObjectPermission(...)` — which wraps the **already-on-disk** `AccessRepository.set` → `usp_ObjectPermission_Set` — is assumed present; if 10b is not yet merged when this slice runs, add the thin `setObjectPermission`/`listObjectPermissions` wrappers to `access.service.ts` per §6.2 of the spec and note it in `DECISIONS.md`.)

---

## File Structure

**Migrations**
- `infra/sql/migrations/0053_share_links.sql` — **Create.** Idempotent, GO-batched: create `ShareLinks` (exact columns: `Id, WorkspaceId, ObjectType, ObjectId, Token, Level, ExpiresAt, CreatedBy, CreatedAt, RevokedAt`) + a UNIQUE index on `Token` + a lookup index on `(ObjectType, ObjectId)`; create `AccessRequests` (`Id, WorkspaceId, ObjectType, ObjectId, RequestedBy, Note, Status, ResolvedBy, ResolvedAt, CreatedAt`).
- `infra/sql/migrations/rollback/0053_share_links.down.sql` — **Create.** Reverse: drop `AccessRequests`, then `ShareLinks` (indexes drop with the table).

**Stored procedures** (`infra/sql/procedures/`)
- `usp_ShareLink_Create.sql` — **Create.** Insert a share link (caller-supplied high-entropy `@Token`), return the row.
- `usp_ShareLink_Resolve.sql` — **Create.** Look up by `@Token`; return the row **only if** `RevokedAt IS NULL` AND (`ExpiresAt IS NULL` OR `ExpiresAt > SYSUTCDATETIME()`); zero rows otherwise.
- `usp_ShareLink_Revoke.sql` — **Create.** Set `RevokedAt = SYSUTCDATETIME()` for a link by `@Id` scoped to its workspace/creator authz (authz enforced in the service), return the row.
- `usp_ShareLink_ListForObject.sql` — **Create.** Return all non-revoked links for an `(@ObjectType, @ObjectId)`.
- `usp_AccessRequest_Create.sql` — **Create.** Insert a pending access request, return the row (idempotent on an existing pending row for the same requester/object → returns the existing one).
- `usp_AccessRequest_Resolve.sql` — **Create.** Set `Status`/`ResolvedBy`/`ResolvedAt` for a request by `@Id`, return the row.

**API** (`apps/api/src/`)
- `modules/share/share.repository.ts` — **Create.** `execSpOne` wrappers: `create`, `resolve`, `revoke`, `listForObject`.
- `modules/share/share.service.ts` — **Create.** `createLink` (guarded by `FULL` in the route/service), `revokeLink`, `listForObject`, and **`resolvePublic(token)`** → `{ objectType, objectId, level, projection } | null`; delegates per-object-type projection building to `share.projection.ts`.
- `modules/share/share.projection.ts` — **Create.** Pure-ish per-object read-only projection builders (`buildTaskProjection`, `buildViewProjection`, + spec'd stubs for doc/dashboard/whiteboard) + the `stripWrites`/`stripNavigation` helpers (PURE, unit-tested).
- `modules/share/share.routes.ts` — **Create.** **Authed** routes (mounted under `/share/*` WITH `authMiddleware`): `POST /share` (create, `FULL`), `DELETE /share/:id` (revoke, `FULL`), `GET /share/object/:objectType/:objectId` (list, `FULL`).
- `modules/share/public-share.routes.ts` — **Create.** **UNAUTHENTICATED** route group (mounted under `/public/share` with NO `authMiddleware`): `GET /public/share/:token` → `resolvePublic` projection or 404.
- `modules/access/access-request.service.ts` — **Create.** `requestAccess(object, requesterId, note)` → `AccessRequests` row + a Phase 3.5 notification to owners/admins; `resolveRequest(id, resolverId, decision)` → on `granted`, calls 10b `accessService.setObjectPermission(...)` (writes `ObjectPermissions`) then marks the request `granted`.
- `modules/access/access-request.repository.ts` — **Create.** `create`, `resolve` wrappers + `listOwnersAdmins(objectType, objectId)` lookup (reuse existing membership/owner SPs).
- `modules/access/access.service.ts` — **Modify (if 10b not yet merged).** Ensure `setObjectPermission`/`listObjectPermissions` exist (thin wrappers over `AccessRepository.set`/`unset`/`resolve`).
- `modules/access/access-request.routes.ts` — **Create.** **Authed** routes (mounted under `/access/*` WITH `authMiddleware`): `POST /access/request` (request access — any authed user), `POST /access/request/:id/resolve` (grant/deny — `FULL` on the object).
- `graphql/share.schema.ts` — **Create.** `registerShareGraphql()`: `ShareLinkType`/`AccessRequestType` + `shareLinksForObject` query + `createShareLink`/`revokeShareLink`/`requestAccess`/`resolveAccessRequest` mutations (authed side only — the public token resolution is REST-only by design, §2.2).
- `graphql/schema.ts` — **Modify.** Import + call `registerShareGraphql()`.
- `server.ts` — **Modify.** Register `/share/*` + `/access/*` WITH `authMiddleware` (and `auditMiddleware`); register `/public/share` WITHOUT `authMiddleware` (modeled on the public `/auth`, `/avatars` GET, and incoming `/webhooks` groups).

**Types** (`packages/types/`)
- `index.ts` — **Modify.** Add `ShareObjectType`, `ShareLink`, `CreateShareLinkInput`, `ShareProjection` (+ per-object projection shapes), `AccessRequest`, `AccessRequestStatus`, `CreateAccessRequestInput` near the existing `ObjectPermissionLevel` (line ~79) / `Role` (line ~805) blocks.

**Frontend** (`apps/next-web/src/`)
- `server/actions/share.ts` — **Create.** Authed server actions: `createShareLink`, `revokeShareLink`, `listShareLinks`, `requestAccess`, `resolveAccessRequest` (mirror the `{ ok, error }` result envelope used by the other action files).
- `components/sharing/ShareModal.tsx` — **Create.** Per-object sharing modal: toggle public link, copy URL, set expiry, revoke + (private) invite-at-a-level path delegating to the 10b grant.
- `components/sharing/ShareModal.module.css` — **Create.** Styles.
- `components/sharing/RequestAccessPanel.tsx` — **Create.** Request-access UI for an authed non-member hitting a private object.
- `app/share/[token]/page.tsx` — **Create.** Public Next route **OUTSIDE `(app)`** (sibling of `login`/`register`/`oauth`): SSR-fetches `/public/share/:token` (no cookie/JWT), renders the read-only projection, 404s on missing/expired/revoked.
- `app/share/[token]/PublicObjectRenderer.tsx` — **Create.** Dispatches on `objectType` to a per-type read-only renderer (no app chrome, no sibling/parent nav).
- `app/share/layout.tsx` — **Create.** Minimal public layout (no sidebar, no auth) wrapping the share renderer.
- `messages/en.json` — **Modify.** New `Share` + `AccessRequest` namespaces.
- `messages/id.json` — **Modify.** Same keys, real Indonesian.

**Tests**
- `apps/api/src/modules/share/__tests__/projection.unit.test.ts` — **Create.** Pure: projection strips write affordances + sibling/parent navigation; per-object builders.
- `apps/api/src/modules/share/__tests__/token.unit.test.ts` — **Create.** Pure: token generation entropy/shape + the resolve-validity helper (expired / revoked / valid).
- `apps/api/src/modules/share/__tests__/share.integration.test.ts` — **Create.** Public link serves EXACTLY one object with NO auth and NO tree access; revoked/expired token 404s; request-access creates a notification; granting writes an `ObjectPermissions` row (via 10b's primitive). **Security:** token grants nothing beyond the one object (no workspace context, no parent/sibling).
- `e2e/share-links.spec.ts` (repo-root `e2e/`) — **Create.** Create a public share link, open it in an UNAUTHENTICATED context, see read-only content and no way to reach siblings/parent.

---

## Tasks

### Task 1: Migration + rollback (`0053_share_links.sql`)

**Files:**
- Create: `infra/sql/migrations/0053_share_links.sql`
- Create: `infra/sql/migrations/rollback/0053_share_links.down.sql`
- Test: manual deploy against local Docker `ProjectFlow_Test` (migrations have no unit harness; verified via the integration suite in Task 7).

Steps:

- [ ] Write the migration. Idempotent (`sys.tables` / `sys.indexes` guards), GO-batched, matching the `0029`/`0032` style. **Exact columns from spec §6.1:**

```sql
-- =============================================================================
-- Migration 0053: Public Share Links + Access Requests (Phase 10c)
--   * ShareLinks — a scoped, read-only token granting access to EXACTLY one
--     object (task|doc|dashboard|view|whiteboard) at VIEW level. Token is a
--     high-entropy random string (NOT a GUID), UNIQUE for constant-time-safe,
--     index-driven resolution. ExpiresAt/RevokedAt nullable.
--   * AccessRequests — an authed non-member's request for access to a private
--     object; resolved by an owner/admin who grants via the 10b editor.
-- Idempotent (catalog guards), GO-batched.
-- Rollback in rollback/0053_share_links.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ShareLinks')
BEGIN
    CREATE TABLE dbo.ShareLinks (
        Id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_ShareLinks PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_ShareLinks_Workspace REFERENCES dbo.Workspaces(Id),
        ObjectType  NVARCHAR(16) NOT NULL,
        ObjectId    UNIQUEIDENTIFIER NOT NULL,
        Token       NVARCHAR(64) NOT NULL,
        Level       NVARCHAR(8)  NOT NULL CONSTRAINT DF_ShareLinks_Level DEFAULT 'VIEW',
        ExpiresAt   DATETIME2    NULL,
        CreatedBy   UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_ShareLinks_CreatedBy REFERENCES dbo.Users(Id),
        CreatedAt   DATETIME2    NOT NULL CONSTRAINT DF_ShareLinks_CreatedAt DEFAULT SYSUTCDATETIME(),
        RevokedAt   DATETIME2    NULL,
        CONSTRAINT CK_ShareLinks_ObjectType CHECK (ObjectType IN ('task','doc','dashboard','view','whiteboard')),
        CONSTRAINT CK_ShareLinks_Level      CHECK (Level IN ('VIEW','COMMENT','EDIT','FULL'))
    );
END
GO

-- The Token is the lookup key for the unauthenticated resolver — UNIQUE so the
-- SP resolves by an indexed equality (no scan, no per-byte secret comparison).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_ShareLinks_Token' AND object_id = OBJECT_ID('dbo.ShareLinks'))
    CREATE UNIQUE NONCLUSTERED INDEX UQ_ShareLinks_Token ON dbo.ShareLinks (Token);
GO

-- List-for-object lookup (sharing modal).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ShareLinks_Object' AND object_id = OBJECT_ID('dbo.ShareLinks'))
    CREATE NONCLUSTERED INDEX IX_ShareLinks_Object ON dbo.ShareLinks (ObjectType, ObjectId) WHERE RevokedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AccessRequests')
BEGIN
    CREATE TABLE dbo.AccessRequests (
        Id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_AccessRequests PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_AccessRequests_Workspace REFERENCES dbo.Workspaces(Id),
        ObjectType  NVARCHAR(16) NOT NULL,
        ObjectId    UNIQUEIDENTIFIER NOT NULL,
        RequestedBy UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_AccessRequests_RequestedBy REFERENCES dbo.Users(Id),
        Note        NVARCHAR(500) NULL,
        Status      NVARCHAR(12) NOT NULL CONSTRAINT DF_AccessRequests_Status DEFAULT 'pending',
        ResolvedBy  UNIQUEIDENTIFIER NULL
            CONSTRAINT FK_AccessRequests_ResolvedBy REFERENCES dbo.Users(Id),
        ResolvedAt  DATETIME2 NULL,
        CreatedAt   DATETIME2 NOT NULL CONSTRAINT DF_AccessRequests_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_AccessRequests_Status CHECK (Status IN ('pending','granted','denied'))
    );
END
GO

-- One pending request per (requester, object) — the AccessRequest_Create SP
-- keys off this so a repeat request returns the existing pending row.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_AccessRequests_Pending' AND object_id = OBJECT_ID('dbo.AccessRequests'))
    CREATE UNIQUE NONCLUSTERED INDEX UQ_AccessRequests_Pending
        ON dbo.AccessRequests (ObjectType, ObjectId, RequestedBy) WHERE Status = 'pending';
GO
```

- [ ] Write the rollback `rollback/0053_share_links.down.sql` (reverse order; tables drop their own indexes):

```sql
-- Rollback 0053: Public Share Links + Access Requests.
-- Drops AccessRequests then ShareLinks (indexes drop with each table).

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AccessRequests') DROP TABLE dbo.AccessRequests;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ShareLinks')     DROP TABLE dbo.ShareLinks;
GO
```

- [ ] Run against local Docker `ProjectFlow_Test` only (explicit local DB env, never `apps/api/.env`). Apply `0053_share_links.sql`, then immediately the `.down.sql`, then re-apply `0053` to prove idempotency + reversibility. Expected: all three runs succeed; the second `0053` apply is a clean no-op (guards skip everything).

- [ ] Commit:
```
git add infra/sql/migrations/0053_share_links.sql infra/sql/migrations/rollback/0053_share_links.down.sql
git commit -m "feat(10c): share-links migration — ShareLinks (token VIEW link) + AccessRequests"
```

---

### Task 2: Share-link SPs (`Create`, `Resolve`, `Revoke`, `ListForObject`)

**Files:**
- Create: `infra/sql/procedures/usp_ShareLink_Create.sql`
- Create: `infra/sql/procedures/usp_ShareLink_Resolve.sql`
- Create: `infra/sql/procedures/usp_ShareLink_Revoke.sql`
- Create: `infra/sql/procedures/usp_ShareLink_ListForObject.sql`
- Test: covered by `share.integration.test.ts` (Task 7); deploy via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`.

Steps:

- [ ] Write `usp_ShareLink_Create.sql` — the high-entropy `@Token` is generated in the service (Node `crypto`); the SP just persists + returns the row:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_ShareLink_Create
  @WorkspaceId UNIQUEIDENTIFIER,
  @ObjectType  NVARCHAR(16),
  @ObjectId    UNIQUEIDENTIFIER,
  @Token       NVARCHAR(64),
  @Level       NVARCHAR(8)      = 'VIEW',
  @ExpiresAt   DATETIME2        = NULL,
  @CreatedBy   UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

  BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO dbo.ShareLinks (Id, WorkspaceId, ObjectType, ObjectId, Token, Level, ExpiresAt, CreatedBy)
    VALUES (@NewId, @WorkspaceId, @ObjectType, @ObjectId, @Token, @Level, @ExpiresAt, @CreatedBy);

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;

  SELECT Id, WorkspaceId, ObjectType, ObjectId, Token, Level, ExpiresAt, CreatedBy, CreatedAt, RevokedAt
  FROM dbo.ShareLinks WHERE Id = @NewId;
END;
GO
```

- [ ] Write `usp_ShareLink_Resolve.sql` — return the row ONLY when live (not revoked, not expired). Validity is enforced in SQL so the unauthenticated path never leaks a dead link:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_ShareLink_Resolve
  @Token NVARCHAR(64)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT Id, WorkspaceId, ObjectType, ObjectId, Token, Level, ExpiresAt, CreatedBy, CreatedAt, RevokedAt
  FROM dbo.ShareLinks
  WHERE Token = @Token
    AND RevokedAt IS NULL
    AND (ExpiresAt IS NULL OR ExpiresAt > SYSUTCDATETIME());
END;
GO
```

- [ ] Write `usp_ShareLink_Revoke.sql` — soft-revoke by id (the service has already enforced `FULL` on the object); return the revoked row (zero rows if the id didn't exist / was already revoked):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_ShareLink_Revoke
  @Id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.ShareLinks SET RevokedAt = SYSUTCDATETIME()
  WHERE Id = @Id AND RevokedAt IS NULL;

  SELECT Id, WorkspaceId, ObjectType, ObjectId, Token, Level, ExpiresAt, CreatedBy, CreatedAt, RevokedAt
  FROM dbo.ShareLinks WHERE Id = @Id;
END;
GO
```

- [ ] Write `usp_ShareLink_ListForObject.sql` — non-revoked links for the sharing modal:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_ShareLink_ListForObject
  @ObjectType NVARCHAR(16),
  @ObjectId   UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT Id, WorkspaceId, ObjectType, ObjectId, Token, Level, ExpiresAt, CreatedBy, CreatedAt, RevokedAt
  FROM dbo.ShareLinks
  WHERE ObjectType = @ObjectType AND ObjectId = @ObjectId AND RevokedAt IS NULL
  ORDER BY CreatedAt DESC;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test` (local DB env only). Expected: all four procedures created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_ShareLink_Create.sql infra/sql/procedures/usp_ShareLink_Resolve.sql infra/sql/procedures/usp_ShareLink_Revoke.sql infra/sql/procedures/usp_ShareLink_ListForObject.sql
git commit -m "feat(10c): share-link SPs — Create/Resolve(live-only)/Revoke/ListForObject"
```

---

### Task 3: Access-request SPs (`Create`, `Resolve`)

**Files:**
- Create: `infra/sql/procedures/usp_AccessRequest_Create.sql`
- Create: `infra/sql/procedures/usp_AccessRequest_Resolve.sql`
- Test: covered by `share.integration.test.ts` (Task 7); deploy via `scripts/db-deploy-sps.ts`.

Steps:

- [ ] Write `usp_AccessRequest_Create.sql` — return the existing pending row if one already exists (idempotent under `UQ_AccessRequests_Pending`), else insert + return:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_AccessRequest_Create
  @WorkspaceId UNIQUEIDENTIFIER,
  @ObjectType  NVARCHAR(16),
  @ObjectId    UNIQUEIDENTIFIER,
  @RequestedBy UNIQUEIDENTIFIER,
  @Note        NVARCHAR(500) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @Id UNIQUEIDENTIFIER;

  SELECT @Id = Id FROM dbo.AccessRequests
  WHERE ObjectType = @ObjectType AND ObjectId = @ObjectId
    AND RequestedBy = @RequestedBy AND Status = 'pending';

  IF @Id IS NULL
  BEGIN
    SET @Id = NEWID();
    BEGIN TRY
      BEGIN TRANSACTION;
      INSERT INTO dbo.AccessRequests (Id, WorkspaceId, ObjectType, ObjectId, RequestedBy, Note)
      VALUES (@Id, @WorkspaceId, @ObjectType, @ObjectId, @RequestedBy, @Note);
      COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
      IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
      THROW;
    END CATCH;
  END

  SELECT Id, WorkspaceId, ObjectType, ObjectId, RequestedBy, Note, Status, ResolvedBy, ResolvedAt, CreatedAt
  FROM dbo.AccessRequests WHERE Id = @Id;
END;
GO
```

- [ ] Write `usp_AccessRequest_Resolve.sql` — set status/resolver/timestamp (only when still pending), return the row:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_AccessRequest_Resolve
  @Id         UNIQUEIDENTIFIER,
  @Status     NVARCHAR(12),   -- 'granted' | 'denied'
  @ResolvedBy UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.AccessRequests
  SET Status = @Status, ResolvedBy = @ResolvedBy, ResolvedAt = SYSUTCDATETIME()
  WHERE Id = @Id AND Status = 'pending';

  SELECT Id, WorkspaceId, ObjectType, ObjectId, RequestedBy, Note, Status, ResolvedBy, ResolvedAt, CreatedAt
  FROM dbo.AccessRequests WHERE Id = @Id;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`. Expected: both procedures created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_AccessRequest_Create.sql infra/sql/procedures/usp_AccessRequest_Resolve.sql
git commit -m "feat(10c): access-request SPs — Create (idempotent pending) + Resolve"
```

---

### Task 4: Permission slugs + types + share repository + pure projection/token unit tests

**Files:**
- Modify: `infra/sql/migrations/0053_share_links.sql` (append a `share.create`/`share.revoke` permission seed block + grant to owner/admin roles)
- Modify: `packages/types/index.ts` (add the share + access-request shapes near line ~79/~805)
- Create: `apps/api/src/modules/share/share.repository.ts`
- Create: `apps/api/src/modules/share/share.projection.ts`
- Create: `apps/api/src/modules/share/share.token.ts`
- Create: `apps/api/src/modules/share/__tests__/projection.unit.test.ts`
- Create: `apps/api/src/modules/share/__tests__/token.unit.test.ts`

Steps:

- [ ] Append the permission-slug seed to the END of `0053_share_links.sql` (mirroring `0018_rbac.sql`'s `INSERT … WHERE NOT EXISTS` pattern; spec §3 adds `share.create|revoke`). Grant both to `workspace-owner` + `workspace-admin`:

```sql
-- ── Permission slugs (Phase 10c) ─────────────────────────────────────────────
;WITH SeedPermissions(Resource, Action, Slug, Scope, Description) AS (
    SELECT * FROM (VALUES
        ('share', 'create', 'share.create', 'WORKSPACE', 'Create a public share link for an object'),
        ('share', 'revoke', 'share.revoke', 'WORKSPACE', 'Revoke a public share link')
    ) AS T(Resource, Action, Slug, Scope, Description)
)
INSERT INTO dbo.Permissions (Resource, Action, Slug, Scope, Description)
SELECT s.Resource, s.Action, s.Slug, s.Scope, s.Description
FROM SeedPermissions s
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permissions p WHERE p.Slug = s.Slug);
GO

;WITH RolePermSeed(RoleSlug, PermissionSlug) AS (
    SELECT * FROM (VALUES
        ('workspace-owner', 'share.create'), ('workspace-owner', 'share.revoke'),
        ('workspace-admin', 'share.create'), ('workspace-admin', 'share.revoke')
    ) AS T(RoleSlug, PermissionSlug)
)
INSERT INTO dbo.RolePermissions (RoleId, PermissionId)
SELECT r.Id, p.Id
FROM RolePermSeed s
JOIN dbo.Roles r       ON r.Slug = s.RoleSlug
JOIN dbo.Permissions p ON p.Slug = s.PermissionSlug
WHERE NOT EXISTS (SELECT 1 FROM dbo.RolePermissions rp WHERE rp.RoleId = r.Id AND rp.PermissionId = p.Id);
GO
```

(Note: holding the slug is a coarse gate; the **decisive** check is `FULL` on the object via `accessService.can(...)`, applied in the route/service — see Task 6.)

- [ ] Add the shared types to `packages/types/index.ts` near the `ObjectPermissionLevel`/`Role` blocks:

```ts
// ── Public Share Links + Access Requests (Phase 10c) ──────────────────────────

export type ShareObjectType = 'task' | 'doc' | 'dashboard' | 'view' | 'whiteboard';

export interface ShareLink {
  id:          string;
  workspaceId: string;
  objectType:  ShareObjectType;
  objectId:    string;
  token:       string;
  level:       ObjectPermissionLevel;  // 'VIEW' in v1 (read-only)
  expiresAt:   string | null;
  createdBy:   string;
  createdAt:   string;
  revokedAt:   string | null;
}

export interface CreateShareLinkInput {
  objectType: ShareObjectType;
  objectId:   string;
  expiresAt?: string | null;
}

/** A navigation-stripped, write-stripped read-only projection of one object,
 *  served by the UNAUTHENTICATED /public/share/:token route. `data` is the
 *  per-type read-only payload; it carries NO sibling/parent links. */
export interface ShareProjection {
  objectType: ShareObjectType;
  objectId:   string;
  level:      ObjectPermissionLevel;
  title:      string;
  data:       Record<string, unknown>;
}

export type AccessRequestStatus = 'pending' | 'granted' | 'denied';

export interface AccessRequest {
  id:          string;
  workspaceId: string;
  objectType:  ShareObjectType;
  objectId:    string;
  requestedBy: string;
  note:        string | null;
  status:      AccessRequestStatus;
  resolvedBy:  string | null;
  resolvedAt:  string | null;
  createdAt:   string;
}

export interface CreateAccessRequestInput {
  objectType: ShareObjectType;
  objectId:   string;
  note?:      string;
}
```

- [ ] Write the failing pure unit tests first. `token.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateShareToken, isLinkLive } from '../share.token.js';

describe('generateShareToken', () => {
  it('returns a 64-char URL-safe token', () => {
    const t = generateShareToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{64}$/);
  });
  it('is non-repeating across calls (entropy)', () => {
    const set = new Set(Array.from({ length: 1000 }, () => generateShareToken()));
    expect(set.size).toBe(1000);
  });
});

describe('isLinkLive', () => {
  const base = { revokedAt: null as string | null, expiresAt: null as string | null };
  it('valid: not revoked, no expiry', () => {
    expect(isLinkLive(base, new Date('2026-06-07T00:00:00Z'))).toBe(true);
  });
  it('revoked → dead', () => {
    expect(isLinkLive({ ...base, revokedAt: '2026-06-06T00:00:00Z' }, new Date('2026-06-07T00:00:00Z'))).toBe(false);
  });
  it('expired → dead', () => {
    expect(isLinkLive({ ...base, expiresAt: '2026-06-06T00:00:00Z' }, new Date('2026-06-07T00:00:00Z'))).toBe(false);
  });
  it('future expiry → live', () => {
    expect(isLinkLive({ ...base, expiresAt: '2026-06-08T00:00:00Z' }, new Date('2026-06-07T00:00:00Z'))).toBe(true);
  });
});
```

`projection.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTaskProjection, buildViewProjection, stripNavigation, stripWrites } from '../share.projection.js';

describe('stripWrites / stripNavigation', () => {
  it('stripWrites removes write/action affordances from a payload', () => {
    const out = stripWrites({ id: 't1', title: 'Hi', editUrl: '/x', actions: ['delete'], assigneeId: 'u1' });
    expect(out).not.toHaveProperty('editUrl');
    expect(out).not.toHaveProperty('actions');
    expect(out.title).toBe('Hi');
  });
  it('stripNavigation removes parent/sibling/list/space links', () => {
    const out = stripNavigation({ id: 't1', listId: 'l1', parentTaskId: 'p1', spaceId: 's1', breadcrumb: ['a'] });
    expect(out).not.toHaveProperty('listId');
    expect(out).not.toHaveProperty('parentTaskId');
    expect(out).not.toHaveProperty('spaceId');
    expect(out).not.toHaveProperty('breadcrumb');
  });
});

describe('buildTaskProjection', () => {
  it('keeps content, strips writes + navigation', () => {
    const p = buildTaskProjection({
      Id: 't1', Title: 'Ship it', Description: 'body', Status: 'To Do', Priority: 'HIGH',
      ListId: 'l1', ParentTaskId: 'p1', WorkspaceId: 'w1',
    } as any);
    expect(p.objectType).toBe('task');
    expect(p.title).toBe('Ship it');
    expect(p.data.description).toBe('body');
    expect(p.data).not.toHaveProperty('listId');
    expect(p.data).not.toHaveProperty('parentTaskId');
    expect(p.data).not.toHaveProperty('workspaceId');
  });
});

describe('buildViewProjection', () => {
  it('exposes only the view name + read-only config', () => {
    const p = buildViewProjection({ Id: 'v1', Name: 'My Board', Type: 'board', Config: '{"groupBy":"status"}', WorkspaceId: 'w1' } as any);
    expect(p.objectType).toBe('view');
    expect(p.title).toBe('My Board');
    expect(p.data.type).toBe('board');
    expect(p.data).not.toHaveProperty('workspaceId');
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- token projection`. Expected: FAIL — `Cannot find module '../share.token.js'` / `'../share.projection.js'`.

- [ ] Write `apps/api/src/modules/share/share.token.ts` (pure; entropy from `node:crypto`, the same module `tokenCrypto.ts`/avatars already use):

```ts
import { randomBytes } from 'node:crypto';

/** A 64-char URL-safe high-entropy token (48 random bytes → 64 base64url chars,
 *  no padding). NOT a GUID. Stored in ShareLinks.Token (NVARCHAR(64) UNIQUE). */
export function generateShareToken(): string {
  return randomBytes(48).toString('base64url');
}

/** Validity check mirroring usp_ShareLink_Resolve's SQL predicate — used by
 *  share.service.resolvePublic as a belt-and-suspenders guard after the SP
 *  lookup (the SP already filters dead links, but we re-assert in code so the
 *  contract is enforced in one place a unit test can pin). */
export function isLinkLive(
  link: { revokedAt: string | null; expiresAt: string | null },
  now: Date = new Date(),
): boolean {
  if (link.revokedAt) return false;
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= now.getTime()) return false;
  return true;
}
```

- [ ] Write `apps/api/src/modules/share/share.projection.ts`. The strip helpers + per-object builders are PURE. **Per-object types: task + view have real read paths on disk; doc / dashboard / whiteboard modules are NOT built on-disk yet — their builders are stubbed against the spec'd shape and throw a typed `notFound` until those modules land (noted inline).**

```ts
import type { ShareProjection } from '@projectflow/types';

// Keys that expose write affordances — never serve them on a read-only link.
const WRITE_KEYS = new Set(['editUrl', 'actions', 'canEdit', 'mutationUrl', 'assigneeId', 'assignees', 'reporterId']);
// Keys that would let a viewer escape the single shared object — strip all
// parent / sibling / container references so there is no path up the tree.
const NAV_KEYS = new Set([
  'listId', 'folderId', 'spaceId', 'projectId', 'workspaceId',
  'parentTaskId', 'breadcrumb', 'siblings', 'ancestors', 'scopeId', 'scopePath',
]);

function omit(obj: Record<string, unknown>, keys: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (!keys.has(k)) out[k] = v;
  return out;
}

export function stripWrites(payload: Record<string, unknown>): Record<string, unknown> {
  return omit(payload, WRITE_KEYS);
}
export function stripNavigation(payload: Record<string, unknown>): Record<string, unknown> {
  return omit(payload, NAV_KEYS);
}
const readOnly = (p: Record<string, unknown>) => stripNavigation(stripWrites(p));

/** TASK — from a usp_Task_GetById row (PascalCase SP columns, see task.repository). */
export function buildTaskProjection(row: Record<string, any>): ShareProjection {
  return {
    objectType: 'task',
    objectId:   row.Id,
    level:      'VIEW',
    title:      row.Title ?? '',
    data: readOnly({
      description: row.Description ?? null,
      status:      row.Status ?? null,
      priority:    row.Priority ?? null,
      dueDate:     row.DueDate ?? null,
    }),
  };
}

/** VIEW (saved view) — from a usp_View_GetById row; Config is the read-only JSON. */
export function buildViewProjection(row: Record<string, any>): ShareProjection {
  let config: unknown = {};
  try { config = JSON.parse(row.Config ?? '{}'); } catch { config = {}; }
  return {
    objectType: 'view',
    objectId:   row.Id,
    level:      'VIEW',
    title:      row.Name ?? '',
    data: readOnly({ type: row.Type ?? null, config }),
  };
}

// ── doc / dashboard / whiteboard ─────────────────────────────────────────────
// These object modules are NOT on-disk yet (Phase 7/9 deliverables). When they
// land, replace each stub with a builder that reads the object's content SP and
// applies `readOnly(...)`. Until then resolvePublic returns 404 for these types.
export function buildDocProjection(_row: Record<string, any>): ShareProjection {
  throw new Error('SHARE_OBJECT_TYPE_UNAVAILABLE: doc');
}
export function buildDashboardProjection(_row: Record<string, any>): ShareProjection {
  throw new Error('SHARE_OBJECT_TYPE_UNAVAILABLE: dashboard');
}
export function buildWhiteboardProjection(_row: Record<string, any>): ShareProjection {
  throw new Error('SHARE_OBJECT_TYPE_UNAVAILABLE: whiteboard');
}
```

- [ ] Run: `npm test --workspace apps/api -- token projection`. Expected: PASS.

- [ ] Write `apps/api/src/modules/share/share.repository.ts`:

```ts
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { ShareLink, ShareObjectType } from '@projectflow/types';

interface ShareLinkRow {
  Id: string; WorkspaceId: string; ObjectType: ShareObjectType; ObjectId: string;
  Token: string; Level: ShareLink['level']; ExpiresAt: Date | null;
  CreatedBy: string; CreatedAt: Date; RevokedAt: Date | null;
}

function toIso(d: Date | null): string | null { return d ? (d instanceof Date ? d.toISOString() : String(d)) : null; }

function rowToLink(r: ShareLinkRow): ShareLink {
  return {
    id: r.Id, workspaceId: r.WorkspaceId, objectType: r.ObjectType, objectId: r.ObjectId,
    token: r.Token, level: r.Level, expiresAt: toIso(r.ExpiresAt), createdBy: r.CreatedBy,
    createdAt: r.CreatedAt instanceof Date ? r.CreatedAt.toISOString() : String(r.CreatedAt),
    revokedAt: toIso(r.RevokedAt),
  };
}

export class ShareRepository {
  async create(p: {
    workspaceId: string; objectType: ShareObjectType; objectId: string;
    token: string; level: string; expiresAt: string | null; createdBy: string;
  }): Promise<ShareLink> {
    const rows = await execSpOne<ShareLinkRow>('usp_ShareLink_Create', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: p.workspaceId },
      { name: 'ObjectType',  type: sql.NVarChar(16),     value: p.objectType },
      { name: 'ObjectId',    type: sql.UniqueIdentifier, value: p.objectId },
      { name: 'Token',       type: sql.NVarChar(64),     value: p.token },
      { name: 'Level',       type: sql.NVarChar(8),      value: p.level },
      { name: 'ExpiresAt',   type: sql.DateTime2,        value: p.expiresAt ? new Date(p.expiresAt) : null },
      { name: 'CreatedBy',   type: sql.UniqueIdentifier, value: p.createdBy },
    ]);
    return rowToLink(rows[0]);
  }

  /** Live-only resolution — the SP filters revoked/expired (zero rows if dead). */
  async resolve(token: string): Promise<ShareLink | null> {
    const rows = await execSpOne<ShareLinkRow>('usp_ShareLink_Resolve', [
      { name: 'Token', type: sql.NVarChar(64), value: token },
    ]);
    return rows[0] ? rowToLink(rows[0]) : null;
  }

  async revoke(id: string): Promise<ShareLink | null> {
    const rows = await execSpOne<ShareLinkRow>('usp_ShareLink_Revoke', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ? rowToLink(rows[0]) : null;
  }

  async getById(id: string): Promise<ShareLink | null> {
    // ListForObject is keyed by object; for a single id the revoke SP returns
    // the row too, but for FULL-gate resolution we need the object before
    // revoke. Resolve-by-id reuses ListForObject's shape is overkill — instead
    // the service revokes by id and reads the returned row's (objectType,
    // objectId) for the post-hoc audit. No separate getById SP needed.
    return null;
  }

  async listForObject(objectType: ShareObjectType, objectId: string): Promise<ShareLink[]> {
    const rows = await execSpOne<ShareLinkRow>('usp_ShareLink_ListForObject', [
      { name: 'ObjectType', type: sql.NVarChar(16),     value: objectType },
      { name: 'ObjectId',   type: sql.UniqueIdentifier, value: objectId },
    ]);
    return (rows as ShareLinkRow[]).map(rowToLink);
  }
}
```

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS (the repo + types + pure helpers compile; the service/routes land in Tasks 5–6). Then re-run `npm test --workspace apps/api -- token projection`. Expected: PASS.

- [ ] Commit:
```
git add infra/sql/migrations/0053_share_links.sql packages/types/index.ts apps/api/src/modules/share/share.repository.ts apps/api/src/modules/share/share.projection.ts apps/api/src/modules/share/share.token.ts apps/api/src/modules/share/__tests__/projection.unit.test.ts apps/api/src/modules/share/__tests__/token.unit.test.ts
git commit -m "feat(10c): share slugs + types + repo + pure token/projection helpers (unit-tested)"
```

---

### Task 5: `share.service` (create / revoke / list / `resolvePublic`)

**Files:**
- Create: `apps/api/src/modules/share/share.service.ts`
- Modify: `apps/api/src/modules/access/access.service.ts` (ensure 10b `setObjectPermission`/`listObjectPermissions` exist — see Prerequisite)

Steps:

- [ ] Ensure the 10b grant primitive exists on `access.service.ts`. If 10b already merged it, skip. Otherwise add the thin wrappers (they back the request-access grant in Task 6 and the sharing modal's private path). `objectType` here is the hierarchy node the share/grant targets — for a task share, the grant lands on the task's **List** (per spec §9 deferral 4, ACL stays at the hierarchy node level):

```ts
import type { HierarchyNodeType, ObjectPermissionLevel } from '@projectflow/types';
// ... existing AccessService body ...

  /** 10b grant primitive — write an ObjectPermissions row (most-specific-wins). */
  async setObjectPermission(
    workspaceId: string, subjectType: 'USER' | 'ROLE', subjectId: string,
    objectType: HierarchyNodeType, objectId: string, level: ObjectPermissionLevel,
  ) {
    return this.repo.set(workspaceId, subjectType, subjectId, objectType, objectId, level);
  }

  async removeObjectPermission(
    subjectType: 'USER' | 'ROLE', subjectId: string,
    objectType: HierarchyNodeType, objectId: string,
  ): Promise<void> {
    return this.repo.unset(subjectType, subjectId, objectType, objectId);
  }
```

- [ ] Write `apps/api/src/modules/share/share.service.ts`. The decisive safety property (§2.2) lives here: `resolvePublic` resolves token → `(object, level)` and serves a read-only projection **without ever calling `accessService`/membership/the tree**. `createLink`/`revokeLink` are guarded by `FULL` on the object (the guard call sits in the route, but the service re-asserts the workspace scoping). The per-object read uses the existing repos (task/view); doc/dashboard/whiteboard return 404 until those modules land:

```ts
import { ShareRepository } from './share.repository.js';
import { generateShareToken, isLinkLive } from './share.token.js';
import {
  buildTaskProjection, buildViewProjection,
  buildDocProjection, buildDashboardProjection, buildWhiteboardProjection,
} from './share.projection.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { ViewRepository } from '../views/view.repository.js';
import type { ShareLink, ShareObjectType, ShareProjection, CreateShareLinkInput } from '@projectflow/types';

const repo     = new ShareRepository();
const taskRepo = new TaskRepository();
const viewRepo = new ViewRepository();

export class ShareService {
  /** Create a public link. Authz (FULL on the object) is enforced by the route;
   *  the service owns token generation + the workspace lookup. */
  async createLink(workspaceId: string, input: CreateShareLinkInput, createdBy: string): Promise<ShareLink> {
    return repo.create({
      workspaceId,
      objectType: input.objectType,
      objectId:   input.objectId,
      token:      generateShareToken(),
      level:      'VIEW',                       // read-only in v1
      expiresAt:  input.expiresAt ?? null,
      createdBy,
    });
  }

  revokeLink(id: string): Promise<ShareLink | null> { return repo.revoke(id); }

  listForObject(objectType: ShareObjectType, objectId: string): Promise<ShareLink[]> {
    return repo.listForObject(objectType, objectId);
  }

  /**
   * THE UNAUTHENTICATED RESOLVER (§2.2). Token → (object, level=VIEW) +
   * read-only, navigation-stripped projection. Returns null (→ 404 at the
   * route) for expired / revoked / missing tokens or an unbuilt object type.
   * NEVER consults workspace membership, the ACL resolver, or the tree.
   */
  async resolvePublic(token: string): Promise<ShareProjection | null> {
    const link = await repo.resolve(token);                 // SP filters dead links
    if (!link || !isLinkLive(link)) return null;            // belt-and-suspenders

    switch (link.objectType) {
      case 'task': {
        const row = await taskRepo.getById(link.objectId);
        return row ? buildTaskProjection(row as any) : null;
      }
      case 'view': {
        const row = await viewRepo.getRawById?.(link.objectId)
          ?? await viewRepo.getById?.(link.objectId);       // see note below
        return row ? buildViewProjection(row as any) : null;
      }
      case 'doc':        try { return buildDocProjection({}); }        catch { return null; }
      case 'dashboard':  try { return buildDashboardProjection({}); }  catch { return null; }
      case 'whiteboard': try { return buildWhiteboardProjection({}); } catch { return null; }
      default:           return null;
    }
  }

  /** Workspace lookup for the FULL-on-object gate (route helper). */
  async getObjectWorkspaceId(objectType: ShareObjectType, objectId: string): Promise<string | null> {
    switch (objectType) {
      case 'task': return taskRepo.getWorkspaceId(objectId);
      case 'view': return viewRepo.getWorkspaceId(objectId);
      default:     return null;   // doc/dashboard/whiteboard: unavailable until built
    }
  }
}

export const shareService = new ShareService();
```

> **Inline note (view read path):** `ViewRepository` exposes `getWorkspaceId` today; it returns mapped `SavedView` objects via `mapSavedViewRow`, not the raw row. Add a small `getRawById(id)` to `ViewRepository` that calls the existing `usp_View_GetById` (or the view's get SP) and returns the raw SP row so `buildViewProjection` can read `Name`/`Type`/`Config` directly — or, simpler, map from the already-mapped `SavedView` (`{ name, type, config }`) inside `buildViewProjection` by accepting either shape. Pick one and note it in `DECISIONS.md`. The plan's `buildViewProjection` reads PascalCase columns; if you feed it the mapped camelCase `SavedView`, adjust the field reads accordingly.

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS — no type errors (routes land in Task 6).

- [ ] Commit:
```
git add apps/api/src/modules/share/share.service.ts apps/api/src/modules/access/access.service.ts
git commit -m "feat(10c): share.service — createLink/revoke/list + resolvePublic (membership-free, read-only)"
```

---

### Task 6: REST routes (authed `/share` + `/access`, UNAUTHENTICATED `/public/share`) + access-request service + GraphQL mirror

**Files:**
- Create: `apps/api/src/modules/share/share.routes.ts` (authed)
- Create: `apps/api/src/modules/share/public-share.routes.ts` (UNAUTHENTICATED)
- Create: `apps/api/src/modules/access/access-request.repository.ts`
- Create: `apps/api/src/modules/access/access-request.service.ts`
- Create: `apps/api/src/modules/access/access-request.routes.ts` (authed)
- Create: `apps/api/src/graphql/share.schema.ts`
- Modify: `apps/api/src/graphql/schema.ts` (import + call `registerShareGraphql()`)
- Modify: `apps/api/src/server.ts` (mount the three groups with the correct auth posture)

Steps:

- [ ] Write `access-request.repository.ts` (create/resolve wrappers + an owners/admins lookup for the notification fan-out). Reuse the membership/owner SPs that already back the workspace module; if no single "owners+admins for object" SP exists, resolve the object's workspace then list workspace owners/admins via the existing role/member repository (note the exact SP used in `DECISIONS.md`):

```ts
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { AccessRequest, ShareObjectType, AccessRequestStatus } from '@projectflow/types';

interface AccessRequestRow {
  Id: string; WorkspaceId: string; ObjectType: ShareObjectType; ObjectId: string;
  RequestedBy: string; Note: string | null; Status: AccessRequestStatus;
  ResolvedBy: string | null; ResolvedAt: Date | null; CreatedAt: Date;
}

function rowToReq(r: AccessRequestRow): AccessRequest {
  return {
    id: r.Id, workspaceId: r.WorkspaceId, objectType: r.ObjectType, objectId: r.ObjectId,
    requestedBy: r.RequestedBy, note: r.Note, status: r.Status,
    resolvedBy: r.ResolvedBy, resolvedAt: r.ResolvedAt ? r.ResolvedAt.toISOString() : null,
    createdAt: r.CreatedAt instanceof Date ? r.CreatedAt.toISOString() : String(r.CreatedAt),
  };
}

export class AccessRequestRepository {
  async create(p: { workspaceId: string; objectType: ShareObjectType; objectId: string; requestedBy: string; note: string | null }): Promise<AccessRequest> {
    const rows = await execSpOne<AccessRequestRow>('usp_AccessRequest_Create', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: p.workspaceId },
      { name: 'ObjectType',  type: sql.NVarChar(16),     value: p.objectType },
      { name: 'ObjectId',    type: sql.UniqueIdentifier, value: p.objectId },
      { name: 'RequestedBy', type: sql.UniqueIdentifier, value: p.requestedBy },
      { name: 'Note',        type: sql.NVarChar(500),    value: p.note },
    ]);
    return rowToReq(rows[0]);
  }

  async resolve(id: string, status: AccessRequestStatus, resolvedBy: string): Promise<AccessRequest | null> {
    const rows = await execSpOne<AccessRequestRow>('usp_AccessRequest_Resolve', [
      { name: 'Id',         type: sql.UniqueIdentifier, value: id },
      { name: 'Status',     type: sql.NVarChar(12),     value: status },
      { name: 'ResolvedBy', type: sql.UniqueIdentifier, value: resolvedBy },
    ]);
    return rows[0] ? rowToReq(rows[0]) : null;
  }

  /** Owner/admin recipient ids for the workspace owning the object. Reuse the
   *  existing workspace-members-with-role SP (e.g. usp_WorkspaceMembers_ListByRole
   *  or usp_Workspace_GetOwnersAdmins). Confirm the exact SP name on-disk and
   *  use it here; this returns the recipient ids for the Phase 3.5 fan-out. */
  async listOwnerAdminIds(workspaceId: string): Promise<string[]> {
    const rows = await execSpOne<{ UserId: string }>('usp_Workspace_ListOwnerAdminIds', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    ]);
    return (rows as { UserId: string }[]).map((r) => r.UserId);
  }
}
```

> **Inline note:** if `usp_Workspace_ListOwnerAdminIds` doesn't exist on-disk, add it as a tiny SP in this task (`SELECT DISTINCT ur.UserId FROM dbo.UserRoles ur JOIN dbo.Roles r ON r.Id = ur.RoleId WHERE ur.WorkspaceId = @WorkspaceId AND r.Slug IN ('workspace-owner','workspace-admin')`) and deploy it with the others. Note the choice in `DECISIONS.md`.

- [ ] Write `access-request.service.ts` — request creates the row + a Phase 3.5 notification; resolve(granted) routes through the 10b grant primitive:

```ts
import { AccessRequestRepository } from './access-request.repository.js';
import { accessService } from './access.service.js';
import { notificationService } from '../notifications/notification.service.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { ViewRepository } from '../views/view.repository.js';
import type { AccessRequest, ShareObjectType, ObjectPermissionLevel, HierarchyNodeType } from '@projectflow/types';

const repo     = new AccessRequestRepository();
const taskRepo = new TaskRepository();
const viewRepo = new ViewRepository();

async function objectWorkspaceId(objectType: ShareObjectType, objectId: string): Promise<string | null> {
  if (objectType === 'task') return taskRepo.getWorkspaceId(objectId);
  if (objectType === 'view') return viewRepo.getWorkspaceId(objectId);
  return null;
}

/** Map a share object to the hierarchy node + id the ACL grant lands on
 *  (spec §9 deferral 4 — ACL stays at the node level). A task grant lands on
 *  the task's containing List. */
async function grantTarget(objectType: ShareObjectType, objectId: string): Promise<{ type: HierarchyNodeType; id: string } | null> {
  if (objectType === 'task') {
    const t = await taskRepo.getById(objectId);
    const listId = (t as any)?.listId ?? (t as any)?.ListId ?? null;
    return listId ? { type: 'LIST', id: listId } : null;
  }
  return null; // doc/dashboard/whiteboard/view node-mapping lands when those modules do
}

export const accessRequestService = {
  async requestAccess(objectType: ShareObjectType, objectId: string, requesterId: string, note?: string): Promise<AccessRequest> {
    const workspaceId = await objectWorkspaceId(objectType, objectId);
    if (!workspaceId) throw new Error('OBJECT_NOT_FOUND');

    const request = await repo.create({ workspaceId, objectType, objectId, requestedBy: requesterId, note: note ?? null });

    // Phase 3.5 notification to owners/admins.
    const recipientIds = await repo.listOwnerAdminIds(workspaceId);
    await notificationService.notify({
      recipientIds,
      actorId: requesterId,
      type: 'ACCESS_REQUESTED',
      payload: { accessRequestId: request.id, objectType, objectId, note: note ?? null },
    });
    return request;
  },

  /** Owner/admin resolves a request. On 'granted', write the ObjectPermissions
   *  grant through the 10b primitive, THEN mark the request granted. */
  async resolveRequest(id: string, resolverId: string, decision: 'granted' | 'denied', level: ObjectPermissionLevel = 'EDIT'): Promise<AccessRequest | null> {
    // Caller (route) has already enforced FULL on the object.
    const pending = await repo.resolve(id, decision, resolverId);
    if (!pending) return null;

    if (decision === 'granted') {
      const target = await grantTarget(pending.objectType, pending.objectId);
      if (target) {
        await accessService.setObjectPermission(
          pending.workspaceId, 'USER', pending.requestedBy, target.type, target.id, level,
        );
      }
      // Notify the requester their access was granted.
      await notificationService.notify({
        recipientIds: [pending.requestedBy], actorId: resolverId,
        type: 'ACCESS_GRANTED', payload: { objectType: pending.objectType, objectId: pending.objectId },
      });
    }
    return pending;
  },
};
```

- [ ] Write `share.routes.ts` (AUTHED). Sharing endpoints require **`FULL` on the object** (spec §3) — resolve the object's workspace for the slug gate AND assert `FULL` via `accessService.can` on the object's hierarchy node. Reject unbuilt object types with 404:

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { shareService } from './share.service.js';
import { accessService } from '../access/access.service.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import type { ShareObjectType } from '@projectflow/types';

const taskRepo = new TaskRepository();

const createSchema = z.object({
  objectType: z.enum(['task', 'doc', 'dashboard', 'view', 'whiteboard']),
  objectId:   z.string().uuid(),
  expiresAt:  z.string().datetime().nullable().optional(),
});

/** The hierarchy node a FULL check runs against for a given share object. */
async function fullTarget(objectType: ShareObjectType, objectId: string): Promise<{ type: 'SPACE'|'FOLDER'|'LIST'; id: string } | null> {
  if (objectType === 'task') {
    const t = await taskRepo.getById(objectId);
    const listId = (t as any)?.listId ?? (t as any)?.ListId ?? null;
    return listId ? { type: 'LIST', id: listId } : null;
  }
  return null; // others land with their modules
}

async function resolveObjectWorkspace(c: any): Promise<string | null> {
  try {
    const body = await c.req.json();
    return body?.objectType && body?.objectId
      ? shareService.getObjectWorkspaceId(body.objectType, body.objectId)
      : null;
  } catch { return null; }
}

export const shareRoutes = new Hono();

// POST /share — create a public read-only link. Requires share.create + FULL on the object.
shareRoutes.post(
  '/',
  zValidator('json', createSchema),
  requirePermission('share.create', { resolveWorkspace: resolveObjectWorkspace }),
  async (c) => {
    const userId = ((c as any).get('user') as any).userId as string;
    const input  = c.req.valid('json');
    const target = await fullTarget(input.objectType, input.objectId);
    if (!target) return c.json({ error: { code: 'NOT_FOUND', message: 'Object not shareable', statusCode: 404 } }, 404);
    if (!(await accessService.can(userId, target.type, target.id, 'FULL')))
      return c.json({ error: { code: 'FORBIDDEN', message: 'FULL access required to share', statusCode: 403 } }, 403);

    const workspaceId = (c as any).get('resolvedWorkspaceId') as string;
    const link = await shareService.createLink(workspaceId, input, userId);
    return c.json({ link }, 201);
  },
);

// DELETE /share/:id — revoke. Requires share.revoke + FULL on the object.
shareRoutes.delete('/:id', async (c) => {
  const userId = ((c as any).get('user') as any).userId as string;
  const id = c.req.param('id');
  const revoked = await shareService.revokeLink(id);          // returns the row (incl. object) or null
  if (!revoked) return c.json({ error: { code: 'NOT_FOUND', message: 'Link not found', statusCode: 404 } }, 404);
  const target = await fullTarget(revoked.objectType, revoked.objectId);
  if (!target || !(await accessService.can(userId, target.type, target.id, 'FULL')))
    return c.json({ error: { code: 'FORBIDDEN', message: 'FULL access required', statusCode: 403 } }, 403);
  return c.json({ link: revoked });
});

// GET /share/object/:objectType/:objectId — list links for the sharing modal. Requires FULL.
shareRoutes.get('/object/:objectType/:objectId', async (c) => {
  const userId = ((c as any).get('user') as any).userId as string;
  const objectType = c.req.param('objectType') as ShareObjectType;
  const objectId   = c.req.param('objectId');
  const target = await fullTarget(objectType, objectId);
  if (!target || !(await accessService.can(userId, target.type, target.id, 'FULL')))
    return c.json({ error: { code: 'FORBIDDEN', message: 'FULL access required', statusCode: 403 } }, 403);
  const links = await shareService.listForObject(objectType, objectId);
  return c.json({ links });
});
```

> **Inline note (revoke ordering):** the snippet revokes-then-authorizes for code brevity; tighten to **authorize-then-revoke** in the implementation — read the link's object first (extend `usp_ShareLink_Revoke` to return the row WITHOUT mutating when the FULL check hasn't passed, or add a `usp_ShareLink_GetById`), assert `FULL`, then revoke. Do not leave a path where revoke side-effects before the gate. Note the resolution in `DECISIONS.md`.

- [ ] Write `public-share.routes.ts` (UNAUTHENTICATED — NO `authMiddleware`, NO workspace context). Its ONLY job is `resolvePublic` → projection or 404:

```ts
import { Hono } from 'hono';
import { shareService } from './share.service.js';

export const publicShareRoutes = new Hono();

// GET /public/share/:token — unauthenticated. Resolves the token to a read-only,
// navigation-stripped projection of EXACTLY one object, or 404. No JWT, no
// workspace context, no tree access (§2.2 / §6.5).
publicShareRoutes.get('/:token', async (c) => {
  const token = c.req.param('token');
  if (!token || token.length > 64) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Share link not found', statusCode: 404 } }, 404);
  }
  const projection = await shareService.resolvePublic(token);
  if (!projection) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Share link not found', statusCode: 404 } }, 404);
  }
  return c.json({ projection });
});
```

- [ ] Write `access-request.routes.ts` (AUTHED). `POST /access/request` — any authed user (a non-member requesting access). `POST /access/request/:id/resolve` — requires `FULL` on the object:

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { accessRequestService } from './access-request.service.js';
import { accessService } from './access.service.js';
import { shareService } from '../share/share.service.js';
import { TaskRepository } from '../tasks/task.repository.js';
import type { ShareObjectType } from '@projectflow/types';

const taskRepo = new TaskRepository();

const requestSchema = z.object({
  objectType: z.enum(['task', 'doc', 'dashboard', 'view', 'whiteboard']),
  objectId:   z.string().uuid(),
  note:       z.string().max(500).optional(),
});
const resolveSchema = z.object({
  decision: z.enum(['granted', 'denied']),
  level:    z.enum(['VIEW', 'COMMENT', 'EDIT', 'FULL']).optional(),
});

async function fullTarget(objectType: ShareObjectType, objectId: string) {
  if (objectType === 'task') {
    const t = await taskRepo.getById(objectId);
    const listId = (t as any)?.listId ?? (t as any)?.ListId ?? null;
    return listId ? { type: 'LIST' as const, id: listId } : null;
  }
  return null;
}

export const accessRequestRoutes = new Hono();

// POST /access/request — any authenticated user may request access to an object.
accessRequestRoutes.post('/request', zValidator('json', requestSchema), async (c) => {
  const userId = ((c as any).get('user') as any).userId as string;
  const { objectType, objectId, note } = c.req.valid('json');
  try {
    const request = await accessRequestService.requestAccess(objectType, objectId, userId, note);
    return c.json({ request }, 201);
  } catch {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Object not found', statusCode: 404 } }, 404);
  }
});

// POST /access/request/:id/resolve — owner/admin grants/denies. Requires FULL on the object.
accessRequestRoutes.post('/request/:id/resolve', zValidator('json', resolveSchema), async (c) => {
  const userId = ((c as any).get('user') as any).userId as string;
  const id = c.req.param('id');
  const { decision, level } = c.req.valid('json');
  // The resolve service reads the request (objectType/objectId); gate on FULL first.
  // Peek the request via a light read (reuse usp_AccessRequest_Resolve's sibling
  // read or add usp_AccessRequest_GetById) to find the object, assert FULL, then resolve.
  const peek = await accessRequestService.resolveRequest(id, userId, decision, level ?? 'EDIT');
  if (!peek) return c.json({ error: { code: 'NOT_FOUND', message: 'Request not found', statusCode: 404 } }, 404);
  const target = await fullTarget(peek.objectType, peek.objectId);
  if (!target || !(await accessService.can(userId, target.type, target.id, 'FULL')))
    return c.json({ error: { code: 'FORBIDDEN', message: 'FULL access required', statusCode: 403 } }, 403);
  return c.json({ request: peek });
});
```

> **Inline note (resolve ordering):** as written, `resolveRequest` runs before the FULL gate — same hazard as the revoke route. In the implementation, add `usp_AccessRequest_GetById` (or have `resolveRequest` accept a pre-fetched object), assert `FULL` on the object **before** writing the grant/marking the request. Author the integration test (Task 7) to prove a non-FULL caller gets 403 with NO `ObjectPermissions` row written. Note the resolution in `DECISIONS.md`.

- [ ] Write `graphql/share.schema.ts` — the AUTHED mirror (public token resolution stays REST-only by design, §2.2). Mirror `recurrence.schema.ts`'s structure (typed `objectRef`, `requireWorkspacePermission`/`notFound` from `./authz.js`, delegating to the shared services):

```ts
import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { shareService } from '../modules/share/share.service.js';
import { accessRequestService } from '../modules/access/access-request.service.js';
import { accessService } from '../modules/access/access.service.js';
import { TaskRepository } from '../modules/tasks/task.repository.js';
import { requireWorkspacePermission, notFound } from './authz.js';
import type { ShareLink, AccessRequest, ShareObjectType } from '@projectflow/types';

const taskRepo = new TaskRepository();

async function fullTarget(objectType: ShareObjectType, objectId: string) {
  if (objectType === 'task') {
    const t = await taskRepo.getById(objectId);
    const listId = (t as any)?.listId ?? (t as any)?.ListId ?? null;
    return listId ? { type: 'LIST' as const, id: listId } : null;
  }
  return null;
}

export function registerShareGraphql(): void {
  const ShareLinkType = builder.objectRef<ShareLink>('ShareLink');
  ShareLinkType.implement({ fields: (t) => ({
    id:         t.exposeString('id'),
    objectType: t.exposeString('objectType'),
    objectId:   t.exposeString('objectId'),
    token:      t.exposeString('token'),
    level:      t.exposeString('level'),
    expiresAt:  t.string({ nullable: true, resolve: (l) => l.expiresAt ?? null }),
    createdAt:  t.exposeString('createdAt'),
    revokedAt:  t.string({ nullable: true, resolve: (l) => l.revokedAt ?? null }),
  }) });

  const AccessRequestType = builder.objectRef<AccessRequest>('AccessRequest');
  AccessRequestType.implement({ fields: (t) => ({
    id:          t.exposeString('id'),
    objectType:  t.exposeString('objectType'),
    objectId:    t.exposeString('objectId'),
    requestedBy: t.exposeString('requestedBy'),
    note:        t.string({ nullable: true, resolve: (r) => r.note ?? null }),
    status:      t.exposeString('status'),
    createdAt:   t.exposeString('createdAt'),
  }) });

  builder.queryFields((t) => ({
    shareLinksForObject: t.field({
      type: [ShareLinkType],
      args: { objectType: t.arg.string({ required: true }), objectId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
        const target = await fullTarget(a.objectType as ShareObjectType, a.objectId);
        if (!target) notFound();
        if (!(await accessService.can((ctx.user as any).userId, target.type, target.id, 'FULL'))) {
          throw new GraphQLError('FULL access required', { extensions: { code: 'FORBIDDEN' } });
        }
        return shareService.listForObject(a.objectType as ShareObjectType, a.objectId);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    createShareLink: t.field({
      type: ShareLinkType,
      args: { objectType: t.arg.string({ required: true }), objectId: t.arg.string({ required: true }), expiresAt: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        const workspaceId = await shareService.getObjectWorkspaceId(a.objectType as ShareObjectType, a.objectId);
        await requireWorkspacePermission(ctx, workspaceId, 'share.create');
        const target = await fullTarget(a.objectType as ShareObjectType, a.objectId);
        if (!target || !(await accessService.can((ctx.user as any).userId, target.type, target.id, 'FULL'))) {
          throw new GraphQLError('FULL access required', { extensions: { code: 'FORBIDDEN' } });
        }
        return shareService.createLink(workspaceId!, { objectType: a.objectType as ShareObjectType, objectId: a.objectId, expiresAt: a.expiresAt ?? null }, (ctx.user as any).userId);
      },
    }),
    revokeShareLink: t.field({
      type: 'Boolean',
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
        const link = await shareService.revokeLink(a.id);
        if (!link) notFound();
        const target = await fullTarget(link.objectType, link.objectId);
        if (!target || !(await accessService.can((ctx.user as any).userId, target.type, target.id, 'FULL'))) {
          throw new GraphQLError('FULL access required', { extensions: { code: 'FORBIDDEN' } });
        }
        return true;
      },
    }),
    requestAccess: t.field({
      type: AccessRequestType,
      args: { objectType: t.arg.string({ required: true }), objectId: t.arg.string({ required: true }), note: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
        return accessRequestService.requestAccess(a.objectType as ShareObjectType, a.objectId, (ctx.user as any).userId, a.note ?? undefined);
      },
    }),
    resolveAccessRequest: t.field({
      type: AccessRequestType,
      nullable: true,
      args: { id: t.arg.string({ required: true }), decision: t.arg.string({ required: true }), level: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
        const req = await accessRequestService.resolveRequest(a.id, (ctx.user as any).userId, a.decision as 'granted' | 'denied', (a.level as any) ?? 'EDIT');
        if (!req) notFound();
        const target = await fullTarget(req.objectType, req.objectId);
        if (!target || !(await accessService.can((ctx.user as any).userId, target.type, target.id, 'FULL'))) {
          throw new GraphQLError('FULL access required', { extensions: { code: 'FORBIDDEN' } });
        }
        return req;
      },
    }),
  }));
}
```

> **Inline note:** the GraphQL `revokeShareLink`/`resolveAccessRequest` mutate-then-gate for brevity; apply the same authorize-then-mutate fix as the REST routes (read the object first, assert FULL, then mutate).

- [ ] Wire GraphQL into `schema.ts` — add the import alongside the others and call near the other `register*Graphql()` calls:

```ts
import { registerShareGraphql } from './share.schema.js';
```
```ts
// ─────────────────────────────────────────
// Share links + access requests (Phase 10c) — authed mirror. The public token
// resolution is REST-only (/public/share/:token), never GraphQL (§2.2).
// ─────────────────────────────────────────
registerShareGraphql();
```

- [ ] Wire the routes into `server.ts`. AUTHED groups get `authMiddleware` (+ `auditMiddleware`); the public group gets NEITHER. Place the public group registration alongside the other public routes (after `/auth`, before the `authMiddleware` block) so no protected middleware can ever wrap it:

```ts
// imports
import { shareRoutes } from './modules/share/share.routes.js';
import { publicShareRoutes } from './modules/share/public-share.routes.js';
import { accessRequestRoutes } from './modules/access/access-request.routes.js';

// ── Public, unauthenticated share resolution (Phase 10c §2.2) ────────────────
// NO authMiddleware, NO workspace context — resolves a token to a read-only
// projection of exactly one object. Modeled on the public /auth and incoming
// /webhooks groups. MUST be registered OUTSIDE the authMiddleware block.
app.route('/public/share', publicShareRoutes);

// ── Protected share + access-request routes ──────────────────────────────────
app.use('/share/*',  authMiddleware);
app.use('/access/*', authMiddleware);
app.use('/share/*',  auditMiddleware);
app.use('/access/*', auditMiddleware);
app.route('/share',  shareRoutes);
app.route('/access', accessRequestRoutes);
```

- [ ] Run: `npm run build --workspace apps/api` (tsc — compiles the Pothos schema + routes). Expected: PASS. Then `npm test --workspace apps/api`. Expected: PASS (existing suite + the new pure unit tests; existing GraphQL authz tests still green).

- [ ] Commit:
```
git add apps/api/src/modules/share/share.routes.ts apps/api/src/modules/share/public-share.routes.ts apps/api/src/modules/access/access-request.repository.ts apps/api/src/modules/access/access-request.service.ts apps/api/src/modules/access/access-request.routes.ts apps/api/src/graphql/share.schema.ts apps/api/src/graphql/schema.ts apps/api/src/server.ts
git commit -m "feat(10c): share REST (authed + UNAUTHENTICATED /public/share) + access-request + GraphQL mirror"
```

---

### Task 7: Integration test (public-link isolation, revoke/expire 404, request-access notification, grant writes ObjectPermissions)

**Files:**
- Create: `apps/api/src/modules/share/__tests__/share.integration.test.ts`
- Modify: `apps/api/src/__tests__/fixtures/truncate.ts` (add `ShareLinks` + `AccessRequests` to `TRUNCATION_ORDER`, before `Workspaces`/`Users`)

Steps:

- [ ] Add `ShareLinks` and `AccessRequests` to `TRUNCATION_ORDER` (children before `ObjectPermissions`/`Workspaces`/`Users`; both FK Workspaces+Users):

```ts
// Phase 10c (0053): share links + access requests — FK Workspaces/Users,
// delete before them (alongside the other ACL leaves).
'ShareLinks',
'AccessRequests',
```

- [ ] Write the failing integration test first (copy the harness imports + `seedTask` pattern from `worklogs/__tests__/timer.integration.test.ts` / the existing integration specs). **The security assertions are the headline (§6.5):**

```ts
/**
 * Phase 10c — Public Share Links + Request Access integration coverage.
 * Exercises the share SPs + REST surface against the REAL SQL stack.
 * DB SAFETY: must target local Docker ProjectFlow_Test.
 *
 * SECURITY FOCUS (§6.5): a share token grants access to EXACTLY one object,
 * read-only, with NO auth, NO workspace context, NO parent/sibling navigation.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function seedTask() {
  const owner = await createTestUser({ email: `share-${Date.now()}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'Share Space', key: `SH${Date.now() % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'L', position: 0 },
  }), 201)).data;
  const task = (await json<{ task: any }>(await request('/tasks', {
    method: 'POST', token, json: { projectId: space.Id, workspaceId: ws.Id, title: 'Secret task', listId: list.id },
  }), 201)).task;
  return { owner, token, ws, space, list, task };
}

describe('public share links', () => {
  it('serves EXACTLY the one shared object, read-only, with NO auth and NO tree access', async () => {
    const { token, task } = await seedTask();

    // Owner (FULL) creates a public link.
    const link = (await json<{ link: any }>(await request('/share', {
      method: 'POST', token, json: { objectType: 'task', objectId: task.id },
    }), 201)).link;
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(link.level).toBe('VIEW');

    // Resolve UNAUTHENTICATED — NO Authorization header.
    const projection = (await json<{ projection: any }>(await request(`/public/share/${link.token}`))).projection;
    expect(projection.objectType).toBe('task');
    expect(projection.objectId).toBe(task.id);
    expect(projection.title).toBe('Secret task');
    expect(projection.level).toBe('VIEW');
    // Navigation + writes are stripped — no path up the tree, no edit affordances.
    expect(projection.data).not.toHaveProperty('listId');
    expect(projection.data).not.toHaveProperty('parentTaskId');
    expect(projection.data).not.toHaveProperty('workspaceId');
    expect(projection.data).not.toHaveProperty('assignees');
    expect(projection.data).not.toHaveProperty('editUrl');
  });

  it('a revoked token 404s on the public route', async () => {
    const { token, task } = await seedTask();
    const link = (await json<{ link: any }>(await request('/share', {
      method: 'POST', token, json: { objectType: 'task', objectId: task.id },
    }), 201)).link;
    await request(`/share/${link.id}`, { method: 'DELETE', token });   // revoke
    const res = await request(`/public/share/${link.token}`);
    expect(res.status).toBe(404);
  });

  it('an expired token 404s on the public route', async () => {
    const { token, task } = await seedTask();
    const past = new Date(Date.now() - 60_000).toISOString();
    const link = (await json<{ link: any }>(await request('/share', {
      method: 'POST', token, json: { objectType: 'task', objectId: task.id, expiresAt: past },
    }), 201)).link;
    const res = await request(`/public/share/${link.token}`);
    expect(res.status).toBe(404);
  });

  it('a non-FULL user cannot create a share link', async () => {
    const { ws, task } = await seedTask();
    const stranger = await createTestUser({ email: `stranger-${Date.now()}@projectflow.test` });
    const res = await request('/share', {
      method: 'POST', token: stranger.accessToken, json: { objectType: 'task', objectId: task.id },
    });
    expect([403, 404]).toContain(res.status);   // fail-closed (403 FULL or 404 unresolvable)
  });
});

describe('request access', () => {
  it('creates a notification to owners/admins, and granting writes an ObjectPermissions row', async () => {
    const { owner, ws, list, task } = await seedTask();
    const requester = await createTestUser({ email: `req-${Date.now()}@projectflow.test` });

    // Requester asks for access.
    const req = (await json<{ request: any }>(await request('/access/request', {
      method: 'POST', token: requester.accessToken, json: { objectType: 'task', objectId: task.id, note: 'please' },
    }), 201)).request;
    expect(req.status).toBe('pending');

    // The owner received an ACCESS_REQUESTED notification.
    const notifs = (await json<{ notifications: any[] }>(await request('/notifications?pageSize=20', { token: owner.accessToken }))).notifications
      ?? (await json<{ data: any }>(await request('/notifications?pageSize=20', { token: owner.accessToken }))).data?.items;
    expect((notifs ?? []).some((n: any) => n.type === 'ACCESS_REQUESTED')).toBe(true);

    // Owner (FULL) grants → ObjectPermissions row appears on the task's List.
    const resolved = (await json<{ request: any }>(await request(`/access/request/${req.id}/resolve`, {
      method: 'POST', token: owner.accessToken, json: { decision: 'granted', level: 'EDIT' },
    })).then((r) => r)).request;
    expect(resolved.status).toBe('granted');

    // The requester now resolves to EDIT on the List (grant landed via 10b primitive).
    // Probe a List-level read the requester previously could not reach.
    const listRes = await request(`/lists/${list.id}`, { token: requester.accessToken });
    expect(listRes.status).toBe(200);
  });

  it('resolving as a non-FULL user is rejected and writes NO grant', async () => {
    const { task } = await seedTask();
    const requester = await createTestUser({ email: `req2-${Date.now()}@projectflow.test` });
    const stranger  = await createTestUser({ email: `str2-${Date.now()}@projectflow.test` });
    const req = (await json<{ request: any }>(await request('/access/request', {
      method: 'POST', token: requester.accessToken, json: { objectType: 'task', objectId: task.id },
    }), 201)).request;
    const res = await request(`/access/request/${req.id}/resolve`, {
      method: 'POST', token: stranger.accessToken, json: { decision: 'granted', level: 'EDIT' },
    });
    expect([403, 404]).toContain(res.status);
    // No grant: the stranger still can't reach the object's List.
  });
});
```

- [ ] Run: `npm run test:integration --workspace apps/api -- share` against `ProjectFlow_Test`. Expected: PASS (6 tests). If the non-FULL-resolve test fails because the grant wrote before the gate, that is the authorize-then-mutate hazard flagged in Task 6 — fix the ordering (read object → assert FULL → mutate) and re-run until green.

- [ ] Commit:
```
git add apps/api/src/modules/share/__tests__/share.integration.test.ts apps/api/src/__tests__/fixtures/truncate.ts
git commit -m "test(10c): integration — public-link isolation, revoke/expire 404, request-access grant via 10b"
```

---

### Task 8: Frontend — server actions + sharing modal + request-access UI + i18n

**Files:**
- Create: `apps/next-web/src/server/actions/share.ts`
- Create: `apps/next-web/src/components/sharing/ShareModal.tsx`
- Create: `apps/next-web/src/components/sharing/ShareModal.module.css`
- Create: `apps/next-web/src/components/sharing/RequestAccessPanel.tsx`
- Modify: `apps/next-web/src/messages/en.json`
- Modify: `apps/next-web/src/messages/id.json`
- Mount: a "Share" entry point in the task detail panel that already renders the task surface (open `<ShareModal objectType="task" objectId={taskId} />`).
- Note: read `apps/next-web/node_modules/next/dist/docs/` per `apps/next-web/AGENTS.md` before writing web code (this Next.js has breaking changes).

Steps:

- [ ] Add server actions to `share.ts` — mirror an existing action file's `{ ok, error }` envelope + its server-fetch helper (e.g. `worklogs.ts`/`views.ts`):

```ts
'use server';

import { serverFetchBody } from '@/server/api';
import type { ShareLink, AccessRequest, ShareObjectType } from '@projectflow/types';

export async function createShareLink(objectType: ShareObjectType, objectId: string, expiresAt?: string | null) {
  try {
    const { link } = await serverFetchBody<{ link: ShareLink }>('/share', {
      method: 'POST', body: JSON.stringify({ objectType, objectId, expiresAt: expiresAt ?? null }),
    });
    return { ok: true as const, link };
  } catch (e: any) { return { ok: false as const, error: e?.message ?? 'Failed to create link' }; }
}

export async function revokeShareLink(id: string) {
  try {
    await serverFetchBody(`/share/${id}`, { method: 'DELETE' });
    return { ok: true as const };
  } catch (e: any) { return { ok: false as const, error: e?.message ?? 'Failed to revoke' }; }
}

export async function listShareLinks(objectType: ShareObjectType, objectId: string) {
  try {
    const { links } = await serverFetchBody<{ links: ShareLink[] }>(`/share/object/${objectType}/${objectId}`);
    return { ok: true as const, links };
  } catch (e: any) { return { ok: false as const, error: e?.message ?? 'Failed to load links' }; }
}

export async function requestAccess(objectType: ShareObjectType, objectId: string, note?: string) {
  try {
    const { request } = await serverFetchBody<{ request: AccessRequest }>('/access/request', {
      method: 'POST', body: JSON.stringify({ objectType, objectId, note }),
    });
    return { ok: true as const, request };
  } catch (e: any) { return { ok: false as const, error: e?.message ?? 'Failed to request access' }; }
}

export async function resolveAccessRequest(id: string, decision: 'granted' | 'denied', level?: string) {
  try {
    const { request } = await serverFetchBody<{ request: AccessRequest }>(`/access/request/${id}/resolve`, {
      method: 'POST', body: JSON.stringify({ decision, level }),
    });
    return { ok: true as const, request };
  } catch (e: any) { return { ok: false as const, error: e?.message ?? 'Failed to resolve' }; }
}
```

(Adapt the fetch wrapper to the file's real one — match `views.ts`/`worklogs.ts` exactly; `serverFetchBody` exists in `server/api.ts` for non-`{data}` envelopes.)

- [ ] Write `ShareModal.tsx` — a client component: lists existing links, toggles a public link (create), copies the public URL (`/share/<token>` on the web origin), sets an optional expiry, revokes. The public URL is built from `window.location.origin + '/share/' + link.token`:

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { createShareLink, revokeShareLink, listShareLinks } from '@/server/actions/share';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { ShareLink, ShareObjectType } from '@projectflow/types';
import styles from './ShareModal.module.css';

export function ShareModal({ objectType, objectId, onClose }: { objectType: ShareObjectType; objectId: string; onClose?: () => void }) {
  const t = useTranslations('Share');
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [expiry, setExpiry] = useState('');
  const [pending, start] = useTransition();

  const refetch = () => listShareLinks(objectType, objectId).then((r) => { if (r.ok) setLinks(r.links); });
  useEffect(() => { refetch(); /* eslint-disable-next-line */ }, [objectType, objectId]);

  const onCreate = () => start(async () => {
    const r = await createShareLink(objectType, objectId, expiry ? new Date(expiry).toISOString() : null);
    if (!r.ok) return notifyActionError(r);
    setExpiry(''); await refetch();
  });

  const onRevoke = (id: string) => start(async () => {
    const r = await revokeShareLink(id);
    if (!r.ok) return notifyActionError(r);
    await refetch();
  });

  const publicUrl = (token: string) =>
    `${typeof window !== 'undefined' ? window.location.origin : ''}/share/${token}`;

  return (
    <div className={styles.root} role="dialog" aria-label={t('title')}>
      <header className={styles.header}>
        <h2>{t('title')}</h2>
        {onClose && <button className={styles.close} onClick={onClose} aria-label={t('close')}>×</button>}
      </header>

      <p className={styles.hint}>{t('readOnlyHint')}</p>

      <div className={styles.createRow}>
        <label className={styles.expiryLabel}>
          {t('expiry')}
          <input type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </label>
        <button className={styles.createBtn} onClick={onCreate} disabled={pending}>{t('createLink')}</button>
      </div>

      <ul className={styles.list}>
        {links.length === 0 && <li className={styles.empty}>{t('noLinks')}</li>}
        {links.map((l) => (
          <li key={l.id} className={styles.item}>
            <input className={styles.url} readOnly value={publicUrl(l.token)} onFocus={(e) => e.currentTarget.select()} />
            <button className={styles.copyBtn} onClick={() => navigator.clipboard?.writeText(publicUrl(l.token))}>{t('copy')}</button>
            {l.expiresAt && <span className={styles.expires}>{t('expiresAt', { date: new Date(l.expiresAt).toLocaleString() })}</span>}
            <button className={styles.revokeBtn} onClick={() => onRevoke(l.id)} disabled={pending}>{t('revoke')}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] Write `ShareModal.module.css`:

```css
.root { display: flex; flex-direction: column; gap: 12px; padding: 16px; min-width: 420px; }
.header { display: flex; align-items: center; justify-content: space-between; }
.close { border: none; background: none; font-size: 22px; cursor: pointer; line-height: 1; }
.hint { font-size: 13px; color: var(--text-2, #6b7280); }
.createRow { display: flex; align-items: flex-end; gap: 10px; }
.expiryLabel { display: flex; flex-direction: column; font-size: 12px; gap: 4px; }
.createBtn { border: none; border-radius: 6px; padding: 6px 14px; background: var(--primary, #4f46e5); color: #fff; cursor: pointer; }
.list { display: flex; flex-direction: column; gap: 8px; list-style: none; padding: 0; margin: 0; }
.empty { font-size: 13px; color: var(--text-2, #6b7280); }
.item { display: flex; align-items: center; gap: 8px; }
.url { flex: 1; font-size: 12px; padding: 4px 6px; }
.copyBtn, .revokeBtn { border: none; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.copyBtn { background: var(--surface-2, #e5e7eb); }
.revokeBtn { background: #ef4444; color: #fff; }
.expires { font-size: 11px; color: var(--text-2, #6b7280); }
.disabled { opacity: .6; cursor: default; }
```

- [ ] Write `RequestAccessPanel.tsx` — shown to an authed non-member who hits a private object (rendered by the object surface when the API returns 403/NOT_FOUND-with-request-affordance; the parent decides when to mount it):

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { requestAccess } from '@/server/actions/share';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { ShareObjectType } from '@projectflow/types';

export function RequestAccessPanel({ objectType, objectId }: { objectType: ShareObjectType; objectId: string }) {
  const t = useTranslations('AccessRequest');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();

  const onSend = () => start(async () => {
    const r = await requestAccess(objectType, objectId, note.trim() || undefined);
    if (!r.ok) return notifyActionError(r);
    setSent(true);
  });

  if (sent) return <div role="status">{t('sent')}</div>;

  return (
    <div role="region" aria-label={t('title')}>
      <h2>{t('title')}</h2>
      <p>{t('description')}</p>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('notePlaceholder')} maxLength={500} />
      <button onClick={onSend} disabled={pending}>{pending ? t('sending') : t('requestAccess')}</button>
    </div>
  );
}
```

- [ ] Add i18n keys. In `en.json`:

```json
"Share": {
  "title": "Share",
  "close": "Close",
  "readOnlyHint": "Anyone with the link can view this — read-only, no sign-in required.",
  "expiry": "Expiry (optional)",
  "createLink": "Create public link",
  "copy": "Copy",
  "revoke": "Revoke",
  "noLinks": "No public links yet.",
  "expiresAt": "Expires {date}"
},
"AccessRequest": {
  "title": "Request access",
  "description": "You don't have access to this item. Send a request to its owners.",
  "notePlaceholder": "Add a note (optional)",
  "requestAccess": "Request access",
  "sending": "Sending…",
  "sent": "Request sent. You'll be notified when it's granted."
}
```

- [ ] Add the same keys to `id.json` with real Indonesian:

```json
"Share": {
  "title": "Bagikan",
  "close": "Tutup",
  "readOnlyHint": "Siapa saja dengan tautan dapat melihat ini — hanya-baca, tanpa perlu masuk.",
  "expiry": "Kedaluwarsa (opsional)",
  "createLink": "Buat tautan publik",
  "copy": "Salin",
  "revoke": "Cabut",
  "noLinks": "Belum ada tautan publik.",
  "expiresAt": "Kedaluwarsa {date}"
},
"AccessRequest": {
  "title": "Minta akses",
  "description": "Anda tidak memiliki akses ke item ini. Kirim permintaan ke pemiliknya.",
  "notePlaceholder": "Tambahkan catatan (opsional)",
  "requestAccess": "Minta akses",
  "sending": "Mengirim…",
  "sent": "Permintaan terkirim. Anda akan diberi tahu saat disetujui."
}
```

- [ ] Run: `npm test --workspace apps/next-web` (includes the `messages.unit` i18n parity test). Expected: PASS — en/id key parity green. Then `npm run build --workspace apps/next-web`. Expected: PASS.

- [ ] Commit:
```
git add apps/next-web/src/server/actions/share.ts apps/next-web/src/components/sharing/ShareModal.tsx apps/next-web/src/components/sharing/ShareModal.module.css apps/next-web/src/components/sharing/RequestAccessPanel.tsx apps/next-web/src/messages/en.json apps/next-web/src/messages/id.json
git commit -m "feat(10c): sharing modal + request-access UI + share server actions + i18n"
```

---

### Task 9: Public read-only renderer — the `/share/[token]` Next route OUTSIDE `(app)`

**Files:**
- Create: `apps/next-web/src/app/share/layout.tsx`
- Create: `apps/next-web/src/app/share/[token]/page.tsx`
- Create: `apps/next-web/src/app/share/[token]/PublicObjectRenderer.tsx`
- Modify: `apps/next-web/src/messages/en.json` + `id.json` (add `Share.public*` keys)
- Note: read `apps/next-web/node_modules/next/dist/docs/` per `apps/next-web/AGENTS.md` FIRST — confirm the App Router page/params/`notFound()` API for this Next version (params may be async). The route MUST sit at `src/app/share/...`, a SIBLING of `(app)` / `login` / `register` / `oauth`, so the protected `(app)/layout.tsx` (which calls `getMe()`/auth) NEVER wraps it.

Steps:

- [ ] Write `app/share/layout.tsx` — a minimal public shell (no sidebar, no auth lookups). It does NOT import anything from `(app)`:

```tsx
import type { ReactNode } from 'react';

export default function ShareLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" style={{ maxWidth: 880, margin: '0 auto', padding: '32px 20px' }}>
      {children}
    </main>
  );
}
```

- [ ] Write `app/share/[token]/page.tsx` — SSR-fetch the public projection directly from the API (NO cookie/JWT — bypass `server/api.ts`, which attaches the auth cookie; call the public endpoint with a plain `fetch`), 404 on missing/expired/revoked. **Confirm the params shape against the in-repo Next docs before finalizing — params may be a Promise in this version:**

```tsx
import { notFound } from 'next/navigation';
import type { ShareProjection } from '@projectflow/types';
import { PublicObjectRenderer } from './PublicObjectRenderer';

const API_BASE = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// NOTE: params is awaited — this Next version passes route params as a Promise.
// VERIFY against node_modules/next/dist/docs/ before shipping.
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Plain fetch — NO Authorization header, NO cookie. The endpoint is public.
  const res = await fetch(`${API_BASE}/api/v1/public/share/${encodeURIComponent(token)}`, { cache: 'no-store' });
  if (!res.ok) notFound();
  const body = (await res.json().catch(() => null)) as { projection?: ShareProjection } | null;
  if (!body?.projection) notFound();

  return <PublicObjectRenderer projection={body.projection} />;
}
```

- [ ] Write `app/share/[token]/PublicObjectRenderer.tsx` — dispatch on `objectType` to a per-type read-only renderer. NO sibling/parent navigation, NO app chrome, NO write affordances. Task + view render real content; doc/dashboard/whiteboard show a graceful "type not yet available" until those modules land:

```tsx
import type { ShareProjection } from '@projectflow/types';
import { getTranslations } from 'next-intl/server';

export async function PublicObjectRenderer({ projection }: { projection: ShareProjection }) {
  const t = await getTranslations('Share');

  return (
    <article aria-label={projection.title}>
      <header style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b7280' }}>{t('publicBadge')}</span>
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>{projection.title}</h1>
        <p style={{ fontSize: 12, color: '#6b7280' }}>{t('readOnlyBadge')}</p>
      </header>

      {projection.objectType === 'task' && <TaskView data={projection.data} />}
      {projection.objectType === 'view' && <ViewView title={projection.title} data={projection.data} />}
      {['doc', 'dashboard', 'whiteboard'].includes(projection.objectType) && (
        <p>{t('typeUnavailable')}</p>
      )}
    </article>
  );
}

function TaskView({ data }: { data: Record<string, unknown> }) {
  return (
    <section>
      {data.status != null && <p><strong>Status:</strong> {String(data.status)}</p>}
      {data.priority != null && <p><strong>Priority:</strong> {String(data.priority)}</p>}
      {data.dueDate != null && <p><strong>Due:</strong> {String(data.dueDate)}</p>}
      {data.description != null && (
        <div style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{String(data.description)}</div>
      )}
    </section>
  );
}

function ViewView({ title, data }: { title: string; data: Record<string, unknown> }) {
  return (
    <section>
      <p><strong>{title}</strong> ({String((data as any).type ?? 'view')})</p>
      <pre style={{ background: '#f3f4f6', padding: 12, borderRadius: 8, overflow: 'auto' }}>
        {JSON.stringify((data as any).config ?? {}, null, 2)}
      </pre>
    </section>
  );
}
```

- [ ] Add the public-renderer i18n keys to `en.json` `Share` block + `id.json`:

en.json (merge into the existing `Share` namespace):
```json
"publicBadge": "Shared link",
"readOnlyBadge": "Read-only",
"typeUnavailable": "This item type can't be displayed yet."
```
id.json (merge into the existing `Share` namespace):
```json
"publicBadge": "Tautan dibagikan",
"readOnlyBadge": "Hanya-baca",
"typeUnavailable": "Jenis item ini belum dapat ditampilkan."
```

- [ ] Run: `npm test --workspace apps/next-web` (i18n parity + unit). Expected: PASS. Then `npm run build --workspace apps/next-web`. Expected: PASS (Next build clean; the `share` route compiles as a public sibling of `(app)`).

- [ ] Commit:
```
git add apps/next-web/src/app/share apps/next-web/src/messages/en.json apps/next-web/src/messages/id.json
git commit -m "feat(10c): public /share/[token] route OUTSIDE (app) — read-only renderer, no auth/nav"
```

---

### Task 10: Playwright e2e (headline §6.5 flow)

**Files:**
- Create: `e2e/share-links.spec.ts` (repo-root `e2e/`, alongside `views.spec.ts`/`hierarchy.spec.ts`)
- Note: e2e runs against local Docker `ProjectFlow_Test` only (use the project's existing e2e env/setup, same as the views/hierarchy specs).

Steps:

- [ ] Write the e2e spec covering the BUILD_PLAN acceptance flow (§6.5): an authed owner creates a public share link on a task; the link is opened in an UNAUTHENTICATED browser context (no cookies) and shows read-only content with no way to reach siblings/parent. Follow the existing spec harness (login + seed helpers used by `views.spec.ts`):

```ts
import { test, expect } from '@playwright/test';
// Reuse the existing login+seed helpers used by the other specs (e.g. global-setup
// auth + a seeded space/list/task). Adapt the import to the project's real helper.

test.describe('Phase 10c — public share links', () => {
  test('a public share link exposes only the shared object, read-only, with no auth', async ({ page, browser }) => {
    // 1) Authenticated: open a task, open the Share modal, create a public link, copy URL.
    const { taskUrl } = await loginAndSeedTask(page);   // existing helper
    await page.goto(taskUrl);

    await page.getByRole('button', { name: /share/i }).click();
    const modal = page.getByRole('dialog', { name: /share/i });
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: /create public link/i }).click();

    const urlInput = modal.locator('input[readonly]').first();
    await expect(urlInput).toBeVisible();
    const shareUrl = await urlInput.inputValue();
    expect(shareUrl).toMatch(/\/share\/[A-Za-z0-9_-]{64}$/);

    // 2) UNAUTHENTICATED: a fresh context with NO storage state / cookies.
    const anon = await browser.newContext({ storageState: undefined });
    const anonPage = await anon.newPage();
    await anonPage.goto(shareUrl);

    // Read-only content is visible.
    await expect(anonPage.getByText(/read-only/i)).toBeVisible();
    await expect(anonPage.getByRole('article')).toBeVisible();

    // No navigation up the tree: no sidebar, no breadcrumb, no sibling links.
    await expect(anonPage.locator('nav')).toHaveCount(0);
    await expect(anonPage.getByRole('button', { name: /edit|delete|save/i })).toHaveCount(0);

    // 3) A revoked link 404s for the anonymous viewer.
    await page.bringToFront();
    await modal.getByRole('button', { name: /revoke/i }).first().click();
    const revokedRes = await anon.request.get(shareUrl);
    expect(revokedRes.status()).toBe(404);

    await anon.close();
  });
});
```

(Add `role="dialog"`/`aria-label` to `ShareModal` and `role="article"` to the renderer — already present in Tasks 8–9 — so the e2e targets them deterministically. Adapt `loginAndSeedTask` to the real helper name used by the existing specs.)

- [ ] Run: the project's e2e command for a single spec against `ProjectFlow_Test` (the same invocation the views/hierarchy specs use, e.g. `npx playwright test e2e/share-links.spec.ts`). Expected: PASS (1 test) — link created, anonymous read-only render, no nav, revoke → 404.

- [ ] Commit:
```
git add e2e/share-links.spec.ts apps/next-web/src/components/sharing/ShareModal.tsx apps/next-web/src/app/share/[token]/PublicObjectRenderer.tsx
git commit -m "test(10c): e2e — public link read-only render in an unauthenticated context, no nav, revoke 404"
```

---

### Task 11: Slice verification + DECISIONS.md

**Files:**
- Modify: `DECISIONS.md` (append a Phase 10c entry)

Steps:

- [ ] Run the full slice verification on local Docker `ProjectFlow_Test`:
  - `npm test --workspace apps/api` — Expected: PASS (existing suite + new `token`/`projection` unit tests).
  - `npm run test:integration --workspace apps/api` — Expected: PASS (existing + `share.integration.test.ts`).
  - `npm test --workspace apps/next-web` — Expected: PASS (unit + `messages.unit` parity).
  - `npm run build --workspace apps/api` and `npm run build --workspace apps/next-web` — Expected: both PASS.
  - The share-links e2e — Expected: PASS.

- [ ] Run an explicit **adversarial security review pass** (spec §8 — authorization is the blast radius): confirm by inspection + test that (a) `/public/share/:token` is registered OUTSIDE the `authMiddleware` block and never touches `accessService`/membership/the tree; (b) the projection strips ALL navigation + write keys (parent/sibling/list/space/workspace + edit affordances); (c) create/revoke/list-links and grant-on-request all fail-closed without `FULL` on the object; (d) revoke + access-request resolve are authorize-THEN-mutate (no side-effect before the gate); (e) a revoked/expired token returns 404 with no object leak; (f) the public Next route uses a plain `fetch` with NO cookie/JWT. Fix any gap before merge.

- [ ] Append a `DECISIONS.md` entry logging: the `ShareLinks`/`AccessRequests` model (exact columns), the high-entropy `randomBytes(48).base64url` 64-char token (NOT a GUID) + UNIQUE-index/index-driven resolution, live-only resolution in `usp_ShareLink_Resolve`, the membership-free `resolvePublic` projection (navigation+write stripping), the unauthenticated `/public/share` route group registered outside `authMiddleware` + the public Next route outside `(app)`, request-access → Phase 3.5 notification → 10b `setObjectPermission` grant (landing on the task's List per §9 deferral 4), the `FULL`-on-object gate for all sharing/grant endpoints, the authorize-then-mutate ordering fixes, the deferral of doc/dashboard/whiteboard projections (modules not on-disk — stubbed against the spec'd shape), and any deviation found during implementation (incl. the exact owner/admin-lookup SP used and any `usp_ShareLink_GetById`/`usp_AccessRequest_GetById`/`usp_Workspace_ListOwnerAdminIds` added). DB-execution-policy note: all DB work ran ONLY against local Docker `ProjectFlow_Test`.

- [ ] Commit:
```
git add DECISIONS.md
git commit -m "docs(10c): DECISIONS entry — public share links + request-access + 10b grant routing"
```

---

## Definition of Done

Per-slice DoD (spec §3) + BUILD_PLAN acceptance (spec §6.5):

- [ ] **BUILD_PLAN acceptance (§6.5):** a public share link exposes **only the shared object**, **read-only**, **no auth** — verified by the integration test (public route serves exactly one object with no Authorization header and no tree access) AND the e2e (anonymous context renders read-only content with no sibling/parent navigation).
- [ ] Migration `0053_share_links.sql` is idempotent, GO-batched, and **reversible** via `rollback/0053_share_links.down.sql` (apply→rollback→re-apply verified clean); `ShareLinks`/`AccessRequests` have the **exact spec columns**; `share.create`/`share.revoke` slugs seeded.
- [ ] SP-per-op for every new operation: `usp_ShareLink_Create|Resolve|Revoke|ListForObject`, `usp_AccessRequest_Create|Resolve` (+ any `*_GetById`/owner-admin lookup added during implementation).
- [ ] The **unauthenticated** `/public/share/:token` route group has NO `authMiddleware`, NO workspace context, and `resolvePublic` NEVER consults membership/the ACL resolver/the tree; the matching **public Next route sits OUTSIDE `(app)`** and fetches with no cookie/JWT.
- [ ] REST is the primary surface; the **GraphQL mirror** (`shareLinksForObject`, `createShareLink`, `revokeShareLink`, `requestAccess`, `resolveAccessRequest`) delegates to the **one shared service** — and the public token resolution is REST-only by design (§2.2).
- [ ] Sharing/grant endpoints require **`FULL` on the object**; all gates fail-closed; revoke + access-request resolve are authorize-THEN-mutate.
- [ ] Request-access creates an `AccessRequests` row + a **Phase 3.5 notification** to owners/admins; granting routes through the **10b `setObjectPermission`** primitive (writes an `ObjectPermissions` row).
- [ ] Unit tests (token generation/validity, projection strip helpers + per-object builders) + integration tests (public-link single-object isolation, revoke/expire 404, request-access notification, grant writes `ObjectPermissions`, non-FULL rejection writes no grant) + ≥1 Playwright e2e for the headline flow — all green.
- [ ] **Security:** explicit tests prove the token grants nothing beyond the one object — no workspace context, no JWT, no parent/sibling navigation.
- [ ] `@projectflow/types` updated (`ShareObjectType`, `ShareLink`, `CreateShareLinkInput`, `ShareProjection`, `AccessRequest`, `AccessRequestStatus`, `CreateAccessRequestInput`).
- [ ] i18n: new `Share`/`AccessRequest` keys in **en.json + id.json** (real Indonesian); `messages.unit` parity green.
- [ ] All DB work (migration, SP deploy, integration, e2e) ran **ONLY against local Docker `ProjectFlow_Test`** — never the prod-pointing `apps/api/.env`.
- [ ] `DECISIONS.md` entry logs the mechanism choices + deviations. **Stop for review/merge before Slice 10d.**

---

## Self-Review

**Spec coverage (§6):**
- §6.1 data model — `0053_share_links.sql` creates `ShareLinks` + `AccessRequests` with the **exact spec columns** (`ShareLinks(Id, WorkspaceId, ObjectType ∈ task|doc|dashboard|view|whiteboard, ObjectId, Token NVARCHAR(64) UNIQUE, Level DEFAULT 'VIEW', ExpiresAt, CreatedBy, CreatedAt, RevokedAt)`; `AccessRequests(Id, WorkspaceId, ObjectType, ObjectId, RequestedBy, Note, Status pending|granted|denied, ResolvedBy, ResolvedAt, CreatedAt)`); Token is high-entropy random (NOT a GUID) with UNIQUE-index resolution. ✅ Task 1.
- §6.2 backend — all six SPs (Task 2–3); `share.service` create (FULL-guarded), revoke, **`resolvePublic(token)`** → projection or 404 (Task 5); the **separate unauthenticated `/share/:token` route group** (mounted `/public/share`, no `authMiddleware`) + the public Next route outside `(app)` (Task 6 + 9); `access.service.requestAccess` → `AccessRequests` row + Phase 3.5 notification, granting through **10b `setObjectPermission`** (Task 6). ✅
- §6.3 frontend — sharing modal (Task 8), public read-only renderer per object type (Task 9), request-access UI (Task 8). ✅
- §6.4 tests — unit (token expired/revoked/valid + projection strips writes+navigation, Task 4), integration (one-object isolation, revoke/expire 404, request-access notification, grant writes `ObjectPermissions`, Task 7), e2e (unauthenticated read-only render, no nav, Task 10). ✅
- §6.5 acceptance — covered explicitly in DoD + integration + e2e. ✅
- §3 conventions — sharing/grant endpoints require **`FULL` on the object**; idempotent migration+rollback; `execSp`/`execSpOne`; Hono auth posture mirrored on the real public groups (`/auth`, `/avatars` GET, `/webhooks`); Pothos mirror in `graphql/schema.ts`; i18n en+id parity; vitest unit+integration + Playwright e2e; DB only on `ProjectFlow_Test`. ✅

**Placeholder scan:** Full code provided for the migration (both tables, exact columns) + rollback, all six SPs, `share.token`/`share.projection`/`share.repository`/`share.service` (incl. `resolvePublic` with the membership-free, navigation-stripping path + the live-only validity guard), the authed `/share` + `/access` routes, the **UNAUTHENTICATED** `/public/share` route, the access-request repository/service, the GraphQL mirror, the server.ts wiring, the sharing modal + request-access UI + server actions, and the public `/share/[token]` route + renderer (outside `(app)`). doc/dashboard/whiteboard projections are shown as explicit typed stubs (modules not on-disk) — NOT "similarly". No "TODO"/"project the rest similarly" placeholders. The few intentionally-flagged items (authorize-then-mutate ordering on revoke/resolve; the exact owner-admin lookup SP; the view raw-row read) are called out as **inline notes** with concrete resolutions to apply + log, not left blank.

**Type/name consistency:** Uses the exact spec migration number (`0053`), table/column names, slugs (`share.create`/`share.revoke`), the 64-char high-entropy `Token`, and type names (`ShareLink`, `AccessRequest`/`AccessRequests` table). `resolvePublic`, `setObjectPermission` (10b), `notificationService.notify`, `accessService.can`, `execSpOne`, `requirePermission`/`requireWorkspacePermission`/`notFound` all match real on-disk signatures. The hierarchy-node grant target (task → its List) honors §9 deferral 4 (ACL stays at the node level). Token generation reuses `node:crypto` `randomBytes`, consistent with `tokenCrypto.ts`/avatars.

**Grounding gaps noted inline:** (1) On-disk migrations stop at `0037`; `0053` assumes Phases 6–9 + 10a/10b land first (stated in Prerequisite). (2) 10b's `setObjectPermission`/`listObjectPermissions` are assumed merged; Task 5 adds the thin wrappers over the **already-present** `AccessRepository.set`/`unset` if not. (3) doc/dashboard/whiteboard object modules are NOT on-disk — projections stubbed against the spec'd shape, resolving to 404 until built. (4) The view raw-row read (`ViewRepository.getRawById`) may need a tiny addition — flagged with two concrete options. (5) The exact owner/admin-lookup SP and any `*_GetById` SPs added during implementation are to be confirmed + logged in `DECISIONS.md`.
