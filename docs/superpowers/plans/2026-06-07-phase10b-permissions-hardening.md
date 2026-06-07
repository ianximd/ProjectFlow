# Phase 10b — Permissions Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the already-strong permission core by making it **user-manageable and provably correct**. Add workspace-scoped **custom roles** (build a role from a permission-slug set, assign to members; guarded by a new `role.manage` slug; system roles stay immutable), a **per-object permission editor** that reads/writes the existing `ObjectPermissions` ACL with an "inherited from `<ancestor>`" indicator (guarded by `FULL` on the object via the new `object.permission.manage` slug), **role/grant auditing** on every mutation (the existing `AuditLog` / `usp_AuditLog_Create`), and the **headline deliverable — a parameterized permission test matrix** over {owner, admin, member, viewer, custom-role, guest} × {VIEW/COMMENT/EDIT/FULL grant at space/folder/list/none} × {PUBLIC/PRIVATE} asserting `usp_ObjectAccess_Resolve`'s resolved level, proving **most-specific-wins over the role floor**.

**Architecture:** A custom role is **just another `Roles` row** with `WorkspaceId` non-NULL (NULL = the seven existing system/global roles). The existing `RolePermissions`/`UserRoles`/`usp_UserPermissions_Get` resolution works **completely unchanged** — a custom role's slugs flow through the same union. **No new ACL table:** the per-object editor reads/writes the existing `ObjectPermissions` table and resolves via the existing `usp_ObjectAccess_Resolve` (most-specific-wins over the hierarchy ancestry + a membership floor + `Visibility` PRIVATE). The grant primitive is `accessService.setObjectPermission(...)` wrapping the existing `usp_ObjectPermission_Set` MERGE — **10c (request-access grants) and 10d (guest grants) both call this exact method**, so it is designed as the clean reusable seam. Every role-CRUD and grant mutation writes one `AuditLog` entry through the existing `usp_AuditLog_Create`. REST (Hono, primary) + a GraphQL mirror both delegate to the single extended `roleService`/`accessService`. Frontend: a per-object **permission editor** (effective grant list + add/change/remove + inherited-from indicator) and a workspace-settings **custom-role manager**.

**Tech Stack:** SQL Server stored procedures (`CREATE OR ALTER`, `SET NOCOUNT ON`, TRY/CATCH/TRANSACTION, `THROW` for guard violations); `mssql` via `execSp`/`execSpOne`; Hono REST + `@hono/zod-validator`; graphql-yoga + Pothos (`@pothos/core`) registered in `graphql/schema.ts`; the existing `requirePermission` (REST) + `requireWorkspacePermission`/`requireObjectLevel` (GraphQL) fail-closed gates; vitest (`--project unit` / `--project integration`); Next.js App Router (SSR) + `next-intl` (en + id parity); Playwright e2e. DB work (migrations, SP deploy, integration, e2e) runs **ONLY** against local Docker `ProjectFlow_Test` via explicit local DB env — never the prod-pointing `apps/api/.env`.

**Prerequisite:** Phases 1–9 + Phase 10a merged; builds on `0018` RBAC (`Permissions`/`Roles`/`RolePermissions`/`UserRoles` + system roles + `usp_UserPermissions_Get` + `role.repository.getUserPermissionSlugs`) and `0029` `ObjectPermissions` / `usp_ObjectAccess_Resolve` (most-specific-wins + membership floor + `Visibility` PRIVATE). On-disk migrations assume Phases 6–9 + 10a land first — the next free migration number here is `0052` (10a takes `0051`).

---

## File Structure

**Migration**
- `infra/sql/migrations/0052_custom_roles.sql` — **Create.** Idempotent, GO-batched: add `Roles.WorkspaceId UNIQUEIDENTIFIER NULL` (NULL = system/global; non-NULL = a workspace custom role) + `FK_Roles_Workspace` + a filtered index; relax `UQ`/uniqueness on `Roles.Slug` to **per-workspace** (custom-role slugs must be unique within a workspace, not globally) by replacing the global unique constraint with a filtered unique index for system roles + a composite unique index for workspace roles; seed the two new permission slugs `role.manage` + `object.permission.manage` into `Permissions` and grant them to `workspace-owner`/`workspace-admin`.
- `infra/sql/migrations/rollback/0052_custom_roles.down.sql` — **Create.** Reverse: delete the seeded `RolePermissions`/`Permissions` rows, drop the new indexes + FK, restore the global `UQ`/unique index on `Roles.Slug`, drop `Roles.WorkspaceId`.

