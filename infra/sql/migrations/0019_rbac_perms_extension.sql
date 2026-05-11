-- =============================================================================
-- Migration 0019: Extend RBAC seed with sprint and project permissions
-- =============================================================================
-- Migration 0018 seeded ~50 permission slugs but missed two resources that the
-- API surfaces as workspace-scoped writes: sprints and projects. Without these
-- the Week 28 routes can't be permission-gated cleanly.
--
-- This migration is idempotent (NOT EXISTS guards on both inserts) and can be
-- re-run safely.
-- =============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- New permissions
-- ────────────────────────────────────────────────────────────────────────────
;WITH SeedPermissions(Resource, Action, Slug, Scope, Description) AS (
    SELECT * FROM (VALUES
        ('project',  'create',   'project.create',   'WORKSPACE', 'Create projects in a workspace'),
        ('project',  'update',   'project.update',   'WORKSPACE', 'Edit project settings'),
        ('project',  'delete',   'project.delete',   'WORKSPACE', 'Delete or archive a project'),

        ('sprint',   'create',   'sprint.create',    'WORKSPACE', 'Create sprints'),
        ('sprint',   'start',    'sprint.start',     'WORKSPACE', 'Start a sprint'),
        ('sprint',   'complete', 'sprint.complete',  'WORKSPACE', 'Complete a sprint'),
        ('sprint',   'delete',   'sprint.delete',    'WORKSPACE', 'Delete a sprint')
    ) AS T(Resource, Action, Slug, Scope, Description)
)
INSERT INTO dbo.Permissions (Resource, Action, Slug, Scope, Description)
SELECT s.Resource, s.Action, s.Slug, s.Scope, s.Description
FROM SeedPermissions s
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permissions p WHERE p.Slug = s.Slug);
GO


-- ────────────────────────────────────────────────────────────────────────────
-- Grant new permissions to existing built-in roles
--   workspace-owner: every new perm
--   workspace-admin: every new perm except project.delete
--   workspace-member: project.create, sprint.create, sprint.start, sprint.complete
--                     (members commonly run the scrum ceremonies on existing
--                      projects; deletion stays admin-only)
--   workspace-viewer: none (read-only)
-- ────────────────────────────────────────────────────────────────────────────
;WITH RolePermSeed(RoleSlug, PermissionSlug) AS (
    SELECT * FROM (VALUES
        ('workspace-owner',  'project.create'),
        ('workspace-owner',  'project.update'),
        ('workspace-owner',  'project.delete'),
        ('workspace-owner',  'sprint.create'),
        ('workspace-owner',  'sprint.start'),
        ('workspace-owner',  'sprint.complete'),
        ('workspace-owner',  'sprint.delete'),

        ('workspace-admin',  'project.create'),
        ('workspace-admin',  'project.update'),
        ('workspace-admin',  'sprint.create'),
        ('workspace-admin',  'sprint.start'),
        ('workspace-admin',  'sprint.complete'),
        ('workspace-admin',  'sprint.delete'),

        ('workspace-member', 'project.create'),
        ('workspace-member', 'sprint.create'),
        ('workspace-member', 'sprint.start'),
        ('workspace-member', 'sprint.complete')
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
