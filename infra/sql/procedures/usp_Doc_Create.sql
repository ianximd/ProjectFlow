CREATE OR ALTER PROCEDURE dbo.usp_Doc_Create
    @WorkspaceId UNIQUEIDENTIFIER,
    @ScopeType   NVARCHAR(8),
    @ScopeId     UNIQUEIDENTIFIER,
    @Name        NVARCHAR(255),
    @Icon        NVARCHAR(64)     = NULL,
    @CreatedById UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @DocId UNIQUEIDENTIFIER = NEWID();
    DECLARE @PageId UNIQUEIDENTIFIER = NEWID();

    BEGIN TRY
        BEGIN TRANSACTION;

        INSERT INTO dbo.Docs (Id, WorkspaceId, ScopeType, ScopeId, Name, Icon, CreatedById)
        VALUES (@DocId, @WorkspaceId, @ScopeType, @ScopeId, @Name, @Icon, @CreatedById);

        INSERT INTO dbo.DocPages (Id, DocId, ParentPageId, Title, Position)
        VALUES (@PageId, @DocId, NULL, N'Untitled', 0);

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT Id, WorkspaceId, ScopeType, ScopeId, Name, Icon, IsWiki, VerifiedById, CreatedById, CreatedAt, UpdatedAt
    FROM dbo.Docs WHERE Id = @DocId;

    SELECT Id, DocId, ParentPageId, Title, Icon, Cover, Position, CreatedAt, UpdatedAt
    FROM dbo.DocPages WHERE Id = @PageId;
END;
GO
