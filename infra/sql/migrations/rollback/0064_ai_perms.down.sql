-- Rollback for 0064_ai_perms.sql
-- Removes ai.use from RolePermissions, Permissions, and MigrationHistory.

DELETE rp FROM dbo.RolePermissions rp
  JOIN dbo.Permissions p ON p.Id = rp.PermissionId WHERE p.Slug = 'ai.use';
GO
DELETE FROM dbo.Permissions WHERE Slug = 'ai.use';
GO
DELETE FROM dbo.MigrationHistory WHERE [FileName] = '0064_ai_perms.sql';
GO
