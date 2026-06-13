-- Rollback 0052: dashboard.* RBAC permissions.
DELETE rp
FROM dbo.RolePermissions rp
JOIN dbo.Permissions p ON p.Id = rp.PermissionId
WHERE p.Slug IN ('dashboard.read','dashboard.create','dashboard.update','dashboard.delete');
GO
DELETE FROM dbo.Permissions WHERE Slug IN ('dashboard.read','dashboard.create','dashboard.update','dashboard.delete');
GO
