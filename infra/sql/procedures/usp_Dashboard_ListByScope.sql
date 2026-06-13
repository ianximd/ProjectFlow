CREATE OR ALTER PROCEDURE dbo.usp_Dashboard_ListByScope
  @WorkspaceId UNIQUEIDENTIFIER,
  @UserId      UNIQUEIDENTIFIER,
  @ScopeType   NVARCHAR(12),
  @ScopeId     UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM dbo.Dashboards
   WHERE WorkspaceId = @WorkspaceId
     AND ScopeType = @ScopeType
     AND ((@ScopeId IS NULL AND ScopeId IS NULL) OR ScopeId = @ScopeId)
     AND DeletedAt IS NULL
     AND (Visibility IN ('shared','protected') OR OwnerId = @UserId)
   ORDER BY Position ASC, CreatedAt ASC;
END;
GO
