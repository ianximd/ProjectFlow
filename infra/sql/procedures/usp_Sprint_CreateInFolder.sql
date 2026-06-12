CREATE OR ALTER PROCEDURE dbo.usp_Sprint_CreateInFolder
    @FolderId  UNIQUEIDENTIFIER,
    @Name      NVARCHAR(255),
    @Goal      NVARCHAR(MAX) = NULL,
    @StartDate DATETIME2     = NULL,
    @EndDate   DATETIME2     = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @SpaceId UNIQUEIDENTIFIER, @WorkspaceId UNIQUEIDENTIFIER;
        SELECT @SpaceId = SpaceId, @WorkspaceId = WorkspaceId
        FROM   dbo.Folders WHERE Id = @FolderId AND IsSprintFolder = 1 AND DeletedAt IS NULL;
        IF @SpaceId IS NULL
            THROW 50046, 'Folder not found or not a sprint folder.', 1;

        DECLARE @ListId UNIQUEIDENTIFIER = NEWID();
        DECLARE @ListPath NVARCHAR(900) =
            '/' + CONVERT(NVARCHAR(36), @SpaceId) + '/' + CONVERT(NVARCHAR(36), @FolderId) + '/' + CONVERT(NVARCHAR(36), @ListId) + '/';
        INSERT INTO dbo.Lists (Id, WorkspaceId, SpaceId, FolderId, Name, Position, Path, IsDefault)
        VALUES (@ListId, @WorkspaceId, @SpaceId, @FolderId, @Name, 0, @ListPath, 0);

        DECLARE @SprintId UNIQUEIDENTIFIER = NEWID();
        INSERT INTO dbo.Sprints (Id, ProjectId, Name, Goal, Status, StartDate, EndDate, ListId, FolderId)
        VALUES (@SprintId, @SpaceId, @Name, @Goal, 'PLANNED', @StartDate, @EndDate, @ListId, @FolderId);

        COMMIT TRANSACTION;

        SELECT * FROM dbo.Sprints WHERE Id = @SprintId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO
