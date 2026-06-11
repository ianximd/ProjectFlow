CREATE OR ALTER PROCEDURE dbo.usp_Whiteboard_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.Whiteboards
       SET DeletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
     WHERE Id = @Id AND DeletedAt IS NULL;

    SELECT Id, WorkspaceId, ScopeType, ScopeId, Name, DocJson, CreatedById, CreatedAt, UpdatedAt FROM dbo.Whiteboards WHERE Id = @Id;
END;
GO
