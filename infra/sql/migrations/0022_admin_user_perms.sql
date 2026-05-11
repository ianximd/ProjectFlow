-- =============================================================================
-- Migration 0022: Admin user-management permission slugs
-- =============================================================================
-- 0018 seeded admin.users.read and admin.users.suspend. The new admin UI adds
-- create / edit / hard-delete / reset-password / reset-mfa actions, each of
-- which needs its own slug so an org can grant a help-desk user the recovery
-- ones (reset_password, reset_mfa) without granting full delete.
--
-- Idempotent: NOT EXISTS guards on both inserts.
-- =============================================================================


-- ── New permissions ──────────────────────────────────────────────────────────
;WITH SeedPermissions(Resource, Action, Slug, Scope, Description) AS (
    SELECT * FROM (VALUES
        ('admin', 'users.create',         'admin.users.create',         'SYSTEM', 'Create user accounts directly (skips self-registration)'),
        ('admin', 'users.update',         'admin.users.update',         'SYSTEM', 'Edit a user''s name or email'),
        ('admin', 'users.delete',         'admin.users.delete',         'SYSTEM', 'Permanently delete a user (only when no references remain)'),
        ('admin', 'users.reset_password', 'admin.users.reset_password', 'SYSTEM', 'Force-reset a user''s password to a temporary value'),
        ('admin', 'users.reset_mfa',      'admin.users.reset_mfa',      'SYSTEM', 'Disable MFA and clear lockout state for account recovery')
    ) AS T(Resource, Action, Slug, Scope, Description)
)
INSERT INTO dbo.Permissions (Resource, Action, Slug, Scope, Description)
SELECT s.Resource, s.Action, s.Slug, s.Scope, s.Description
FROM SeedPermissions s
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permissions p WHERE p.Slug = s.Slug);
GO


-- ── Grant to built-in admin roles ────────────────────────────────────────────
--   super-admin: every new perm
--   user-admin:  every new perm (this role is the user-mgmt specialist)
;WITH RolePermSeed(RoleSlug, PermissionSlug) AS (
    SELECT * FROM (VALUES
        ('super-admin', 'admin.users.create'),
        ('super-admin', 'admin.users.update'),
        ('super-admin', 'admin.users.delete'),
        ('super-admin', 'admin.users.reset_password'),
        ('super-admin', 'admin.users.reset_mfa'),

        ('user-admin',  'admin.users.create'),
        ('user-admin',  'admin.users.update'),
        ('user-admin',  'admin.users.delete'),
        ('user-admin',  'admin.users.reset_password'),
        ('user-admin',  'admin.users.reset_mfa')
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
