-- =============================================================================
-- Migration 0053: Reports RBAC permission (Phase 9b)
-- The reports module had NO authz (its REST routes were ungated — any
-- authenticated user could read any workspace's reports). Phase 9b adds a
-- GraphQL mirror that MUST gate on a slug, and retro-gates the REST routes on
-- the same slug to close that pre-existing cross-tenant read (IDOR).
--   * report.read — read any report (burndown/velocity/sprint-summary/workload/
--                    created-vs-resolved + burnup/cumulative-flow/lead-cycle-time/
--                    portfolio) for a workspace; also resolves report card data.
--
-- Without this row in dbo.Permissions + dbo.RolePermissions, requirePermission
-- (REST) and requireWorkspacePermission (GraphQL) fail-close and even a workspace
-- owner gets 403 (the trap that bit 8b timesheet.*, 8c sprint.manage, 8e goal.*,
-- 9a dashboard.*). Reports are read-only, so the grant is broad (incl. viewer),
-- mirroring dashboard.read.
--
-- Idempotent (NOT EXISTS guards on both inserts) and re-runnable.
-- Rollback in rollback/0053_report_perms.down.sql.
-- =============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- New permission
-- ────────────────────────────────────────────────────────────────────────────
;WITH SeedPermissions(Resource, Action, Slug, Scope, Description) AS (
    SELECT * FROM (VALUES
        ('report', 'read', 'report.read', 'WORKSPACE', 'Read reports/analytics and resolve report card data')
    ) AS T(Resource, Action, Slug, Scope, Description)
)
INSERT INTO dbo.Permissions (Resource, Action, Slug, Scope, Description)
SELECT s.Resource, s.Action, s.Slug, s.Scope, s.Description
FROM SeedPermissions s
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permissions p WHERE p.Slug = s.Slug);
GO


-- ────────────────────────────────────────────────────────────────────────────
-- Grant the new permission to existing built-in roles (read is broad)
-- ────────────────────────────────────────────────────────────────────────────
;WITH RolePermSeed(RoleSlug, PermissionSlug) AS (
    SELECT * FROM (VALUES
        ('workspace-owner',  'report.read'),
        ('workspace-admin',  'report.read'),
        ('workspace-member', 'report.read'),
        ('workspace-viewer', 'report.read')
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