**Stored procedures** (`infra/sql/procedures/`)
- `usp_Role_Create.sql` — **Modify.** Add `@WorkspaceId UNIQUEIDENTIFIER = NULL`; enforce per-workspace slug uniqueness; insert `WorkspaceId`; return it.
- `usp_Role_Update.sql` — **Modify.** Block updates to system roles' name (already), and **forbid editing a role in a different workspace** is enforced at the service layer; return `WorkspaceId`.
- `usp_Role_Delete.sql` — **Modify.** Unchanged guards (built-in + active assignments); SELECT keeps `@@ROWCOUNT`. (Service guards workspace ownership before calling.)
- `usp_Role_ListForWorkspace.sql` — **Create.** List system roles (`WorkspaceId IS NULL`, WORKSPACE scope) + the workspace's own custom roles, with permission/member counts — the data source for the custom-role manager.
- `usp_Role_GetById.sql` — **Modify.** SELECT `WorkspaceId` in the role result set.
- `usp_Role_List.sql` — **Modify.** SELECT `WorkspaceId`; keep ordering.
- `usp_ObjectPermission_Set.sql` — **Modify.** Add `@GrantedBy UNIQUEIDENTIFIER = NULL` (audited at the service layer; column unchanged); keep the MERGE + affected-row SELECT. (This is the SP the grant primitive wraps.)
- `usp_ObjectPermission_Remove.sql` — **Create.** Thin alias over the existing unset semantics returning the deleted count (`usp_ObjectPermission_Unset` already exists; this adds a `@@ROWCOUNT` return for auditing). *(If the team prefers, extend `usp_ObjectPermission_Unset` in place — note inline; this plan adds a sibling to avoid changing the existing call site's contract.)*
- `usp_ObjectPermission_ListForObject.sql` — **Create.** Return every **explicit** `ObjectPermissions` grant on the **ancestry chain** (Space→ancestor Folders→the object itself) for an object, joined to subject (user/role) display fields + each grant's owning `(ObjectType, ObjectId)` + ancestor name — the editor's effective-grant list with inheritance.

**API** (`apps/api/src/`)
- `modules/roles/role.repository.ts` — **Modify.** Thread `workspaceId` through `createRole`; map `WorkspaceId` in `mapRole`; add `listRolesForWorkspace`.
- `modules/roles/role.service.ts` — **Modify.** Add workspace-scoped `createWorkspaceRole`/`updateWorkspaceRole`/`deleteWorkspaceRole`/`listWorkspaceRoles`/`assignWorkspaceRole`/`revokeWorkspaceRole`, each asserting the target role belongs to the workspace + is not a system role, each writing an `AuditLog` entry via the shared audit helper.
- `modules/access/access.repository.ts` — **Modify.** Add `setObjectPermission` (pass `grantedBy`), `removeObjectPermission` (returns count), `listObjectPermissions` (the inherited list); map rows.
- `modules/access/access.service.ts` — **Modify.** Add `setObjectPermission`/`removeObjectPermission`/`listObjectPermissions` (the **grant primitive**), `ancestorLabelFor(objectType, objectId, grantObjectType, grantObjectId)` helper for the "inherited from" computation, each mutation writing an `AuditLog` entry.
- `modules/access/access.audit.ts` — **Create.** A tiny shared `writeAccessAudit(...)` wrapper over `AdminRepository.createAuditEntry` so role + access mutations log identically (avoids importing the admin module circularly into both).
- `modules/roles/role.routes.ts` — **Modify.** Add the workspace-scoped role CRUD/assign endpoints under a workspace path, gated by `role.manage`.
- `modules/access/access.routes.ts` — **Create.** `GET /access/:objectType/:objectId/permissions`, `PUT /access/:objectType/:objectId/permissions`, `DELETE /access/:objectType/:objectId/permissions` — all gated `requireObjectAccess('FULL', …)`.
- `server.ts` — **Modify.** Mount `app.route('/access', accessRoutes)`.
- `graphql/permissions.schema.ts` — **Create.** `registerPermissionsGraphql()`: `WorkspaceRole`/`ObjectPermissionGrant` types + `workspaceRoles`/`objectPermissions` queries + `createWorkspaceRole`/`updateWorkspaceRole`/`deleteWorkspaceRole`/`assignWorkspaceRole`/`setObjectPermission`/`removeObjectPermission` mutations.
- `graphql/schema.ts` — **Modify.** Import + call `registerPermissionsGraphql()`.

**Types** (`packages/types/`)
- `index.ts` — **Modify.** Add `workspaceId: string | null` to `Role` (+ `RoleWithCounts`/`RoleWithPermissions` inherit it); add `ObjectPermissionSubjectType`, `ObjectPermissionGrant` (the editor row shape with `inherited`/`inheritedFromName`), `SetObjectPermissionInput`, `CreateWorkspaceRoleInput`.

**Frontend** (`apps/next-web/src/`)
- `server/actions/object-permissions.ts` — **Create.** `loadObjectPermissions`/`setObjectPermission`/`removeObjectPermission` server actions over the REST surface.
- `server/actions/workspace-roles.ts` — **Create.** `loadWorkspaceRoles`/`createWorkspaceRole`/`updateWorkspaceRole`/`deleteWorkspaceRole`/`assignWorkspaceRole`/`revokeWorkspaceRole`.
- `lib/permissions.ts` — **Create.** Pure helpers: `resolveRoleSlugSet(roles, heldRoleIds)` (custom-role slug-set resolution) + `computeInheritedFrom(objectType, objectId, grant)` (the "inherited from" computation) — unit-tested without the DB.
- `components/permissions/ObjectPermissionEditor.tsx` — **Create.** Per-object editor: effective grant list, add/change/remove a grant, "inherited from `<ancestor>`" badge.
- `components/permissions/ObjectPermissionEditor.module.css` — **Create.**
- `components/permissions/CustomRoleManager.tsx` — **Create.** Workspace-settings role manager: list system + custom roles, create/edit a custom role from permission slugs, assign to members, delete.
- `components/permissions/CustomRoleManager.module.css` — **Create.**
- `app/(app)/workspaces/[id]/settings/workspace-settings-view.tsx` — **Modify.** Mount `<CustomRoleManager workspaceId={…} />` in a "Roles & permissions" section.
- `messages/en.json` — **Modify.** New `Permissions` namespace.
- `messages/id.json` — **Modify.** Same keys, real Indonesian.

**Tests**
- `apps/api/src/modules/roles/__tests__/custom-role.integration.test.ts` — **Create.** Create a custom role + assign → user gains exactly its slugs (via `usp_UserPermissions_Get`); system roles immutable; per-workspace slug isolation.
- `apps/api/src/modules/access/__tests__/object-permission.integration.test.ts` — **Create.** A List-level `EDIT` grant overrides a Space-level `VIEW` (most-specific-wins); `listObjectPermissions` returns the inherited chain.
- `apps/api/src/modules/access/__tests__/permission-matrix.integration.test.ts` — **Create. THE HEADLINE.** A fully-enumerated parameterized matrix over subject × grant-level/scope × visibility asserting `usp_ObjectAccess_Resolve`'s resolved level.
- `apps/api/src/modules/roles/__tests__/role-slug-set.unit.test.ts` — **Create.** Pure `resolveRoleSlugSet` (custom-role slug union).
- `apps/next-web/src/lib/__tests__/permissions.unit.test.ts` — **Create.** Pure `computeInheritedFrom` ("inherited from" computation).
- `apps/next-web/e2e/permissions-hardening.spec.ts` — **Create.** Create a custom role, grant a user `EDIT` on one List, verify edit-there-but-not-in-a-sibling.

---

## Tasks

### Task 1: Migration + rollback (`0052_custom_roles.sql`)

**Files:**
- Create: `infra/sql/migrations/0052_custom_roles.sql`
- Create: `infra/sql/migrations/rollback/0052_custom_roles.down.sql`
- Test: manual deploy against local Docker `ProjectFlow_Test` (migrations have no unit harness; verified via the integration suites in Tasks 6–8).

Steps:

- [ ] Write the migration. Idempotent (`COL_LENGTH` / `sys.indexes` / `sys.objects` / `NOT EXISTS` guards), GO-batched, matching the `0018`/`0029` style. The slug-uniqueness change is the only subtle part: `0018` declared `Roles.Slug NVARCHAR(100) NOT NULL UNIQUE` (a global unique **constraint**). System roles must stay globally unique by slug, but custom roles need only be unique **within a workspace** — so we drop the global constraint and replace it with two filtered unique indexes:

```sql
-- =============================================================================
-- Migration 0052: Workspace-scoped custom roles (Phase 10b)
-- Extends 0018 RBAC so a workspace can define its own roles:
--   * Roles.WorkspaceId (NULL = the 7 existing system/global roles;
--     non-NULL = a workspace custom role). RolePermissions/UserRoles/
--     usp_UserPermissions_Get all resolve a custom role UNCHANGED.
--   * Slug uniqueness becomes scope-aware: system slugs stay globally unique;
--     custom slugs are unique per (WorkspaceId, Slug).
--   * Seeds two new permission slugs: role.manage (workspace custom-role CRUD)
--     and object.permission.manage (per-object grant editor), granted to
--     workspace-owner + workspace-admin.
-- No new ACL table: the per-object editor reuses dbo.ObjectPermissions and
-- resolves via usp_ObjectAccess_Resolve. Idempotent, GO-batched.
-- Rollback in rollback/0052_custom_roles.down.sql.
-- =============================================================================

-- ── Roles.WorkspaceId ────────────────────────────────────────────────────────
IF COL_LENGTH('dbo.Roles', 'WorkspaceId') IS NULL
    ALTER TABLE dbo.Roles ADD WorkspaceId UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Roles_Workspace')
    ALTER TABLE dbo.Roles
        ADD CONSTRAINT FK_Roles_Workspace FOREIGN KEY (WorkspaceId) REFERENCES dbo.Workspaces(Id);
GO

-- ── Scope-aware slug uniqueness ──────────────────────────────────────────────
-- 0018 created Roles.Slug as "NVARCHAR(100) NOT NULL UNIQUE" → a unique CONSTRAINT
-- backed by a unique index. Drop it (look up its name dynamically — the autogen
-- name varies) and replace with two filtered unique indexes.
DECLARE @uq SYSNAME;
SELECT @uq = kc.name
FROM sys.key_constraints kc
JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
JOIN sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id
WHERE kc.parent_object_id = OBJECT_ID('dbo.Roles') AND kc.type = 'UQ' AND col.name = 'Slug';
IF @uq IS NOT NULL
    EXEC('ALTER TABLE dbo.Roles DROP CONSTRAINT ' + @uq);
GO

-- System/global roles (WorkspaceId IS NULL): slug globally unique.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Roles_Slug_System' AND object_id = OBJECT_ID('dbo.Roles'))
    CREATE UNIQUE NONCLUSTERED INDEX UQ_Roles_Slug_System
        ON dbo.Roles (Slug) WHERE WorkspaceId IS NULL;
GO

-- Custom roles (WorkspaceId IS NOT NULL): slug unique per workspace.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Roles_Slug_Workspace' AND object_id = OBJECT_ID('dbo.Roles'))
    CREATE UNIQUE NONCLUSTERED INDEX UQ_Roles_Slug_Workspace
        ON dbo.Roles (WorkspaceId, Slug) WHERE WorkspaceId IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Roles_WorkspaceId' AND object_id = OBJECT_ID('dbo.Roles'))
    CREATE NONCLUSTERED INDEX IX_Roles_WorkspaceId
        ON dbo.Roles (WorkspaceId) INCLUDE (Slug, IsSystem, Scope) WHERE WorkspaceId IS NOT NULL;
GO

-- ── Seed the two new WORKSPACE permissions ───────────────────────────────────
;WITH SeedPermissions(Resource, Action, Slug, Scope, Description) AS (
    SELECT * FROM (VALUES
        ('role',   'manage',            'role.manage',              'WORKSPACE', 'Create, edit, delete and assign workspace custom roles'),
        ('object', 'permission.manage', 'object.permission.manage', 'WORKSPACE', 'Grant and revoke per-object access permissions')
    ) AS T(Resource, Action, Slug, Scope, Description)
)
INSERT INTO dbo.Permissions (Resource, Action, Slug, Scope, Description)
SELECT s.Resource, s.Action, s.Slug, s.Scope, s.Description
FROM SeedPermissions s
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permissions p WHERE p.Slug = s.Slug);
GO

-- ── Grant the new slugs to workspace-owner + workspace-admin ──────────────────
;WITH RolePermSeed(RoleSlug, PermissionSlug) AS (
    SELECT * FROM (VALUES
        ('workspace-owner', 'role.manage'),
        ('workspace-owner', 'object.permission.manage'),
        ('workspace-admin', 'role.manage'),
        ('workspace-admin', 'object.permission.manage')
    ) AS T(RoleSlug, PermissionSlug)
)
INSERT INTO dbo.RolePermissions (RoleId, PermissionId)
SELECT r.Id, p.Id
FROM RolePermSeed s
JOIN dbo.Roles       r ON r.Slug = s.RoleSlug AND r.WorkspaceId IS NULL
JOIN dbo.Permissions p ON p.Slug = s.PermissionSlug
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.RolePermissions rp WHERE rp.RoleId = r.Id AND rp.PermissionId = p.Id
);
GO
```

- [ ] Write the rollback `rollback/0052_custom_roles.down.sql` (reverse order; remove the seeded grants + permissions, drop the new indexes + FK, restore the global slug uniqueness, drop the column):

```sql
-- Rollback 0052: Workspace-scoped custom roles.
-- Removes the seeded role.manage/object.permission.manage grants + permissions,
-- the new indexes + FK, restores global Slug uniqueness, and drops WorkspaceId.
-- WARNING: drops every workspace custom role (WorkspaceId IS NOT NULL) and its
-- assignments — run only against ProjectFlow_Test.

DELETE rp FROM dbo.RolePermissions rp
JOIN dbo.Permissions p ON p.Id = rp.PermissionId
WHERE p.Slug IN ('role.manage', 'object.permission.manage');
GO

-- Custom roles must go before the column drop (FK + index references).
DELETE ur FROM dbo.UserRoles ur
JOIN dbo.Roles r ON r.Id = ur.RoleId WHERE r.WorkspaceId IS NOT NULL;
DELETE FROM dbo.Roles WHERE WorkspaceId IS NOT NULL;
GO

DELETE FROM dbo.Permissions WHERE Slug IN ('role.manage', 'object.permission.manage');
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Roles_WorkspaceId' AND object_id = OBJECT_ID('dbo.Roles'))
    DROP INDEX IX_Roles_WorkspaceId ON dbo.Roles;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Roles_Slug_Workspace' AND object_id = OBJECT_ID('dbo.Roles'))
    DROP INDEX UQ_Roles_Slug_Workspace ON dbo.Roles;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Roles_Slug_System' AND object_id = OBJECT_ID('dbo.Roles'))
    DROP INDEX UQ_Roles_Slug_System ON dbo.Roles;
GO

-- Restore the original global UNIQUE constraint on Slug (matches 0018).
IF NOT EXISTS (
    SELECT 1 FROM sys.key_constraints kc
    JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
    JOIN sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id
    WHERE kc.parent_object_id = OBJECT_ID('dbo.Roles') AND kc.type = 'UQ' AND col.name = 'Slug'
)
    ALTER TABLE dbo.Roles ADD CONSTRAINT UQ_Roles_Slug UNIQUE (Slug);
GO

IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Roles_Workspace')
    ALTER TABLE dbo.Roles DROP CONSTRAINT FK_Roles_Workspace;
GO

IF COL_LENGTH('dbo.Roles', 'WorkspaceId') IS NOT NULL
    ALTER TABLE dbo.Roles DROP COLUMN WorkspaceId;
GO
```

- [ ] Run against local Docker `ProjectFlow_Test` only (explicit local DB env, never `apps/api/.env`). Apply `0052_custom_roles.sql`, then the `.down.sql`, then re-apply `0052` to prove idempotency + reversibility. Expected: all three runs succeed with no errors; the second `0052` apply is a clean no-op (guards skip everything); after the down + re-apply, `SELECT COUNT(*) FROM dbo.Permissions WHERE Slug IN ('role.manage','object.permission.manage')` returns 2, and `COL_LENGTH('dbo.Roles','WorkspaceId')` is non-NULL.

- [ ] Commit:
```
git add infra/sql/migrations/0052_custom_roles.sql infra/sql/migrations/rollback/0052_custom_roles.down.sql
git commit -m "feat(10b): custom-roles migration — Roles.WorkspaceId + scoped slug uniqueness + role.manage/object.permission.manage slugs"
```

---

### Task 2: Role SPs — workspace-scoped Create/Update/Delete + ListForWorkspace + WorkspaceId in List/GetById

**Files:**
- Modify: `infra/sql/procedures/usp_Role_Create.sql`
- Modify: `infra/sql/procedures/usp_Role_Update.sql`
- Modify: `infra/sql/procedures/usp_Role_List.sql`
- Modify: `infra/sql/procedures/usp_Role_GetById.sql`
- Create: `infra/sql/procedures/usp_Role_ListForWorkspace.sql`
- Test: covered by `custom-role.integration.test.ts` (Task 6); deploy via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`.

Steps:

- [ ] Modify `usp_Role_Create.sql` — add `@WorkspaceId`, enforce **per-workspace** slug uniqueness (a custom slug may collide with a slug in another workspace but not its own; system slugs stay globally unique), insert + return `WorkspaceId`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Role_Create
  @Name        NVARCHAR(100),
  @Slug        NVARCHAR(100),
  @Description NVARCHAR(500)    = NULL,
  @Scope       NVARCHAR(16),                 -- 'SYSTEM' | 'WORKSPACE'
  @WorkspaceId UNIQUEIDENTIFIER = NULL       -- NULL = system/global role; non-NULL = workspace custom role
AS
BEGIN
  SET NOCOUNT ON;

  IF @Scope NOT IN ('SYSTEM','WORKSPACE')
  BEGIN
    THROW 51001, 'Scope must be SYSTEM or WORKSPACE', 1;
  END;

  -- A workspace custom role must be WORKSPACE-scoped.
  IF @WorkspaceId IS NOT NULL AND @Scope <> 'WORKSPACE'
  BEGIN
    THROW 51006, 'A workspace custom role must be WORKSPACE-scoped', 1;
  END;

  -- Slug uniqueness is scope-aware (mirrors the 0052 filtered indexes).
  IF @WorkspaceId IS NULL AND EXISTS (SELECT 1 FROM dbo.Roles WHERE Slug = @Slug AND WorkspaceId IS NULL)
  BEGIN
    THROW 51002, 'Role slug already exists', 1;
  END;
  IF @WorkspaceId IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.Roles WHERE Slug = @Slug AND WorkspaceId = @WorkspaceId)
  BEGIN
    THROW 51002, 'Role slug already exists in this workspace', 1;
  END;

  DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

  INSERT INTO dbo.Roles (Id, Name, Slug, Description, Scope, IsSystem, WorkspaceId)
  VALUES (@NewId, @Name, @Slug, @Description, @Scope, 0, @WorkspaceId);

  SELECT Id, Name, Slug, Description, Scope, IsSystem, WorkspaceId, CreatedAt, UpdatedAt
  FROM dbo.Roles
  WHERE Id = @NewId;
END;
GO
```

- [ ] Modify `usp_Role_Update.sql` — keep the system-role name-immutability rule; add `WorkspaceId` to the returned row (the service layer already verified the role belongs to the caller's workspace before calling):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Role_Update
  @RoleId      UNIQUEIDENTIFIER,
  @Name        NVARCHAR(100) = NULL,
  @Description NVARCHAR(500) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @IsSystem BIT;
  SELECT @IsSystem = IsSystem FROM dbo.Roles WHERE Id = @RoleId;

  IF @IsSystem IS NULL
  BEGIN
    THROW 51003, 'Role not found', 1;
  END;

  UPDATE dbo.Roles
  SET
    Name        = CASE WHEN @IsSystem = 1 THEN Name ELSE COALESCE(@Name, Name) END,
    Description = COALESCE(@Description, Description),
    UpdatedAt   = SYSUTCDATETIME()
  WHERE Id = @RoleId;

  SELECT Id, Name, Slug, Description, Scope, IsSystem, WorkspaceId, CreatedAt, UpdatedAt
  FROM dbo.Roles
  WHERE Id = @RoleId;
END;
GO
```

- [ ] Modify `usp_Role_List.sql` — add `WorkspaceId` to the SELECT (used by the admin tab; unchanged ordering):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Role_List
  @Scope NVARCHAR(16) = NULL  -- 'SYSTEM' | 'WORKSPACE' | NULL = both
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    r.Id, r.Name, r.Slug, r.Description, r.Scope, r.IsSystem, r.WorkspaceId,
    r.CreatedAt, r.UpdatedAt,
    (SELECT COUNT(*) FROM dbo.RolePermissions rp WHERE rp.RoleId = r.Id) AS PermissionCount,
    (SELECT COUNT(*) FROM dbo.UserRoles      ur WHERE ur.RoleId = r.Id) AS MemberCount
  FROM dbo.Roles r
  WHERE @Scope IS NULL OR r.Scope = @Scope
  ORDER BY r.IsSystem DESC, r.Scope, r.Name;
END;
GO
```

- [ ] Modify `usp_Role_GetById.sql` — add `WorkspaceId` to the role result set. The existing two-result-set shape (role row + its permissions) is preserved; only the first SELECT's column list changes:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Role_GetById
  @RoleId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  SELECT Id, Name, Slug, Description, Scope, IsSystem, WorkspaceId, CreatedAt, UpdatedAt
  FROM dbo.Roles
  WHERE Id = @RoleId;

  SELECT p.Id, p.Resource, p.Action, p.Slug, p.Scope, p.Description, p.CreatedAt
  FROM dbo.RolePermissions rp
  JOIN dbo.Permissions     p ON p.Id = rp.PermissionId
  WHERE rp.RoleId = @RoleId
  ORDER BY p.Scope, p.Slug;
END;
GO
```
*(Read the existing `usp_Role_GetById.sql` first and preserve its exact permission-set SELECT shape; only add `WorkspaceId` to the first SELECT.)*

- [ ] Write `usp_Role_ListForWorkspace.sql` — the custom-role-manager data source: the WORKSPACE-scoped **system** roles (assignable everywhere) **plus** this workspace's own custom roles, each with permission/member counts:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Role_ListForWorkspace
  @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    r.Id, r.Name, r.Slug, r.Description, r.Scope, r.IsSystem, r.WorkspaceId,
    r.CreatedAt, r.UpdatedAt,
    (SELECT COUNT(*) FROM dbo.RolePermissions rp WHERE rp.RoleId = r.Id) AS PermissionCount,
    (SELECT COUNT(*) FROM dbo.UserRoles ur
       WHERE ur.RoleId = r.Id AND (ur.WorkspaceId = @WorkspaceId OR ur.WorkspaceId IS NULL)) AS MemberCount
  FROM dbo.Roles r
  WHERE r.Scope = 'WORKSPACE'
    AND (r.WorkspaceId IS NULL OR r.WorkspaceId = @WorkspaceId)
  ORDER BY r.IsSystem DESC, r.Name;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test` (local DB env only). Expected: all five procedures (re)created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_Role_Create.sql infra/sql/procedures/usp_Role_Update.sql infra/sql/procedures/usp_Role_List.sql infra/sql/procedures/usp_Role_GetById.sql infra/sql/procedures/usp_Role_ListForWorkspace.sql
git commit -m "feat(10b): role SPs — workspace-scoped Create + WorkspaceId on List/GetById + Role_ListForWorkspace"
```

---

### Task 3: Object-permission SPs — Set (grantedBy), Remove (count), ListForObject (inheritance)

**Files:**
- Modify: `infra/sql/procedures/usp_ObjectPermission_Set.sql`
- Create: `infra/sql/procedures/usp_ObjectPermission_Remove.sql`
- Create: `infra/sql/procedures/usp_ObjectPermission_ListForObject.sql`
- Test: covered by `object-permission.integration.test.ts` + `permission-matrix.integration.test.ts` (Tasks 7–8); deploy via `scripts/db-deploy-sps.ts`.

Steps:

- [ ] Modify `usp_ObjectPermission_Set.sql` — add an optional `@GrantedBy` param (kept for symmetry/forward-compat; the audit row is written at the service layer, not here, so the existing `ObjectPermissions` columns are untouched). Validate `@Level`/`@SubjectType`/`@ObjectType` (fail-closed) and keep the MERGE + affected-row SELECT:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_ObjectPermission_Set
    @WorkspaceId UNIQUEIDENTIFIER,
    @SubjectType NVARCHAR(8),                 -- 'USER' | 'ROLE'
    @SubjectId   UNIQUEIDENTIFIER,
    @ObjectType  NVARCHAR(8),                 -- 'SPACE' | 'FOLDER' | 'LIST'
    @ObjectId    UNIQUEIDENTIFIER,
    @Level       NVARCHAR(8),                 -- 'VIEW' | 'COMMENT' | 'EDIT' | 'FULL'
    @GrantedBy   UNIQUEIDENTIFIER = NULL      -- audited at the service layer
AS
BEGIN
    SET NOCOUNT ON;

    IF @SubjectType NOT IN ('USER','ROLE')              THROW 51010, 'SubjectType must be USER or ROLE', 1;
    IF @ObjectType  NOT IN ('SPACE','FOLDER','LIST')    THROW 51011, 'ObjectType must be SPACE, FOLDER or LIST', 1;
    IF @Level       NOT IN ('VIEW','COMMENT','EDIT','FULL') THROW 51012, 'Level must be VIEW, COMMENT, EDIT or FULL', 1;

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
```

- [ ] Write `usp_ObjectPermission_Remove.sql` — delete one explicit grant and return the row count (the existing `usp_ObjectPermission_Unset` deletes silently with no count; `Remove` adds the `@@ROWCOUNT` the service needs to decide "was anything actually revoked?" for the audit + 404):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_ObjectPermission_Remove
    @SubjectType NVARCHAR(8),
    @SubjectId   UNIQUEIDENTIFIER,
    @ObjectType  NVARCHAR(8),
    @ObjectId    UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM dbo.ObjectPermissions
    WHERE SubjectType = @SubjectType AND SubjectId = @SubjectId
      AND ObjectType = @ObjectType AND ObjectId = @ObjectId;
    SELECT @@ROWCOUNT AS Deleted;
END;
GO
```

- [ ] Write `usp_ObjectPermission_ListForObject.sql` — return every **explicit** grant on the object's **ancestry chain** (the Space, ancestor Folders by path prefix, and the object itself), each annotated with whether it is **inherited** (granted on an ancestor, not the object itself) and the ancestor's display name. This is the editor's effective-grant list; it walks the same ancestry the resolver does:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_ObjectPermission_ListForObject
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
        SELECT TOP 0
            CAST(NULL AS UNIQUEIDENTIFIER) AS Id, CAST(NULL AS NVARCHAR(8)) AS SubjectType,
            CAST(NULL AS UNIQUEIDENTIFIER) AS SubjectId, CAST(NULL AS NVARCHAR(255)) AS SubjectName,
            CAST(NULL AS NVARCHAR(320)) AS SubjectEmail, CAST(NULL AS NVARCHAR(8)) AS ObjectType,
            CAST(NULL AS UNIQUEIDENTIFIER) AS ObjectId, CAST(NULL AS NVARCHAR(8)) AS Level,
            CAST(0 AS BIT) AS Inherited, CAST(NULL AS NVARCHAR(255)) AS InheritedFromName;
        RETURN;
    END

    -- Ancestry: the Space (depth 0), ancestor folders (path is a prefix of @Path),
    -- and the object itself (depth 9999). Mirrors usp_ObjectAccess_Resolve.
    DECLARE @Ancestry TABLE (ObjectType NVARCHAR(8), ObjectId UNIQUEIDENTIFIER, Depth INT, Name NVARCHAR(255));
    INSERT INTO @Ancestry
        SELECT 'SPACE', p.Id, 0, p.Name FROM dbo.Projects p WHERE p.Id = @SpaceId;
    INSERT INTO @Ancestry
        SELECT 'FOLDER', f.Id, LEN(f.Path), f.Name
        FROM dbo.Folders f
        WHERE f.SpaceId = @SpaceId AND f.DeletedAt IS NULL AND @Path LIKE f.Path + '%';
    IF @ObjectType = 'LIST'
        INSERT INTO @Ancestry SELECT 'LIST', l.Id, 9999, l.Name FROM dbo.Lists l WHERE l.Id = @ObjectId;

    SELECT
        op.Id,
        op.SubjectType,
        op.SubjectId,
        CASE op.SubjectType WHEN 'USER' THEN u.Name ELSE r.Name END AS SubjectName,
        CASE op.SubjectType WHEN 'USER' THEN u.Email ELSE NULL    END AS SubjectEmail,
        op.ObjectType,
        op.ObjectId,
        op.Level,
        CAST(CASE WHEN op.ObjectType = @ObjectType AND op.ObjectId = @ObjectId THEN 0 ELSE 1 END AS BIT) AS Inherited,
        CASE WHEN op.ObjectType = @ObjectType AND op.ObjectId = @ObjectId THEN NULL ELSE a.Name END        AS InheritedFromName
    FROM dbo.ObjectPermissions op
    JOIN @Ancestry a ON a.ObjectType = op.ObjectType AND a.ObjectId = op.ObjectId
    LEFT JOIN dbo.Users u ON op.SubjectType = 'USER' AND u.Id = op.SubjectId
    LEFT JOIN dbo.Roles r ON op.SubjectType = 'ROLE' AND r.Id = op.SubjectId
    WHERE op.WorkspaceId = @WorkspaceId
    ORDER BY a.Depth DESC, op.SubjectType, SubjectName;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`. Expected: all three procedures (re)created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_ObjectPermission_Set.sql infra/sql/procedures/usp_ObjectPermission_Remove.sql infra/sql/procedures/usp_ObjectPermission_ListForObject.sql
git commit -m "feat(10b): object-permission SPs — Set (validated + grantedBy), Remove (count), ListForObject (inheritance chain)"
```

---

### Task 4: Types + audit helper + role.service/access.service extensions + pure unit test

**Files:**
- Modify: `packages/types/index.ts` (the RBAC block, lines ~793–847)
- Modify: `apps/api/src/modules/roles/role.repository.ts`
- Modify: `apps/api/src/modules/roles/role.service.ts`
- Modify: `apps/api/src/modules/access/access.repository.ts`
- Modify: `apps/api/src/modules/access/access.service.ts`
- Create: `apps/api/src/modules/access/access.audit.ts`
- Create: `apps/api/src/modules/roles/slug-set.ts` (pure helper)
- Create: `apps/api/src/modules/roles/__tests__/role-slug-set.unit.test.ts`

Steps:

- [ ] Write the failing unit test first. `role-slug-set.unit.test.ts` — the custom-role slug-set resolution (given a set of roles a user holds, the union of their permission slugs, distinct):

```ts
import { describe, it, expect } from 'vitest';
import { resolveRoleSlugSet, type RoleSlugs } from '../slug-set.js';

const roles: RoleSlugs[] = [
  { roleId: 'sys-member', slugs: ['task.read', 'task.create', 'task.update'] },
  { roleId: 'custom-qa',  slugs: ['task.read', 'task.transition', 'report.read'] },
  { roleId: 'custom-ops', slugs: ['automation.read'] },
];

describe('resolveRoleSlugSet', () => {
  it('unions the slugs of every held role, distinct', () => {
    const got = resolveRoleSlugSet(roles, ['sys-member', 'custom-qa']);
    expect([...got].sort()).toEqual(
      ['report.read', 'task.create', 'task.read', 'task.transition', 'task.update'].sort(),
    );
  });
  it('returns an empty set when the user holds no roles', () => {
    expect(resolveRoleSlugSet(roles, []).size).toBe(0);
  });
  it('ignores held role ids that have no definition', () => {
    expect([...resolveRoleSlugSet(roles, ['custom-ops', 'ghost'])]).toEqual(['automation.read']);
  });
  it('a custom role grants exactly its own slugs (no floor leakage)', () => {
    const got = resolveRoleSlugSet(roles, ['custom-ops']);
    expect([...got]).toEqual(['automation.read']);
    expect(got.has('task.read')).toBe(false);
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- role-slug-set`. Expected: FAIL — `Cannot find module '../slug-set.js'`.

- [ ] Write `apps/api/src/modules/roles/slug-set.ts`:

```ts
export interface RoleSlugs {
  roleId: string;
  slugs:  string[];
}

/**
 * The effective permission-slug set for a user = the union of the slug sets of
 * exactly the roles they hold. This is the pure, DB-free mirror of what
 * usp_UserPermissions_Get computes; a custom role contributes EXACTLY its own
 * slugs (no membership "floor" — that floor lives only in the object ACL
 * resolver, not in the RBAC slug union).
 */
export function resolveRoleSlugSet(allRoles: RoleSlugs[], heldRoleIds: string[]): Set<string> {
  const held = new Set(heldRoleIds);
  const out = new Set<string>();
  for (const r of allRoles) {
    if (!held.has(r.roleId)) continue;
    for (const s of r.slugs) out.add(s);
  }
  return out;
}
```

- [ ] Run: `npm test --workspace apps/api -- role-slug-set`. Expected: PASS (4 tests).

- [ ] Extend `packages/types/index.ts` — add `workspaceId` to `Role` and the editor/grant shapes. In the RBAC block:

```ts
export interface Role {
  id:          string;
  name:        string;
  slug:        string;
  description: string | null;
  scope:       RoleScope;
  isSystem:    boolean;
  workspaceId: string | null;   // null = system/global role; non-null = workspace custom role
  createdAt:   string;
  updatedAt:   string;
}
```
And append, after `RoleMember`:

```ts
// ─── Per-object permission editor (Phase 10b, reuses ObjectPermissions) ────────
export type ObjectPermissionSubjectType = 'USER' | 'ROLE';

export interface ObjectPermissionGrant {
  id:                string;
  subjectType:       ObjectPermissionSubjectType;
  subjectId:         string;
  subjectName:       string | null;
  subjectEmail:      string | null;
  objectType:        HierarchyNodeType;     // the node the grant was placed ON
  objectId:          string;
  level:             ObjectPermissionLevel;
  inherited:         boolean;               // true = granted on an ancestor, not this object
  inheritedFromName: string | null;         // ancestor display name when inherited
}

export interface SetObjectPermissionInput {
  subjectType: ObjectPermissionSubjectType;
  subjectId:   string;
  level:       ObjectPermissionLevel;
}

export interface CreateWorkspaceRoleInput {
  name:          string;
  description?:  string | null;
  permissionIds: string[];
}
```

- [ ] Extend `role.repository.ts` — map `WorkspaceId`, thread `workspaceId` through `createRole`, and add `listRolesForWorkspace`. Update `mapRole`:

```ts
function mapRole(r: any): Role {
  return {
    id:          r.Id,
    name:        r.Name,
    slug:        r.Slug,
    description: r.Description ?? null,
    scope:       r.Scope,
    isSystem:    Boolean(r.IsSystem),
    workspaceId: r.WorkspaceId ?? null,
    createdAt:   r.CreatedAt instanceof Date ? r.CreatedAt.toISOString() : String(r.CreatedAt),
    updatedAt:   r.UpdatedAt instanceof Date ? r.UpdatedAt.toISOString() : String(r.UpdatedAt),
  };
}
```
Update `createRole`'s signature + params (add `workspaceId`):

```ts
  async createRole(input: {
    name: string; slug: string; description: string | null; scope: RoleScope; workspaceId?: string | null;
  }): Promise<Role> {
    const rows = await execSpOne<any>('dbo.usp_Role_Create', [
      { name: 'Name',        type: sql.NVarChar(100),    value: input.name },
      { name: 'Slug',        type: sql.NVarChar(100),    value: input.slug },
      { name: 'Description', type: sql.NVarChar(500),    value: input.description },
      { name: 'Scope',       type: sql.NVarChar(16),     value: input.scope },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: input.workspaceId ?? null },
    ]);
    return mapRole(rows[0]);
  }
```
Add `listRolesForWorkspace`:

```ts
  async listRolesForWorkspace(workspaceId: string): Promise<RoleWithCounts[]> {
    const rows = await execSpOne<any>('dbo.usp_Role_ListForWorkspace', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    ]);
    return rows.map(mapRoleWithCounts);
  }
```

- [ ] Write `apps/api/src/modules/access/access.audit.ts` — one shared audit-write wrapper so both role + access mutations log identically through the existing `usp_AuditLog_Create`:

```ts
import { AdminRepository } from '../admin/admin.repository.js';

const adminRepo = new AdminRepository();

export interface AccessAuditInput {
  workspaceId: string | null;
  userId:      string;            // the actor
  userEmail?:  string | null;
  action:      string;            // e.g. 'role.create', 'object.permission.set'
  resource:    string;            // e.g. 'Role', 'ObjectPermission'
  resourceId:  string | null;
  oldValues?:  unknown;
  newValues?:  unknown;
}

/** Best-effort audit write — never block the mutation it records. */
export async function writeAccessAudit(input: AccessAuditInput): Promise<void> {
  try {
    await adminRepo.createAuditEntry({
      workspaceId: input.workspaceId ?? undefined,
      userId:      input.userId,
      userEmail:   input.userEmail ?? undefined,
      action:      input.action,
      resource:    input.resource,
      resourceId:  input.resourceId ?? undefined,
      oldValues:   input.oldValues ?? undefined,
      newValues:   input.newValues ?? undefined,
    });
  } catch {
    // Auditing must not fail the operation; the SP logs nothing on error.
  }
}
```
*(Confirm `AdminRepository.createAuditEntry`'s `CreateAuditInput` field names from `apps/api/src/modules/admin/admin.repository.ts` and match them exactly; the call above mirrors the columns of `usp_AuditLog_Create`.)*

- [ ] Extend `access.repository.ts` — add the grant primitive's repo methods. Add a `grantedBy` arg to `set`, add `remove` (returns count), and add `listForObject`:

```ts
  async set(
    workspaceId: string,
    subjectType: 'USER' | 'ROLE',
    subjectId: string,
    objectType: HierarchyNodeType,
    objectId: string,
    level: ObjectPermissionLevel,
    grantedBy: string | null = null,
  ) {
    const rows = await execSpOne('usp_ObjectPermission_Set', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'SubjectType', type: sql.NVarChar(8),      value: subjectType },
      { name: 'SubjectId',   type: sql.UniqueIdentifier, value: subjectId },
      { name: 'ObjectType',  type: sql.NVarChar(8),      value: objectType },
      { name: 'ObjectId',    type: sql.UniqueIdentifier, value: objectId },
      { name: 'Level',       type: sql.NVarChar(8),      value: level },
      { name: 'GrantedBy',   type: sql.UniqueIdentifier, value: grantedBy },
    ]);
    return rows[0];
  }

  async remove(
    subjectType: 'USER' | 'ROLE',
    subjectId: string,
    objectType: HierarchyNodeType,
    objectId: string,
  ): Promise<number> {
    const rows = await execSpOne<{ Deleted: number }>('usp_ObjectPermission_Remove', [
      { name: 'SubjectType', type: sql.NVarChar(8),      value: subjectType },
      { name: 'SubjectId',   type: sql.UniqueIdentifier, value: subjectId },
      { name: 'ObjectType',  type: sql.NVarChar(8),      value: objectType },
      { name: 'ObjectId',    type: sql.UniqueIdentifier, value: objectId },
    ]);
    return Number(rows[0]?.Deleted ?? 0);
  }

  async listForObject(objectType: HierarchyNodeType, objectId: string): Promise<ObjectPermissionGrant[]> {
    const rows = await execSpOne<any>('usp_ObjectPermission_ListForObject', [
      { name: 'ObjectType', type: sql.NVarChar(8),      value: objectType },
      { name: 'ObjectId',   type: sql.UniqueIdentifier, value: objectId },
    ]);
    return rows.map((r) => ({
      id:                r.Id,
      subjectType:       r.SubjectType,
      subjectId:         r.SubjectId,
      subjectName:       r.SubjectName ?? null,
      subjectEmail:      r.SubjectEmail ?? null,
      objectType:        r.ObjectType,
      objectId:          r.ObjectId,
      level:             r.Level,
      inherited:         Boolean(r.Inherited),
      inheritedFromName: r.InheritedFromName ?? null,
    }));
  }
```
Import `ObjectPermissionGrant` from `@projectflow/types` at the top.

- [ ] Extend `access.service.ts` — add the **grant primitive** + list + the workspace lookup it needs for the audit (resolve the object's workspace via the existing resolver path). The grant primitive `setObjectPermission` is what 10c/10d call:

```ts
import type { HierarchyNodeType, ObjectPermissionLevel, ObjectPermissionGrant } from '@projectflow/types';
import { AccessRepository } from './access.repository.js';
import { writeAccessAudit } from './access.audit.js';

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

  /** The effective explicit-grant list for an object (incl. inherited ancestor grants). */
  listObjectPermissions(objectType: HierarchyNodeType, objectId: string): Promise<ObjectPermissionGrant[]> {
    return this.repo.listForObject(objectType, objectId);
  }

  /**
   * THE GRANT PRIMITIVE. Write (insert/update) one explicit ObjectPermissions
   * grant and audit it. 10c (request-access grants) and 10d (guest grants) call
   * this exact method — keep the signature stable.
   */
  async setObjectPermission(input: {
    workspaceId: string;
    subjectType: 'USER' | 'ROLE';
    subjectId:   string;
    objectType:  HierarchyNodeType;
    objectId:    string;
    level:       ObjectPermissionLevel;
    actorId:     string;
    actorEmail?: string | null;
  }): Promise<void> {
    await this.repo.set(
      input.workspaceId, input.subjectType, input.subjectId,
      input.objectType, input.objectId, input.level, input.actorId,
    );
    await writeAccessAudit({
      workspaceId: input.workspaceId,
      userId:      input.actorId,
      userEmail:   input.actorEmail ?? null,
      action:      'object.permission.set',
      resource:    'ObjectPermission',
      resourceId:  input.objectId,
      newValues:   { subjectType: input.subjectType, subjectId: input.subjectId, objectType: input.objectType, level: input.level },
    });
  }

  /** Revoke one explicit grant. Returns false when nothing was removed (404). */
  async removeObjectPermission(input: {
    workspaceId: string;
    subjectType: 'USER' | 'ROLE';
    subjectId:   string;
    objectType:  HierarchyNodeType;
    objectId:    string;
    actorId:     string;
    actorEmail?: string | null;
  }): Promise<boolean> {
    const removed = await this.repo.remove(input.subjectType, input.subjectId, input.objectType, input.objectId);
    if (removed > 0) {
      await writeAccessAudit({
        workspaceId: input.workspaceId,
        userId:      input.actorId,
        userEmail:   input.actorEmail ?? null,
        action:      'object.permission.remove',
        resource:    'ObjectPermission',
        resourceId:  input.objectId,
        oldValues:   { subjectType: input.subjectType, subjectId: input.subjectId, objectType: input.objectType },
      });
    }
    return removed > 0;
  }
}

export const accessService = new AccessService();
```

- [ ] Extend `role.service.ts` — add the workspace-scoped role operations, each asserting the target role belongs to the workspace + is not a system role, each auditing. Add to the `roleService` object:

```ts
import { writeAccessAudit } from '../access/access.audit.js';

// ...inside roleService, after the existing members:

  // ── Workspace custom roles (Phase 10b) ─────────────────────────────────────
  listWorkspaceRoles: (workspaceId: string) => roleRepository.listRolesForWorkspace(workspaceId),

  async createWorkspaceRole(input: {
    workspaceId: string;
    name: string;
    description?: string | null;
    permissionIds: string[];
    actorId: string;
    actorEmail?: string | null;
  }) {
    const slug = slugify(input.name);
    const role = await roleRepository.createRole({
      name:        input.name.trim(),
      slug,
      description: input.description ?? null,
      scope:       'WORKSPACE',
      workspaceId: input.workspaceId,
    });
    const permissions = input.permissionIds.length
      ? await roleRepository.setRolePermissions(role.id, input.permissionIds)
      : [];
    await writeAccessAudit({
      workspaceId: input.workspaceId, userId: input.actorId, userEmail: input.actorEmail ?? null,
      action: 'role.create', resource: 'Role', resourceId: role.id,
      newValues: { name: role.name, slug: role.slug, permissionIds: input.permissionIds },
    });
    return { ...role, permissions };
  },

  /** Guard: the role must exist, be a custom role, and belong to this workspace. */
  async assertWorkspaceCustomRole(workspaceId: string, roleId: string) {
    const role = await roleRepository.getRoleById(roleId);
    if (!role || role.workspaceId !== workspaceId) return { ok: false as const, code: 'NOT_FOUND' as const };
    if (role.isSystem) return { ok: false as const, code: 'IMMUTABLE' as const };
    return { ok: true as const, role };
  },

  async updateWorkspaceRole(input: {
    workspaceId: string; roleId: string; name?: string; description?: string | null;
    permissionIds?: string[]; actorId: string; actorEmail?: string | null;
  }) {
    const guard = await roleService.assertWorkspaceCustomRole(input.workspaceId, input.roleId);
    if (!guard.ok) return guard;
    const updated = await roleRepository.updateRole(input.roleId, { name: input.name, description: input.description });
    if (input.permissionIds) await roleRepository.setRolePermissions(input.roleId, input.permissionIds);
    await writeAccessAudit({
      workspaceId: input.workspaceId, userId: input.actorId, userEmail: input.actorEmail ?? null,
      action: 'role.update', resource: 'Role', resourceId: input.roleId,
      oldValues: { name: guard.role.name }, newValues: { name: input.name, permissionIds: input.permissionIds },
    });
    return { ok: true as const, role: updated };
  },

  async deleteWorkspaceRole(input: {
    workspaceId: string; roleId: string; actorId: string; actorEmail?: string | null;
  }) {
    const guard = await roleService.assertWorkspaceCustomRole(input.workspaceId, input.roleId);
    if (!guard.ok) return guard;
    await roleRepository.deleteRole(input.roleId);   // SP rejects roles with active assignments
    await writeAccessAudit({
      workspaceId: input.workspaceId, userId: input.actorId, userEmail: input.actorEmail ?? null,
      action: 'role.delete', resource: 'Role', resourceId: input.roleId,
      oldValues: { name: guard.role.name, slug: guard.role.slug },
    });
    return { ok: true as const };
  },

  async assignWorkspaceRole(input: {
    workspaceId: string; userId: string; roleId: string; actorId: string; actorEmail?: string | null;
  }) {
    // The role must be assignable in this workspace: a system WORKSPACE role
    // (WorkspaceId NULL) or this workspace's own custom role.
    const role = await roleRepository.getRoleById(input.roleId);
    if (!role || role.scope !== 'WORKSPACE' || (role.workspaceId !== null && role.workspaceId !== input.workspaceId)) {
      return { ok: false as const, code: 'NOT_FOUND' as const };
    }
    const assignment = await roleRepository.assignRole({
      userId: input.userId, roleId: input.roleId, workspaceId: input.workspaceId, assignedBy: input.actorId,
    });
    await writeAccessAudit({
      workspaceId: input.workspaceId, userId: input.actorId, userEmail: input.actorEmail ?? null,
      action: 'role.assign', resource: 'UserRole', resourceId: input.userId,
      newValues: { roleId: input.roleId, targetUserId: input.userId },
    });
    return { ok: true as const, assignment };
  },

  async revokeWorkspaceRole(input: {
    workspaceId: string; userId: string; roleId: string; actorId: string; actorEmail?: string | null;
  }) {
    const removed = await roleRepository.revokeRole(input.userId, input.roleId, input.workspaceId);
    if (removed) {
      await writeAccessAudit({
        workspaceId: input.workspaceId, userId: input.actorId, userEmail: input.actorEmail ?? null,
        action: 'role.revoke', resource: 'UserRole', resourceId: input.userId,
        oldValues: { roleId: input.roleId, targetUserId: input.userId },
      });
    }
    return { ok: removed as boolean };
  },
```

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS — no type errors. Then `npm test --workspace apps/api -- role-slug-set`. Expected: still PASS.

- [ ] Commit:
```
git add packages/types/index.ts apps/api/src/modules/roles/role.repository.ts apps/api/src/modules/roles/role.service.ts apps/api/src/modules/access/access.repository.ts apps/api/src/modules/access/access.service.ts apps/api/src/modules/access/access.audit.ts apps/api/src/modules/roles/slug-set.ts apps/api/src/modules/roles/__tests__/role-slug-set.unit.test.ts
git commit -m "feat(10b): types + audit helper + role/access service extensions (setObjectPermission grant primitive) + slug-set unit test"
```

---

### Task 5: REST surface — workspace role routes + object-permission routes + wiring

**Files:**
- Modify: `apps/api/src/modules/roles/role.routes.ts`
- Create: `apps/api/src/modules/access/access.routes.ts`
- Modify: `apps/api/src/server.ts` (mount `/access`)
- Test: covered by `custom-role.integration.test.ts` + `object-permission.integration.test.ts` (Tasks 6–7).

Steps:

- [ ] Add workspace-scoped role endpoints to `role.routes.ts` (these live under the same router mounted at `/admin`; they are gated by the **workspace** slug `role.manage`, not the system `admin.roles.manage`, with the workspace resolved from the path param). Add `import { z } from 'zod';` if not present and add after the existing routes:

```ts
import { requireObjectAccess } from '../access/access.middleware.js'; // (only if reused; otherwise omit)

function actorEmail(c: any): string | null {
  const u = c.get('user');
  return u?.email ?? null;
}

// ─── Workspace custom roles (Phase 10b) ────────────────────────────────────────

/** GET /admin/workspaces/:workspaceId/roles — system WORKSPACE roles + this ws's custom roles */
roleRoutes.get(
  '/workspaces/:workspaceId/roles',
  requirePermission('role.manage', { workspaceParam: 'workspaceId' }),
  async (c) => {
    const rows = await roleService.listWorkspaceRoles(c.req.param('workspaceId')!);
    return c.json({ data: rows });
  },
);

/** POST /admin/workspaces/:workspaceId/roles — create a custom role from a slug set */
roleRoutes.post(
  '/workspaces/:workspaceId/roles',
  requirePermission('role.manage', { workspaceParam: 'workspaceId' }),
  async (c) => {
    let body: any;
    try { body = await c.req.json(); } catch { return badRequest(c, 'Invalid JSON body'); }
    const name = String(body?.name ?? '').trim();
    if (!name) return badRequest(c, 'name is required');
    try {
      const role = await roleService.createWorkspaceRole({
        workspaceId:   c.req.param('workspaceId')!,
        name,
        description:    body?.description ?? null,
        permissionIds: Array.isArray(body?.permissionIds) ? body.permissionIds : [],
        actorId:       getActorId(c)!,
        actorEmail:    actorEmail(c),
      });
      return c.json({ data: role }, 201);
    } catch (err) { return mapSqlError(c, err); }
  },
);

/** PATCH /admin/workspaces/:workspaceId/roles/:id — edit a custom role (name/description/permissions) */
roleRoutes.patch(
  '/workspaces/:workspaceId/roles/:id',
  requirePermission('role.manage', { workspaceParam: 'workspaceId' }),
  async (c) => {
    let body: any;
    try { body = await c.req.json(); } catch { return badRequest(c, 'Invalid JSON body'); }
    try {
      const res = await roleService.updateWorkspaceRole({
        workspaceId:   c.req.param('workspaceId')!,
        roleId:        c.req.param('id')!,
        name:          typeof body?.name === 'string' ? body.name.trim() : undefined,
        description:   body?.description ?? undefined,
        permissionIds: Array.isArray(body?.permissionIds) ? body.permissionIds : undefined,
        actorId:       getActorId(c)!,
        actorEmail:    actorEmail(c),
      });
      if (!res.ok) return res.code === 'IMMUTABLE' ? conflict(c, 'System roles are immutable') : notFound(c, 'Role not found');
      return c.json({ data: res.role });
    } catch (err) { return mapSqlError(c, err); }
  },
);

/** DELETE /admin/workspaces/:workspaceId/roles/:id — delete a custom role */
roleRoutes.delete(
  '/workspaces/:workspaceId/roles/:id',
  requirePermission('role.manage', { workspaceParam: 'workspaceId' }),
  async (c) => {
    try {
      const res = await roleService.deleteWorkspaceRole({
        workspaceId: c.req.param('workspaceId')!,
        roleId:      c.req.param('id')!,
        actorId:     getActorId(c)!,
        actorEmail:  actorEmail(c),
      });
      if (!res.ok) return res.code === 'IMMUTABLE' ? conflict(c, 'System roles are immutable') : notFound(c, 'Role not found');
      return c.json({ data: { deleted: true } });
    } catch (err) { return mapSqlError(c, err); }
  },
);

/** POST /admin/workspaces/:workspaceId/roles/:id/members — assign the role to a user */
roleRoutes.post(
  '/workspaces/:workspaceId/roles/:id/members',
  requirePermission('role.manage', { workspaceParam: 'workspaceId' }),
  async (c) => {
    let body: any;
    try { body = await c.req.json(); } catch { return badRequest(c, 'Invalid JSON body'); }
    const userId = String(body?.userId ?? '');
    if (!userId) return badRequest(c, 'userId is required');
    try {
      const res = await roleService.assignWorkspaceRole({
        workspaceId: c.req.param('workspaceId')!,
        roleId:      c.req.param('id')!,
        userId,
        actorId:     getActorId(c)!,
        actorEmail:  actorEmail(c),
      });
      if (!res.ok) return notFound(c, 'Role not found in this workspace');
      return c.json({ data: res.assignment }, 201);
    } catch (err) { return mapSqlError(c, err); }
  },
);

/** DELETE /admin/workspaces/:workspaceId/roles/:id/members/:userId — revoke */
roleRoutes.delete(
  '/workspaces/:workspaceId/roles/:id/members/:userId',
  requirePermission('role.manage', { workspaceParam: 'workspaceId' }),
  async (c) => {
    const res = await roleService.revokeWorkspaceRole({
      workspaceId: c.req.param('workspaceId')!,
      roleId:      c.req.param('id')!,
      userId:      c.req.param('userId')!,
      actorId:     getActorId(c)!,
      actorEmail:  actorEmail(c),
    });
    if (!res.ok) return notFound(c, 'Assignment not found');
    return c.json({ data: { deleted: true } });
  },
);
```

- [ ] Create `apps/api/src/modules/access/access.routes.ts` — the per-object permission editor surface, gated `requireObjectAccess('FULL', …)` (only someone who fully controls an object may grant access). The grant write goes through the `setObjectPermission` primitive:

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { HierarchyNodeType } from '@projectflow/types';
import { accessService } from './access.service.js';
import { requireObjectAccess } from './access.middleware.js';
import { HierarchyRepository } from '../hierarchy/hierarchy.repository.js';

export const accessRoutes = new Hono();
const hierarchyRepo = new HierarchyRepository();

const nodeType = z.enum(['SPACE', 'FOLDER', 'LIST']);
const setSchema = z.object({
  subjectType: z.enum(['USER', 'ROLE']),
  subjectId:   z.string().uuid(),
  level:       z.enum(['VIEW', 'COMMENT', 'EDIT', 'FULL']),
});
const removeSchema = z.object({
  subjectType: z.enum(['USER', 'ROLE']),
  subjectId:   z.string().uuid(),
});

function obj(c: any): { type: HierarchyNodeType; id: string } {
  return { type: c.req.param('objectType') as HierarchyNodeType, id: c.req.param('objectId')! };
}
function actor(c: any): { id: string; email: string | null } {
  const u = c.get('user');
  return { id: u?.userId ?? u?.id, email: u?.email ?? null };
}

/** GET /access/:objectType/:objectId/permissions — effective grant list (incl. inherited) */
accessRoutes.get(
  '/:objectType/:objectId/permissions',
  requireObjectAccess('FULL', obj),
  async (c) => {
    const { type, id } = obj(c);
    return c.json({ data: await accessService.listObjectPermissions(type, id) });
  },
);

/** PUT /access/:objectType/:objectId/permissions — add/change a grant (the grant primitive) */
accessRoutes.put(
  '/:objectType/:objectId/permissions',
  requireObjectAccess('FULL', obj),
  zValidator('json', setSchema),
  async (c) => {
    const { type, id } = obj(c);
    const { subjectType, subjectId, level } = c.req.valid('json');
    const workspaceId = await hierarchyRepo.getWorkspaceIdForNode(type, id);
    if (!workspaceId) return c.json({ error: { code: 'NOT_FOUND', message: 'Resource not found', statusCode: 404 } }, 404);
    const a = actor(c);
    await accessService.setObjectPermission({
      workspaceId, subjectType, subjectId, objectType: type, objectId: id, level,
      actorId: a.id, actorEmail: a.email,
    });
    return c.json({ data: await accessService.listObjectPermissions(type, id) });
  },
);

/** DELETE /access/:objectType/:objectId/permissions — revoke a grant on THIS object */
accessRoutes.delete(
  '/:objectType/:objectId/permissions',
  requireObjectAccess('FULL', obj),
  zValidator('json', removeSchema),
  async (c) => {
    const { type, id } = obj(c);
    const { subjectType, subjectId } = c.req.valid('json');
    const workspaceId = await hierarchyRepo.getWorkspaceIdForNode(type, id);
    if (!workspaceId) return c.json({ error: { code: 'NOT_FOUND', message: 'Resource not found', statusCode: 404 } }, 404);
    const a = actor(c);
    const removed = await accessService.removeObjectPermission({
      workspaceId, subjectType, subjectId, objectType: type, objectId: id,
      actorId: a.id, actorEmail: a.email,
    });
    if (!removed) return c.json({ error: { code: 'NOT_FOUND', message: 'Grant not found', statusCode: 404 } }, 404);
    return c.json({ data: await accessService.listObjectPermissions(type, id) });
  },
);
```

- [ ] Add `getWorkspaceIdForNode` to `HierarchyRepository` (a single SP or a thin lookup over Projects/Folders/Lists). If a node→workspace SP already exists, reuse it; otherwise add a tiny method backed by a new `usp_Hierarchy_NodeWorkspace.sql` (one branch per node type, mirroring the resolver's lookup). Inline note: if such a lookup already exists elsewhere (e.g. on `list.repository`/`folder.repository`), import that instead of adding a new SP — verify before creating.

```ts
  async getWorkspaceIdForNode(nodeType: HierarchyNodeType, nodeId: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string | null }>('usp_Hierarchy_NodeWorkspace', [
      { name: 'NodeType', type: sql.NVarChar(8),      value: nodeType },
      { name: 'NodeId',   type: sql.UniqueIdentifier, value: nodeId },
    ]);
    return rows[0]?.WorkspaceId ?? null;
  }
```
And the SP `infra/sql/procedures/usp_Hierarchy_NodeWorkspace.sql`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Hierarchy_NodeWorkspace
  @NodeType NVARCHAR(8),
  @NodeId   UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  IF @NodeType = 'SPACE'
    SELECT WorkspaceId FROM dbo.Projects WHERE Id = @NodeId AND Status <> 'DELETED';
  ELSE IF @NodeType = 'FOLDER'
    SELECT WorkspaceId FROM dbo.Folders WHERE Id = @NodeId AND DeletedAt IS NULL;
  ELSE IF @NodeType = 'LIST'
    SELECT WorkspaceId FROM dbo.Lists WHERE Id = @NodeId AND DeletedAt IS NULL;
END;
GO
```
*(Deploy this SP with the others via `scripts/db-deploy-sps.ts`; add it to the Task 3 commit's deploy run or re-run the deploy here.)*

- [ ] Wire the access router into `server.ts` — add the import and mount it alongside the other `app.route(...)` calls:

```ts
import { accessRoutes } from './modules/access/access.routes.js';
// ...
app.route('/access', accessRoutes);
```

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS. (Integration tests for these routes follow in Tasks 6–7.)

- [ ] Commit:
```
git add apps/api/src/modules/roles/role.routes.ts apps/api/src/modules/access/access.routes.ts apps/api/src/modules/hierarchy/hierarchy.repository.ts apps/api/src/server.ts infra/sql/procedures/usp_Hierarchy_NodeWorkspace.sql
git commit -m "feat(10b): REST — workspace role CRUD/assign (role.manage) + object-permission editor routes (FULL-gated) + node→workspace lookup"
```

---

### Task 6: Integration — create-custom-role-then-assign (user gains exactly its slugs)

**Files:**
- Create: `apps/api/src/modules/roles/__tests__/custom-role.integration.test.ts`

Steps:

- [ ] Write the failing integration test (copy the harness imports from an existing integration test, e.g. `access.service.unit.test.ts`'s siblings under `__tests__/setup` + `fixtures`). This exercises the real SQL stack against `ProjectFlow_Test`:

```ts
/**
 * Phase 10b — Custom-role integration coverage.
 * Creates a workspace custom role from a permission-slug set, assigns it, and
 * proves the user's effective slugs (usp_UserPermissions_Get) equal exactly the
 * role's slugs — no floor leakage, system roles immutable, per-workspace slug
 * isolation. DB SAFETY: must target local Docker ProjectFlow_Test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { roleService } from '../role.service.js';
import { roleRepository } from '../role.repository.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

describe('workspace custom roles', () => {
  it('a created custom role + assignment grants the user EXACTLY its slugs', async () => {
    const owner = await createTestUser({ email: `cr-owner-${Date.now()}@projectflow.test` });
    const member = await createTestUser({ email: `cr-member-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);

    // owner holds workspace-owner → has role.manage. Pick two slugs to bundle.
    const perms = await roleService.listPermissions('WORKSPACE');
    const taskRead   = perms.find((p) => p.slug === 'task.read')!;
    const reportRead = perms.find((p) => p.slug === 'report.read')!;

    const created = await roleService.createWorkspaceRole({
      workspaceId: ws.Id, name: 'QA Reviewer', description: null,
      permissionIds: [taskRead.id, reportRead.id], actorId: owner.id,
    });
    expect(created.workspaceId).toBe(ws.Id);
    expect(created.isSystem).toBe(false);

    const assigned = await roleService.assignWorkspaceRole({
      workspaceId: ws.Id, userId: member.id, roleId: created.id, actorId: owner.id,
    });
    expect(assigned.ok).toBe(true);

    // Effective slugs for the member in this workspace = EXACTLY the role's two.
    const slugs = await roleRepository.getUserPermissionSlugs(member.id, ws.Id);
    expect([...slugs].sort()).toEqual(['report.read', 'task.read']);
  });

  it('refuses to mutate a system role (immutable)', async () => {
    const owner = await createTestUser({ email: `cr-sys-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const sysMember = await roleService.getRoleBySlug('workspace-member');
    const res = await roleService.updateWorkspaceRole({
      workspaceId: ws.Id, roleId: sysMember!.id, name: 'Hacked', actorId: owner.id,
    });
    expect(res.ok).toBe(false);
    expect((res as any).code).toBe('NOT_FOUND'); // system role has workspaceId null → not "this ws's custom role"
  });

  it('isolates custom-role slugs per workspace', async () => {
    const owner = await createTestUser({ email: `cr-iso-${Date.now()}@projectflow.test` });
    const wsA = await createTestWorkspace(owner.accessToken);
    const wsB = await createTestWorkspace(owner.accessToken);
    // Same human-readable name in both workspaces is allowed (slug unique per-ws).
    const a = await roleService.createWorkspaceRole({ workspaceId: wsA.Id, name: 'Lead', permissionIds: [], actorId: owner.id });
    const b = await roleService.createWorkspaceRole({ workspaceId: wsB.Id, name: 'Lead', permissionIds: [], actorId: owner.id });
    expect(a.id).not.toBe(b.id);
    expect(a.slug).toBe(b.slug); // 'lead' in both — allowed because WorkspaceId differs

    const listA = await roleService.listWorkspaceRoles(wsA.Id);
    expect(listA.some((r) => r.id === b.id)).toBe(false); // wsB's role not visible from wsA
  });

  it('REST: create + assign via the workspace role endpoints', async () => {
    const owner = await createTestUser({ email: `cr-rest-${Date.now()}@projectflow.test` });
    const member = await createTestUser({ email: `cr-rest-m-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const token = owner.accessToken;
    const perms = (await json<{ data: any[] }>(await request(`/admin/permissions?scope=WORKSPACE`, { token }))).data;
    const slugId = perms.find((p) => p.slug === 'task.read').id;

    const role = (await json<{ data: any }>(await request(`/admin/workspaces/${ws.Id}/roles`, {
      method: 'POST', token, json: { name: 'Triage', permissionIds: [slugId] },
    }), 201)).data;
    expect(role.workspaceId).toBe(ws.Id);

    await json(await request(`/admin/workspaces/${ws.Id}/roles/${role.id}/members`, {
      method: 'POST', token, json: { userId: member.id },
    }), 201);

    const slugs = await roleRepository.getUserPermissionSlugs(member.id, ws.Id);
    expect(slugs.has('task.read')).toBe(true);
  });
});
```

- [ ] Run: `npm run test:integration --workspace apps/api -- custom-role` against `ProjectFlow_Test`. Expected: PASS (4 tests). (Adapt the factory/harness import paths to the actual `__tests__/setup` + `fixtures` filenames used by the existing integration suites.)

- [ ] Commit:
```
git add apps/api/src/modules/roles/__tests__/custom-role.integration.test.ts
git commit -m "test(10b): integration — custom role grants exactly its slugs + immutable system roles + per-ws isolation"
```

---

### Task 7: Integration — object-permission editor (most-specific-wins override + inherited list)

**Files:**
- Create: `apps/api/src/modules/access/__tests__/object-permission.integration.test.ts`

Steps:

- [ ] Write the failing integration test — set a Space-level `VIEW` then a List-level `EDIT` for the same subject and prove the resolver returns `EDIT` for the List (most-specific-wins) while the Space stays `VIEW`; assert `listObjectPermissions` returns the inherited chain:

```ts
/**
 * Phase 10b — Object-permission editor + most-specific-wins override.
 * A List-level EDIT grant overrides a Space-level VIEW for the same subject.
 * DB SAFETY: must target local Docker ProjectFlow_Test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { accessService } from '../access.service.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function seedSpaceAndList(token: string, wsId: string) {
  const space = await createTestProject(wsId, token, { name: 'ACL Space', key: `ACL${Date.now() % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: wsId, spaceId: space.Id, folderId: null, name: 'L', position: 0 },
  }), 201)).data;
  return { spaceId: space.Id, listId: list.id };
}

describe('object permission most-specific-wins', () => {
  it('a List-level EDIT grant overrides a Space-level VIEW for the same user', async () => {
    const owner = await createTestUser({ email: `op-owner-${Date.now()}@projectflow.test` });
    const guest = await createTestUser({ email: `op-guest-${Date.now()}@projectflow.test` }); // non-member of ws
    const ws = await createTestWorkspace(owner.accessToken);
    const { spaceId, listId } = await seedSpaceAndList(owner.accessToken, ws.Id);

    // Space VIEW → the guest can VIEW the space (and inherit VIEW on the list)...
    await accessService.setObjectPermission({
      workspaceId: ws.Id, subjectType: 'USER', subjectId: guest.id,
      objectType: 'SPACE', objectId: spaceId, level: 'VIEW', actorId: owner.id,
    });
    expect((await accessService.resolveOrNull(guest.id, 'LIST', listId)).level).toBe('VIEW');

    // ...until a List-level EDIT grant wins for the list specifically.
    await accessService.setObjectPermission({
      workspaceId: ws.Id, subjectType: 'USER', subjectId: guest.id,
      objectType: 'LIST', objectId: listId, level: 'EDIT', actorId: owner.id,
    });
    expect((await accessService.resolveOrNull(guest.id, 'LIST', listId)).level).toBe('EDIT');
    // The space itself stays VIEW (the list grant is more specific, not global).
    expect((await accessService.resolveOrNull(guest.id, 'SPACE', spaceId)).level).toBe('VIEW');
  });

  it('listObjectPermissions returns both the own grant and the inherited ancestor grant', async () => {
    const owner = await createTestUser({ email: `op-list-${Date.now()}@projectflow.test` });
    const guest = await createTestUser({ email: `op-list-g-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const { spaceId, listId } = await seedSpaceAndList(owner.accessToken, ws.Id);

    await accessService.setObjectPermission({ workspaceId: ws.Id, subjectType: 'USER', subjectId: guest.id, objectType: 'SPACE', objectId: spaceId, level: 'VIEW', actorId: owner.id });
    await accessService.setObjectPermission({ workspaceId: ws.Id, subjectType: 'USER', subjectId: guest.id, objectType: 'LIST', objectId: listId, level: 'EDIT', actorId: owner.id });

    const grants = await accessService.listObjectPermissions('LIST', listId);
    const own      = grants.find((g) => g.objectType === 'LIST'  && g.subjectId === guest.id);
    const inherited = grants.find((g) => g.objectType === 'SPACE' && g.subjectId === guest.id);
    expect(own?.level).toBe('EDIT');
    expect(own?.inherited).toBe(false);
    expect(inherited?.level).toBe('VIEW');
    expect(inherited?.inherited).toBe(true);
    expect(inherited?.inheritedFromName).toBe('ACL Space');
  });

  it('REST: PUT then DELETE a grant via the FULL-gated editor surface', async () => {
    const owner = await createTestUser({ email: `op-rest-${Date.now()}@projectflow.test` });
    const guest = await createTestUser({ email: `op-rest-g-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const token = owner.accessToken;
    const { listId } = await seedSpaceAndList(token, ws.Id);

    const put = await json<{ data: any[] }>(await request(`/access/LIST/${listId}/permissions`, {
      method: 'PUT', token, json: { subjectType: 'USER', subjectId: guest.id, level: 'EDIT' },
    }));
    expect(put.data.some((g) => g.subjectId === guest.id && g.level === 'EDIT')).toBe(true);

    const del = await json<{ data: any[] }>(await request(`/access/LIST/${listId}/permissions`, {
      method: 'DELETE', token, json: { subjectType: 'USER', subjectId: guest.id },
    }));
    expect(del.data.some((g) => g.subjectId === guest.id)).toBe(false);
  });
});
```

- [ ] Run: `npm run test:integration --workspace apps/api -- object-permission` against `ProjectFlow_Test`. Expected: PASS (3 tests).

- [ ] Commit:
```
git add apps/api/src/modules/access/__tests__/object-permission.integration.test.ts
git commit -m "test(10b): integration — List EDIT overrides Space VIEW (most-specific-wins) + inherited grant list + REST editor"
```

---

### Task 8: THE PERMISSION TEST MATRIX (headline integration test — §5.5 acceptance)

**Files:**
- Create: `apps/api/src/modules/access/__tests__/permission-matrix.integration.test.ts`

This is the acceptance deliverable: a **fully-enumerated** parameterized matrix over {owner, admin, member, viewer, custom-role, guest} × {VIEW/COMMENT/EDIT/FULL grant at space/folder/list/none} × {PUBLIC/PRIVATE}, asserting `usp_ObjectAccess_Resolve`'s resolved level for a target List — proving most-specific-wins over the role floor. The expected levels follow directly from the resolver's contract (read `usp_ObjectAccess_Resolve.sql`):
- **Floor:** workspace **owner** → `FULL`; any **workspace member** (admin/member/viewer/custom-role/guest-as-member) → `EDIT`; a **non-member** (the "guest" subject here, with no `WorkspaceMembers` row) → no floor (`null`).
- **Explicit grant** at the most-specific ancestor (space < folder < list) **wins over the floor** when present (the resolver `COALESCE(@Explicit, @Floor)`). A grant placed on the List is more specific than one on the Space.
- **Visibility PRIVATE** denies a non-member/non-owner **without** an explicit grant (`null`); PUBLIC lets the floor apply. (For members/owner, PRIVATE is irrelevant — they have a floor.)

Steps:

- [ ] Write the matrix test. Enumerate **every** case as explicit data rows (no "…and so on"); a loop over the arrays is the mechanism, but the arrays are complete and real:

```ts
/**
 * Phase 10b — THE PERMISSION TEST MATRIX (BUILD_PLAN §5.5 acceptance).
 *
 * Proves usp_ObjectAccess_Resolve resolves the correct level for a TARGET LIST
 * across the full cross-product of:
 *   subject   ∈ { owner, admin, member, viewer, custom-role, guest }
 *   grant     ∈ { none, VIEW@space, VIEW@folder, VIEW@list, COMMENT@list,
 *                 EDIT@list, FULL@list, EDIT@space }
 *   visibility ∈ { PUBLIC, PRIVATE }
 *
 * The headline property: a more-specific explicit grant WINS over the role
 * floor. DB SAFETY: must target local Docker ProjectFlow_Test.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { accessService } from '../access.service.js';
import { roleService } from '../../roles/role.service.js';
import { execSpOne } from '../../../shared/lib/sqlClient.js';
import sql from 'mssql';

type Level = 'VIEW' | 'COMMENT' | 'EDIT' | 'FULL' | null;
type Subject = 'owner' | 'admin' | 'member' | 'viewer' | 'custom' | 'guest';
type Visibility = 'PUBLIC' | 'PRIVATE';
type GrantSpec =
  | { kind: 'none' }
  | { kind: 'grant'; level: Exclude<Level, null>; node: 'space' | 'folder' | 'list' };

// The role floor each subject gets from membership (PUBLIC space). The "guest"
// here is a non-member of the workspace — NO floor.
const FLOOR: Record<Subject, Level> = {
  owner: 'FULL', admin: 'EDIT', member: 'EDIT', viewer: 'EDIT', custom: 'EDIT', guest: null,
};

// Every grant scenario applied to the TARGET LIST resolution.
const GRANTS: GrantSpec[] = [
  { kind: 'none' },
  { kind: 'grant', level: 'VIEW',    node: 'space'  },
  { kind: 'grant', level: 'VIEW',    node: 'folder' },
  { kind: 'grant', level: 'VIEW',    node: 'list'   },
  { kind: 'grant', level: 'COMMENT', node: 'list'   },
  { kind: 'grant', level: 'EDIT',    node: 'list'   },
  { kind: 'grant', level: 'FULL',    node: 'list'   },
  { kind: 'grant', level: 'EDIT',    node: 'space'  }, // ancestor grant, less specific than a list grant
];

const SUBJECTS: Subject[] = ['owner', 'admin', 'member', 'viewer', 'custom', 'guest'];
const VISIBILITIES: Visibility[] = ['PUBLIC', 'PRIVATE'];

/** Most-specific explicit grant on the ancestry for THIS list, given the spec. */
function explicitForList(g: GrantSpec): Level {
  return g.kind === 'none' ? null : g.level; // single grant per scenario; always on the list's ancestry
}

/** Expected resolved level = explicit (if any) else (PRIVATE && no floor-eligibility ? null : floor). */
function expected(subject: Subject, g: GrantSpec, vis: Visibility): Level {
  const explicit = explicitForList(g);
  if (explicit) return explicit;                       // explicit grant wins over the floor
  const floor = FLOOR[subject];
  // owner/member floor applies regardless of visibility.
  if (subject === 'owner' || floor === 'EDIT' || floor === 'FULL') return floor;
  // guest (no membership): PRIVATE without an explicit grant → null; PUBLIC → null too (no floor).
  return null;
}

// ── Shared seed: one workspace, one space (toggled PUBLIC/PRIVATE per run),
//    one folder, one list; six subjects with their memberships/roles. ──────────
let env: {
  ownerToken: string;
  wsId: string;
  spaceId: string; folderId: string; listId: string;
  subjects: Record<Subject, { id: string }>;
  customRoleId: string;
};

async function setVisibility(spaceId: string, v: Visibility) {
  await execSpOne('usp_Project_SetVisibility', [   // if no such SP exists, UPDATE Projects directly via a test-only helper
    { name: 'Id', type: sql.UniqueIdentifier, value: spaceId },
    { name: 'Visibility', type: sql.NVarChar(10), value: v },
  ]).catch(async () => {
    // Fallback: raw update against the test DB (test-only).
    await execSpOne('sp_executesql' as any, []).catch(() => {});
  });
}

beforeAll(async () => {
  await truncateAll();
  const owner = await createTestUser({ email: `mx-owner-${Date.now()}@projectflow.test` });
  const ws = await createTestWorkspace(owner.accessToken);
  const space = await createTestProject(ws.Id, owner.accessToken, { name: 'Matrix Space', key: `MX${Date.now() % 100000}` });
  const folder = (await json<{ data: any }>(await request('/folders', {
    method: 'POST', token: owner.accessToken, json: { workspaceId: ws.Id, spaceId: space.Id, name: 'F', position: 0 },
  }), 201)).data;
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token: owner.accessToken, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: folder.id, name: 'L', position: 0 },
  }), 201)).data;

  // Subjects: admin/member/viewer/custom are workspace members with their role;
  // guest is a non-member of the workspace.
  const mk = async (tag: string) => (await createTestUser({ email: `mx-${tag}-${Date.now()}@projectflow.test` }));
  const admin = await mk('admin'), member = await mk('member'), viewer = await mk('viewer'), custom = await mk('custom'), guest = await mk('guest');

  // Add the four members to the workspace (the factory's member-add path) and
  // assign their workspace roles. (Adapt to the project's member-invite helper.)
  for (const [u, slug] of [[admin, 'workspace-admin'], [member, 'workspace-member'], [viewer, 'workspace-viewer']] as const) {
    await request(`/workspaces/${ws.Id}/members`, { method: 'POST', token: owner.accessToken, json: { userId: u.id, role: slug } });
  }
  // The custom subject is a member with a custom role carrying task.* slugs.
  await request(`/workspaces/${ws.Id}/members`, { method: 'POST', token: owner.accessToken, json: { userId: custom.id, role: 'workspace-member' } });
  const perms = await roleService.listPermissions('WORKSPACE');
  const customRole = await roleService.createWorkspaceRole({
    workspaceId: ws.Id, name: 'Matrix Custom', permissionIds: [perms.find((p) => p.slug === 'task.read')!.id], actorId: owner.id,
  });
  await roleService.assignWorkspaceRole({ workspaceId: ws.Id, userId: custom.id, roleId: customRole.id, actorId: owner.id });

  env = {
    ownerToken: owner.accessToken, wsId: ws.Id,
    spaceId: space.Id, folderId: folder.id, listId: list.id,
    subjects: { owner: { id: owner.id }, admin: { id: admin.id }, member: { id: member.id }, viewer: { id: viewer.id }, custom: { id: custom.id }, guest: { id: guest.id } },
    customRoleId: customRole.id,
  };
});

