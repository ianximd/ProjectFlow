CREATE OR ALTER PROCEDURE dbo.usp_Folder_Create
    @Id             UNIQUEIDENTIFIER,
    @WorkspaceId    UNIQUEIDENTIFIER,
    @SpaceId        UNIQUEIDENTIFIER,
    @ParentFolderId UNIQUEIDENTIFIER = NULL,
    @Name           NVARCHAR(255),
    @Position       FLOAT,
    @Path           NVARCHAR(900)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Projects WHERE Id = @SpaceId AND WorkspaceId = @WorkspaceId AND DeletedAt IS NULL)
            THROW 51200, 'Space not found in workspace', 1;
        IF @ParentFolderId IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM dbo.Folders
            WHERE Id = @ParentFolderId AND SpaceId = @SpaceId AND WorkspaceId = @WorkspaceId AND DeletedAt IS NULL)
            THROW 51201, 'Parent folder not found in this space', 1;

        INSERT INTO dbo.Folders (Id, WorkspaceId, SpaceId, ParentFolderId, Name, Position, Path)
        VALUES (@Id, @WorkspaceId, @SpaceId, @ParentFolderId, @Name, @Position, @Path);

        SELECT * FROM dbo.Folders WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
