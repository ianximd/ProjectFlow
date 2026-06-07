# Phase 10d — Guests & Limited Members Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add external-access membership to ProjectFlow: a **guest** (external, non-org-email) and a **limited member** (internal, org-email) are `WorkspaceMembers` rows that contribute **no membership floor**, so the existing `usp_ObjectAccess_Resolve` already returns "no access" for every object they were not explicitly granted — the Space tree is invisible by construction. A guest invite carries `(email, target object, level)`; accepting it atomically creates the guest `WorkspaceMembers` row + the `ObjectPermissions` grant. Two service-layer guards encode the BUILD_PLAN rules: an **org-email** invite is promoted to `limited_member` (not a guest), and a **guest may not be added at Space scope** (only Folder/List/task objects). Tree/listing endpoints filter out non-granted nodes for guests as defense-in-depth alongside the resolver.

**Architecture:** A guest is membership-with-no-floor. The mechanism reuses the mature resolver almost entirely (§2.3 of the design): the **only** resolver change is making the membership floor (`owner=FULL`, `member=EDIT`) yield **no floor** when the subject is a guest/limited member, leaving `COALESCE(@Explicit, @Floor)` to resolve to the explicit `ObjectPermissions` grant alone (or NULL = no access). Guest vs. limited member share the same no-floor + object-grant resolution and differ ONLY in the invite/grant guards. New work is SP-per-op in `infra/sql/procedures/` (the modified resolver + guest invite/accept/list/revoke), surfaced through `guest.repository` → `guest.service` → Hono REST (primary) + a graphql-yoga/Pothos mirror (`guests.schema.ts`), both delegating to the one shared service. The atomic `accept` routes its grant through the **existing** object-permission primitive (`AccessRepository.set` → `usp_ObjectPermission_Set`, the 10b grant SP). Org-email detection reads a new `Workspaces.VerifiedDomain` field (greenfield — Workspaces has no domain column today; this plan adds a lightweight one). Frontend adds guest & member management in workspace settings and the Space-tree sidebar shows a guest only their granted objects.

**Tech Stack:** SQL Server stored procedures (`CREATE OR ALTER`, `SET NOCOUNT ON`, TRY/CATCH/TRANSACTION); Hono REST + `@hono/zod-validator`; graphql-yoga + Pothos (`@pothos/core`); `mssql` via `execSp`/`execSpOne`; vitest (`--project unit` / `--project integration`); Next.js App Router (SSR) + `next-intl`; Playwright e2e. DB work runs ONLY against local Docker `ProjectFlow_Test`.

**Prerequisite:** Phases 1–9 + Phase 10a–10c merged; reuses 10b `setObjectPermission` (the `usp_ObjectPermission_Set` grant primitive surfaced via `AccessRepository.set`); modifies `usp_ObjectAccess_Resolve` floor logic.

---

## File Structure

**Migration: roles seed + GuestInvites + WorkspaceMembers.IsGuest + Workspaces.VerifiedDomain**
- `infra/sql/migrations/0054_guests.sql` — **Create.** Idempotent, GO-batched: seed TWO `IsSystem=1` WORKSPACE-scope roles (`workspace-guest`, `workspace-limited-member`) into `Roles` + minimal-slug `RolePermissions`; create `GuestInvites`; add `WorkspaceMembers.IsGuest BIT NOT NULL DEFAULT 0`; add `Workspaces.VerifiedDomain NVARCHAR(255) NULL` (the lightweight org-email domain — Workspaces had no domain column).
- `infra/sql/migrations/rollback/0054_guests.down.sql` — **Create.** Reverse: drop `GuestInvites`, `WorkspaceMembers.IsGuest` (+ default constraint), `Workspaces.VerifiedDomain`, and the two seeded roles' `RolePermissions` + `Roles` + their `Permissions` slugs; delete the `MigrationHistory` row.

**Stored procedures** (`infra/sql/procedures/`)
- `usp_ObjectAccess_Resolve.sql` — **Modify.** Add a guest/limited-member detection so the membership floor contributes **no floor** for those subjects (preserving owner=`FULL`, member=`EDIT` for everyone else); explicit-grant scan + PRIVATE handling unchanged.
- `usp_GuestInvite_Create.sql` — **Create.** Insert a pending `GuestInvites` row (email + object + level + token + expiry), return it.
- `usp_GuestInvite_Accept.sql` — **Create.** Atomic (one TRANSACTION): resolve the token → upsert the guest `WorkspaceMembers` row (`IsGuest=1`) + the `workspace-guest`/`workspace-limited-member` `UserRoles` assignment + the `ObjectPermissions` grant via the same write `usp_ObjectPermission_Set` performs; mark the invite `accepted`; return the membership + grant.
- `usp_GuestInvite_List.sql` — **Create.** List a workspace's guests with their granted objects (join `WorkspaceMembers IsGuest=1` → `ObjectPermissions`), and pending invites.
- `usp_GuestInvite_Revoke.sql` — **Create.** Atomic: delete a guest's `ObjectPermissions` grants + `UserRoles` + `WorkspaceMembers` row (or cancel a still-pending invite); return the affected ids.