afterAll(async () => { await closePool(); });

// Clear every explicit grant for a subject across the three nodes between cases.
async function clearGrants(subjectId: string) {
  for (const node of [['SPACE', env.spaceId], ['FOLDER', env.folderId], ['LIST', env.listId]] as const) {
    await accessService.removeObjectPermission({
      workspaceId: env.wsId, subjectType: 'USER', subjectId,
      objectType: node[0], objectId: node[1], actorId: env.subjects.owner.id,
    });
  }
}

function nodeId(node: 'space' | 'folder' | 'list'): { type: 'SPACE' | 'FOLDER' | 'LIST'; id: string } {
  if (node === 'space')  return { type: 'SPACE',  id: env.spaceId };
  if (node === 'folder') return { type: 'FOLDER', id: env.folderId };
  return { type: 'LIST', id: env.listId };
}

describe('permission matrix — most-specific-wins over the role floor', () => {
  for (const vis of VISIBILITIES) {
    describe(`visibility=${vis}`, () => {
      it('sets the space visibility for this block', async () => {
        await setVisibility(env.spaceId, vis);
      });

      for (const subject of SUBJECTS) {
        for (const g of GRANTS) {
          const label = g.kind === 'none' ? 'no-grant' : `${g.level}@${g.node}`;
          it(`${subject} × ${label} → ${expected(subject, g, vis) ?? 'NONE'}`, async () => {
            const subjectId = env.subjects[subject].id;
            await clearGrants(subjectId);
            if (g.kind === 'grant') {
              const n = nodeId(g.node);
              await accessService.setObjectPermission({
                workspaceId: env.wsId, subjectType: 'USER', subjectId,
                objectType: n.type, objectId: n.id, level: g.level, actorId: env.subjects.owner.id,
              });
            }
            const { level } = await accessService.resolveOrNull(subjectId, 'LIST', env.listId);
            expect(level).toBe(expected(subject, g, vis));
          });
        }
      }
    });
  }
});
```

Notes for the implementer (resolve before running):
- The matrix asserts the **List** resolution. A grant on `space`/`folder` is an **ancestor** grant (less specific); a grant on `list` is the most specific. Because each scenario applies a **single** grant, `explicitForList(g)` is just that grant's level — but it still proves the override: compare the `EDIT@list` row (always `EDIT`) against the floor (`viewer` member's floor is also `EDIT`, so to make the override visible, the matrix ALSO includes `VIEW@list` for member/admin where floor=`EDIT` → resolved drops to `VIEW`, i.e. the **list grant overrides the floor downward**, and `FULL@list` raises it upward). This is the most-specific-wins proof.
- **Add explicit "grant-overrides-floor" rows** to make the override unmistakable: a `member` (floor `EDIT`) with `VIEW@list` must resolve to **`VIEW`** (grant beats floor), and with `FULL@list` to **`FULL`**. The `expected()` function already encodes this (explicit wins). Verify these specific rows are present in `GRANTS` (they are: `VIEW@list`, `FULL@list`).
- **`setVisibility`**: prefer a real SP if one exists (grep for `Visibility` in `infra/sql/procedures`); otherwise add a test-only `usp_Project_SetVisibility` SP (`UPDATE dbo.Projects SET Visibility=@Visibility WHERE Id=@Id`) and deploy it, OR set visibility via the existing project-update REST route. Do NOT leave the `sp_executesql` fallback stub — replace it with a real path before committing.
- The workspace member-add route/shape (`POST /workspaces/:id/members` with `{ userId, role }`) must match the project's real invite endpoint — adapt to the actual factory/route (grep `members` in `workspace.routes.ts`). If members are added by a factory helper, use it instead.

- [ ] Run: `npm run test:integration --workspace apps/api -- permission-matrix` against `ProjectFlow_Test`. Expected: PASS — every enumerated case (6 subjects × 8 grants × 2 visibilities = 96 assertions + 2 visibility-setup cases) green. This satisfies §5.5.

- [ ] Commit:
```
git add apps/api/src/modules/access/__tests__/permission-matrix.integration.test.ts
git commit -m "test(10b): THE permission test matrix — subject × grant-level/scope × visibility proves most-specific-wins over the role floor (§5.5)"
```

---

### Task 9: GraphQL mirror (`permissions.schema.ts`)

**Files:**
- Create: `apps/api/src/graphql/permissions.schema.ts`
- Modify: `apps/api/src/graphql/schema.ts` (import + call near the other `register*Graphql()` calls)

Steps:

- [ ] Write `permissions.schema.ts`, mirroring an existing schema's structure (`objectRef`, `requireWorkspacePermission`/`requireObjectLevel`/`notFound` from `./authz.js`, delegating to the shared `roleService`/`accessService`). The object-permission mutations gate on `requireObjectLevel(ctx, type, id, 'FULL')`; the role mutations gate on `requireWorkspacePermission(ctx, workspaceId, 'role.manage')`:

```ts
import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { roleService } from '../modules/roles/role.service.js';
import { accessService } from '../modules/access/access.service.js';
import { HierarchyRepository } from '../modules/hierarchy/hierarchy.repository.js';
import { notFound, requireObjectLevel, requireWorkspacePermission } from './authz.js';
import type { RoleWithCounts, ObjectPermissionGrant, HierarchyNodeType } from '@projectflow/types';

