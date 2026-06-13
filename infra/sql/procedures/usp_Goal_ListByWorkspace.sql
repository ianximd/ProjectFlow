-- Phase 8e: list non-deleted goals in a workspace; optional @FolderId filter
-- (NULL = all goals across folders + unfoldered).
CREATE OR ALTER PROCEDURE dbo.usp_Goal_ListByWorkspace
    @WorkspaceId UNIQUEIDENTIFIER,
    @FolderId    UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        SELECT * FROM dbo.Goals
        WHERE WorkspaceId = @WorkspaceId AND DeletedAt IS NULL
          AND (@FolderId IS NULL OR FolderId = @FolderId)
        ORDER BY CreatedAt ASC;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
