CREATE OR ALTER PROCEDURE dbo.usp_Whiteboard_Create
    @Id          UNIQUEIDENTIFIER,
    @WorkspaceId UNIQUEIDENTIFIER,
    @ScopeType   NVARCHAR(12),
    @ScopeId     UNIQUEIDENTIFIER,
    @Name        NVARCHAR(255),
    @CreatedById UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRANSACTION;
    BEGIN TRY
        INSERT INTO dbo.Whiteboards (Id, WorkspaceId, ScopeType, ScopeId, Name, CreatedById)
        VALUES (@Id, @WorkspaceId, @ScopeType, @ScopeId, @Name, @CreatedById);

        COMMIT TRANSACTION;
        SELECT Id, WorkspaceId, ScopeType, ScopeId, Name, DocJson, CreatedById, CreatedAt, UpdatedAt FROM dbo.Whiteboards WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO
