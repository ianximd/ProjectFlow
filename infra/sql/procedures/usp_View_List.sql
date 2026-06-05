CREATE OR ALTER PROCEDURE dbo.usp_View_List
    @WorkspaceId UNIQUEIDENTIFIER,
    @UserId      UNIQUEIDENTIFIER,
    @ScopeType   NVARCHAR(12),
    @ScopeId     UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.SavedViews
     WHERE WorkspaceId = @WorkspaceId
       AND ScopeType = @ScopeType
       AND ((@ScopeId IS NULL AND ScopeId IS NULL) OR ScopeId = @ScopeId)
       AND DeletedAt IS NULL
       AND (IsShared = 1 OR OwnerId = @UserId)
     ORDER BY Position ASC, CreatedAt ASC;
END;
