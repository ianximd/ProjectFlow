CREATE OR ALTER PROCEDURE dbo.usp_Role_Create
  @Name        NVARCHAR(100),
  @Slug        NVARCHAR(100),
  @Description NVARCHAR(500)    = NULL,
  @Scope       NVARCHAR(16),                 -- 'SYSTEM' | 'WORKSPACE'
  @WorkspaceId UNIQUEIDENTIFIER = NULL       -- NULL = system/global role; non-NULL = workspace custom role
AS
BEGIN
  SET NOCOUNT ON;

  IF @Scope NOT IN ('SYSTEM','WORKSPACE')
  BEGIN
    THROW 51001, 'Scope must be SYSTEM or WORKSPACE', 1;
  END;

  -- A workspace custom role must be WORKSPACE-scoped.
  IF @WorkspaceId IS NOT NULL AND @Scope <> 'WORKSPACE'
  BEGIN
    THROW 51006, 'A workspace custom role must be WORKSPACE-scoped', 1;
  END;

  -- Slug uniqueness is scope-aware (mirrors the 0060 filtered indexes).
  IF @WorkspaceId IS NULL AND EXISTS (SELECT 1 FROM dbo.Roles WHERE Slug = @Slug AND WorkspaceId IS NULL)
  BEGIN
    THROW 51002, 'Role slug already exists', 1;
  END;
  IF @WorkspaceId IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.Roles WHERE Slug = @Slug AND WorkspaceId = @WorkspaceId)
  BEGIN
    THROW 51002, 'Role slug already exists in this workspace', 1;
  END;

  DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

  INSERT INTO dbo.Roles (Id, Name, Slug, Description, Scope, IsSystem, WorkspaceId)
  VALUES (@NewId, @Name, @Slug, @Description, @Scope, 0, @WorkspaceId);

  SELECT Id, Name, Slug, Description, Scope, IsSystem, WorkspaceId, CreatedAt, UpdatedAt
  FROM dbo.Roles
  WHERE Id = @NewId;
END;
