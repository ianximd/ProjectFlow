-- =============================================================================
-- Migration 0055: Scheduled-report RBAC permission (Phase 9c)
-- The scheduled-reports REST routes + GraphQL mirror gate every operation
-- (list/create/update/delete/run-history/snapshot) on a SINGLE workspace slug
-- `scheduled_report.manage`. Without this row in dbo.Permissions +
-- dbo.RolePermissions, requirePermission (REST) and requireWorkspacePermission
-- (GraphQL) fail-close and even a workspace owner gets 403 (the exact trap that
-- bit 8b timesheet.*, 8c sprint.manage, 8e goal.*, 9a dashboard.*, 9b report.read).
--
--   * scheduled_report.manage — create/edit/delete scheduled report deliveries
--     and read their run history/snapshots, for a workspace.
--
-- Managing a recurring delivery is a write-capable, configuration action, so the
-- grant is narrower than the broad read-only report.read: owner + admin + member
-- (members own dashboards/reports and may schedule their delivery); VIEWER is
-- excluded (read-only role cannot configure deliveries; the single manage slug
-- gates reads too, so viewers see no schedule editor — acceptable, see DECISIONS).
--
-- Idempotent (NOT EXISTS guards on both inserts) and re-runnable.
-- Rollback in rollback/0055_scheduled_report_perms.down.sql.
-- =============================================================================


-- New permission
;WITH SeedPermissions(Resource, Action, Slug, Scope, Description) AS (
    SELECT * FROM (VALUES
        ('scheduled_report', 'manage', 'scheduled_report.manage', 'WORKSPACE', 'Create/edit/delete scheduled report deliveries and read their run history')
    ) AS T(Resource, Action, Slug, Scope, Description)
)
INSERT INTO dbo.Permissions (Resource, Action, Slug, Scope, Description)
SELECT s.Resource, s.Action, s.Slug, s.Scope, s.Description
FROM SeedPermissions s
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permissions p WHERE p.Slug = s.Slug);
GO


-- Grant the new permission to existing built-in roles (manage excludes viewer)
;WITH RolePermSeed(RoleSlug, PermissionSlug) AS (
    SELECT * FROM (VALUES
        ('workspace-owner',  'scheduled_report.manage'),
        ('workspace-admin',  'scheduled_report.manage'),
        ('workspace-member', 'scheduled_report.manage')
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
