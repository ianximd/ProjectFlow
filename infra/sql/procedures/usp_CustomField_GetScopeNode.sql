CREATE OR ALTER PROCEDURE dbo.usp_CustomField_GetScopeNode
    @ScopeType NVARCHAR(8),
    @ScopeId   UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    IF @ScopeType = 'SPACE'
        SELECT WorkspaceId, '/' + CONVERT(NVARCHAR(36), Id) + '/' AS ScopePath
        FROM dbo.Projects WHERE Id = @ScopeId AND Status <> 'DELETED';
    ELSE IF @ScopeType = 'FOLDER'
        SELECT WorkspaceId, Path AS ScopePath
        FROM dbo.Folders WHERE Id = @ScopeId AND DeletedAt IS NULL;
    ELSE IF @ScopeType = 'LIST'
        SELECT WorkspaceId, Path AS ScopePath
        FROM dbo.Lists WHERE Id = @ScopeId AND DeletedAt IS NULL;
END;
