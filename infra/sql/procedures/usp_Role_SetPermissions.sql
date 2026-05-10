CREATE OR ALTER PROCEDURE dbo.usp_Role_SetPermissions
  @RoleId         UNIQUEIDENTIFIER,
  @PermissionIds  NVARCHAR(MAX)  -- JSON array of permission UUIDs, e.g. '["...","..."]'
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @RoleScope NVARCHAR(16);
  SELECT @RoleScope = Scope FROM dbo.Roles WHERE Id = @RoleId;
  IF @RoleScope IS NULL
  BEGIN
    THROW 51003, 'Role not found', 1;
  END;

  -- Parse JSON into a temp table of UUIDs.
  DECLARE @Wanted TABLE (PermissionId UNIQUEIDENTIFIER PRIMARY KEY);
  INSERT INTO @Wanted (PermissionId)
  SELECT DISTINCT CAST(value AS UNIQUEIDENTIFIER)
  FROM OPENJSON(@PermissionIds);

  -- Reject any permission whose scope doesn't match the role.
  IF EXISTS (
    SELECT 1
    FROM @Wanted w
    JOIN dbo.Permissions p ON p.Id = w.PermissionId
    WHERE p.Scope <> @RoleScope
  )
  BEGIN
    THROW 51006, 'One or more permissions do not match the role scope', 1;
  END;

  -- Reject any permission UUID that doesn't exist.
  IF EXISTS (
    SELECT 1
    FROM @Wanted w
    WHERE NOT EXISTS (SELECT 1 FROM dbo.Permissions p WHERE p.Id = w.PermissionId)
  )
  BEGIN
    THROW 51007, 'Unknown permission id', 1;
  END;

  BEGIN TRANSACTION;

    -- Remove permissions no longer wanted.
    DELETE rp
    FROM dbo.RolePermissions rp
    WHERE rp.RoleId = @RoleId
      AND NOT EXISTS (SELECT 1 FROM @Wanted w WHERE w.PermissionId = rp.PermissionId);

    -- Add new permissions.
    INSERT INTO dbo.RolePermissions (RoleId, PermissionId)
    SELECT @RoleId, w.PermissionId
    FROM @Wanted w
    WHERE NOT EXISTS (
      SELECT 1 FROM dbo.RolePermissions rp
      WHERE rp.RoleId = @RoleId AND rp.PermissionId = w.PermissionId
    );

    UPDATE dbo.Roles SET UpdatedAt = SYSUTCDATETIME() WHERE Id = @RoleId;

  COMMIT TRANSACTION;

  -- Return the updated permission set.
  SELECT
    p.Id, p.Resource, p.Action, p.Slug, p.Scope, p.Description, p.CreatedAt
  FROM dbo.RolePermissions rp
  JOIN dbo.Permissions     p  ON p.Id = rp.PermissionId
  WHERE rp.RoleId = @RoleId
  ORDER BY p.Resource, p.Action;
END;
