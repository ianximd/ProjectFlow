CREATE OR ALTER PROCEDURE dbo.usp_Whiteboard_Update
    @Id   UNIQUEIDENTIFIER,
    @Name NVARCHAR(255) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.Whiteboards
       SET Name      = ISNULL(@Name, Name),
           UpdatedAt = SYSUTCDATETIME()
     WHERE Id = @Id AND DeletedAt IS NULL;

    SELECT Id, WorkspaceId, ScopeType, ScopeId, Name, DocJson, CreatedById, CreatedAt, UpdatedAt FROM dbo.Whiteboards WHERE Id = @Id;
END;
GO
