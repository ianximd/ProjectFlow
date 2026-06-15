CREATE OR ALTER PROCEDURE dbo.usp_Role_GetById
  @RoleId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  -- Recordset 1: the role row
  SELECT
    Id, Name, Slug, Description, Scope, IsSystem, WorkspaceId, CreatedAt, UpdatedAt
  FROM dbo.Roles
  WHERE Id = @RoleId;

  -- Recordset 2: granted permissions
  SELECT
    p.Id, p.Resource, p.Action, p.Slug, p.Scope, p.Description, p.CreatedAt
  FROM dbo.RolePermissions rp
  JOIN dbo.Permissions     p  ON p.Id = rp.PermissionId
  WHERE rp.RoleId = @RoleId
  ORDER BY p.Resource, p.Action;
END;
