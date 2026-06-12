-- =============================================================================
-- Migration 0047: Sprint-management RBAC permission (Phase 8c)
-- =============================================================================
-- Phase 8c adds sprint-folder settings + roll-forward. Its REST + GraphQL
-- surfaces gate on a NEW workspace-scoped permission slug that 0018/0019 never
-- seeded:
--   * sprint.manage — configure sprint-folder cadence/auto flags + roll a
--                     sprint's unfinished tasks forward.
--
-- Without this row in dbo.Permissions + dbo.RolePermissions, requirePermission
-- fail-closes and even a workspace owner gets 403 on every sprint-folder
-- settings / roll-forward call (the exact trap that bit Phase 8b's timesheet.*).
--
-- Grants follow the management tier of the existing sprint.* slugs seeded in
-- 0019 (sprint.delete is owner+admin only — settings/roll-forward are likewise
-- management operations, not day-to-day member actions):
--   workspace-owner : sprint.manage
--   workspace-admin : sprint.manage
--
-- Idempotent (NOT EXISTS guards on both inserts) and re-runnable.
-- Rollback in rollback/0047_sprint_manage_perm.down.sql.
-- =============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- New permission
-- ────────────────────────────────────────────────────────────────────────────
;WITH SeedPermissions(Resource, Action, Slug, Scope, Description) AS (
    SELECT * FROM (VALUES
        ('sprint', 'manage', 'sprint.manage', 'WORKSPACE', 'Configure sprint-folder cadence and roll sprints forward')
    ) AS T(Resource, Action, Slug, Scope, Description)
)
INSERT INTO dbo.Permissions (Resource, Action, Slug, Scope, Description)
SELECT s.Resource, s.Action, s.Slug, s.Scope, s.Description
FROM SeedPermissions s
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permissions p WHERE p.Slug = s.Slug);
GO


-- ────────────────────────────────────────────────────────────────────────────
-- Grant the new permission to existing built-in roles
-- ────────────────────────────────────────────────────────────────────────────
;WITH RolePermSeed(RoleSlug, PermissionSlug) AS (
    SELECT * FROM (VALUES
        ('workspace-owner', 'sprint.manage'),
        ('workspace-admin', 'sprint.manage')
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
