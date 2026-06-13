-- Phase 8e: soft-delete a goal folder. Goals retain FolderId (orphaned folder ref
-- is tolerated by reads, which left-join). Idempotent.
CREATE OR ALTER PROCEDURE dbo.usp_GoalFolder_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        UPDATE dbo.GoalFolders
        SET DeletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
        WHERE Id = @Id AND DeletedAt IS NULL;
        SELECT @@ROWCOUNT AS Deleted;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
