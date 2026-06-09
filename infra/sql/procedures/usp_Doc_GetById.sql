CREATE OR ALTER PROCEDURE dbo.usp_Doc_GetById
    @DocId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, WorkspaceId, ScopeType, ScopeId, Name, Icon, IsWiki, VerifiedById, CreatedById, CreatedAt, UpdatedAt
    FROM dbo.Docs
    WHERE Id = @DocId AND DeletedAt IS NULL;
END;
GO
