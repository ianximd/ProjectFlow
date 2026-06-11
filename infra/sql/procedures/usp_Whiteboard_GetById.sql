CREATE OR ALTER PROCEDURE dbo.usp_Whiteboard_GetById
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, WorkspaceId, ScopeType, ScopeId, Name, DocJson, CreatedById, CreatedAt, UpdatedAt FROM dbo.Whiteboards WHERE Id = @Id AND DeletedAt IS NULL;
END;
GO
