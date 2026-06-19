-- =============================================================================
-- Migration 0064: AI feature permission (Phase 11a)
-- Seeds a new workspace-scoped permission for AI features:
--   * ai.use — Use AI features (search, ask, summarize, write)
--
-- Granted to workspace-owner, workspace-admin, and workspace-member.
-- workspace-viewer is intentionally excluded (read-only role, no AI generation).
--
-- Idempotent (NOT EXISTS guards on both inserts) and re-runnable.
-- Rollback in rollback/0064_ai_perms.down.sql.
-- =============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- New permission
-- ────────────────────────────────────────────────────────────────────────────
;WITH SeedPermissions(Resource, Action, Slug, Scope, Description) AS (
    SELECT * FROM (VALUES
        ('ai', 'use', 'ai.use', 'WORKSPACE', 'Use AI features (search, ask, summarize, write)')
    ) AS T(Resource, Action, Slug, Scope, Description)
)
INSERT INTO dbo.Permissions (Resource, Action, Slug, Scope, Description)
SELECT s.Resource, s.Action, s.Slug, s.Scope, s.Description
FROM SeedPermissions s
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permissions p WHERE p.Slug = s.Slug);
GO


-- ────────────────────────────────────────────────────────────────────────────
-- Grant the new permission to owner, admin, and member roles
-- ────────────────────────────────────────────────────────────────────────────
;WITH RolePermSeed(RoleSlug, PermissionSlug) AS (
    SELECT * FROM (VALUES
        ('workspace-owner',  'ai.use'),
        ('workspace-admin',  'ai.use'),
        ('workspace-member', 'ai.use')
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
