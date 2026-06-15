-- =============================================================================
-- Migration 0060: Workspace-scoped custom roles (Phase 10b)
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
-- Rollback in rollback/0060_custom_roles.down.sql.
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
