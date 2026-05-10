CREATE OR ALTER PROCEDURE dbo.usp_UserRole_Assign
  @UserId      UNIQUEIDENTIFIER,
  @RoleId      UNIQUEIDENTIFIER,
  @WorkspaceId UNIQUEIDENTIFIER = NULL,
  @AssignedBy  UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @RoleScope NVARCHAR(16);
  SELECT @RoleScope = Scope FROM dbo.Roles WHERE Id = @RoleId;
  IF @RoleScope IS NULL
  BEGIN
    THROW 51003, 'Role not found', 1;
  END;

  -- A SYSTEM role must not have a workspace; a WORKSPACE role must have one.
  IF (@RoleScope = 'SYSTEM' AND @WorkspaceId IS NOT NULL)
  BEGIN
    THROW 51008, 'System roles cannot be scoped to a workspace', 1;
  END;
  IF (@RoleScope = 'WORKSPACE' AND @WorkspaceId IS NULL)
  BEGIN
    THROW 51009, 'Workspace roles require a WorkspaceId', 1;
  END;

  -- User and (when relevant) workspace must exist.
  IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE Id = @UserId)
  BEGIN
    THROW 51010, 'User not found', 1;
  END;
  IF @WorkspaceId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.Workspaces WHERE Id = @WorkspaceId)
  BEGIN
    THROW 51011, 'Workspace not found', 1;
  END;

  -- Idempotent insert via NOT EXISTS (composite PK already prevents dupes,
  -- but this lets us return the row whether or not it was newly inserted).
  IF NOT EXISTS (
    SELECT 1 FROM dbo.UserRoles
    WHERE UserId = @UserId AND RoleId = @RoleId
      AND ISNULL(WorkspaceId, '00000000-0000-0000-0000-000000000000') =
          ISNULL(@WorkspaceId, '00000000-0000-0000-0000-000000000000')
  )
  BEGIN
    INSERT INTO dbo.UserRoles (UserId, RoleId, WorkspaceId, AssignedBy)
    VALUES (@UserId, @RoleId, @WorkspaceId, @AssignedBy);
  END;

  SELECT
    ur.UserId, ur.RoleId, ur.WorkspaceId, ur.AssignedBy, ur.AssignedAt,
    r.Slug AS RoleSlug, r.Name AS RoleName, r.Scope AS RoleScope, r.IsSystem AS RoleIsSystem
  FROM dbo.UserRoles ur
  JOIN dbo.Roles r ON r.Id = ur.RoleId
  WHERE ur.UserId = @UserId AND ur.RoleId = @RoleId
    AND ISNULL(ur.WorkspaceId, '00000000-0000-0000-0000-000000000000') =
        ISNULL(@WorkspaceId,    '00000000-0000-0000-0000-000000000000');
END;
