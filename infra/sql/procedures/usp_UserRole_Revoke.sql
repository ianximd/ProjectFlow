CREATE OR ALTER PROCEDURE dbo.usp_UserRole_Revoke
  @UserId      UNIQUEIDENTIFIER,
  @RoleId      UNIQUEIDENTIFIER,
  @WorkspaceId UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;

  -- Safety: never let an admin remove the last super-admin assignment.
  IF EXISTS (
      SELECT 1
      FROM dbo.UserRoles ur
      JOIN dbo.Roles r ON r.Id = ur.RoleId
      WHERE ur.UserId = @UserId
        AND ur.RoleId = @RoleId
        AND r.Slug    = 'super-admin'
  )
  AND (
      SELECT COUNT(*)
      FROM dbo.UserRoles ur
      JOIN dbo.Roles r ON r.Id = ur.RoleId
      WHERE r.Slug = 'super-admin'
  ) <= 1
  BEGIN
    THROW 51013, 'Cannot revoke the last super-admin role', 1;
  END;

  DELETE FROM dbo.UserRoles
  WHERE UserId = @UserId
    AND RoleId = @RoleId
    AND ISNULL(WorkspaceId, '00000000-0000-0000-0000-000000000000') =
        ISNULL(@WorkspaceId,'00000000-0000-0000-0000-000000000000');

  SELECT @@ROWCOUNT AS Deleted;
END;