**API** (`apps/api/src/`)
- `modules/guests/guest.repository.ts` — **Create.** `createInvite`/`acceptInvite`/`listGuests`/`revokeGuest` over the new SPs; map rows.
- `modules/guests/guest.service.ts` — **Create.** Pure-helper guards (`isOrgEmail`, `resolveInviteRole`, `assertGuestObjectAllowed`) + `invite`/`accept`/`list`/`revoke`; the org-email→limited-member promotion and the reject-guest-at-Space rule; `accept` routes the grant through `AccessRepository.set` (10b primitive) when not done in-SP.
- `modules/guests/guest.routes.ts` — **Create.** `POST /guests/invites` (FULL on object), `POST /guests/invites/:token/accept`, `GET /guests?workspaceId=` (`guest.manage`), `DELETE /guests/:userId?workspaceId=` (`guest.manage`).
- `modules/guests/guest.pure.ts` — **Create.** Pure, dependency-free helpers (`isOrgEmail`, `resolveInviteRole`, `guestFloor`, `assertGuestObjectAllowed`) so unit tests need no DB.
- `modules/hierarchy/list.routes.ts` — **Modify.** Defense-in-depth: after the SPACE `VIEW` gate, filter the returned lists per-node for guests (drop any list the caller can't `VIEW`).
- `modules/hierarchy/folder.routes.ts` — **Modify.** Same per-node guest filter on the folder listing.
- `modules/projects/project.routes.ts` — **Modify.** Same per-node guest filter on the Space-tree top-level listing (a guest sees no Space they lack a grant under).
- `modules/access/access.service.ts` — **Modify (additive).** Expose `setObjectPermission` as the named 10b primitive alias over `AccessRepository.set` (used by `accept`), plus a small `filterVisibleNodes` helper.
- `graphql/guests.schema.ts` — **Create.** `registerGuestGraphql()`: `GuestInviteType`/`GuestType` + `workspaceGuests` query + `inviteGuest`/`acceptGuestInvite`/`revokeGuest` mutations, mirroring the REST gates.
- `graphql/schema.ts` — **Modify.** Import + call `registerGuestGraphql()`.

**Types** (`packages/types/`)
- `index.ts` — **Modify.** Add `GuestInvite`, `GuestInviteStatus`, `Guest`, `InviteGuestInput`, the role constants `WORKSPACE_GUEST_ROLE`/`WORKSPACE_LIMITED_MEMBER_ROLE`, and a `guestRoleForEmail` discriminant type.

**Frontend** (`apps/next-web/src/`)
- `server/actions/guests.ts` — **Create.** `inviteGuest`/`acceptGuestInvite`/`revokeGuest` server actions + `loadGuests` query.
- `components/settings/GuestManagementPanel.tsx` — **Create.** Invite a guest to a specific object at a level; list guests + their granted objects; revoke.
- `components/settings/GuestManagementPanel.module.css` — **Create.** Styles.
- `app/(app)/.../guests/accept/[token]/page.tsx` — **Create.** Accept-invite landing (authenticated) that calls `acceptGuestInvite` and routes to the granted object.
- `components/hierarchy/SidebarTree.tsx` — **Modify.** A guest's sidebar shows only granted objects (the filtered tree from the now-guest-aware listing endpoints; no Space chrome they lack a grant under).
- `messages/en.json` — **Modify.** New `Guests` namespace.
- `messages/id.json` — **Modify.** Same keys, real Indonesian.

**Tests**
- `apps/api/src/modules/guests/__tests__/guest.pure.unit.test.ts` — **Create.** Pure: org-email→limited-member promotion, reject-guest-at-Space guard, guest floor = none.
- `apps/api/src/modules/guests/__tests__/guests.integration.test.ts` — **Create.** A guest sees ONLY explicitly-shared items + 403/404s on the rest; cannot enumerate the Space tree (resolver + tree-listing); an org-email invite becomes a limited member, not a guest.
- `apps/api/src/modules/access/__tests__/guest-resolver.integration.test.ts` — **Create.** Resolver-level invariant: a guest with one List grant resolves `VIEW` on that List and **NULL** on its Space/siblings.
- `e2e/guests.spec.ts` — **Create.** Invite a guest to one List, accept, confirm they see that List only and cannot navigate to the Space or siblings.

---

## Tasks

### Task 1: Migration + rollback (`0054_guests.sql`)

**Files:**
- Create: `infra/sql/migrations/0054_guests.sql`
- Create: `infra/sql/migrations/rollback/0054_guests.down.sql`
- Test: manual deploy against local Docker `ProjectFlow_Test` (migrations have no unit harness; verified via the integration suites in Tasks 6–7).

Steps:

- [ ] Write the migration. Idempotent (`COL_LENGTH` / `sys.tables` / `NOT EXISTS` seed guards), GO-batched, matching the `0018`/`0029` style. Seed the new permission slugs (`guest.invite`, `guest.manage`) into `Permissions`, the TWO system roles into `Roles`, their minimal `RolePermissions`, then create `GuestInvites`, add `WorkspaceMembers.IsGuest`, and add `Workspaces.VerifiedDomain`:

```sql
-- =============================================================================
-- Migration 0054: Guests & Limited Members (Phase 10d)
-- External-access membership on top of the existing RBAC + object ACL:
--   * Permissions  — new WORKSPACE slugs guest.invite / guest.manage
--   * Roles        — two IsSystem=1 WORKSPACE roles, minimal slug sets:
--                      workspace-guest          (external, non-org-email)
--                      workspace-limited-member (internal, org-email)
--                    Both have NO membership floor (enforced in
--                    usp_ObjectAccess_Resolve) — they see only explicitly
--                    granted objects. They differ ONLY in the service-layer
--                    invite/grant guards, not in resolution.
--   * GuestInvites — pending email+object+level invites with a unique token
--   * WorkspaceMembers.IsGuest — denormalized flag for fast tree-visibility
--                    filtering (authoritative role is still the UserRoles row)
--   * Workspaces.VerifiedDomain — lightweight org-email domain (greenfield;
--                    Workspaces had no domain column). NULL = no org-email rule.
-- Idempotent (catalog/NOT EXISTS guards), GO-batched.
-- Rollback in rollback/0054_guests.down.sql.
-- =============================================================================

-- ── New permission slugs ─────────────────────────────────────────────────────
;WITH SeedPermissions(Resource, Action, Slug, Scope, Description) AS (
    SELECT * FROM (VALUES
        ('guest', 'invite', 'guest.invite', 'WORKSPACE', 'Invite a guest to a specific object'),
        ('guest', 'manage', 'guest.manage', 'WORKSPACE', 'List and revoke workspace guests')
    ) AS T(Resource, Action, Slug, Scope, Description)
)
INSERT INTO dbo.Permissions (Resource, Action, Slug, Scope, Description)
SELECT s.Resource, s.Action, s.Slug, s.Scope, s.Description
FROM SeedPermissions s
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permissions p WHERE p.Slug = s.Slug);
GO

-- ── Two system roles ─────────────────────────────────────────────────────────
;WITH SeedRoles(Slug, Name, Scope, Description) AS (
    SELECT * FROM (VALUES
        ('workspace-guest',          'Guest',          'WORKSPACE', 'External guest: no membership floor; sees only explicitly granted objects.'),
        ('workspace-limited-member', 'Limited Member', 'WORKSPACE', 'Internal limited member (org-email): no membership floor; sees only explicitly granted objects.')
    ) AS T(Slug, Name, Scope, Description)
)
INSERT INTO dbo.Roles (Slug, Name, Scope, Description, IsSystem)
SELECT s.Slug, s.Name, s.Scope, s.Description, 1
FROM SeedRoles s
WHERE NOT EXISTS (SELECT 1 FROM dbo.Roles r WHERE r.Slug = s.Slug);
GO

-- ── Minimal RolePermissions for both roles ───────────────────────────────────
-- Both get only the read slugs needed to render an explicitly-granted object.
-- They hold NO workspace.read / members.read (they must NOT enumerate the tree
-- or the member list); object visibility comes entirely from ObjectPermissions
-- grants resolved with NO floor.
;WITH RolePermSeed(RoleSlug, PermissionSlug) AS (
    SELECT * FROM (VALUES
        ('workspace-guest',          'task.read'),
        ('workspace-guest',          'comment.create'),
        ('workspace-guest',          'comment.update.own'),
        ('workspace-guest',          'comment.delete.own'),
        ('workspace-limited-member', 'task.read'),
        ('workspace-limited-member', 'comment.create'),
        ('workspace-limited-member', 'comment.update.own'),
        ('workspace-limited-member', 'comment.delete.own')
    ) AS T(RoleSlug, PermissionSlug)
)
INSERT INTO dbo.RolePermissions (RoleId, PermissionId)
SELECT r.Id, p.Id
FROM RolePermSeed s
JOIN dbo.Roles       r ON r.Slug = s.RoleSlug
JOIN dbo.Permissions p ON p.Slug = s.PermissionSlug
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.RolePermissions rp
    WHERE rp.RoleId = r.Id AND rp.PermissionId = p.Id
);
GO

-- ── GuestInvites ─────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'GuestInvites')
BEGIN
    CREATE TABLE dbo.GuestInvites (
        Id          UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Workspaces(Id),
        Email       NVARCHAR(255)    NOT NULL,
        ObjectType  NVARCHAR(8)      NOT NULL,   -- 'SPACE'|'FOLDER'|'LIST' (SPACE rejected for guests at the service layer)
        ObjectId    UNIQUEIDENTIFIER NOT NULL,
        Level       NVARCHAR(8)      NOT NULL,   -- 'VIEW'|'COMMENT'|'EDIT'|'FULL'
        Token       NVARCHAR(64)     NOT NULL UNIQUE,
        Status      NVARCHAR(12)     NOT NULL CONSTRAINT DF_GuestInvites_Status DEFAULT 'pending',
        InvitedBy   UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Users(Id),
        ExpiresAt   DATETIME2        NULL,
        CreatedAt   DATETIME2        NOT NULL CONSTRAINT DF_GuestInvites_CreatedAt DEFAULT SYSUTCDATETIME(),
        AcceptedAt  DATETIME2        NULL,
        CONSTRAINT CK_GuestInvites_ObjectType CHECK (ObjectType IN ('SPACE','FOLDER','LIST')),
        CONSTRAINT CK_GuestInvites_Level      CHECK (Level IN ('VIEW','COMMENT','EDIT','FULL')),
        CONSTRAINT CK_GuestInvites_Status     CHECK (Status IN ('pending','accepted','revoked'))
    );
    CREATE NONCLUSTERED INDEX IX_GuestInvites_Workspace ON dbo.GuestInvites (WorkspaceId, Status);
    CREATE NONCLUSTERED INDEX IX_GuestInvites_Email     ON dbo.GuestInvites (Email);
END
GO

-- ── WorkspaceMembers.IsGuest (denormalized tree-visibility flag) ─────────────
IF COL_LENGTH('dbo.WorkspaceMembers', 'IsGuest') IS NULL
    ALTER TABLE dbo.WorkspaceMembers ADD IsGuest BIT NOT NULL CONSTRAINT DF_WorkspaceMembers_IsGuest DEFAULT 0;
GO

-- ── Workspaces.VerifiedDomain (lightweight org-email rule) ───────────────────
IF COL_LENGTH('dbo.Workspaces', 'VerifiedDomain') IS NULL
    ALTER TABLE dbo.Workspaces ADD VerifiedDomain NVARCHAR(255) NULL;
GO
```

- [ ] Write the rollback `rollback/0054_guests.down.sql` (reverse order; drop tables/columns + their DEFAULT constraints, then un-seed the roles/permissions; idempotent, matching the `0029` rollback style):

```sql
-- =============================================================================
-- Rollback for 0054_guests.sql. Run manually (forward-only runner). Idempotent.
-- Reverses: Workspaces.VerifiedDomain, WorkspaceMembers.IsGuest, GuestInvites,
-- the two system roles + their RolePermissions, and the new permission slugs.
-- =============================================================================

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'GuestInvites') DROP TABLE dbo.GuestInvites;
GO

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_WorkspaceMembers_IsGuest')
    ALTER TABLE dbo.WorkspaceMembers DROP CONSTRAINT DF_WorkspaceMembers_IsGuest;
IF COL_LENGTH('dbo.WorkspaceMembers', 'IsGuest') IS NOT NULL
    ALTER TABLE dbo.WorkspaceMembers DROP COLUMN IsGuest;
GO

IF COL_LENGTH('dbo.Workspaces', 'VerifiedDomain') IS NOT NULL
    ALTER TABLE dbo.Workspaces DROP COLUMN VerifiedDomain;
GO

-- Un-seed RolePermissions + Roles for the two guest roles, then their slugs.
DELETE rp FROM dbo.RolePermissions rp
JOIN dbo.Roles r ON r.Id = rp.RoleId
WHERE r.Slug IN ('workspace-guest', 'workspace-limited-member');
GO
-- Remove any UserRoles assignments to the guest roles (dangling guests) first.
DELETE ur FROM dbo.UserRoles ur
JOIN dbo.Roles r ON r.Id = ur.RoleId
WHERE r.Slug IN ('workspace-guest', 'workspace-limited-member');
GO
DELETE FROM dbo.Roles WHERE Slug IN ('workspace-guest', 'workspace-limited-member');
GO
DELETE FROM dbo.Permissions WHERE Slug IN ('guest.invite', 'guest.manage');
GO

DELETE FROM dbo.MigrationHistory WHERE [FileName] = '0054_guests.sql';
GO
```

- [ ] Run against local Docker `ProjectFlow_Test` only (explicit local DB env, never `apps/api/.env`). Run: apply `0054_guests.sql` then immediately the `.down.sql` then re-apply `0054` to prove idempotency + reversibility. Expected: all three runs succeed with no errors; second `0054` apply is a clean no-op (every guard/`NOT EXISTS` seed skips).

- [ ] Commit:
```
git add infra/sql/migrations/0054_guests.sql infra/sql/migrations/rollback/0054_guests.down.sql
git commit -m "feat(10d): guests migration — workspace-guest/limited-member roles + GuestInvites + IsGuest + VerifiedDomain"
```

---

### Task 2: Modify `usp_ObjectAccess_Resolve` — guest contributes no floor

**Files:**
- Modify: `infra/sql/procedures/usp_ObjectAccess_Resolve.sql`
- Test: resolver invariant is integration-tested in Task 7 (`guest-resolver.integration.test.ts`); the floor=none decision is also unit-tested pure in Task 5 (`guest.pure.unit.test.ts`); deploy via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`.

Steps:

- [ ] Modify `usp_ObjectAccess_Resolve.sql`. Preserve the EXISTING owner/member behavior; add a `@IsGuest` detection that suppresses the membership floor. A subject is a guest when they hold a `workspace-guest` **or** `workspace-limited-member` role in this workspace (the denormalized `WorkspaceMembers.IsGuest` is a fast-path corroborant but the authoritative signal is the role, matching the spec's "authoritative role is still the assignment in `UserRoles`"). The full modified SP — note ONLY the floor block changes; the ancestry scan, explicit-grant pick, and PRIVATE handling are byte-for-byte unchanged:

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
        FROM dbo.Projects WHERE Id = @ObjectId AND Status <> 'DELETED';
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

    DECLARE @IsMember BIT = 0, @IsOwner BIT = 0, @IsGuest BIT = 0, @Visibility NVARCHAR(10);
    SELECT @Visibility = Visibility FROM dbo.Projects WHERE Id = @SpaceId;
    IF EXISTS (SELECT 1 FROM dbo.WorkspaceMembers WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId) SET @IsMember = 1;
    IF EXISTS (SELECT 1 FROM dbo.Workspaces WHERE Id = @WorkspaceId AND OwnerId = @UserId) SET @IsOwner = 1;

    -- A guest / limited member holds workspace-guest or workspace-limited-member
    -- in THIS workspace. They are WorkspaceMembers rows, so @IsMember is 1 — but
    -- they must contribute NO floor, so the Space tree is invisible by
    -- construction and access comes ONLY from an explicit ObjectPermissions grant.
    IF EXISTS (
        SELECT 1 FROM dbo.UserRoles ur
        JOIN dbo.Roles r ON r.Id = ur.RoleId
        WHERE ur.UserId = @UserId
          AND (ur.WorkspaceId = @WorkspaceId OR ur.WorkspaceId IS NULL)
          AND r.Slug IN ('workspace-guest', 'workspace-limited-member')
    ) SET @IsGuest = 1;

    -- Floor: owner=FULL, member=EDIT, guest/limited-member=NONE.
    -- Guest wins over member so the EDIT floor never leaks to a guest.
    DECLARE @Floor NVARCHAR(8) =
        CASE WHEN @IsOwner = 1 THEN 'FULL'
             WHEN @IsGuest = 1 THEN NULL
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

    -- PRIVATE space, no explicit grant, not a real member/owner → no access.
    -- A guest is NOT a real member for this gate: they have @Floor = NULL, so
    -- the existing COALESCE already yields NULL without an explicit grant. We
    -- keep the original predicate intact for non-guests.
    IF @Visibility = 'PRIVATE' AND @IsMember = 0 AND @IsOwner = 0 AND @Explicit IS NULL
    BEGIN
        SELECT CAST(NULL AS NVARCHAR(8)) AS Level, CAST(1 AS BIT) AS Found;
        RETURN;
    END

    SELECT COALESCE(@Explicit, @Floor) AS Level, CAST(1 AS BIT) AS Found;
END;
GO
```

  Note: the only changes are (1) the new `@IsGuest` declaration + detection, and (2) the `WHEN @IsGuest = 1 THEN NULL` branch placed **above** the member branch in the `@Floor` CASE. For a guest with no explicit grant, `COALESCE(@Explicit, @Floor)` = `COALESCE(NULL, NULL)` = NULL → no access, while `Found=1` (the object exists) so the caller returns 403, not 404, on a known-but-ungranted object. On a List they were granted, `@Explicit` wins. The PRIVATE early-return is unchanged and still correct (a guest there also has `@Explicit IS NULL` only when ungranted, but a guest's `@IsMember=1` keeps them out of that branch — the floor=NULL is what denies them, identically to a PUBLIC space).

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test` (local DB env only). Expected: `usp_ObjectAccess_Resolve` (re)created with no errors. Run the existing `object-access.integration.test.ts` (`npm run test:integration --workspace apps/api -- object-access`) to confirm owner/non-member behavior is unregressed.

- [ ] Commit:
```
git add infra/sql/procedures/usp_ObjectAccess_Resolve.sql
git commit -m "feat(10d): resolver — guest/limited-member contributes no floor (tree invisible by construction)"
```

---

### Task 3: Guest invite/accept SPs (`GuestInvite_Create`, `GuestInvite_Accept`)

**Files:**
- Create: `infra/sql/procedures/usp_GuestInvite_Create.sql`
- Create: `infra/sql/procedures/usp_GuestInvite_Accept.sql`
- Test: covered by `guests.integration.test.ts` (Task 6); deploy via `scripts/db-deploy-sps.ts`.

Steps:

- [ ] Write `usp_GuestInvite_Create.sql` — insert a pending invite (the caller has already passed the role/object guards in the service; the SP stores the resolved `RoleSlug` implicitly by accepting either object type — Space-rejection is a service guard, not a DB constraint, so an org-email Space invite for a limited member is permitted). Return the new row:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_GuestInvite_Create
  @WorkspaceId UNIQUEIDENTIFIER,
  @Email       NVARCHAR(255),
  @ObjectType  NVARCHAR(8),
  @ObjectId    UNIQUEIDENTIFIER,
  @Level       NVARCHAR(8),
  @Token       NVARCHAR(64),
  @InvitedBy   UNIQUEIDENTIFIER,
  @ExpiresAt   DATETIME2 = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

  INSERT INTO dbo.GuestInvites (Id, WorkspaceId, Email, ObjectType, ObjectId, Level, Token, Status, InvitedBy, ExpiresAt)
  VALUES (@NewId, @WorkspaceId, LOWER(LTRIM(RTRIM(@Email))), @ObjectType, @ObjectId, @Level, @Token, 'pending', @InvitedBy, @ExpiresAt);

  SELECT Id, WorkspaceId, Email, ObjectType, ObjectId, Level, Token, Status, InvitedBy, ExpiresAt, CreatedAt, AcceptedAt
  FROM dbo.GuestInvites WHERE Id = @NewId;
END;
GO
```

- [ ] Write `usp_GuestInvite_Accept.sql` — atomic accept. Resolve the token (pending, not expired). `@AccepterUserId` is the authenticated user accepting (their email must match the invite email, enforced in the service before this call). `@RoleSlug` is the role the service resolved (`workspace-guest` or `workspace-limited-member`). In ONE transaction: upsert the `WorkspaceMembers` row with `IsGuest=1`, assign the role in `UserRoles`, write the `ObjectPermissions` grant (identical shape to what `usp_ObjectPermission_Set` writes — `SubjectType='USER'`), and flip the invite to `accepted`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_GuestInvite_Accept
  @Token          NVARCHAR(64),
  @AccepterUserId UNIQUEIDENTIFIER,
  @RoleSlug       NVARCHAR(100)    -- 'workspace-guest' | 'workspace-limited-member'
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @InviteId   UNIQUEIDENTIFIER, @WorkspaceId UNIQUEIDENTIFIER,
          @ObjectType NVARCHAR(8),      @ObjectId    UNIQUEIDENTIFIER,
          @Level      NVARCHAR(8),      @ExpiresAt   DATETIME2, @Status NVARCHAR(12);

  SELECT @InviteId = Id, @WorkspaceId = WorkspaceId, @ObjectType = ObjectType,
         @ObjectId = ObjectId, @Level = Level, @ExpiresAt = ExpiresAt, @Status = Status
  FROM dbo.GuestInvites WHERE Token = @Token;

  IF @InviteId IS NULL                                   THROW 51410, 'Invite not found.', 1;
  IF @Status <> 'pending'                                THROW 51411, 'Invite is not pending.', 1;
  IF @ExpiresAt IS NOT NULL AND @ExpiresAt < SYSUTCDATETIME() THROW 51412, 'Invite has expired.', 1;

  DECLARE @RoleId UNIQUEIDENTIFIER;
  SELECT @RoleId = Id FROM dbo.Roles WHERE Slug = @RoleSlug AND IsSystem = 1;
  IF @RoleId IS NULL                                     THROW 51413, 'Guest role not seeded.', 1;

  BEGIN TRY
    BEGIN TRANSACTION;

    -- Guest WorkspaceMembers row (IsGuest=1). Idempotent on re-accept.
    IF NOT EXISTS (SELECT 1 FROM dbo.WorkspaceMembers WHERE WorkspaceId = @WorkspaceId AND UserId = @AccepterUserId)
      INSERT INTO dbo.WorkspaceMembers (Id, WorkspaceId, UserId, IsGuest)
      VALUES (NEWID(), @WorkspaceId, @AccepterUserId, 1);
    ELSE
      UPDATE dbo.WorkspaceMembers SET IsGuest = 1
      WHERE WorkspaceId = @WorkspaceId AND UserId = @AccepterUserId;

    -- Role assignment.
    IF NOT EXISTS (SELECT 1 FROM dbo.UserRoles WHERE UserId = @AccepterUserId AND RoleId = @RoleId AND WorkspaceId = @WorkspaceId)
      INSERT INTO dbo.UserRoles (UserId, RoleId, WorkspaceId) VALUES (@AccepterUserId, @RoleId, @WorkspaceId);

    -- Object grant (same write usp_ObjectPermission_Set performs; upsert on the
    -- UQ_ObjPerm unique key so re-accept doesn't duplicate).
    IF EXISTS (SELECT 1 FROM dbo.ObjectPermissions
               WHERE SubjectType = 'USER' AND SubjectId = @AccepterUserId
                 AND ObjectType = @ObjectType AND ObjectId = @ObjectId)
      UPDATE dbo.ObjectPermissions SET Level = @Level
      WHERE SubjectType = 'USER' AND SubjectId = @AccepterUserId
        AND ObjectType = @ObjectType AND ObjectId = @ObjectId;
    ELSE
      INSERT INTO dbo.ObjectPermissions (WorkspaceId, SubjectType, SubjectId, ObjectType, ObjectId, Level)
      VALUES (@WorkspaceId, 'USER', @AccepterUserId, @ObjectType, @ObjectId, @Level);

    UPDATE dbo.GuestInvites SET Status = 'accepted', AcceptedAt = SYSUTCDATETIME() WHERE Id = @InviteId;

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;

  SELECT gi.Id, gi.WorkspaceId, gi.Email, gi.ObjectType, gi.ObjectId, gi.Level,
         gi.Status, gi.AcceptedAt, @AccepterUserId AS UserId
  FROM dbo.GuestInvites gi WHERE gi.Id = @InviteId;
END;
GO
```

  Note: the service ALSO calls `AccessRepository.set` (the 10b `usp_ObjectPermission_Set` primitive) — but doing the grant inside this TRANSACTION is what makes accept **atomic** (the spec requires the membership row + the grant be created atomically). The service's `accept` therefore delegates the whole atomic unit to this SP and does NOT make a second out-of-transaction grant call; `setObjectPermission` remains the primitive for the standalone invite-time/admin grant path. (See DECISIONS note in Task 12.)

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`. Expected: both procedures created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_GuestInvite_Create.sql infra/sql/procedures/usp_GuestInvite_Accept.sql
git commit -m "feat(10d): guest invite SPs — Create (pending) + Accept (atomic member row + grant)"
```

---

### Task 4: Guest list/revoke SPs (`GuestInvite_List`, `GuestInvite_Revoke`)

**Files:**
- Create: `infra/sql/procedures/usp_GuestInvite_List.sql`
- Create: `infra/sql/procedures/usp_GuestInvite_Revoke.sql`
- Test: covered by `guests.integration.test.ts` (Task 6); deploy via `scripts/db-deploy-sps.ts`.

Steps:

- [ ] Write `usp_GuestInvite_List.sql` — two result sets: accepted guests (an `IsGuest=1` member) with their granted objects, and still-pending invites:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_GuestInvite_List
  @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  -- Accepted guests + each explicit object grant they hold.
  SELECT
    u.Id AS UserId, u.Email, u.Name, u.AvatarUrl,
    CASE WHEN EXISTS (
      SELECT 1 FROM dbo.UserRoles ur JOIN dbo.Roles r ON r.Id = ur.RoleId
      WHERE ur.UserId = u.Id AND ur.WorkspaceId = @WorkspaceId AND r.Slug = 'workspace-limited-member'
    ) THEN 'workspace-limited-member' ELSE 'workspace-guest' END AS RoleSlug,
    op.ObjectType, op.ObjectId, op.Level
  FROM dbo.WorkspaceMembers wm
  JOIN dbo.Users u ON u.Id = wm.UserId
  LEFT JOIN dbo.ObjectPermissions op
    ON op.WorkspaceId = @WorkspaceId AND op.SubjectType = 'USER' AND op.SubjectId = u.Id
  WHERE wm.WorkspaceId = @WorkspaceId AND wm.IsGuest = 1
  ORDER BY u.Email;

  -- Pending invites (not yet accepted, not revoked).
  SELECT Id, Email, ObjectType, ObjectId, Level, Token, Status, InvitedBy, ExpiresAt, CreatedAt
  FROM dbo.GuestInvites
  WHERE WorkspaceId = @WorkspaceId AND Status = 'pending'
  ORDER BY CreatedAt DESC;
END;
GO
```

- [ ] Write `usp_GuestInvite_Revoke.sql` — revoke a guest entirely (delete their grants + role + membership) OR cancel a still-pending invite. `@UserId` revokes an accepted guest; `@InviteId` cancels a pending invite:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_GuestInvite_Revoke
  @WorkspaceId UNIQUEIDENTIFIER,
  @UserId      UNIQUEIDENTIFIER = NULL,   -- revoke an accepted guest
  @InviteId    UNIQUEIDENTIFIER = NULL    -- cancel a pending invite
AS
BEGIN
  SET NOCOUNT ON;

  BEGIN TRY
    BEGIN TRANSACTION;

    IF @InviteId IS NOT NULL
      UPDATE dbo.GuestInvites SET Status = 'revoked'
      WHERE Id = @InviteId AND WorkspaceId = @WorkspaceId AND Status = 'pending';

    IF @UserId IS NOT NULL
    BEGIN
      -- Only ever touch a GUEST membership — never a real member.
      IF EXISTS (SELECT 1 FROM dbo.WorkspaceMembers WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId AND IsGuest = 1)
      BEGIN
        DELETE FROM dbo.ObjectPermissions
        WHERE WorkspaceId = @WorkspaceId AND SubjectType = 'USER' AND SubjectId = @UserId;

        DELETE ur FROM dbo.UserRoles ur
        JOIN dbo.Roles r ON r.Id = ur.RoleId
        WHERE ur.UserId = @UserId AND ur.WorkspaceId = @WorkspaceId
          AND r.Slug IN ('workspace-guest', 'workspace-limited-member');

        DELETE FROM dbo.WorkspaceMembers WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId AND IsGuest = 1;

        UPDATE dbo.GuestInvites SET Status = 'revoked'
        WHERE WorkspaceId = @WorkspaceId AND Email = (SELECT LOWER(Email) FROM dbo.Users WHERE Id = @UserId) AND Status = 'pending';
      END
    END

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;

  SELECT @UserId AS RevokedUserId, @InviteId AS CancelledInviteId;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`. Expected: both procedures created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_GuestInvite_List.sql infra/sql/procedures/usp_GuestInvite_Revoke.sql
git commit -m "feat(10d): guest list/revoke SPs — List (guests+grants+pending) + Revoke (grants+role+membership)"
```

---

### Task 5: Types + pure guards + repository + service + pure unit tests

**Files:**
- Modify: `packages/types/index.ts` (add the Guest block after the Role block, ~line 847)
- Create: `apps/api/src/modules/guests/guest.pure.ts`
- Create: `apps/api/src/modules/guests/guest.repository.ts`
- Create: `apps/api/src/modules/guests/guest.service.ts`
- Modify: `apps/api/src/modules/access/access.service.ts` (named `setObjectPermission` alias + `filterVisibleNodes`)
- Create: `apps/api/src/modules/guests/__tests__/guest.pure.unit.test.ts`

Steps:

- [ ] Write the failing unit tests first. `guest.pure.unit.test.ts` — the three pure invariants the spec names (org-email→limited-member promotion, reject-guest-at-Space, guest floor = none):

```ts
import { describe, it, expect } from 'vitest';
import {
  isOrgEmail, resolveInviteRole, assertGuestObjectAllowed, guestFloor,
  WORKSPACE_GUEST_ROLE, WORKSPACE_LIMITED_MEMBER_ROLE,
} from '../guest.pure.js';

describe('isOrgEmail', () => {
  it('matches the workspace verified domain case-insensitively', () => {
    expect(isOrgEmail('alice@Acme.com', 'acme.com')).toBe(true);
    expect(isOrgEmail('ALICE@ACME.COM', 'acme.com')).toBe(true);
  });
  it('is false for a different domain or no verified domain', () => {
    expect(isOrgEmail('bob@gmail.com', 'acme.com')).toBe(false);
    expect(isOrgEmail('bob@acme.com', null)).toBe(false);
  });
});

describe('resolveInviteRole (org-email promotion)', () => {
  it('promotes an org-email invite to limited member', () => {
    expect(resolveInviteRole('alice@acme.com', 'acme.com')).toBe(WORKSPACE_LIMITED_MEMBER_ROLE);
  });
  it('keeps an external invite as guest', () => {
    expect(resolveInviteRole('ext@vendor.io', 'acme.com')).toBe(WORKSPACE_GUEST_ROLE);
    expect(resolveInviteRole('ext@vendor.io', null)).toBe(WORKSPACE_GUEST_ROLE);
  });
});

describe('assertGuestObjectAllowed (reject-guest-at-Space)', () => {
  it('rejects a guest at SPACE scope', () => {
    expect(() => assertGuestObjectAllowed(WORKSPACE_GUEST_ROLE, 'SPACE')).toThrow(/space/i);
  });
  it('allows a guest at FOLDER/LIST scope', () => {
    expect(() => assertGuestObjectAllowed(WORKSPACE_GUEST_ROLE, 'FOLDER')).not.toThrow();
    expect(() => assertGuestObjectAllowed(WORKSPACE_GUEST_ROLE, 'LIST')).not.toThrow();
  });
  it('allows a LIMITED MEMBER at SPACE scope', () => {
    expect(() => assertGuestObjectAllowed(WORKSPACE_LIMITED_MEMBER_ROLE, 'SPACE')).not.toThrow();
  });
});

describe('guestFloor (no floor for guests)', () => {
  it('is null for both guest roles', () => {
    expect(guestFloor(true)).toBeNull();
    expect(guestFloor(false)).toBeNull();   // helper documents the invariant: guests never get a floor
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- guest.pure`. Expected: FAIL — `Cannot find module '../guest.pure.js'`.

- [ ] Write `apps/api/src/modules/guests/guest.pure.ts` (pure, no DB; mirrors the service guards so they are unit-testable):

```ts
import type { HierarchyNodeType } from '@projectflow/types';

export const WORKSPACE_GUEST_ROLE          = 'workspace-guest' as const;
export const WORKSPACE_LIMITED_MEMBER_ROLE = 'workspace-limited-member' as const;
export type GuestRoleSlug = typeof WORKSPACE_GUEST_ROLE | typeof WORKSPACE_LIMITED_MEMBER_ROLE;

/** True when the email's domain matches the workspace's verified org domain. */
export function isOrgEmail(email: string, verifiedDomain: string | null): boolean {
  if (!verifiedDomain) return false;
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  return email.slice(at + 1).trim().toLowerCase() === verifiedDomain.trim().toLowerCase();
}

/** Org-email → limited member; external → guest. (Spec §2.3 promotion rule.) */
export function resolveInviteRole(email: string, verifiedDomain: string | null): GuestRoleSlug {
  return isOrgEmail(email, verifiedDomain) ? WORKSPACE_LIMITED_MEMBER_ROLE : WORKSPACE_GUEST_ROLE;
}

/** A GUEST may not be granted Space scope (only Folder/List/task objects). A
 *  LIMITED MEMBER may. (Spec §2.3 — the only resolver-irrelevant guard.) */
export function assertGuestObjectAllowed(role: GuestRoleSlug, objectType: HierarchyNodeType): void {
  if (role === WORKSPACE_GUEST_ROLE && objectType === 'SPACE') {
    throw new GuestObjectScopeError('A guest cannot be added at Space scope — grant a Folder or List instead.');
  }
}

export class GuestObjectScopeError extends Error {
  readonly code = 'GUEST_SPACE_SCOPE_FORBIDDEN';
}

/** Documents the resolver invariant in TS: a guest/limited member contributes
 *  NO membership floor regardless of their underlying membership row. */
export function guestFloor(_isGuestMember: boolean): null { return null; }
```

- [ ] Run: `npm test --workspace apps/api -- guest.pure`. Expected: PASS (the four describe blocks).

- [ ] Extend `packages/types/index.ts` — add the Guest block after the Role/RoleMember block:

```ts
// ─── Guests & Limited Members (Phase 10d, migration 0054) ──────────────────
export const WORKSPACE_GUEST_ROLE          = 'workspace-guest';
export const WORKSPACE_LIMITED_MEMBER_ROLE = 'workspace-limited-member';
export type GuestRoleSlug = typeof WORKSPACE_GUEST_ROLE | typeof WORKSPACE_LIMITED_MEMBER_ROLE;

export type GuestInviteStatus = 'pending' | 'accepted' | 'revoked';

export interface GuestInvite {
  id:          string;
  workspaceId: string;
  email:       string;
  objectType:  HierarchyNodeType;
  objectId:    string;
  level:       ObjectPermissionLevel;
  token:       string;
  status:      GuestInviteStatus;
  invitedBy:   string;
  expiresAt:   string | null;
  createdAt:   string;
  acceptedAt:  string | null;
}

export interface GuestGrant {
  objectType: HierarchyNodeType;
  objectId:   string;
  level:      ObjectPermissionLevel;
}

export interface Guest {
  userId:    string;
  email:     string;
  name:      string;
  avatarUrl: string | null;
  roleSlug:  GuestRoleSlug;
  grants:    GuestGrant[];
}

export interface GuestListResult {
  guests:  Guest[];
  pending: GuestInvite[];
}

export interface InviteGuestInput {
  workspaceId: string;
  email:       string;
  objectType:  HierarchyNodeType;
  objectId:    string;
  level:       ObjectPermissionLevel;
  expiresAt?:  string;
}
```

- [ ] Add the named 10b primitive alias + the per-node filter to `access.service.ts` (additive — do not remove `can`/`resolveOrNull`):

```ts
  /** The 10b grant primitive (named) — write/overwrite a USER/ROLE grant on an
   *  object. Guest accept and the permission editor both call this. */
  async setObjectPermission(
    workspaceId: string,
    subjectType: 'USER' | 'ROLE',
    subjectId: string,
    objectType: HierarchyNodeType,
    objectId: string,
    level: ObjectPermissionLevel,
  ): Promise<void> {
    await this.repo.set(workspaceId, subjectType, subjectId, objectType, objectId, level);
  }

  /** Defense-in-depth: keep only the nodes the user can VIEW. Used by the
   *  tree/listing endpoints so a guest never receives an ungranted sibling
   *  even if the parent gate let the request through. */
  async filterVisibleNodes<T extends { id: string }>(
    userId: string,
    objectType: HierarchyNodeType,
    nodes: T[],
  ): Promise<T[]> {
    const checks = await Promise.all(
      nodes.map(async (n) => ((await this.resolveOrNull(userId, objectType, n.id)).level ? n : null)),
    );
    return checks.filter((n): n is T => n !== null);
  }
```

- [ ] Write `apps/api/src/modules/guests/guest.repository.ts`:

```ts
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { GuestInvite, Guest, GuestGrant, HierarchyNodeType, ObjectPermissionLevel } from '@projectflow/types';
import type { GuestRoleSlug } from './guest.pure.js';

function isoOrNull(v: Date | string | null): string | null {
  return v == null ? null : v instanceof Date ? v.toISOString() : String(v);
}

interface InviteRow {
  Id: string; WorkspaceId: string; Email: string; ObjectType: HierarchyNodeType; ObjectId: string;
  Level: ObjectPermissionLevel; Token: string; Status: GuestInvite['status']; InvitedBy: string;
  ExpiresAt: Date | null; CreatedAt: Date; AcceptedAt: Date | null;
}
function rowToInvite(r: InviteRow): GuestInvite {
  return {
    id: r.Id, workspaceId: r.WorkspaceId, email: r.Email, objectType: r.ObjectType, objectId: r.ObjectId,
    level: r.Level, token: r.Token, status: r.Status, invitedBy: r.InvitedBy,
    expiresAt: isoOrNull(r.ExpiresAt), createdAt: isoOrNull(r.CreatedAt)!, acceptedAt: isoOrNull(r.AcceptedAt),
  };
}

export class GuestRepository {
  async createInvite(args: {
    workspaceId: string; email: string; objectType: HierarchyNodeType; objectId: string;
    level: ObjectPermissionLevel; token: string; invitedBy: string; expiresAt: string | null;
  }): Promise<GuestInvite> {
    const rows = await execSpOne<InviteRow>('usp_GuestInvite_Create', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: args.workspaceId },
      { name: 'Email',       type: sql.NVarChar(255),    value: args.email },
      { name: 'ObjectType',  type: sql.NVarChar(8),      value: args.objectType },
      { name: 'ObjectId',    type: sql.UniqueIdentifier, value: args.objectId },
      { name: 'Level',       type: sql.NVarChar(8),      value: args.level },
      { name: 'Token',       type: sql.NVarChar(64),     value: args.token },
      { name: 'InvitedBy',   type: sql.UniqueIdentifier, value: args.invitedBy },
      { name: 'ExpiresAt',   type: sql.DateTime2,        value: args.expiresAt ? new Date(args.expiresAt) : null },
    ]);
    return rowToInvite(rows[0]);
  }

  async acceptInvite(token: string, accepterUserId: string, roleSlug: GuestRoleSlug): Promise<{
    id: string; workspaceId: string; objectType: HierarchyNodeType; objectId: string; userId: string;
  }> {
    const rows = await execSpOne<{
      Id: string; WorkspaceId: string; ObjectType: HierarchyNodeType; ObjectId: string; UserId: string;
    }>('usp_GuestInvite_Accept', [
      { name: 'Token',          type: sql.NVarChar(64),     value: token },
      { name: 'AccepterUserId', type: sql.UniqueIdentifier, value: accepterUserId },
      { name: 'RoleSlug',       type: sql.NVarChar(100),    value: roleSlug },
    ]);
    const r = rows[0];
    return { id: r.Id, workspaceId: r.WorkspaceId, objectType: r.ObjectType, objectId: r.ObjectId, userId: r.UserId };
  }

  async listGuests(workspaceId: string): Promise<{ guests: Guest[]; pending: GuestInvite[] }> {
    // Two result sets: guest+grant rows, then pending invites.
    const { execSp } = await import('../../shared/lib/sqlClient.js');
    const sets = await execSp<any>('usp_GuestInvite_List', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    ]);
    const guestRows: any[] = (sets as any).recordsets?.[0] ?? [];
    const pendingRows: any[] = (sets as any).recordsets?.[1] ?? [];

    const byUser = new Map<string, Guest>();
    for (const row of guestRows) {
      let g = byUser.get(row.UserId);
      if (!g) {
        g = { userId: row.UserId, email: row.Email, name: row.Name, avatarUrl: row.AvatarUrl, roleSlug: row.RoleSlug, grants: [] };
        byUser.set(row.UserId, g);
      }
      if (row.ObjectId) g.grants.push({ objectType: row.ObjectType, objectId: row.ObjectId, level: row.Level } as GuestGrant);
    }
    return { guests: [...byUser.values()], pending: pendingRows.map(rowToInvite) };
  }

  async revokeGuest(workspaceId: string, opts: { userId?: string; inviteId?: string }): Promise<void> {
    await execSpOne('usp_GuestInvite_Revoke', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'UserId',      type: sql.UniqueIdentifier, value: opts.userId ?? null },
      { name: 'InviteId',    type: sql.UniqueIdentifier, value: opts.inviteId ?? null },
    ]);
  }
}
```

  Note: `execSp` (multi-recordset) vs `execSpOne` (first recordset) — `usp_GuestInvite_List` returns two sets, so it uses `execSp`. Confirm the exact multi-recordset accessor against `worklog.repository.listByTask` (the existing two-result-set consumer) and match its shape.

- [ ] Write `apps/api/src/modules/guests/guest.service.ts` — the org-email guard, the Space-rejection, token generation, and the atomic accept (delegating to the SP; the standalone grant primitive remains available):

```ts
import { randomBytes } from 'node:crypto';
import { GuestRepository } from './guest.repository.js';
import { WorkspaceRepository } from '../workspaces/workspace.repository.js';
import { UserRepository } from '../users/user.repository.js';
import {
  resolveInviteRole, assertGuestObjectAllowed, isOrgEmail,
  WORKSPACE_GUEST_ROLE, WORKSPACE_LIMITED_MEMBER_ROLE, type GuestRoleSlug,
} from './guest.pure.js';
import type { GuestInvite, InviteGuestInput, GuestListResult } from '@projectflow/types';

export class GuestService {
  constructor(
    private repo = new GuestRepository(),
    private workspaceRepo = new WorkspaceRepository(),
    private userRepo = new UserRepository(),
  ) {}

  /** Invite a guest to a specific object at a level. Org-email → limited member
   *  (promoted); a guest may NOT be granted Space scope. */
  async invite(input: InviteGuestInput, invitedBy: string): Promise<{ invite: GuestInvite; role: GuestRoleSlug }> {
    const verifiedDomain = await this.workspaceRepo.getVerifiedDomain(input.workspaceId); // string | null
    const role = resolveInviteRole(input.email, verifiedDomain);
    assertGuestObjectAllowed(role, input.objectType);                 // throws GuestObjectScopeError on guest@SPACE
    const token = randomBytes(32).toString('base64url').slice(0, 64); // high-entropy, fits NVARCHAR(64)
    const invite = await this.repo.createInvite({
      workspaceId: input.workspaceId, email: input.email.toLowerCase(),
      objectType: input.objectType, objectId: input.objectId, level: input.level,
      token, invitedBy, expiresAt: input.expiresAt ?? null,
    });
    return { invite, role };
  }

  /** Accept an invite: the authed user's email must match the invite email; the
   *  membership row + grant are created atomically in usp_GuestInvite_Accept. */
  async accept(token: string, accepterUserId: string, accepterEmail: string, verifiedDomain: string | null) {
    const role: GuestRoleSlug = isOrgEmail(accepterEmail, verifiedDomain)
      ? WORKSPACE_LIMITED_MEMBER_ROLE : WORKSPACE_GUEST_ROLE;
    // Email-match is enforced in the route (compares invite.email to the authed
    // user's email) before this call; the SP re-validates pending/expiry.
    return this.repo.acceptInvite(token, accepterUserId, role);
  }

  list(workspaceId: string): Promise<GuestListResult> {
    return this.repo.listGuests(workspaceId);
  }

  revoke(workspaceId: string, opts: { userId?: string; inviteId?: string }): Promise<void> {
    return this.repo.revokeGuest(workspaceId, opts);
  }
}

export const guestService = new GuestService();
```

  Note: confirm `WorkspaceRepository.getVerifiedDomain` and `UserRepository` method names against the real files; if `getVerifiedDomain` doesn't exist, add a one-line SP-free read (`SELECT VerifiedDomain FROM Workspaces WHERE Id=@Id`) to the workspace repo. The accept route looks up the invite's email + the authed user's email to enforce the match.

- [ ] Run: `npm run build --workspace apps/api` (tsc) and `npm test --workspace apps/api -- guest.pure`. Expected: PASS — compiles, pure tests green.

- [ ] Commit:
```
git add packages/types/index.ts apps/api/src/modules/guests/guest.pure.ts apps/api/src/modules/guests/guest.repository.ts apps/api/src/modules/guests/guest.service.ts apps/api/src/modules/access/access.service.ts apps/api/src/modules/guests/__tests__/guest.pure.unit.test.ts
git commit -m "feat(10d): guest types + pure guards + repo/service + access.setObjectPermission/filterVisibleNodes + pure unit tests"
```

---

### Task 6: REST routes + tree-filter defense-in-depth + integration test

**Files:**
- Create: `apps/api/src/modules/guests/guest.routes.ts`
- Modify: `apps/api/src/server.ts` (mount `app.route('/guests', guestRoutes)`)
- Modify: `apps/api/src/modules/hierarchy/list.routes.ts` (per-node guest filter)
- Modify: `apps/api/src/modules/hierarchy/folder.routes.ts` (per-node guest filter)
- Modify: `apps/api/src/modules/projects/project.routes.ts` (per-node guest filter on the Space list)
- Create: `apps/api/src/modules/guests/__tests__/guests.integration.test.ts`

Steps:

- [ ] Write the failing integration test first (copy the harness imports from `object-access.integration.test.ts` + `factories.js`):

```ts
/**
 * Phase 10d — Guests & Limited Members integration coverage.
 * Asserts a guest sees ONLY explicitly-shared items, cannot enumerate the
 * Space tree, and an org-email invite becomes a limited member (not a guest).
 * DB SAFETY: must target local Docker ProjectFlow_Test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function seedSpaceWithTwoLists() {
  const owner = await createTestUser({ email: `g-owner-${Date.now()}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'GSpace', key: `GS${Date.now() % 100000}` });
  const mk = (name: string) => json<{ data: any }>(
    request('/lists', { method: 'POST', token, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name, position: 0 } }), 201,
  ).then((r) => r.data);
  const listA = await mk('Shared List');
  const listB = await mk('Hidden List');
  return { owner, token, wsId: ws.Id, spaceId: space.Id, listA, listB };
}

