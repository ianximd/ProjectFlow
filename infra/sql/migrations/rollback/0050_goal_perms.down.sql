-- Rollback 0050: goal.* RBAC permissions.
DELETE rp
FROM dbo.RolePermissions rp
JOIN dbo.Permissions p ON p.Id = rp.PermissionId
WHERE p.Slug IN ('goal.create','goal.update','goal.delete');
GO
DELETE FROM dbo.Permissions WHERE Slug IN ('goal.create','goal.update','goal.delete');
GO
