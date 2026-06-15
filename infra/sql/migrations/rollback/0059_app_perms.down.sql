-- Rollback 0059: Apps / feature toggles RBAC permission.
-- Removes the app.manage grants then the slug (reverse order: RolePermissions
-- before Permissions to satisfy the FK).

DELETE rp
FROM   dbo.RolePermissions rp
JOIN   dbo.Permissions p ON p.Id = rp.PermissionId
WHERE  p.Slug = 'app.manage';
GO

DELETE FROM dbo.Permissions WHERE Slug = 'app.manage';
GO