const hierarchyRepo = new HierarchyRepository();

export function registerPermissionsGraphql(): void {
  const WorkspaceRole = builder.objectRef<RoleWithCounts>('WorkspaceRole');
  WorkspaceRole.implement({ fields: (t) => ({
    id:              t.exposeString('id'),
    name:            t.exposeString('name'),
    slug:            t.exposeString('slug'),
    description:     t.string({ nullable: true, resolve: (r) => r.description ?? null }),
    scope:           t.exposeString('scope'),
    isSystem:        t.boolean({ resolve: (r) => r.isSystem }),
    workspaceId:     t.string({ nullable: true, resolve: (r) => r.workspaceId ?? null }),
    permissionCount: t.exposeInt('permissionCount'),
    memberCount:     t.exposeInt('memberCount'),
  }) });

  const ObjectPermissionGrantType = builder.objectRef<ObjectPermissionGrant>('ObjectPermissionGrant');
  ObjectPermissionGrantType.implement({ fields: (t) => ({
    id:                t.exposeString('id'),
    subjectType:       t.exposeString('subjectType'),
    subjectId:         t.exposeString('subjectId'),
    subjectName:       t.string({ nullable: true, resolve: (g) => g.subjectName ?? null }),
    subjectEmail:      t.string({ nullable: true, resolve: (g) => g.subjectEmail ?? null }),
    objectType:        t.exposeString('objectType'),
    objectId:          t.exposeString('objectId'),
    level:             t.exposeString('level'),
    inherited:         t.boolean({ resolve: (g) => g.inherited }),
    inheritedFromName: t.string({ nullable: true, resolve: (g) => g.inheritedFromName ?? null }),
  }) });

  builder.queryFields((t) => ({
    workspaceRoles: t.field({
      type: [WorkspaceRole],
      args: { workspaceId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'role.manage');
        return roleService.listWorkspaceRoles(a.workspaceId);
      },
    }),
    objectPermissions: t.field({
      type: [ObjectPermissionGrantType],
      args: { objectType: t.arg.string({ required: true }), objectId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireObjectLevel(ctx, a.objectType as HierarchyNodeType, a.objectId, 'FULL');
        return accessService.listObjectPermissions(a.objectType as HierarchyNodeType, a.objectId);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    createWorkspaceRole: t.field({
      type: WorkspaceRole,
      args: {
        workspaceId:   t.arg.string({ required: true }),
        name:          t.arg.string({ required: true }),
        description:   t.arg.string({ required: false }),
        permissionIds: t.arg.stringList({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'role.manage');
        const role = await roleService.createWorkspaceRole({
          workspaceId: a.workspaceId, name: a.name, description: a.description ?? null,
          permissionIds: a.permissionIds ?? [], actorId: (ctx.user as any).userId, actorEmail: (ctx.user as any).email ?? null,
        });
        return { ...role, permissionCount: role.permissions.length, memberCount: 0 } as any;
      },
    }),
    updateWorkspaceRole: t.field({
      type: 'Boolean',
      args: {
        workspaceId: t.arg.string({ required: true }), roleId: t.arg.string({ required: true }),
        name: t.arg.string({ required: false }), description: t.arg.string({ required: false }),
        permissionIds: t.arg.stringList({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'role.manage');
        const res = await roleService.updateWorkspaceRole({
          workspaceId: a.workspaceId, roleId: a.roleId, name: a.name ?? undefined,
          description: a.description ?? undefined, permissionIds: a.permissionIds ?? undefined,
          actorId: (ctx.user as any).userId, actorEmail: (ctx.user as any).email ?? null,
        });
        if (!res.ok) res.code === 'IMMUTABLE' ? forbid('System roles are immutable') : notFound('Role not found');
        return true;
      },
    }),
    deleteWorkspaceRole: t.field({
      type: 'Boolean',
      args: { workspaceId: t.arg.string({ required: true }), roleId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'role.manage');
        const res = await roleService.deleteWorkspaceRole({
          workspaceId: a.workspaceId, roleId: a.roleId,
          actorId: (ctx.user as any).userId, actorEmail: (ctx.user as any).email ?? null,
        });
        if (!res.ok) res.code === 'IMMUTABLE' ? forbid('System roles are immutable') : notFound('Role not found');
        return true;
      },
    }),
    assignWorkspaceRole: t.field({
      type: 'Boolean',
      args: { workspaceId: t.arg.string({ required: true }), roleId: t.arg.string({ required: true }), userId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'role.manage');
        const res = await roleService.assignWorkspaceRole({
          workspaceId: a.workspaceId, roleId: a.roleId, userId: a.userId,
          actorId: (ctx.user as any).userId, actorEmail: (ctx.user as any).email ?? null,
        });
        if (!res.ok) notFound('Role not found in this workspace');
        return true;
      },
    }),
    setObjectPermission: t.field({
      type: [ObjectPermissionGrantType],
      args: {
        objectType: t.arg.string({ required: true }), objectId: t.arg.string({ required: true }),
        subjectType: t.arg.string({ required: true }), subjectId: t.arg.string({ required: true }),
        level: t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        await requireObjectLevel(ctx, a.objectType as HierarchyNodeType, a.objectId, 'FULL');
        const workspaceId = await hierarchyRepo.getWorkspaceIdForNode(a.objectType as HierarchyNodeType, a.objectId);
        if (!workspaceId) notFound('Resource not found');
        await accessService.setObjectPermission({
          workspaceId: workspaceId!, subjectType: a.subjectType as 'USER' | 'ROLE', subjectId: a.subjectId,
          objectType: a.objectType as HierarchyNodeType, objectId: a.objectId, level: a.level as any,
          actorId: (ctx.user as any).userId, actorEmail: (ctx.user as any).email ?? null,
        });
        return accessService.listObjectPermissions(a.objectType as HierarchyNodeType, a.objectId);
      },
    }),
    removeObjectPermission: t.field({
      type: [ObjectPermissionGrantType],
      args: {
        objectType: t.arg.string({ required: true }), objectId: t.arg.string({ required: true }),
        subjectType: t.arg.string({ required: true }), subjectId: t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        await requireObjectLevel(ctx, a.objectType as HierarchyNodeType, a.objectId, 'FULL');
        const workspaceId = await hierarchyRepo.getWorkspaceIdForNode(a.objectType as HierarchyNodeType, a.objectId);
        if (!workspaceId) notFound('Resource not found');
        await accessService.removeObjectPermission({
          workspaceId: workspaceId!, subjectType: a.subjectType as 'USER' | 'ROLE', subjectId: a.subjectId,
          objectType: a.objectType as HierarchyNodeType, objectId: a.objectId,
          actorId: (ctx.user as any).userId, actorEmail: (ctx.user as any).email ?? null,
        });
        return accessService.listObjectPermissions(a.objectType as HierarchyNodeType, a.objectId);
      },
    }),
  }));
}

function forbid(message: string): never {
  throw new GraphQLError(message, { extensions: { code: 'FORBIDDEN' } });
}
```
*(Match the exact Pothos field helpers used by a recent schema, e.g. `graphql/worklog.schema.ts` if 8a landed, or another `register*Graphql()` module; adapt `t.arg.stringList`/`t.exposeInt` to the project's helper names. Read `graphql/schema.ts`'s existing registrations for the exact import/call convention.)*

- [ ] Wire it into `schema.ts` — add the import and call near the other `register*Graphql()` calls:

```ts
import { registerPermissionsGraphql } from './permissions.schema.js';
```
```ts
// ─────────────────────────────────────────
// Permissions hardening (Phase 10b) — WorkspaceRole/ObjectPermissionGrant types +
// workspaceRoles/objectPermissions queries + custom-role CRUD/assign + the
// setObjectPermission grant primitive + removeObjectPermission.
// ─────────────────────────────────────────
registerPermissionsGraphql();
```

- [ ] Run: `npm run build --workspace apps/api` (tsc — compiles the Pothos schema). Expected: PASS. Then `npm test --workspace apps/api`. Expected: PASS (existing GraphQL authz tests still green).

- [ ] Commit:
```
git add apps/api/src/graphql/permissions.schema.ts apps/api/src/graphql/schema.ts
git commit -m "feat(10b): GraphQL mirror — workspaceRoles/objectPermissions + custom-role CRUD/assign + setObjectPermission/removeObjectPermission"
```

---

### Task 10: Frontend — pure helpers + unit test + server actions

**Files:**
- Create: `apps/next-web/src/lib/permissions.ts`
- Create: `apps/next-web/src/lib/__tests__/permissions.unit.test.ts`
- Create: `apps/next-web/src/server/actions/object-permissions.ts`
- Create: `apps/next-web/src/server/actions/workspace-roles.ts`
- Note: read `node_modules/next/dist/docs/` per `apps/next-web/AGENTS.md` before writing web code (this Next.js has breaking changes).

Steps:

- [ ] Write the failing unit test for the "inherited from" computation. `permissions.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeInheritedFrom, groupGrantsBySubject } from '../permissions';
import type { ObjectPermissionGrant } from '@projectflow/types';

const base: Omit<ObjectPermissionGrant, 'objectType' | 'objectId' | 'inherited' | 'inheritedFromName'> = {
  id: 'g1', subjectType: 'USER', subjectId: 'u1', subjectName: 'Ada', subjectEmail: 'ada@x.test', level: 'EDIT',
};

describe('computeInheritedFrom', () => {
  it('marks a grant on the same object as direct (not inherited)', () => {
    const g = { ...base, objectType: 'LIST' as const, objectId: 'L1', inherited: false, inheritedFromName: null };
    expect(computeInheritedFrom('LIST', 'L1', g)).toEqual({ inherited: false, fromName: null });
  });
  it('marks a grant on an ancestor as inherited with the ancestor name', () => {
    const g = { ...base, objectType: 'SPACE' as const, objectId: 'S1', inherited: true, inheritedFromName: 'Marketing' };
    expect(computeInheritedFrom('LIST', 'L1', g)).toEqual({ inherited: true, fromName: 'Marketing' });
  });
});

describe('groupGrantsBySubject', () => {
  it('keeps the most-specific (direct) grant when a subject has both inherited + direct', () => {
    const grants: ObjectPermissionGrant[] = [
      { ...base, objectType: 'SPACE', objectId: 'S1', level: 'VIEW', inherited: true, inheritedFromName: 'Marketing' },
      { ...base, objectType: 'LIST',  objectId: 'L1', level: 'EDIT', inherited: false, inheritedFromName: null },
    ];
    const rows = groupGrantsBySubject('LIST', 'L1', grants);
    expect(rows).toHaveLength(1);
    expect(rows[0].effectiveLevel).toBe('EDIT');  // direct beats inherited
    expect(rows[0].inheritedLevel).toBe('VIEW');  // still surfaced for the UI hint
  });
});
```

- [ ] Run: `npm test --workspace apps/next-web -- permissions`. Expected: FAIL — module not found.

- [ ] Write `apps/next-web/src/lib/permissions.ts` (pure, DB-free; the "inherited from" computation + a per-subject collapse so the editor shows one row per subject with the effective + inherited level):

```ts
import type { HierarchyNodeType, ObjectPermissionGrant, ObjectPermissionLevel } from '@projectflow/types';

const RANK: Record<ObjectPermissionLevel, number> = { VIEW: 1, COMMENT: 2, EDIT: 3, FULL: 4 };

/** Is a grant direct (on this object) or inherited from an ancestor? */
export function computeInheritedFrom(
  objectType: HierarchyNodeType, objectId: string, grant: ObjectPermissionGrant,
): { inherited: boolean; fromName: string | null } {
  const direct = grant.objectType === objectType && grant.objectId === objectId;
  return direct ? { inherited: false, fromName: null } : { inherited: true, fromName: grant.inheritedFromName };
}

export interface SubjectGrantRow {
  subjectType:    ObjectPermissionGrant['subjectType'];
  subjectId:      string;
  subjectName:    string | null;
  subjectEmail:   string | null;
  effectiveLevel: ObjectPermissionLevel;        // the most-specific (direct wins over inherited)
  directGrantId:  string | null;                // present only when editable on THIS object
  inheritedLevel: ObjectPermissionLevel | null; // surfaced as the "inherited from <ancestor>" hint
  inheritedFromName: string | null;
}

/** Collapse the raw ancestry grant list into one row per subject for the editor. */
export function groupGrantsBySubject(
  objectType: HierarchyNodeType, objectId: string, grants: ObjectPermissionGrant[],
): SubjectGrantRow[] {
  const map = new Map<string, SubjectGrantRow>();
  for (const g of grants) {
    const key = `${g.subjectType}:${g.subjectId}`;
    const { inherited } = computeInheritedFrom(objectType, objectId, g);
    let row = map.get(key);
    if (!row) {
      row = {
        subjectType: g.subjectType, subjectId: g.subjectId, subjectName: g.subjectName, subjectEmail: g.subjectEmail,
        effectiveLevel: g.level, directGrantId: null, inheritedLevel: null, inheritedFromName: null,
      };
      map.set(key, row);
    }
    if (inherited) {
      // keep the strongest inherited level + its source name
      if (row.inheritedLevel === null || RANK[g.level] > RANK[row.inheritedLevel]) {
        row.inheritedLevel = g.level;
        row.inheritedFromName = g.inheritedFromName;
      }
    } else {
      row.directGrantId = g.id;
    }
    // effective = direct if present, else the strongest inherited
    const directLevel = !inherited ? g.level : null;
    if (directLevel) row.effectiveLevel = directLevel;
    else if (row.directGrantId === null && row.inheritedLevel) row.effectiveLevel = row.inheritedLevel;
  }
  return [...map.values()];
}
```

- [ ] Run: `npm test --workspace apps/next-web -- permissions`. Expected: PASS.

- [ ] Write `apps/next-web/src/server/actions/object-permissions.ts` (mirror the `admin-roles.ts` action shape — `requireSession` + `serverFetch` + `toActionError` + `revalidatePath`):

```ts
'use server';

import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ObjectPermissionGrant, ObjectPermissionLevel, HierarchyNodeType } from '@projectflow/types';
import type { ActionResult } from './result';

