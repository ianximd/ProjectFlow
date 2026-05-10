CREATE OR ALTER PROCEDURE dbo.usp_Role_Delete
  @RoleId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (SELECT 1 FROM dbo.Roles WHERE Id = @RoleId AND IsSystem = 1)
  BEGIN
    THROW 51004, 'Cannot delete a built-in role', 1;
  END;

  -- ON DELETE CASCADE on RolePermissions cleans the permission links.
  -- UserRoles intentionally has no cascade — block delete if assignments exist
  -- so admins must explicitly revoke users first.
  IF EXISTS (SELECT 1 FROM dbo.UserRoles WHERE RoleId = @RoleId)
  BEGIN
    THROW 51005, 'Role has active assignments — revoke them first', 1;
  END;

  DELETE FROM dbo.Roles WHERE Id = @RoleId;
  SELECT @@ROWCOUNT AS Deleted;
END;
