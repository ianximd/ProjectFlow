-- Phase 8e: list non-deleted goal folders in a workspace.
CREATE OR ALTER PROCEDURE dbo.usp_GoalFolder_List
    @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        SELECT * FROM dbo.GoalFolders
        WHERE WorkspaceId = @WorkspaceId AND DeletedAt IS NULL
        ORDER BY CreatedAt ASC;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
