CREATE OR ALTER PROCEDURE dbo.usp_UserRole_AssignBySlug
  @UserId      UNIQUEIDENTIFIER,
  @RoleSlug    NVARCHAR(100),
  @WorkspaceId UNIQUEIDENTIFIER = NULL,
  @AssignedBy  UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @RoleId UNIQUEIDENTIFIER;
  SELECT @RoleId = Id FROM dbo.Roles WHERE Slug = @RoleSlug;
  IF @RoleId IS NULL
  BEGIN
    THROW 51012, 'Unknown role slug', 1;
  END;

  EXEC dbo.usp_UserRole_Assign
    @UserId      = @UserId,
    @RoleId      = @RoleId,
    @WorkspaceId = @WorkspaceId,
    @AssignedBy  = @AssignedBy;
END;
