-- Rollback 0060: Workspace-scoped custom roles.
-- Removes the seeded role.manage/object.permission.manage grants + permissions,
-- the new indexes + FK, restores global Slug uniqueness, and drops WorkspaceId.
-- WARNING: drops every workspace custom role (WorkspaceId IS NOT NULL) and its
-- assignments — run only against ProjectFlow_Test.

DELETE rp FROM dbo.RolePermissions rp
JOIN dbo.Permissions p ON p.Id = rp.PermissionId
WHERE p.Slug IN ('role.manage', 'object.permission.manage');
GO

-- Custom roles must go before the column drop (FK + index references).
DELETE ur FROM dbo.UserRoles ur
JOIN dbo.Roles r ON r.Id = ur.RoleId WHERE r.WorkspaceId IS NOT NULL;
DELETE FROM dbo.Roles WHERE WorkspaceId IS NOT NULL;
GO

DELETE FROM dbo.Permissions WHERE Slug IN ('role.manage', 'object.permission.manage');
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Roles_WorkspaceId' AND object_id = OBJECT_ID('dbo.Roles'))
    DROP INDEX IX_Roles_WorkspaceId ON dbo.Roles;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Roles_Slug_Workspace' AND object_id = OBJECT_ID('dbo.Roles'))
    DROP INDEX UQ_Roles_Slug_Workspace ON dbo.Roles;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Roles_Slug_System' AND object_id = OBJECT_ID('dbo.Roles'))
    DROP INDEX UQ_Roles_Slug_System ON dbo.Roles;
GO

-- Restore the original global UNIQUE constraint on Slug (matches 0018).
IF NOT EXISTS (
    SELECT 1 FROM sys.key_constraints kc
    JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
    JOIN sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id
    WHERE kc.parent_object_id = OBJECT_ID('dbo.Roles') AND kc.type = 'UQ' AND col.name = 'Slug'
)
    ALTER TABLE dbo.Roles ADD CONSTRAINT UQ_Roles_Slug UNIQUE (Slug);
GO

IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Roles_Workspace')
    ALTER TABLE dbo.Roles DROP CONSTRAINT FK_Roles_Workspace;
GO

IF COL_LENGTH('dbo.Roles', 'WorkspaceId') IS NOT NULL
    ALTER TABLE dbo.Roles DROP COLUMN WorkspaceId;
GO
