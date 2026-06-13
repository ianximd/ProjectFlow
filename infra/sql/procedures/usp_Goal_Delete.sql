-- Phase 8e: soft-delete a goal and hard-delete its targets (targets are leaf,
-- not referenced elsewhere). Transactional. Idempotent on the goal soft-delete.
CREATE OR ALTER PROCEDURE dbo.usp_Goal_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        DELETE FROM dbo.Targets WHERE GoalId = @Id;
        UPDATE dbo.Goals
        SET DeletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
        WHERE Id = @Id AND DeletedAt IS NULL;
        SELECT @@ROWCOUNT AS Deleted;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
