CREATE OR ALTER PROCEDURE dbo.usp_UserPermissions_Get
  @UserId      UNIQUEIDENTIFIER,
  @WorkspaceId UNIQUEIDENTIFIER = NULL  -- NULL = system perms only
AS
BEGIN
  SET NOCOUNT ON;

  -- A user's effective permissions are the union of:
  --   * permissions from every SYSTEM role they hold (always included)
  --   * permissions from every WORKSPACE role they hold for the given workspace
  -- Returned as distinct slugs so the API can build a Set<string>.
  SELECT DISTINCT p.Slug, p.Scope
  FROM dbo.UserRoles      ur
  JOIN dbo.Roles          r  ON r.Id = ur.RoleId
  JOIN dbo.RolePermissions rp ON rp.RoleId = r.Id
  JOIN dbo.Permissions    p  ON p.Id = rp.PermissionId
  WHERE ur.UserId = @UserId
    AND (
          r.Scope = 'SYSTEM'
          OR (r.Scope = 'WORKSPACE' AND @WorkspaceId IS NOT NULL AND ur.WorkspaceId = @WorkspaceId)
        )
  ORDER BY p.Scope, p.Slug;
END;
