CREATE OR ALTER PROCEDURE dbo.usp_Role_ListForWorkspace
  @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  -- The custom-role-manager data source: the WORKSPACE-scoped system roles
  -- (assignable everywhere, WorkspaceId IS NULL) plus this workspace's own
  -- custom roles, each with permission/member counts.
  SELECT
    r.Id, r.Name, r.Slug, r.Description, r.Scope, r.IsSystem, r.WorkspaceId,
    r.CreatedAt, r.UpdatedAt,
    (SELECT COUNT(*) FROM dbo.RolePermissions rp WHERE rp.RoleId = r.Id) AS PermissionCount,
    (SELECT COUNT(*) FROM dbo.UserRoles ur
       WHERE ur.RoleId = r.Id AND (ur.WorkspaceId = @WorkspaceId OR ur.WorkspaceId IS NULL)) AS MemberCount
  FROM dbo.Roles r
  WHERE r.Scope = 'WORKSPACE'
    AND (r.WorkspaceId IS NULL OR r.WorkspaceId = @WorkspaceId)
  ORDER BY r.IsSystem DESC, r.Name;
END;
