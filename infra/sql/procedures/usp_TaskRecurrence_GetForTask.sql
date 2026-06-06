-- Phase 5c: read the ACTIVE (non-soft-deleted) recurrence for a task, if any.
-- SELECT * so the repository can map the full row. Returns 0 rows when the task
-- has no recurrence.
CREATE OR ALTER PROCEDURE dbo.usp_TaskRecurrence_GetForTask
    @TaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        SELECT *
        FROM   dbo.TaskRecurrences
        WHERE  TaskId = @TaskId AND DeletedAt IS NULL;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
