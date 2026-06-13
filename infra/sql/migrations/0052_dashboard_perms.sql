-- =============================================================================
-- Migration 0052: Dashboards RBAC permissions (Phase 9a)
-- Phase 9a's REST + GraphQL surfaces gate on NEW workspace-scoped slugs that
-- 0018/0019 never seeded:
--   * dashboard.read   — list/read dashboards + resolve card data
--   * dashboard.create — create a dashboard
--   * dashboard.update — edit a dashboard, add/edit/delete/reorder cards, set-default
--   * dashboard.delete — delete a dashboard
--
-- Without these rows in dbo.Permissions + dbo.RolePermissions, requirePermission
-- (REST) and requireWorkspacePermission (GraphQL) fail-close and even a workspace
-- owner gets 403 (the exact trap that bit 8b timesheet.*, 8c sprint.manage, 8e goal.*).
--
-- Grants (read is broad incl. viewer; write tiers mirror goal.* / docs.*):
--   workspace-owner  : read + create + update + delete
--   workspace-admin  : read + create + update + delete
--   workspace-member : read + create + update
--   workspace-viewer : read
--
-- Idempotent (NOT EXISTS guards on both inserts) and re-runnable.
-- Rollback in rollback/0052_dashboard_perms.down.sql.
-- =============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- New permissions
-- ────────────────────────────────────────────────────────────────────────────
;WITH SeedPermissions(Resource, Action, Slug, Scope, Description) AS (
    SELECT * FROM (VALUES
        ('dashboard', 'read',   'dashboard.read',   'WORKSPACE', 'List and read dashboards and resolve card data'),
        ('dashboard', 'create', 'dashboard.create', 'WORKSPACE', 'Create a dashboard'),
        ('dashboard', 'update', 'dashboard.update', 'WORKSPACE', 'Edit a dashboard, manage cards, set default'),
        ('dashboard', 'delete', 'dashboard.delete', 'WORKSPACE', 'Delete a dashboard')
    ) AS T(Resource, Action, Slug, Scope, Description)
)
INSERT INTO dbo.Permissions (Resource, Action, Slug, Scope, Description)
SELECT s.Resource, s.Action, s.Slug, s.Scope, s.Description
FROM SeedPermissions s
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permissions p WHERE p.Slug = s.Slug);
GO


-- ────────────────────────────────────────────────────────────────────────────
-- Grant the new permissions to existing built-in roles
-- ────────────────────────────────────────────────────────────────────────────
;WITH RolePermSeed(RoleSlug, PermissionSlug) AS (
    SELECT * FROM (VALUES
        ('workspace-owner',  'dashboard.read'),
        ('workspace-owner',  'dashboard.create'),
        ('workspace-owner',  'dashboard.update'),
        ('workspace-owner',  'dashboard.delete'),
        ('workspace-admin',  'dashboard.read'),
        ('workspace-admin',  'dashboard.create'),
        ('workspace-admin',  'dashboard.update'),
        ('workspace-admin',  'dashboard.delete'),
        ('workspace-member', 'dashboard.read'),
        ('workspace-member', 'dashboard.create'),
        ('workspace-member', 'dashboard.update'),
        ('workspace-viewer', 'dashboard.read')
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
