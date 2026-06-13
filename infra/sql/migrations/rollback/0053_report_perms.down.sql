-- Rollback 0053: report.* RBAC permission.
DELETE rp
FROM dbo.RolePermissions rp
JOIN dbo.Permissions p ON p.Id = rp.PermissionId
WHERE p.Slug IN ('report.read');
GO
DELETE FROM dbo.Permissions WHERE Slug IN ('report.read');
GO