export async function loadObjectPermissions(objectType: HierarchyNodeType, objectId: string): Promise<ObjectPermissionGrant[]> {
  await requireSession();
  return (await serverFetch<ObjectPermissionGrant[]>(`/access/${objectType}/${objectId}/permissions`)) ?? [];
}

export async function setObjectPermission(
  objectType: HierarchyNodeType, objectId: string,
  input: { subjectType: 'USER' | 'ROLE'; subjectId: string; level: ObjectPermissionLevel },
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/access/${objectType}/${objectId}/permissions`, { method: 'PUT', body: JSON.stringify(input) });
  } catch (e) { return toActionError(e); }
  return { ok: true };
}

export async function removeObjectPermission(
  objectType: HierarchyNodeType, objectId: string,
  input: { subjectType: 'USER' | 'ROLE'; subjectId: string },
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/access/${objectType}/${objectId}/permissions`, { method: 'DELETE', body: JSON.stringify(input) });
  } catch (e) { return toActionError(e); }
  return { ok: true };
}
```

- [ ] Write `apps/next-web/src/server/actions/workspace-roles.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { RoleWithCounts } from '@projectflow/types';
import type { ActionResult } from './result';

export async function loadWorkspaceRoles(workspaceId: string): Promise<RoleWithCounts[]> {
  await requireSession();
  return (await serverFetch<RoleWithCounts[]>(`/admin/workspaces/${workspaceId}/roles`)) ?? [];
}

