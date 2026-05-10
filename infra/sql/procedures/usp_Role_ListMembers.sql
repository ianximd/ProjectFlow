CREATE OR ALTER PROCEDURE dbo.usp_Role_ListMembers
  @RoleId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    u.Id          AS UserId,
    u.Email,
    u.Name,
    u.AvatarUrl,
    ur.WorkspaceId,
    w.Name        AS WorkspaceName,
    ur.AssignedBy,
    ur.AssignedAt
  FROM dbo.UserRoles ur
  JOIN dbo.Users          u ON u.Id = ur.UserId
  LEFT JOIN dbo.Workspaces w ON w.Id = ur.WorkspaceId
  WHERE ur.RoleId = @RoleId
  ORDER BY u.Name, w.Name;
END;
