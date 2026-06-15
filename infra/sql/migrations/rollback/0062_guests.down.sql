-- =============================================================================
-- Rollback for 0062_guests.sql. Run manually (forward-only runner). Idempotent.
-- Reverses: Workspaces.VerifiedDomain, WorkspaceMembers.IsGuest, GuestInvites,
-- the two system roles + their RolePermissions, and the new permission slugs.
-- =============================================================================

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'GuestInvites') DROP TABLE dbo.GuestInvites;
GO

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_WorkspaceMembers_IsGuest')
    ALTER TABLE dbo.WorkspaceMembers DROP CONSTRAINT DF_WorkspaceMembers_IsGuest;
IF COL_LENGTH('dbo.WorkspaceMembers', 'IsGuest') IS NOT NULL
    ALTER TABLE dbo.WorkspaceMembers DROP COLUMN IsGuest;
GO

IF COL_LENGTH('dbo.Workspaces', 'VerifiedDomain') IS NOT NULL
    ALTER TABLE dbo.Workspaces DROP COLUMN VerifiedDomain;
GO

-- Un-seed RolePermissions for the two guest roles, then dangling UserRoles, then
-- the Roles, then their permission slugs. Scope to system roles (WorkspaceId NULL).
DELETE rp FROM dbo.RolePermissions rp
JOIN dbo.Roles r ON r.Id = rp.RoleId
WHERE r.Slug IN ('workspace-guest', 'workspace-limited-member') AND r.WorkspaceId IS NULL;
GO
DELETE ur FROM dbo.UserRoles ur
JOIN dbo.Roles r ON r.Id = ur.RoleId
WHERE r.Slug IN ('workspace-guest', 'workspace-limited-member') AND r.WorkspaceId IS NULL;
GO
DELETE FROM dbo.Roles WHERE Slug IN ('workspace-guest', 'workspace-limited-member') AND WorkspaceId IS NULL;
GO
DELETE FROM dbo.Permissions WHERE Slug IN ('guest.invite', 'guest.manage');
GO

DELETE FROM dbo.MigrationHistory WHERE [FileName] = '0062_guests.sql';
GO
