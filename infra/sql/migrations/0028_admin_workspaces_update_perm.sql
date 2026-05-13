-- =============================================================================
-- Migration 0028: admin.workspaces.update permission
-- =============================================================================
-- Migration 0027 added the Workspaces.Status enum. The admin route that
-- mutates it (POST /admin/workspaces/:id/status) needs a permission
-- distinct from the read + delete permissions seeded in 0018_rbac.sql.
--
-- This migration:
--   1. Inserts the permission if absent
--   2. Grants it to the super-admin role if not already granted
--
-- Pattern matches the seed in 0018 — idempotent so a re-run on a deployed
-- environment is a no-op.
-- =============================================================================

-- 1. Permission row
IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE Slug = 'admin.workspaces.update')
BEGIN
    INSERT INTO dbo.Permissions (Resource, Action, Slug, Scope, Description)
    VALUES ('admin', 'workspaces.update', 'admin.workspaces.update', 'SYSTEM',
            'Edit any workspace (e.g. change Status / Plan / etc.)');
END
GO

-- 2. Grant to super-admin
IF NOT EXISTS (
    SELECT 1
    FROM   dbo.RolePermissions rp
    JOIN   dbo.Roles r       ON r.Id = rp.RoleId
    JOIN   dbo.Permissions p ON p.Id = rp.PermissionId
    WHERE  r.Slug = 'super-admin' AND p.Slug = 'admin.workspaces.update'
)
BEGIN
    INSERT INTO dbo.RolePermissions (RoleId, PermissionId)
    SELECT r.Id, p.Id
    FROM   dbo.Roles r CROSS JOIN dbo.Permissions p
    WHERE  r.Slug = 'super-admin' AND p.Slug = 'admin.workspaces.update';
END
GO
