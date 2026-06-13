-- Phase 8e: create a goal folder. SELECT * of the new row.
CREATE OR ALTER PROCEDURE dbo.usp_GoalFolder_Create
    @WorkspaceId UNIQUEIDENTIFIER,
    @Name        NVARCHAR(200),
    @OwnerId     UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        DECLARE @Id UNIQUEIDENTIFIER = NEWID();
        INSERT INTO dbo.GoalFolders (Id, WorkspaceId, Name, OwnerId)
        VALUES (@Id, @WorkspaceId, @Name, @OwnerId);
        SELECT * FROM dbo.GoalFolders WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