export async function createWorkspaceRole(
  workspaceId: string, input: { name: string; description: string | null; permissionIds: string[] },
): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/admin/workspaces/${workspaceId}/roles`, { method: 'POST', body: JSON.stringify(input) }); }
  catch (e) { return toActionError(e); }
  revalidatePath(`/workspaces/${workspaceId}/settings`);
  return { ok: true };
}

export async function updateWorkspaceRole(
  workspaceId: string, roleId: string,
  input: { name?: string; description?: string | null; permissionIds?: string[] },
): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/admin/workspaces/${workspaceId}/roles/${roleId}`, { method: 'PATCH', body: JSON.stringify(input) }); }
  catch (e) { return toActionError(e); }
  revalidatePath(`/workspaces/${workspaceId}/settings`);
  return { ok: true };
}

export async function deleteWorkspaceRole(workspaceId: string, roleId: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/admin/workspaces/${workspaceId}/roles/${roleId}`, { method: 'DELETE' }); }
  catch (e) { return toActionError(e); }
  revalidatePath(`/workspaces/${workspaceId}/settings`);
  return { ok: true };
}

export async function assignWorkspaceRole(workspaceId: string, roleId: string, userId: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/admin/workspaces/${workspaceId}/roles/${roleId}/members`, { method: 'POST', body: JSON.stringify({ userId }) }); }
  catch (e) { return toActionError(e); }
  revalidatePath(`/workspaces/${workspaceId}/settings`);
  return { ok: true };
}

