-- Phase 5c: clear (soft-delete + deactivate) a task's active recurrence.
-- Idempotent — a no-op when there is nothing active.
CREATE OR ALTER PROCEDURE dbo.usp_TaskRecurrence_Clear
    @TaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        UPDATE dbo.TaskRecurrences
        SET    DeletedAt = SYSUTCDATETIME(), Active = 0, UpdatedAt = SYSUTCDATETIME()
        WHERE  TaskId = @TaskId AND DeletedAt IS NULL;

        SELECT @@ROWCOUNT AS Cleared;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
