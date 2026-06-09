CREATE OR ALTER PROCEDURE dbo.usp_Doc_ListByScope
    @ScopeType NVARCHAR(8),
    @ScopeId   UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, WorkspaceId, ScopeType, ScopeId, Name, Icon, IsWiki, VerifiedById, CreatedById, CreatedAt, UpdatedAt
    FROM dbo.Docs
    WHERE ScopeType = @ScopeType AND ScopeId = @ScopeId AND DeletedAt IS NULL
    ORDER BY Name;
END;
GO
