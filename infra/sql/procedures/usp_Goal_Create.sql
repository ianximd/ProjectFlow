-- Phase 8e: create a goal. Defaults Status='active'. SELECT * of the new row.
CREATE OR ALTER PROCEDURE dbo.usp_Goal_Create
    @WorkspaceId UNIQUEIDENTIFIER,
    @ScopeType   NVARCHAR(12),
    @ScopeId     UNIQUEIDENTIFIER = NULL,
    @FolderId    UNIQUEIDENTIFIER = NULL,
    @Name        NVARCHAR(300),
    @Description NVARCHAR(MAX) = NULL,
    @OwnerId     UNIQUEIDENTIFIER,
    @DueDate     DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF @ScopeType NOT IN ('WORKSPACE','SPACE','FOLDER','LIST')
            THROW 52803, 'Invalid goal scope type', 1;
        DECLARE @Id UNIQUEIDENTIFIER = NEWID();
        INSERT INTO dbo.Goals (Id, WorkspaceId, ScopeType, ScopeId, FolderId, Name, Description, OwnerId, DueDate, Status)
        VALUES (@Id, @WorkspaceId, @ScopeType, @ScopeId, @FolderId, @Name, @Description, @OwnerId, @DueDate, 'active');
        SELECT * FROM dbo.Goals WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
