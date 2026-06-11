CREATE OR ALTER PROCEDURE dbo.usp_Whiteboard_ListForScope
    @WorkspaceId UNIQUEIDENTIFIER,
    @ScopeType   NVARCHAR(12)     = NULL,
    @ScopeId     UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, WorkspaceId, ScopeType, ScopeId, Name, CreatedById, CreatedAt, UpdatedAt
    FROM dbo.Whiteboards
    WHERE WorkspaceId = @WorkspaceId
      AND DeletedAt IS NULL
      AND (@ScopeType IS NULL OR ScopeType = @ScopeType)
      AND (@ScopeId   IS NULL OR ScopeId   = @ScopeId)
    ORDER BY CreatedAt DESC;
END;
GO
