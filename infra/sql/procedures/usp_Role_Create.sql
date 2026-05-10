CREATE OR ALTER PROCEDURE dbo.usp_Role_Create
  @Name        NVARCHAR(100),
  @Slug        NVARCHAR(100),
  @Description NVARCHAR(500) = NULL,
  @Scope       NVARCHAR(16)  -- 'SYSTEM' | 'WORKSPACE'
AS
BEGIN
  SET NOCOUNT ON;

  IF @Scope NOT IN ('SYSTEM','WORKSPACE')
  BEGIN
    THROW 51001, 'Scope must be SYSTEM or WORKSPACE', 1;
  END;

  IF EXISTS (SELECT 1 FROM dbo.Roles WHERE Slug = @Slug)
  BEGIN
    THROW 51002, 'Role slug already exists', 1;
  END;

  DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

  INSERT INTO dbo.Roles (Id, Name, Slug, Description, Scope, IsSystem)
  VALUES (@NewId, @Name, @Slug, @Description, @Scope, 0);

  SELECT Id, Name, Slug, Description, Scope, IsSystem, CreatedAt, UpdatedAt
  FROM dbo.Roles
  WHERE Id = @NewId;
END;
