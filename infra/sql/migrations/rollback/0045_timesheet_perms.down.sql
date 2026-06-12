-- Rollback 0045: timesheet RBAC permissions.
-- Removes the RolePermissions grants then the Permissions rows for the three
-- timesheet slugs. Idempotent — safe to re-run.

DELETE rp
FROM dbo.RolePermissions rp
JOIN dbo.Permissions p ON p.Id = rp.PermissionId
WHERE p.Slug IN ('timesheet.read', 'timesheet.submit', 'timesheet.approve');
GO

DELETE FROM dbo.Permissions
WHERE Slug IN ('timesheet.read', 'timesheet.submit', 'timesheet.approve');
GO
