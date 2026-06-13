-- =============================================================================
-- Migration 0050: Goals & Targets RBAC permissions (Phase 8e)
-- =============================================================================
-- Phase 8e's REST + GraphQL write surfaces gate on NEW workspace-scoped slugs
-- that 0018/0019 never seeded:
--   * goal.create — create goal folders and goals + targets under a goal
--   * goal.update — edit goals, add/edit/delete targets
--   * goal.delete — delete goal folders and goals
--
-- Without these rows in dbo.Permissions + dbo.RolePermissions, requirePermission
-- (REST) and requireWorkspacePermission (GraphQL) fail-close and even a workspace
-- owner gets 403 on every goal write (the exact trap that bit Phase 8b's
-- timesheet.* and Phase 8c's sprint.manage).
--
-- Grants (mirror docs.* for create/update = standard member authoring, and
-- sprint.delete for delete = management tier):
--   workspace-owner  : goal.create + goal.update + goal.delete
--   workspace-admin  : goal.create + goal.update + goal.delete
--   workspace-member : goal.create + goal.update
--   workspace-viewer : (none — goal reads are auth-only, no goal.read slug)
--
-- Idempotent (NOT EXISTS guards on both inserts) and re-runnable.
-- Rollback in rollback/0050_goal_perms.down.sql.
-- =============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- New permissions
-- ────────────────────────────────────────────────────────────────────────────
;WITH SeedPermissions(Resource, Action, Slug, Scope, Description) AS (
    SELECT * FROM (VALUES
        ('goal', 'create', 'goal.create', 'WORKSPACE', 'Create goal folders, goals and targets'),
        ('goal', 'update', 'goal.update', 'WORKSPACE', 'Edit goals and add/edit/delete targets'),
        ('goal', 'delete', 'goal.delete', 'WORKSPACE', 'Delete goal folders and goals')
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
        ('workspace-owner',  'goal.create'),
        ('workspace-owner',  'goal.update'),
        ('workspace-owner',  'goal.delete'),
        ('workspace-admin',  'goal.create'),
        ('workspace-admin',  'goal.update'),
        ('workspace-admin',  'goal.delete'),
        ('workspace-member', 'goal.create'),
        ('workspace-member', 'goal.update')
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