describe('guests', () => {
  it('invite (external) → accept → guest sees the granted List only, 404s the Space + sibling', async () => {
    const { token, wsId, spaceId, listA, listB } = await seedSpaceWithTwoLists();
    const guest = await createTestUser({ email: `ext-${Date.now()}@vendor.io` }); // not the workspace org domain

    const { invite } = (await json<{ invite: any }>(await request('/guests/invites', {
      method: 'POST', token,
      json: { workspaceId: wsId, email: guest.email, objectType: 'LIST', objectId: listA.id, level: 'VIEW' },
    }), 201));
    expect(invite.status).toBe('pending');

    await json(await request(`/guests/invites/${invite.token}/accept`, { method: 'POST', token: guest.accessToken, json: {} }), 200);

    // Granted List → 200.
    const okList = await request(`/lists/${listA.id}/effective-statuses`, { token: guest.accessToken });
    expect(okList.status).toBe(200);

    // Sibling List → 403 (exists, no grant — resolver floor=none).
    const sibling = await request(`/lists/${listB.id}/effective-statuses`, { token: guest.accessToken });
    expect(sibling.status).toBe(403);

    // The Space tree is invisible: folder/list listings under the Space are gated 403.
    const spaceLists = await request(`/lists?spaceId=${spaceId}`, { token: guest.accessToken });
    expect(spaceLists.status).toBe(403);
    const spaceFolders = await request(`/folders?spaceId=${spaceId}`, { token: guest.accessToken });
    expect(spaceFolders.status).toBe(403);
  });

  it('org-email invite becomes a LIMITED MEMBER, not a guest', async () => {
    const { token, wsId, listA } = await seedSpaceWithTwoLists();
    // Set the workspace verified domain to the invitee's domain.
    await request(`/workspaces/${wsId}`, { method: 'PATCH', token, json: { verifiedDomain: 'orgmail.test' } });

    const { invite } = (await json<{ invite: any; role: string }>(await request('/guests/invites', {
      method: 'POST', token,
      json: { workspaceId: wsId, email: `staff-${Date.now()}@orgmail.test`, objectType: 'LIST', objectId: listA.id, level: 'VIEW' },
    }), 201));
    // The response (and the listed guest after accept) is tagged limited-member.
    const body = (await json<{ role: string }>(await request('/guests/invites', {
      method: 'POST', token,
      json: { workspaceId: wsId, email: `staff2-${Date.now()}@orgmail.test`, objectType: 'LIST', objectId: listA.id, level: 'VIEW' },
    }), 201));
    expect(body.role).toBe('workspace-limited-member');
    expect(invite.status).toBe('pending');
  });

  it('rejects a GUEST invite at SPACE scope (external email)', async () => {
    const { token, wsId, spaceId } = await seedSpaceWithTwoLists();
    const res = await request('/guests/invites', {
      method: 'POST', token,
      json: { workspaceId: wsId, email: `ext2-${Date.now()}@vendor.io`, objectType: 'SPACE', objectId: spaceId, level: 'VIEW' },
    });
    expect(res.status).toBe(422);
  });
});
```

- [ ] Run: `npm run test:integration --workspace apps/api -- guests` against `ProjectFlow_Test`. Expected: FAIL — `/guests/*` routes 404 (not yet mounted).

- [ ] Write `apps/api/src/modules/guests/guest.routes.ts` — invite (FULL on the object), accept (email-match), list/revoke (`guest.manage`):

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { guestService } from './guest.service.js';
import { GuestObjectScopeError } from './guest.pure.js';
import { GuestRepository } from './guest.repository.js';
import { requireObjectAccess } from '../access/access.middleware.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import { WorkspaceRepository } from '../workspaces/workspace.repository.js';
import { UserRepository } from '../users/user.repository.js';

export const guestRoutes = new Hono();
const workspaceRepo = new WorkspaceRepository();
const userRepo = new UserRepository();
const inviteRepo = new GuestRepository();

const inviteSchema = z.object({
  workspaceId: z.string().uuid(),
  email:       z.string().email(),
  objectType:  z.enum(['SPACE', 'FOLDER', 'LIST']),
  objectId:    z.string().uuid(),
  level:       z.enum(['VIEW', 'COMMENT', 'EDIT', 'FULL']),
  expiresAt:   z.string().datetime().optional(),
});

// POST /guests/invites — requires FULL on the target object (only someone who
// fully controls an object may share it / grant access — spec §3).
guestRoutes.post('/invites', zValidator('json', inviteSchema),
  requireObjectAccess('FULL', (c) => {
    const b = (c.req as any).valid('json');
    return { type: b.objectType, id: b.objectId };
  }),
  async (c) => {
    const invitedBy = ((c as any).get('user') as any).userId as string;
    const input = c.req.valid('json');
    try {
      const { invite, role } = await guestService.invite(input, invitedBy);
      return c.json({ invite, role }, 201);
    } catch (e) {
      if (e instanceof GuestObjectScopeError) {
        return c.json({ error: { code: e.code, message: e.message, statusCode: 422 } }, 422);
      }
      throw e;
    }
  },
);

// POST /guests/invites/:token/accept — the authed user accepts; their email
// must match the invite email.
guestRoutes.post('/invites/:token/accept', async (c) => {
  const user = (c as any).get('user') as any;
  if (!user?.userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
  const token = c.req.param('token');
  const invite = await inviteRepo.findByToken?.(token) ?? null; // helper: SELECT * FROM GuestInvites WHERE Token=@Token
  if (!invite) return c.json({ error: { code: 'NOT_FOUND', message: 'Invite not found' } }, 404);
  const me = await userRepo.getById(user.userId);
  if (!me || me.Email.toLowerCase() !== invite.email.toLowerCase()) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'This invite is for a different email' } }, 403);
  }
  const verifiedDomain = await workspaceRepo.getVerifiedDomain(invite.workspaceId);
  const result = await guestService.accept(token, user.userId, me.Email, verifiedDomain);
  return c.json({ accepted: result }, 200);
});

// GET /guests?workspaceId= — list guests + pending (guest.manage).
guestRoutes.get('/', zValidator('query', z.object({ workspaceId: z.string().uuid() })),
  requirePermission('guest.manage', { workspaceParam: 'workspaceId' }),
  async (c) => c.json(await guestService.list(c.req.query('workspaceId')!)),
);

// DELETE /guests/:userId?workspaceId= — revoke an accepted guest (guest.manage).
guestRoutes.delete('/:userId', zValidator('query', z.object({ workspaceId: z.string().uuid() })),
  requirePermission('guest.manage', { workspaceParam: 'workspaceId' }),
  async (c) => {
    await guestService.revoke(c.req.query('workspaceId')!, { userId: c.req.param('userId') });
    return c.json({ ok: true });
  },
);

// DELETE /guests/invites/:inviteId?workspaceId= — cancel a pending invite.
guestRoutes.delete('/invites/:inviteId', zValidator('query', z.object({ workspaceId: z.string().uuid() })),
  requirePermission('guest.manage', { workspaceParam: 'workspaceId' }),
  async (c) => {
    await guestService.revoke(c.req.query('workspaceId')!, { inviteId: c.req.param('inviteId') });
    return c.json({ ok: true });
  },
);
```

  Note: `findByToken` on the repo and `userRepo.getById` are tiny reads — add `findByToken` to `GuestRepository` (`SELECT ... FROM GuestInvites WHERE Token=@Token` → `rowToInvite`) and confirm `UserRepository.getById` returns `{ Email }`. Match the existing user repo method name.

- [ ] Mount the routes in `server.ts` (alongside the other `app.route(...)` calls):

```ts
import { guestRoutes } from './modules/guests/guest.routes.js';
// ...
app.route('/guests', guestRoutes);
```

- [ ] Add the per-node defense-in-depth filter to the three tree-listing endpoints. In `list.routes.ts`, after the existing SPACE `VIEW` gate, filter the returned lists so a guest never receives an ungranted sibling even if the parent gate somehow passed (it normally 403s for a guest, but the filter is belt-and-braces and also covers the future "guest granted a Folder, lists its children" path). Replace the GET handler body:

```ts
listRoutes.get('/', zValidator('query', listQuery),
  requireObjectAccess('VIEW', (c) => ({ type: 'SPACE', id: c.req.query('spaceId')! })),
  async (c) => {
    const userId = ((c as any).get('user') as any).userId as string;
    const folderId = c.req.query('folderId') ?? null;
    const allInSpace = folderId === null;
    const lists = await listService.list(c.req.query('spaceId')!, folderId, allInSpace);
    // Defense-in-depth: drop any node the caller can't VIEW (guests only ever
    // see explicitly granted lists; for full members filterVisibleNodes is a
    // no-op since their EDIT floor passes every node).
    const visible = await accessService.filterVisibleNodes(
      userId, 'LIST', (lists as any[]).map((l) => ({ ...l, id: l.id ?? l.Id })),
    );
    return c.json({ data: visible });
  },
);
```

  (Add `import { accessService } from '../access/access.service.js';` at the top.) Apply the EXACT same pattern to `folder.routes.ts` GET (`'FOLDER'`) and `project.routes.ts`' Space-list GET (`'SPACE'`). The full-member case is a no-op (their floor passes every node), so existing behavior is preserved; only guests get nodes pruned.

- [ ] Run: `npm run test:integration --workspace apps/api -- guests object-access` against `ProjectFlow_Test`. Expected: PASS (guests suite green; the existing object-access suite still green — full members unaffected by the filter).

- [ ] Commit:
```
git add apps/api/src/modules/guests/guest.routes.ts apps/api/src/server.ts apps/api/src/modules/hierarchy/list.routes.ts apps/api/src/modules/hierarchy/folder.routes.ts apps/api/src/modules/projects/project.routes.ts apps/api/src/modules/guests/__tests__/guests.integration.test.ts
git commit -m "feat(10d): guest REST — invite(FULL)/accept(email-match)/list/revoke + tree-listing per-node guest filter + integration"
```

---

### Task 7: Resolver-level invariant integration test (security focus)

**Files:**
- Create: `apps/api/src/modules/access/__tests__/guest-resolver.integration.test.ts`

This task gives the "cannot see the Space tree" invariant an EXPLICIT test at the **resolver** level (Task 6 covered the **tree-listing** defense-in-depth level); the spec §7.5 acceptance requires both.

Steps:

- [ ] Write the resolver integration test — exercise `usp_ObjectAccess_Resolve` (via `accessService.resolveOrNull`) directly for a guest with exactly one List grant:

```ts
/**
 * Phase 10d — resolver-level guest invariant. Proves usp_ObjectAccess_Resolve
 * gives a guest NO floor: VIEW on the one granted List, NULL (Found=true) on
 * the Space + sibling List, so the tree is invisible by construction.
 * DB SAFETY: local Docker ProjectFlow_Test only.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { accessService } from '../access.service.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

describe('resolver: guest contributes no floor', () => {
  it('guest with one List grant resolves VIEW there, NULL on the Space + sibling', async () => {
    const owner = await createTestUser({ email: `gr-owner-${Date.now()}@projectflow.test` });
    const t = owner.accessToken;
    const ws = await createTestWorkspace(t);
    const space = await createTestProject(ws.Id, t, { name: 'GR', key: `GR${Date.now() % 100000}` });
    const mk = (name: string) => json<{ data: any }>(
      request('/lists', { method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name, position: 0 } }), 201,
    ).then((r) => r.data);
    const granted = await mk('Granted');
    const other   = await mk('Other');

    const guest = await createTestUser({ email: `gr-ext-${Date.now()}@vendor.io` });
    const { invite } = (await json<{ invite: any }>(await request('/guests/invites', {
      method: 'POST', token: t,
      json: { workspaceId: ws.Id, email: guest.email, objectType: 'LIST', objectId: granted.id, level: 'VIEW' },
    }), 201));
    await json(await request(`/guests/invites/${invite.token}/accept`, { method: 'POST', token: guest.accessToken, json: {} }), 200);

    // Resolver is the source of truth.
    const onGranted = await accessService.resolveOrNull(guest.id, 'LIST', granted.id);
    expect(onGranted.level).toBe('VIEW');
    expect(onGranted.found).toBe(true);

    const onSibling = await accessService.resolveOrNull(guest.id, 'LIST', other.id);
    expect(onSibling.level).toBeNull();      // no floor, no grant
    expect(onSibling.found).toBe(true);      // object exists → 403, not 404

    const onSpace = await accessService.resolveOrNull(guest.id, 'SPACE', space.Id);
    expect(onSpace.level).toBeNull();        // the Space itself is invisible
    expect(onSpace.found).toBe(true);
  });

  it('a FULL member still resolves the EDIT floor (no regression)', async () => {
    const owner = await createTestUser({ email: `gr-m-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const space = await createTestProject(ws.Id, owner.accessToken, { name: 'M', key: `M${Date.now() % 100000}` });
    // Owner resolves FULL; a plain member would resolve EDIT — owner is the floor proof here.
    const r = await accessService.resolveOrNull(owner.id, 'SPACE', space.Id);
    expect(r.level).toBe('FULL');
  });
});
```

- [ ] Run: `npm run test:integration --workspace apps/api -- guest-resolver` against `ProjectFlow_Test`. Expected: PASS — the guest gets `VIEW`/`null`/`null` and the owner keeps `FULL`.

- [ ] Commit:
```
git add apps/api/src/modules/access/__tests__/guest-resolver.integration.test.ts
git commit -m "test(10d): resolver invariant — guest no-floor (granted=VIEW, space+sibling=null) + member floor unregressed"
```

---

### Task 8: GraphQL mirror (`guests.schema.ts`)

**Files:**
- Create: `apps/api/src/graphql/guests.schema.ts`
- Modify: `apps/api/src/graphql/schema.ts` (import + call near the other `register*Graphql()` calls)

Steps:

- [ ] Write `guests.schema.ts`, mirroring `recurrence.schema.ts`'s structure (typed `objectRef`, `requireObjectLevel`/`requireWorkspacePermission`/`notFound` from `./authz.js`, delegating to the one shared `guestService`):

```ts
import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { guestService } from '../modules/guests/guest.service.js';
import { GuestObjectScopeError } from '../modules/guests/guest.pure.js';
import { GuestRepository } from '../modules/guests/guest.repository.js';
import { WorkspaceRepository } from '../modules/workspaces/workspace.repository.js';
import { UserRepository } from '../modules/users/user.repository.js';
import { requireObjectLevel, requireWorkspacePermission, notFound } from './authz.js';
import type { GuestInvite, Guest } from '@projectflow/types';

const inviteRepo = new GuestRepository();
const workspaceRepo = new WorkspaceRepository();
const userRepo = new UserRepository();

export function registerGuestGraphql(): void {
  const GuestInviteType = builder.objectRef<GuestInvite>('GuestInvite');
  GuestInviteType.implement({ fields: (t) => ({
    id:         t.exposeString('id'),
    email:      t.exposeString('email'),
    objectType: t.exposeString('objectType'),
    objectId:   t.exposeString('objectId'),
    level:      t.exposeString('level'),
    token:      t.exposeString('token'),
    status:     t.exposeString('status'),
    expiresAt:  t.string({ nullable: true, resolve: (g) => g.expiresAt }),
    createdAt:  t.field({ type: 'Date', resolve: (g) => new Date(g.createdAt) }),
  }) });

  const GuestType = builder.objectRef<Guest>('Guest');
  GuestType.implement({ fields: (t) => ({
    userId:    t.exposeString('userId'),
    email:     t.exposeString('email'),
    name:      t.exposeString('name'),
    avatarUrl: t.string({ nullable: true, resolve: (g) => g.avatarUrl }),
    roleSlug:  t.exposeString('roleSlug'),
    grants:    t.field({ type: ['GuestGrant'], resolve: (g) => g.grants }),
  }) });

  builder.objectRef<Guest['grants'][number]>('GuestGrant').implement({ fields: (t) => ({
    objectType: t.exposeString('objectType'),
    objectId:   t.exposeString('objectId'),
    level:      t.exposeString('level'),
  }) });

  builder.queryFields((t) => ({
    workspaceGuests: t.field({
      type: GuestType,
      args: { workspaceId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'guest.manage');
        return (await guestService.list(a.workspaceId)).guests;
      },
    }),
  }));

  builder.mutationFields((t) => ({
    inviteGuest: t.field({
      type: GuestInviteType,
      args: {
        workspaceId: t.arg.string({ required: true }),
        email:       t.arg.string({ required: true }),
        objectType:  t.arg.string({ required: true }),
        objectId:    t.arg.string({ required: true }),
        level:       t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        // FULL on the object (mirror the REST gate).
        await requireObjectLevel(ctx, a.objectType as any, a.objectId, 'FULL');
        try {
          const { invite } = await guestService.invite({
            workspaceId: a.workspaceId, email: a.email,
            objectType: a.objectType as any, objectId: a.objectId, level: a.level as any,
          }, (ctx.user as any).userId);
          return invite;
        } catch (e) {
          if (e instanceof GuestObjectScopeError) throw new GraphQLError(e.message, { extensions: { code: e.code } });
          throw e;
        }
      },
    }),
    acceptGuestInvite: t.field({
      type: 'Boolean',
      args: { token: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
        const invite = await inviteRepo.findByToken(a.token);
        if (!invite) notFound('Invite not found');
        const me = await userRepo.getById((ctx.user as any).userId);
        if (!me || me.Email.toLowerCase() !== invite.email.toLowerCase()) {
          throw new GraphQLError('This invite is for a different email', { extensions: { code: 'FORBIDDEN' } });
        }
        const verifiedDomain = await workspaceRepo.getVerifiedDomain(invite.workspaceId);
        await guestService.accept(a.token, (ctx.user as any).userId, me.Email, verifiedDomain);
        return true;
      },
    }),
    revokeGuest: t.field({
      type: 'Boolean',
      args: { workspaceId: t.arg.string({ required: true }), userId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'guest.manage');
        await guestService.revoke(a.workspaceId, { userId: a.userId });
        return true;
      },
    }),
  }));
}
```

- [ ] Wire it into `schema.ts` — add the import alongside the others and call it near the other `register*Graphql()` calls:

```ts
import { registerGuestGraphql } from './guests.schema.js';
```
```ts
// ─────────────────────────────────────────
// Guests (Phase 10d) — Guest/GuestInvite types + workspaceGuests query +
// inviteGuest/acceptGuestInvite/revokeGuest mutations. Gates mirror REST:
// inviteGuest requires FULL on the object; list/revoke require guest.manage.
// ─────────────────────────────────────────
registerGuestGraphql();
```

- [ ] Run: `npm run build --workspace apps/api` (tsc — compiles the Pothos schema). Expected: PASS — schema builds. Then `npm test --workspace apps/api`. Expected: PASS (existing GraphQL authz tests still green).

- [ ] Commit:
```
git add apps/api/src/graphql/guests.schema.ts apps/api/src/graphql/schema.ts
git commit -m "feat(10d): GraphQL guest mirror — workspaceGuests + inviteGuest(FULL)/acceptGuestInvite(email-match)/revokeGuest"
```

---

### Task 9: Frontend — server actions + guest management panel + accept page + i18n

**Files:**
- Create: `apps/next-web/src/server/actions/guests.ts`
- Create: `apps/next-web/src/components/settings/GuestManagementPanel.tsx`
- Create: `apps/next-web/src/components/settings/GuestManagementPanel.module.css`
- Create: `apps/next-web/src/app/(app)/guests/accept/[token]/page.tsx`
- Modify: `apps/next-web/src/messages/en.json`
- Modify: `apps/next-web/src/messages/id.json`
- Note: read `node_modules/next/dist/docs/` per `apps/next-web/AGENTS.md` before writing web code (this Next.js has breaking changes).

Steps:

- [ ] Write `server/actions/guests.ts` — mirror `members.ts`' `requireSession` + `serverFetch` + `toActionError` shape:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type { GuestListResult, HierarchyNodeType, ObjectPermissionLevel } from '@projectflow/types';

export async function loadGuests(workspaceId: string): Promise<GuestListResult> {
  await requireSession();
  return (await serverFetch<GuestListResult>(`/guests?workspaceId=${encodeURIComponent(workspaceId)}`)) ?? { guests: [], pending: [] };
}

export async function inviteGuest(input: {
  workspaceId: string; email: string; objectType: HierarchyNodeType; objectId: string; level: ObjectPermissionLevel;
}): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/guests/invites', { method: 'POST', body: JSON.stringify(input) });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/workspaces/${input.workspaceId}/guests`);
  return { ok: true };
}

export async function acceptGuestInvite(token: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/guests/invites/${encodeURIComponent(token)}/accept`, { method: 'POST', body: '{}' });
  } catch (e) {
    return toActionError(e);
  }
  return { ok: true };
}

export async function revokeGuest(workspaceId: string, userId: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/guests/${encodeURIComponent(userId)}?workspaceId=${encodeURIComponent(workspaceId)}`, { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/workspaces/${workspaceId}/guests`);
  return { ok: true };
}
```

- [ ] Write `GuestManagementPanel.tsx` — invite form (email + object picker + level), guest list with granted objects, revoke. A client component fed the workspace's Space/Folder/List nodes (reuse the existing hierarchy picker source) so the inviter chooses a target object:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { inviteGuest, revokeGuest } from '@/server/actions/guests';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { Guest, GuestInvite, HierarchyNodeType, ObjectPermissionLevel } from '@projectflow/types';
import styles from './GuestManagementPanel.module.css';

interface ObjectOption { type: HierarchyNodeType; id: string; label: string }

export function GuestManagementPanel({
  workspaceId, initialGuests, initialPending, objectOptions,
}: { workspaceId: string; initialGuests: Guest[]; initialPending: GuestInvite[]; objectOptions: ObjectOption[] }) {
  const t = useTranslations('Guests');
  const [guests, setGuests] = useState(initialGuests);
  const [pending] = useState(initialPending);
  const [email, setEmail] = useState('');
  const [target, setTarget] = useState<ObjectOption | null>(objectOptions[0] ?? null);
  const [level, setLevel] = useState<ObjectPermissionLevel>('VIEW');
  const [busy, start] = useTransition();

  const onInvite = () => start(async () => {
    if (!target || !email.trim()) return;
    const r = await inviteGuest({ workspaceId, email: email.trim(), objectType: target.type, objectId: target.id, level });
    if (!r.ok) return notifyActionError(r);
    setEmail('');
  });

  const onRevoke = (userId: string) => start(async () => {
    const r = await revokeGuest(workspaceId, userId);
    if (!r.ok) return notifyActionError(r);
    setGuests((g) => g.filter((x) => x.userId !== userId));
  });

  return (
    <section className={styles.root}>
      <h2 className={styles.heading}>{t('title')}</h2>

      <div className={styles.inviteRow}>
        <input className={styles.input} type="email" placeholder={t('emailPlaceholder')} value={email}
               onChange={(e) => setEmail(e.target.value)} aria-label={t('email')} />
        <select className={styles.select} aria-label={t('object')}
                value={target ? `${target.type}:${target.id}` : ''}
                onChange={(e) => setTarget(objectOptions.find((o) => `${o.type}:${o.id}` === e.target.value) ?? null)}>
          {objectOptions.map((o) => <option key={`${o.type}:${o.id}`} value={`${o.type}:${o.id}`}>{o.label}</option>)}
        </select>
        <select className={styles.select} aria-label={t('level')} value={level}
                onChange={(e) => setLevel(e.target.value as ObjectPermissionLevel)}>
          {(['VIEW', 'COMMENT', 'EDIT', 'FULL'] as const).map((l) => <option key={l} value={l}>{t(`levels.${l}`)}</option>)}
        </select>
        <button className={styles.inviteBtn} onClick={onInvite} disabled={busy}>{t('invite')}</button>
      </div>
      <p className={styles.hint}>{t('spaceRuleHint')}</p>

      <ul className={styles.list}>
        {guests.map((g) => (
          <li key={g.userId} className={styles.guestRow} data-guest-role={g.roleSlug}>
            <span className={styles.guestEmail}>{g.email}</span>
            <span className={styles.guestRole}>{t(`roles.${g.roleSlug === 'workspace-limited-member' ? 'limited' : 'guest'}`)}</span>
            <span className={styles.grants}>{g.grants.map((gr) => `${gr.objectType} · ${gr.level}`).join(', ') || t('noGrants')}</span>
            <button className={styles.revokeBtn} onClick={() => onRevoke(g.userId)} disabled={busy}>{t('revoke')}</button>
          </li>
        ))}
        {pending.map((p) => (
          <li key={p.id} className={`${styles.guestRow} ${styles.pending}`}>
            <span className={styles.guestEmail}>{p.email}</span>
            <span className={styles.guestRole}>{t('statusPending')}</span>
            <span className={styles.grants}>{p.objectType} · {p.level}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] Write `GuestManagementPanel.module.css`:

```css
.root { display: flex; flex-direction: column; gap: 12px; }
.heading { font-weight: 700; font-size: 16px; }
.inviteRow { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.input { flex: 1 1 220px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border, #d1d5db); }
.select { padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border, #d1d5db); }
.inviteBtn { padding: 6px 14px; border: none; border-radius: 6px; background: #2563eb; color: #fff; cursor: pointer; }
.inviteBtn:disabled { opacity: .6; cursor: default; }
.hint { font-size: 12px; color: var(--text-2, #6b7280); }
.list { display: flex; flex-direction: column; gap: 6px; list-style: none; padding: 0; margin: 0; }
.guestRow { display: grid; grid-template-columns: 1fr auto 1.5fr auto; gap: 10px; align-items: center; padding: 6px 8px; border-radius: 6px; background: var(--surface-2, #f3f4f6); }
.guestRow.pending { opacity: .7; }
.guestRole { font-size: 12px; font-weight: 600; }
.grants { font-size: 12px; color: var(--text-2, #6b7280); }
.revokeBtn { border: none; background: transparent; color: #ef4444; cursor: pointer; }
.noGrants { font-style: italic; }
```

- [ ] Write the accept landing `app/(app)/guests/accept/[token]/page.tsx` — a server component that accepts then redirects to the granted object (or shows an error). Read `node_modules/next/dist/docs/` for the correct `params` typing first:

```tsx
import { redirect } from 'next/navigation';
import { acceptGuestInvite } from '@/server/actions/guests';
import { getTranslations } from 'next-intl/server';

export default async function AcceptGuestInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations('Guests');
  const r = await acceptGuestInvite(token);
  if (r.ok) redirect('/'); // SidebarTree now shows only the granted object(s)
  return (
    <main style={{ padding: 32 }}>
      <h1>{t('acceptFailedTitle')}</h1>
      <p>{t('acceptFailedBody')}</p>
    </main>
  );
}
```

  (Mount the workspace settings panel where the existing members page renders — pass `objectOptions` built from the workspace's hierarchy nodes. The "guest sidebar shows only granted objects" requirement is satisfied by the now-guest-aware listing endpoints from Task 6 — `SidebarTree` consumes the filtered tree without further change; verify it renders empty-but-for-grants for a guest and add a guest empty-state string if needed.)

- [ ] Add the `Guests` namespace to `en.json`:

```json
"Guests": {
  "title": "Guests & limited members",
  "email": "Email",
  "emailPlaceholder": "guest@example.com",
  "object": "Object",
  "level": "Access level",
  "invite": "Invite",
  "revoke": "Revoke",
  "spaceRuleHint": "Guests can be added to a Folder or List, not a whole Space. People with your organization's email become limited members.",
  "noGrants": "No objects shared yet",
  "statusPending": "Pending",
  "acceptFailedTitle": "Could not accept invite",
  "acceptFailedBody": "The invite may have expired, been revoked, or been issued to a different email.",
  "roles": { "guest": "Guest", "limited": "Limited member" },
  "levels": { "VIEW": "View", "COMMENT": "Comment", "EDIT": "Edit", "FULL": "Full" }
}
```

- [ ] Add the same `Guests` namespace to `id.json` with real Indonesian:

```json
"Guests": {
  "title": "Tamu & anggota terbatas",
  "email": "Email",
  "emailPlaceholder": "tamu@contoh.com",
  "object": "Objek",
  "level": "Tingkat akses",
  "invite": "Undang",
  "revoke": "Cabut",
  "spaceRuleHint": "Tamu dapat ditambahkan ke Folder atau List, bukan seluruh Space. Pengguna dengan email organisasi Anda menjadi anggota terbatas.",
  "noGrants": "Belum ada objek yang dibagikan",
  "statusPending": "Menunggu",
  "acceptFailedTitle": "Tidak dapat menerima undangan",
  "acceptFailedBody": "Undangan mungkin telah kedaluwarsa, dicabut, atau ditujukan untuk email lain.",
  "roles": { "guest": "Tamu", "limited": "Anggota terbatas" },
  "levels": { "VIEW": "Lihat", "COMMENT": "Komentar", "EDIT": "Edit", "FULL": "Penuh" }
}
```

- [ ] Run: `npm test --workspace apps/next-web` (includes the `messages.unit` parity test). Expected: PASS — en/id key parity green. Then `npm run build --workspace apps/next-web`. Expected: PASS.

- [ ] Commit:
```
git add apps/next-web/src/server/actions/guests.ts apps/next-web/src/components/settings/GuestManagementPanel.tsx apps/next-web/src/components/settings/GuestManagementPanel.module.css "apps/next-web/src/app/(app)/guests/accept/[token]/page.tsx" apps/next-web/src/messages/en.json apps/next-web/src/messages/id.json
git commit -m "feat(10d): guest & member management panel + accept page + server actions + i18n (en/id)"
```

---

### Task 10: Playwright e2e (headline flow)

**Files:**
- Create: `e2e/guests.spec.ts`
- Note: e2e runs against local Docker `ProjectFlow_Test` only (use the project's existing e2e env/setup; the repo's specs live at `e2e/` and hit `http://localhost:3001/api/v1`).

Steps:

- [ ] Write the e2e spec covering the BUILD_PLAN acceptance flow — invite a guest to one List, accept (as the guest), confirm they see that List only and cannot navigate to the Space or siblings. Follow the `hierarchy.spec.ts` harness (raw API seeding + UI assertions):

```ts
import { test, expect, request as pwRequest } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';
const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

test('guest invited to one List sees only that List; cannot reach the Space or sibling', async ({ page }) => {
  const s = uniq();
  const ownerEmail = `g-owner-${s}@projectflow.test`;
  const guestEmail = `g-ext-${s}@vendor.io`;        // external domain → stays a guest
  const password = 'E2EPass123!';

  const api = await pwRequest.newContext();
  // Owner + workspace + space + two lists.
  await api.post(`${API_BASE}/auth/register`, { data: { email: ownerEmail, name: `O ${s}`, password } });
  const { data: { token } } = await (await api.post(`${API_BASE}/auth/login`, { data: { email: ownerEmail, password } })).json();
  const auth = { Authorization: `Bearer ${token}` };
  const ws = await (await api.post(`${API_BASE}/workspaces`, { headers: auth, data: { name: `WS ${s}`, slug: `ws-${s}` } })).json();
  const space = await (await api.post(`${API_BASE}/projects`, { headers: auth, data: { workspaceId: ws.data.Id, name: `Space ${s}`, key: `SP${s.slice(-4)}`, type: 'KANBAN' } })).json();
  const mkList = async (name: string) => (await (await api.post(`${API_BASE}/lists`, { headers: auth, data: { workspaceId: ws.data.Id, spaceId: space.data.Id, folderId: null, name, position: 0 } })).json()).data;
  const shared = await mkList(`Shared ${s}`);
  const hidden = await mkList(`Hidden ${s}`);

  // Register the guest user (so accept can match their email) and invite them to the shared List.
  await api.post(`${API_BASE}/auth/register`, { data: { email: guestEmail, name: `G ${s}`, password } });
  const invite = await (await api.post(`${API_BASE}/guests/invites`, {
    headers: auth, data: { workspaceId: ws.data.Id, email: guestEmail, objectType: 'LIST', objectId: shared.id, level: 'VIEW' },
  })).json();
  expect(invite.role).toBe('workspace-guest');

  // Log in as the guest in the browser, accept the invite via the landing route.
  await page.goto('/login');
  await page.locator('#email').fill(guestEmail);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
  await page.goto(`/guests/accept/${invite.invite.token}`);
  await page.waitForURL((u) => !u.pathname.includes('/guests/accept'), { timeout: 15000 });

  // The guest sees ONLY the shared List — sidebar shows it, not the sibling, not the Space chrome.
  await expect(page.getByText(`Shared ${s}`, { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(`Hidden ${s}`, { exact: false })).toHaveCount(0);

  // Directly navigating to the sibling List or the Space is denied (403/forbidden surface).
  const siblingResp = await page.request.get(`${API_BASE}/lists/${hidden.id}/effective-statuses`, { headers: { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('accessToken'))}` } });
  expect(siblingResp.status()).toBe(403);

  await api.dispose();
});
```

  (The guest sidebar showing only the granted List is delivered by the Task 6 listing filter + the Task 2 resolver; if the sidebar reads `/projects` first, the per-node Space filter in Task 6 ensures the ungranted Space is absent. Add a `data-guest-empty` test hook to `SidebarTree` if the empty-state assertion needs it. The token read for the direct API check mirrors however the web app stores the session token — adapt to the real storage key.)

- [ ] Run: the project's e2e command for a single spec against `ProjectFlow_Test` (e.g. `npx playwright test e2e/guests.spec.ts`). Expected: PASS (1 test) — guest sees the shared List only; sibling/Space denied.

- [ ] Commit:
```
git add e2e/guests.spec.ts
git commit -m "test(10d): e2e — guest invited to one List sees only it; Space + sibling unreachable"
```

---

### Task 11: Slice verification + DECISIONS.md

**Files:**
- Modify: `DECISIONS.md` (append a Phase 10d entry)

Steps:

- [ ] Run the full slice verification on local Docker `ProjectFlow_Test`:
  - `npm test --workspace apps/api` — Expected: PASS (existing suite + new `guest.pure` unit tests).
  - `npm run test:integration --workspace apps/api` — Expected: PASS (existing + `guests.integration.test.ts` + `guest-resolver.integration.test.ts` + the unregressed `object-access.integration.test.ts`).
  - `npm test --workspace apps/next-web` — Expected: PASS (unit + `messages.unit` parity).
  - `npm run build --workspace apps/api` and `npm run build --workspace apps/next-web` — Expected: both PASS.
  - The guests e2e — Expected: PASS.

- [ ] Append a `DECISIONS.md` entry logging: the **no-floor** resolver change (guest detection via `workspace-guest`/`workspace-limited-member` role, the `WHEN @IsGuest = 1 THEN NULL` floor branch placed above the member branch, `Found=1` on ungranted-but-existing objects → 403 not 404); the **atomic accept** done inside `usp_GuestInvite_Accept` (membership row + role + grant in one TRANSACTION) rather than a second out-of-transaction `setObjectPermission` call, with `setObjectPermission` retained as the standalone 10b grant primitive; the **org-email rule** backed by the new lightweight `Workspaces.VerifiedDomain` (Workspaces had no domain column; SSO/directory-backed identity remains the deferral from spec §9.3); the **reject-guest-at-Space** service guard returning 422; the **defense-in-depth** per-node `filterVisibleNodes` on `/lists`, `/folders`, `/projects` listings (a no-op for full members); the two seeded `IsSystem=1` roles' minimal slug sets (no `workspace.read`/`members.read` so guests can't enumerate the tree or member list). DB-execution-policy note: all DB work ran ONLY against local Docker `ProjectFlow_Test`.

- [ ] Commit:
```
git add DECISIONS.md
git commit -m "docs(10d): DECISIONS entry — guest no-floor resolver + atomic accept + org-email rule + tree defense-in-depth"
```

---

## Definition of Done

Per-slice DoD (spec §3) + BUILD_PLAN acceptance (spec §7.5):

- [ ] **BUILD_PLAN acceptance:** a **guest sees only explicitly shared items; cannot see the Space tree** — proven at BOTH the resolver level (`usp_ObjectAccess_Resolve` gives a guest NO floor: `guest-resolver.integration.test.ts` asserts `VIEW` on the granted List, `null` on the Space + sibling) AND the tree-listing defense-in-depth level (`filterVisibleNodes` on `/lists`/`/folders`/`/projects`; `guests.integration.test.ts` asserts 403 on the Space subtree listings).
- [ ] Migration `0054_guests.sql` is idempotent, GO-batched, and **reversible** via `rollback/0054_guests.down.sql` (apply→rollback→re-apply verified clean); the resolver change is reversible (the prior `usp_ObjectAccess_Resolve` redeploys cleanly) and the two-role seed is idempotent.
- [ ] SP-per-op for every new operation (`usp_GuestInvite_Create`/`Accept`/`List`/`Revoke`); the resolver modified in place preserving owner=`FULL`/member=`EDIT`.
- [ ] The atomic `accept` creates the guest `WorkspaceMembers` row (`IsGuest=1`) + the role assignment + the `ObjectPermissions` grant in ONE transaction; the standalone grant primitive is the existing 10b `setObjectPermission` (`AccessRepository.set` → `usp_ObjectPermission_Set`).
- [ ] Two service-layer guards enforce the BUILD_PLAN rules (unit-tested pure): an **org-email** invite is promoted to `workspace-limited-member`; a **guest** may not be added at `Space` scope (422); guest **floor = none**.
- [ ] REST is the primary surface; the **GraphQL mirror** (`workspaceGuests`, `inviteGuest`, `acceptGuestInvite`, `revokeGuest`) delegates to the **one shared `guestService`** with mirrored gates (invite requires `FULL` on the object; list/revoke require `guest.manage`).
- [ ] Authorization fail-closed: guest grant endpoints require `FULL` on the object (spec §3); `guest.manage`/`guest.invite` seeded into `Permissions`; accept enforces the invite-email ↔ authed-email match.
- [ ] Unit tests (org-email promotion, reject-guest-at-Space, guest floor=none) + integration tests (guest sees only shared items + 403/404s, cannot enumerate the tree, org-email→limited member, resolver invariant) + ≥1 Playwright e2e for the headline flow — all green.
- [ ] `@projectflow/types` updated (`GuestInvite`, `GuestInviteStatus`, `Guest`, `GuestGrant`, `GuestListResult`, `InviteGuestInput`, the `WORKSPACE_GUEST_ROLE`/`WORKSPACE_LIMITED_MEMBER_ROLE` constants).
- [ ] i18n: new `Guests` namespace in **en.json + id.json** (real Indonesian); `messages.unit` parity green.
- [ ] All DB work (migrations, SP deploy, integration, e2e) ran **ONLY against local Docker `ProjectFlow_Test`** — never the prod-pointing `apps/api/.env`.
- [ ] `DECISIONS.md` entry logs the mechanism choices + any deviations. **Stop for review/merge — 10d is the final Phase 10 slice; the adversarial security review (can a guest path leak data across the membership boundary?) gates the merge.**

---

## Self-Review

**Spec coverage (§7):**
- §7.1 data model — `0054_guests.sql` seeds BOTH `workspace-guest` + `workspace-limited-member` (`IsSystem=1`, WORKSPACE, minimal slugs, shown in full — never "seed the other similarly"), creates `GuestInvites` with the EXACT columns (`Id, WorkspaceId, Email, ObjectType, ObjectId, Level, Token NVARCHAR(64) UNIQUE, Status pending, InvitedBy, ExpiresAt, CreatedAt, AcceptedAt`), adds `WorkspaceMembers.IsGuest BIT NOT NULL DEFAULT 0`, and adds the lightweight `Workspaces.VerifiedDomain` (the spec explicitly told me to locate the verified-domain column and, if absent, plan a lightweight field — Workspaces in `0001_init.sql` has none, noted inline). ✓
- §7.2 backend — resolver floor adjusted so a guest contributes NO floor (full modified SP shown; ONLY the floor branch changes, owner/member preserved); `guest.service` `invite` (org-email guard → promote, reject-guest-at-Space), `accept` (atomic member row + grant), `list`, `revoke`; tree/listing defense-in-depth filter; REST + GraphQL mirror. ✓
- §7.3 frontend — guest & member management panel (invite to an object at a level, list guests with granted objects, revoke); the guest sidebar shows only granted objects via the guest-aware listing endpoints. ✓
- §7.4 tests — unit (promotion, Space-reject, floor=none) + integration (guest sees only shared + 403/404, cannot enumerate tree, org-email→limited member) + e2e (one List, accept, confined). ✓
- §7.5 acceptance — covered EXPLICITLY at both the resolver level (Task 7) and the tree-listing defense-in-depth level (Task 6), per the security-focus instruction. ✓
- §3 conventions — guest grant endpoints require `FULL` on the object; accept routes the grant through the 10b primitive (atomically in-SP, with `setObjectPermission` retained as the standalone primitive). ✓

**Placeholder scan:** no "seed similarly"/"TODO"/"etc." stand-ins. Full code is given for the migration (both role seeds + their RolePermissions + GuestInvites + IsGuest + VerifiedDomain), the rollback, the MODIFIED `usp_ObjectAccess_Resolve` (complete SP, floor branch in full), all four guest SPs, `guest.pure.ts`, `guest.repository.ts`, `guest.service.ts`, the `access.service` additions, the REST routes, the tree-filter edit, the GraphQL mirror, the panel + accept page + server actions, and the en/id i18n. A few repo-method names (`WorkspaceRepository.getVerifiedDomain`, `UserRepository.getById`, `GuestRepository.findByToken`, the multi-recordset accessor, the web session-token storage key) are flagged inline as "confirm against the real file" because the prerequisite 10b code and some helper signatures aren't on disk yet — these are the only points an implementer must verify, not invent.

**Type/name consistency:** uses the exact migration number `0054`; role constants `workspace-guest` / `workspace-limited-member`; new slugs `guest.invite` / `guest.manage`; table/column names `GuestInvites`, `WorkspaceMembers.IsGuest`; type names `GuestInvite` + the role constants. Resolver column contract (`Level`, `Found`) and `ObjectPermissions` write shape match the real `usp_ObjectAccess_Resolve.sql` and `0029_hierarchy.sql`. REST/GraphQL gates mirror the real `requirePermission`/`requireObjectAccess`/`requireWorkspacePermission`/`requireObjectLevel` signatures; e2e harness matches the real `e2e/hierarchy.spec.ts` (root `e2e/`, `http://localhost:3001/api/v1`).

**Known prerequisite couplings (flagged, not blocking):** the plan assumes 10b has landed `usp_ObjectPermission_Set` (surfaced via `AccessRepository.set`, which already exists in `access.repository.ts`) and the per-object permission editor; the accept SP writes the `ObjectPermissions` row directly in-transaction (identical shape) to keep accept atomic, so it does not hard-depend on calling `usp_ObjectPermission_Set` at accept time. `Workspaces.VerifiedDomain` and the `verifiedDomain` PATCH on `/workspaces/:id` are new in this slice (the workspace update route must accept the field — verify the workspace update schema/handler and extend it if 10b/earlier didn't).
