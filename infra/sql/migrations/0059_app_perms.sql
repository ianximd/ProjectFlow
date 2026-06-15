-- =============================================================================
-- Migration 0059: Apps / feature toggles RBAC permission (Phase 10a)
-- Phase 10a's App Center write path (PATCH /apps/:scope/:key REST +
-- setAppToggle GraphQL) gates on a NEW workspace-scoped slug 0018/0019 never
-- seeded:
--   * app.manage — enable or disable feature apps for a workspace/space/folder/list
--
-- Without this row in dbo.Permissions + dbo.RolePermissions, requirePermission
-- (REST) and requireWorkspacePermission (GraphQL) fail-close and even a workspace
-- owner gets 403 (the exact trap that bit 8b timesheet.*, 8c sprint.manage,
-- 8e goal.*, 9a dashboard.*). Toggling apps is an administrative act, so the
-- grant is owner+admin only (members/viewers cannot change feature availability;
-- writes are additionally double-gated by FULL on the scope object).
--
-- Idempotent (NOT EXISTS guards on both inserts) and re-runnable.
-- Rollback in rollback/0059_app_perms.down.sql.
-- =============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- New permission
-- ────────────────────────────────────────────────────────────────────────────
;WITH SeedPermissions(Resource, Action, Slug, Scope, Description) AS (
    SELECT * FROM (VALUES
        ('app', 'manage', 'app.manage', 'WORKSPACE', 'Enable or disable feature apps for a workspace/space/folder/list')
    ) AS T(Resource, Action, Slug, Scope, Description)
)
INSERT INTO dbo.Permissions (Resource, Action, Slug, Scope, Description)
SELECT s.Resource, s.Action, s.Slug, s.Scope, s.Description
FROM SeedPermissions s
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permissions p WHERE p.Slug = s.Slug);
GO


-- ────────────────────────────────────────────────────────────────────────────
-- Grant the new permission to the administrative built-in roles
-- ────────────────────────────────────────────────────────────────────────────
;WITH RolePermSeed(RoleSlug, PermissionSlug) AS (
    SELECT * FROM (VALUES
        ('workspace-owner', 'app.manage'),
        ('workspace-admin', 'app.manage')
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