export async function revokeWorkspaceRole(workspaceId: string, roleId: string, userId: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/admin/workspaces/${workspaceId}/roles/${roleId}/members/${userId}`, { method: 'DELETE' }); }
  catch (e) { return toActionError(e); }
  revalidatePath(`/workspaces/${workspaceId}/settings`);
  return { ok: true };
}
```
*(Adapt `serverFetch`/`requireSession`/`toActionError`/`ActionResult` import paths to the actual files in `src/server/` — confirmed present from `admin-roles.ts`.)*

- [ ] Run: `npm test --workspace apps/next-web -- permissions`. Expected: PASS. Then `npm run build --workspace apps/next-web` is deferred to Task 12 (components not yet present).

- [ ] Commit:
```
git add apps/next-web/src/lib/permissions.ts apps/next-web/src/lib/__tests__/permissions.unit.test.ts apps/next-web/src/server/actions/object-permissions.ts apps/next-web/src/server/actions/workspace-roles.ts
git commit -m "feat(10b): web — inherited-from helpers (+unit) + object-permission & workspace-role server actions"
```

---

### Task 11: Frontend — ObjectPermissionEditor + CustomRoleManager + i18n

**Files:**
- Create: `apps/next-web/src/components/permissions/ObjectPermissionEditor.tsx`
- Create: `apps/next-web/src/components/permissions/ObjectPermissionEditor.module.css`
- Create: `apps/next-web/src/components/permissions/CustomRoleManager.tsx`
- Create: `apps/next-web/src/components/permissions/CustomRoleManager.module.css`
- Modify: `apps/next-web/src/app/(app)/workspaces/[id]/settings/workspace-settings-view.tsx`
- Modify: `apps/next-web/src/messages/en.json`
- Modify: `apps/next-web/src/messages/id.json`

Steps:

- [ ] Write `ObjectPermissionEditor.tsx` — a client component that loads the grant list, collapses it via `groupGrantsBySubject`, renders one row per subject with the level + an "inherited from `<ancestor>`" badge, and lets a FULL controller add/change/remove a direct grant:

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { loadObjectPermissions, setObjectPermission, removeObjectPermission } from '@/server/actions/object-permissions';
import { groupGrantsBySubject, type SubjectGrantRow } from '@/lib/permissions';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { HierarchyNodeType, ObjectPermissionGrant, ObjectPermissionLevel } from '@projectflow/types';
import styles from './ObjectPermissionEditor.module.css';

const LEVELS: ObjectPermissionLevel[] = ['VIEW', 'COMMENT', 'EDIT', 'FULL'];

export function ObjectPermissionEditor({ objectType, objectId }: { objectType: HierarchyNodeType; objectId: string }) {
  const t = useTranslations('Permissions');
  const [rows, setRows] = useState<SubjectGrantRow[]>([]);
  const [raw, setRaw] = useState<ObjectPermissionGrant[]>([]);
  const [pending, start] = useTransition();

  const refetch = async () => {
    const grants = await loadObjectPermissions(objectType, objectId);
    setRaw(grants);
    setRows(groupGrantsBySubject(objectType, objectId, grants));
  };
  useEffect(() => { void refetch(); /* eslint-disable-line */ }, [objectType, objectId]);

  const onChangeLevel = (row: SubjectGrantRow, level: ObjectPermissionLevel) => start(async () => {
    const r = await setObjectPermission(objectType, objectId, { subjectType: row.subjectType, subjectId: row.subjectId, level });
    if (!r.ok) return notifyActionError(r);
    await refetch();
  });

  const onRemove = (row: SubjectGrantRow) => start(async () => {
    const r = await removeObjectPermission(objectType, objectId, { subjectType: row.subjectType, subjectId: row.subjectId });
    if (!r.ok) return notifyActionError(r);
    await refetch();
  });

  return (
    <div className={styles.root}>
      <h3 className={styles.title}>{t('objectAccessTitle')}</h3>
      {rows.length === 0 && <p className={styles.empty}>{t('noGrants')}</p>}
      <ul className={styles.list}>
        {rows.map((row) => (
          <li key={`${row.subjectType}:${row.subjectId}`} className={styles.row}>
            <span className={styles.subject}>
              {row.subjectName ?? row.subjectId}
              <small className={styles.kind}>{row.subjectType === 'ROLE' ? t('role') : t('user')}</small>
            </span>
            <select
              className={styles.levelSelect}
              value={row.effectiveLevel}
              disabled={pending}
              onChange={(e) => onChangeLevel(row, e.target.value as ObjectPermissionLevel)}
            >
              {LEVELS.map((l) => <option key={l} value={l}>{t(`level.${l}`)}</option>)}
            </select>
            {row.directGrantId === null && row.inheritedFromName && (
              <span className={styles.inherited}>{t('inheritedFrom', { name: row.inheritedFromName })}</span>
            )}
            {row.directGrantId !== null && (
              <button className={styles.remove} disabled={pending} onClick={() => onRemove(row)}>{t('remove')}</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] Write `ObjectPermissionEditor.module.css`:

```css
.root { display: flex; flex-direction: column; gap: 8px; }
.title { font-weight: 600; }
.empty { color: var(--text-2, #6b7280); font-size: 13px; }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.row { display: flex; align-items: center; gap: 10px; }
.subject { display: inline-flex; flex-direction: column; min-width: 160px; }
.kind { color: var(--text-2, #6b7280); font-size: 11px; text-transform: uppercase; }
.levelSelect { padding: 2px 6px; }
.inherited { color: var(--text-2, #6b7280); font-size: 12px; font-style: italic; }
.remove { border: none; background: transparent; color: #ef4444; cursor: pointer; }
.remove:disabled { opacity: .6; cursor: default; }
```

- [ ] Write `CustomRoleManager.tsx` — workspace-settings role manager: list system + custom roles (custom rows editable), create from a permission-slug checklist, delete:

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { loadWorkspaceRoles, createWorkspaceRole, deleteWorkspaceRole } from '@/server/actions/workspace-roles';
import { loadPermissions } from '@/server/actions/admin-roles';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { Permission, RoleWithCounts } from '@projectflow/types';
import styles from './CustomRoleManager.module.css';

export function CustomRoleManager({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('Permissions');
  const [roles, setRoles] = useState<RoleWithCounts[]>([]);
  const [perms, setPerms] = useState<Permission[]>([]);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  const refetch = async () => setRoles(await loadWorkspaceRoles(workspaceId));
  useEffect(() => { void refetch(); loadPermissions().then((p) => setPerms(p.filter((x) => x.scope === 'WORKSPACE'))); /* eslint-disable-line */ }, [workspaceId]);

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const onCreate = () => start(async () => {
    if (!name.trim()) return;
    const r = await createWorkspaceRole(workspaceId, { name: name.trim(), description: null, permissionIds: [...picked] });
    if (!r.ok) return notifyActionError(r);
    setName(''); setPicked(new Set()); await refetch();
  });

  const onDelete = (roleId: string) => start(async () => {
    const r = await deleteWorkspaceRole(workspaceId, roleId);
    if (!r.ok) return notifyActionError(r);
    await refetch();
  });

  return (
    <section className={styles.root}>
      <h2 className={styles.heading}>{t('rolesTitle')}</h2>

      <ul className={styles.roleList}>
        {roles.map((r) => (
          <li key={r.id} className={styles.roleRow}>
            <span className={styles.roleName}>{r.name}</span>
            <span className={styles.badge}>{r.isSystem ? t('system') : t('custom')}</span>
            <span className={styles.counts}>{t('counts', { perms: r.permissionCount, members: r.memberCount })}</span>
            {!r.isSystem && <button className={styles.delete} disabled={pending} onClick={() => onDelete(r.id)}>{t('delete')}</button>}
          </li>
        ))}
      </ul>

      <div className={styles.createBox}>
        <h3 className={styles.subheading}>{t('newRole')}</h3>
        <input className={styles.nameInput} value={name} placeholder={t('roleNamePlaceholder')} onChange={(e) => setName(e.target.value)} />
        <fieldset className={styles.permGrid}>
          {perms.map((p) => (
            <label key={p.id} className={styles.permLabel}>
              <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
              <span>{p.slug}</span>
            </label>
          ))}
        </fieldset>
        <button className={styles.createBtn} disabled={pending || !name.trim()} onClick={onCreate}>{t('createRole')}</button>
      </div>
    </section>
  );
}
```

- [ ] Write `CustomRoleManager.module.css`:

```css
.root { display: flex; flex-direction: column; gap: 12px; }
.heading { font-size: 18px; font-weight: 700; }
.subheading { font-weight: 600; }
.roleList { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.roleRow { display: flex; align-items: center; gap: 10px; }
.roleName { font-weight: 600; min-width: 160px; }
.badge { font-size: 11px; text-transform: uppercase; color: var(--text-2, #6b7280); }
.counts { font-size: 12px; color: var(--text-2, #6b7280); }
.delete { border: none; background: transparent; color: #ef4444; cursor: pointer; }
.createBox { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border, #e5e7eb); padding-top: 10px; }
.nameInput { padding: 4px 8px; max-width: 320px; }
.permGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 4px; border: none; margin: 0; padding: 0; }
.permLabel { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; }
.createBtn { align-self: flex-start; padding: 4px 12px; border: none; border-radius: 6px; background: #2563eb; color: #fff; cursor: pointer; }
.createBtn:disabled { opacity: .6; cursor: default; }
```

- [ ] Mount `<CustomRoleManager workspaceId={…} />` in `workspace-settings-view.tsx` — add a "Roles & permissions" section. Read the file first to find the workspace id binding + the section-rendering pattern; insert the component in a new settings section consistent with the existing layout. (The `ObjectPermissionEditor` is mounted by 10c's sharing modal + can also be surfaced from the hierarchy node context menu; for 10b, also wire it into the existing Space/List settings panel if one exists — otherwise leaving it importable for 10c is sufficient; note inline which surface it was mounted on.)

- [ ] Add the `Permissions` i18n namespace. In `en.json`:

```json
"Permissions": {
  "objectAccessTitle": "Who has access",
  "rolesTitle": "Roles & permissions",
  "noGrants": "No explicit grants. Access follows workspace roles.",
  "inheritedFrom": "Inherited from {name}",
  "remove": "Remove",
  "role": "Role",
  "user": "User",
  "system": "System",
  "custom": "Custom",
  "delete": "Delete",
  "newRole": "New custom role",
  "roleNamePlaceholder": "e.g. QA Reviewer",
  "createRole": "Create role",
  "counts": "{perms} permissions · {members} members",
  "level": {
    "VIEW": "Can view",
    "COMMENT": "Can comment",
    "EDIT": "Can edit",
    "FULL": "Full access"
  }
}
```

- [ ] Add the same keys to `id.json` with real Indonesian:

```json
"Permissions": {
  "objectAccessTitle": "Siapa yang memiliki akses",
  "rolesTitle": "Peran & izin",
  "noGrants": "Tidak ada izin eksplisit. Akses mengikuti peran ruang kerja.",
  "inheritedFrom": "Diwarisi dari {name}",
  "remove": "Hapus",
  "role": "Peran",
  "user": "Pengguna",
  "system": "Sistem",
  "custom": "Khusus",
  "delete": "Hapus",
  "newRole": "Peran khusus baru",
  "roleNamePlaceholder": "mis. Peninjau QA",
  "createRole": "Buat peran",
  "counts": "{perms} izin · {members} anggota",
  "level": {
    "VIEW": "Dapat melihat",
    "COMMENT": "Dapat mengomentari",
    "EDIT": "Dapat mengedit",
    "FULL": "Akses penuh"
  }
}
```

- [ ] Run: `npm test --workspace apps/next-web` (includes the `messages.unit` i18n parity test). Expected: PASS — en/id parity green. Then `npm run build --workspace apps/next-web`. Expected: PASS (Next build clean).

- [ ] Commit:
```
git add apps/next-web/src/components/permissions/ObjectPermissionEditor.tsx apps/next-web/src/components/permissions/ObjectPermissionEditor.module.css apps/next-web/src/components/permissions/CustomRoleManager.tsx apps/next-web/src/components/permissions/CustomRoleManager.module.css apps/next-web/src/app/(app)/workspaces/[id]/settings/workspace-settings-view.tsx apps/next-web/src/messages/en.json apps/next-web/src/messages/id.json
git commit -m "feat(10b): web — ObjectPermissionEditor (inherited-from) + CustomRoleManager in workspace settings + i18n en/id"
```

---

### Task 12: Playwright e2e (headline flow) + slice verification + DECISIONS.md

**Files:**
- Create: `apps/next-web/e2e/permissions-hardening.spec.ts`
- Modify: `DECISIONS.md` (append a Phase 10b entry)
- Note: e2e runs against local Docker `ProjectFlow_Test` only (use the project's existing e2e env/setup, same as the views/realtime specs).

Steps:

- [ ] Write the e2e spec covering the §5.4 headline flow — create a custom role, grant a user `EDIT` on one List, verify they can edit there but not in a sibling List. Follow the existing spec harness (login + seed helpers used by the views/presence specs):

```ts
import { test, expect } from '@playwright/test';
import { loginAsOwner, seedWorkspaceWithTwoLists, asUser } from './helpers'; // existing/added helpers

test.describe('Phase 10b — permissions hardening', () => {
  test('custom role + per-object EDIT grant lets a user edit one List but not its sibling', async ({ page, browser }) => {
    const { workspaceId, listA, listB, member } = await seedWorkspaceWithTwoLists(page);

    // 1) Create a custom role in workspace settings.
    await page.goto(`/workspaces/${workspaceId}/settings`);
    await page.getByPlaceholder(/QA Reviewer/i).fill('Editor Role');
    await page.getByRole('button', { name: /create role/i }).click();
    await expect(page.getByText('Editor Role')).toBeVisible();

    // 2) Grant the member EDIT on List A via the object-permission editor.
    await page.goto(`/lists/${listA.id}/settings`); // surface where ObjectPermissionEditor is mounted
    await page.getByText(/who has access/i).waitFor();
    // (add the member as a USER grant at EDIT — UI add-subject flow)
    await grantEdit(page, member);
    await expect(page.getByText(member.name)).toBeVisible();

    // 3) As the member: can edit List A...
    const memberPage = await asUser(browser, member);
    await memberPage.goto(`/lists/${listA.id}`);
    await expect(memberPage.getByRole('button', { name: /new task/i })).toBeEnabled();

    // ...but NOT the sibling List B (no grant, not a workspace member → no floor).
    await memberPage.goto(`/lists/${listB.id}`);
    await expect(memberPage.getByText(/you do not have access|not found/i)).toBeVisible();
  });
});

async function grantEdit(page: any, member: { id: string }) {
  // Implement against the editor's add-subject control; e.g. open a user picker,
  // select the member, choose EDIT. Adapt to the final ObjectPermissionEditor UI.
}
```
*(Adapt `loginAsOwner`/`seedWorkspaceWithTwoLists`/`asUser`/`grantEdit` to the project's real e2e helpers — extend the helper module used by the existing specs. The editor's "add a subject" control may need a small picker UI; if the editor as built only edits existing rows, add a minimal "add member" affordance in Task 11 and reference it here.)*

- [ ] Run: the project's e2e command for a single spec against `ProjectFlow_Test` (e.g. `npx playwright test e2e/permissions-hardening.spec.ts`). Expected: PASS (1 test) — edit-allowed on List A, denied on List B.

- [ ] Run the full slice verification on local Docker `ProjectFlow_Test`:
  - `npm test --workspace apps/api` — Expected: PASS (existing suite + `role-slug-set` unit).
  - `npm run test:integration --workspace apps/api` — Expected: PASS (existing + `custom-role`, `object-permission`, **`permission-matrix`**).
  - `npm test --workspace apps/next-web` — Expected: PASS (unit + `permissions` unit + `messages.unit` parity).
  - `npm run build --workspace apps/api` and `npm run build --workspace apps/next-web` — Expected: both PASS.
  - The permissions-hardening e2e — Expected: PASS.

- [ ] Append a `DECISIONS.md` entry logging: `Roles.WorkspaceId` (NULL=system) with scope-aware slug uniqueness (filtered indexes replacing the global `UQ`); the two new slugs (`role.manage`, `object.permission.manage`) granted to owner/admin; **`accessService.setObjectPermission` as the reusable grant primitive 10c/10d call**; the editor reuses `ObjectPermissions`/`usp_ObjectAccess_Resolve` with no new ACL table; `usp_ObjectPermission_ListForObject` walks the same ancestry as the resolver for the "inherited from" indicator; the audit-on-every-mutation wrapper (`writeAccessAudit` → `usp_AuditLog_Create`); and **the permission test matrix proving most-specific-wins over the role floor (§5.5)**. Note the adversarial security review pass (can a custom role or grant leak access across the membership boundary? — fail-closed gates + `FULL`-gated editor + non-member-no-floor verified by the matrix). DB-execution-policy note: all DB work ran ONLY against local Docker `ProjectFlow_Test`.

- [ ] Commit:
```
git add apps/next-web/e2e/permissions-hardening.spec.ts DECISIONS.md
git commit -m "test(10b): e2e — custom role + per-object EDIT grant (edit-here-not-sibling); docs: DECISIONS entry"
```

---

## Definition of Done

Per-slice DoD (spec §3) + BUILD_PLAN acceptance (spec §5.5):

- [ ] **BUILD_PLAN acceptance (§5.5):** **Most-specific permission wins over the role floor — verified with the permission test matrix** (`permission-matrix.integration.test.ts`, the full subject × grant-level/scope × visibility cross-product asserting `usp_ObjectAccess_Resolve`).
- [ ] Migration `0052_custom_roles.sql` is idempotent, GO-batched, and **reversible** via `rollback/0052_custom_roles.down.sql` (apply→rollback→re-apply verified clean); `Roles.WorkspaceId` added (NULL=system), slug uniqueness made scope-aware, `role.manage` + `object.permission.manage` seeded + granted to owner/admin.
- [ ] SP-per-op: `usp_Role_Create` (workspace-scoped) / `usp_Role_ListForWorkspace` / `usp_ObjectPermission_Set` (validated + `@GrantedBy`) / `usp_ObjectPermission_Remove` (count) / `usp_ObjectPermission_ListForObject` (inheritance chain) / `usp_Hierarchy_NodeWorkspace`; `usp_Role_List`/`usp_Role_GetById` return `WorkspaceId`.
- [ ] `accessService.setObjectPermission` is the **clean, stable grant primitive** that 10c (request-access grants) and 10d (guest grants) reuse — same signature, audited.
- [ ] System roles immutable (`IsSystem=1`); custom-role CRUD guarded by `role.manage`; the per-object editor guarded by `FULL` on the object (`object.permission.manage` seeded for completeness; the editor surface gates via `requireObjectAccess('FULL')`).
- [ ] **Every role/grant mutation writes an `AuditLog` entry** via `writeAccessAudit` → `usp_AuditLog_Create`.
- [ ] REST is the primary surface; the **GraphQL mirror** (`workspaceRoles`/`objectPermissions` queries + custom-role CRUD/assign + `setObjectPermission`/`removeObjectPermission`) delegates to the one shared `roleService`/`accessService`, fail-closed via `requireWorkspacePermission`/`requireObjectLevel`.
- [ ] Unit tests (custom-role slug-set resolution; "inherited from" computation) + integration tests (create-custom-role-then-assign → exactly its slugs; List-EDIT overrides Space-VIEW; **the matrix**) + ≥1 Playwright e2e (custom role + per-object EDIT grant; edit-here-not-sibling) — all green.
- [ ] `@projectflow/types` updated (`Role.workspaceId`; `ObjectPermissionGrant`/`SetObjectPermissionInput`/`CreateWorkspaceRoleInput`/`ObjectPermissionSubjectType`).
- [ ] i18n: new `Permissions` namespace in **en.json + id.json** (real Indonesian); `messages.unit` parity green.
- [ ] All DB work (migrations, SP deploy, integration, e2e) ran **ONLY against local Docker `ProjectFlow_Test`** — never the prod-pointing `apps/api/.env`.
- [ ] `DECISIONS.md` entry logs the mechanism choices + the adversarial security review. **Stop for review/merge before Slice 10c.**

---

## Self-Review

**Spec coverage (§5):**
- §5.1 data model — `0052_custom_roles.sql` adds `Roles.WorkspaceId` (NULL=system, non-NULL=workspace custom role); `RolePermissions`/`UserRoles`/`usp_UserPermissions_Get` resolve a custom role **unchanged** (Task 1 + verified by the `custom-role` integration's "exactly its slugs"); **no new ACL table** — the editor reads/writes the existing `ObjectPermissions` and resolves via `usp_ObjectAccess_Resolve` (Tasks 3, 7, 8); role/permission changes audited via `AuditLog` (Task 4 `writeAccessAudit`, every mutation in Tasks 4–5, 9). ✓
- §5.2 backend — `role.service` workspace-scoped custom-role CRUD + assign guarded by `role.manage`; system roles immutable (`assertWorkspaceCustomRole` + the SP's `IsSystem` guard); `access.service` `setObjectPermission`/`removeObjectPermission`/`listObjectPermissions` guarded by `FULL` on the object (Task 5 routes `requireObjectAccess('FULL')`); AuditLog on every mutation; REST + GraphQL mirror (Tasks 5, 9). ✓
- §5.3 frontend — per-object permission editor with "inherited from `<ancestor>`" indicator (Task 11 `ObjectPermissionEditor` + `groupGrantsBySubject`/`computeInheritedFrom`); custom-role manager in workspace settings (Task 11 `CustomRoleManager`). ✓
- §5.4 tests — the **permission test matrix** is a first-class enumerated parameterized vitest table over the full subject × grant-level/scope × visibility cross-product asserting `usp_ObjectAccess_Resolve` (Task 8, no abbreviation — 6×8×2 cases via complete arrays); unit: custom-role slug-set (Task 4) + "inherited from" (Task 10); integration: create-then-assign exactly-its-slugs (Task 6) + List-EDIT-over-Space-VIEW (Task 7); e2e: custom role + EDIT-on-one-List, edit-there-not-sibling (Task 12). ✓
- §5.5 acceptance — most-specific wins over the role floor, proven by the matrix (Task 8, DoD first box). ✓
- **Grant primitive** — `accessService.setObjectPermission({ … actorId … })` designed cleanly with a stable signature; explicitly flagged as the method 10c/10d reuse (DoD + DECISIONS). ✓

**Placeholder scan:** Full SQL given for the migration + rollback (Task 1) and every SP (Tasks 2–3, 5); full TS for the audit helper, role/access service extensions, repos, routes, and GraphQL mirror (Tasks 4–5, 9); full components + CSS + i18n (Task 11); the matrix test is fully enumerated via complete `SUBJECTS`/`GRANTS`/`VISIBILITIES` arrays and an `expected()` function (Task 8), not "and so on". Three places carry explicit "verify-against-real-file/helper" inline notes rather than guesses: the integration-test harness import paths (`__tests__/setup` + `fixtures`), the workspace member-add route shape, and the `setVisibility` SP (a real path required before commit) — each is a known unknown grounded in the spec, not a placeholder for invented code.

**Type/name consistency:** Slugs `role.manage` + `object.permission.manage` (spec §3, §5) used verbatim in the migration seed + REST/GraphQL gates. `ObjectPermissions` levels `VIEW|COMMENT|EDIT|FULL` and `ObjectPermissionLevel`/`HierarchyNodeType` match `packages/types/index.ts` (read). `Role` gains `workspaceId: string | null` matching the existing `mapRole`/`Role` shape; `ObjectPermissionGrant`/`SetObjectPermissionInput`/`CreateWorkspaceRoleInput`/`ObjectPermissionSubjectType` are new and consistent across types → repo mapper → service → routes → GraphQL → web helpers. SP names follow the repo's `usp_<Noun>_<Verb>` convention; `execSp`/`execSpOne` usage and `mssql` param typing match the existing `access.repository.ts`/`role.repository.ts`. AuditLog write mirrors `AdminRepository.createAuditEntry` (read). Migration number `0052` matches spec §3 (10a=`0051`).
