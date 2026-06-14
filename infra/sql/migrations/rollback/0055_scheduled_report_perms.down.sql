-- Rollback 0055: scheduled-report RBAC permission.
-- Remove the role grants then the permission row. Idempotent.

DELETE rp
FROM dbo.RolePermissions rp
JOIN dbo.Permissions p ON p.Id = rp.PermissionId
WHERE p.Slug = 'scheduled_report.manage';
GO

DELETE FROM dbo.Permissions WHERE Slug = 'scheduled_report.manage';
GO
