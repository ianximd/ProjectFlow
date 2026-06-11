CREATE OR ALTER PROCEDURE dbo.usp_Form_List
    @WorkspaceId UNIQUEIDENTIFIER,
    @ScopeType   NVARCHAR(8)      = NULL,
    @ScopeId     UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.Forms
    WHERE WorkspaceId = @WorkspaceId
      AND DeletedAt IS NULL
      AND (@ScopeType IS NULL OR ScopeType = @ScopeType)
      AND (@ScopeId   IS NULL OR ScopeId   = @ScopeId)
    ORDER BY CreatedAt DESC;
END;
GO
