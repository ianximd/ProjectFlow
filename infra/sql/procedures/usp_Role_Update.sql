CREATE OR ALTER PROCEDURE dbo.usp_Role_Update
  @RoleId      UNIQUEIDENTIFIER,
  @Name        NVARCHAR(100) = NULL,
  @Description NVARCHAR(500) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  -- Built-in roles can have their description edited but not their name/slug.
  DECLARE @IsSystem BIT;
  SELECT @IsSystem = IsSystem FROM dbo.Roles WHERE Id = @RoleId;

  IF @IsSystem IS NULL
  BEGIN
    THROW 51003, 'Role not found', 1;
  END;

  UPDATE dbo.Roles
  SET
    Name        = CASE WHEN @IsSystem = 1 THEN Name        ELSE COALESCE(@Name, Name) END,
    Description = COALESCE(@Description, Description),
    UpdatedAt   = SYSUTCDATETIME()
  WHERE Id = @RoleId;

  SELECT Id, Name, Slug, Description, Scope, IsSystem, WorkspaceId, CreatedAt, UpdatedAt
  FROM dbo.Roles
  WHERE Id = @RoleId;
END;
