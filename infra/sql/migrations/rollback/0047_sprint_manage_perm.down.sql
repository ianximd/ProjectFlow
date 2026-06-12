-- Rollback 0047: sprint.manage RBAC permission.
DELETE rp
FROM dbo.RolePermissions rp
JOIN dbo.Permissions p ON p.Id = rp.PermissionId
WHERE p.Slug = 'sprint.manage';
GO
DELETE FROM dbo.Permissions WHERE Slug = 'sprint.manage';
GO
