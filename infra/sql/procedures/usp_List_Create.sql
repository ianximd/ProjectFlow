CREATE OR ALTER PROCEDURE dbo.usp_List_Create
    @Id          UNIQUEIDENTIFIER,
    @WorkspaceId UNIQUEIDENTIFIER,
    @SpaceId     UNIQUEIDENTIFIER,
    @FolderId    UNIQUEIDENTIFIER = NULL,
    @Name        NVARCHAR(255),
    @Position    FLOAT,
    @Path        NVARCHAR(900),
    @IsDefault   BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Projects WHERE Id = @SpaceId AND WorkspaceId = @WorkspaceId AND DeletedAt IS NULL)
            THROW 51200, 'Space not found in workspace', 1;
        IF @FolderId IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM dbo.Folders WHERE Id = @FolderId AND SpaceId = @SpaceId AND WorkspaceId = @WorkspaceId AND DeletedAt IS NULL)
            THROW 51201, 'Folder not found in this space', 1;

        INSERT INTO dbo.Lists (Id, WorkspaceId, SpaceId, FolderId, Name, Position, Path, IsDefault)
        VALUES (@Id, @WorkspaceId, @SpaceId, @FolderId, @Name, @Position, @Path, @IsDefault);
        SELECT * FROM dbo.Lists WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
