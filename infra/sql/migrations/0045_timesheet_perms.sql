-- =============================================================================
-- Migration 0045: Timesheet RBAC permissions (Phase 8b)
-- =============================================================================
-- Phase 8b adds the submit/approve timesheet envelope. Its REST + GraphQL
-- surfaces gate on three NEW workspace-scoped permission slugs that 0018/0019
-- never seeded:
--   * timesheet.read    — view a timesheet + its aggregate
--   * timesheet.submit  — submit a draft/rejected timesheet for review
--   * timesheet.approve — approve or reject a submitted timesheet (reviewer)
--
-- Without these rows in dbo.Permissions + dbo.RolePermissions, requirePermission
-- fail-closes and even a workspace owner gets 403 on every /timesheets call.
--
-- Grants mirror the analogous worklog permissions seeded in 0018:
--   workspace-owner : read + submit + approve (full control, like worklog.*)
--   workspace-admin : read + submit + approve (reviewers; mirrors worklog admin)
--   workspace-member: read + submit          (members log + submit their own
--                     timesheets; approval stays admin-only, like worklog.delete.any)
--   workspace-viewer: read                    (read-only, parity with *.read)
--
-- This migration is idempotent (NOT EXISTS guards on both inserts) and can be
-- re-run safely.
-- =============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- New permissions
-- ────────────────────────────────────────────────────────────────────────────
;WITH SeedPermissions(Resource, Action, Slug, Scope, Description) AS (
    SELECT * FROM (VALUES
        ('timesheet', 'read',    'timesheet.read',    'WORKSPACE', 'View timesheets and their aggregate'),
        ('timesheet', 'submit',  'timesheet.submit',  'WORKSPACE', 'Submit a draft timesheet for review'),
        ('timesheet', 'approve', 'timesheet.approve', 'WORKSPACE', 'Approve or reject a submitted timesheet')
    ) AS T(Resource, Action, Slug, Scope, Description)
)
INSERT INTO dbo.Permissions (Resource, Action, Slug, Scope, Description)
SELECT s.Resource, s.Action, s.Slug, s.Scope, s.Description
FROM SeedPermissions s
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permissions p WHERE p.Slug = s.Slug);
GO


-- ────────────────────────────────────────────────────────────────────────────
-- Grant new permissions to existing built-in roles
-- ────────────────────────────────────────────────────────────────────────────
;WITH RolePermSeed(RoleSlug, PermissionSlug) AS (
    SELECT * FROM (VALUES
        ('workspace-owner',  'timesheet.read'),
        ('workspace-owner',  'timesheet.submit'),
        ('workspace-owner',  'timesheet.approve'),

        ('workspace-admin',  'timesheet.read'),
        ('workspace-admin',  'timesheet.submit'),
        ('workspace-admin',  'timesheet.approve'),

        ('workspace-member', 'timesheet.read'),
        ('workspace-member', 'timesheet.submit'),

        ('workspace-viewer', 'timesheet.read')
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
