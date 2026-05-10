CREATE OR ALTER PROCEDURE dbo.usp_UserRole_List
  @UserId      UNIQUEIDENTIFIER,
  @WorkspaceId UNIQUEIDENTIFIER = NULL  -- NULL = all (system + every workspace)
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    ur.UserId,
    ur.RoleId,
    r.Slug         AS RoleSlug,
    r.Name         AS RoleName,
    r.Scope        AS RoleScope,
    r.IsSystem     AS RoleIsSystem,
    ur.WorkspaceId,
    w.Name         AS WorkspaceName,
    ur.AssignedBy,
    ur.AssignedAt
  FROM dbo.UserRoles ur
  JOIN dbo.Roles          r ON r.Id = ur.RoleId
  LEFT JOIN dbo.Workspaces w ON w.Id = ur.WorkspaceId
  WHERE ur.UserId = @UserId
    AND (@WorkspaceId IS NULL
         OR ur.WorkspaceId = @WorkspaceId
         OR ur.WorkspaceId IS NULL)        -- always include system roles
  ORDER BY r.Scope, r.Name;
END;
