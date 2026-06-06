-- Phase 5c helper: return the user ids assigned to a task. Used by the
-- recurrence spawn to copy assignees onto the cloned occurrence.
CREATE OR ALTER PROCEDURE dbo.usp_Task_GetAssignees
    @TaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        SELECT ta.UserId
        FROM   dbo.TaskAssignees ta
        WHERE  ta.TaskId = @TaskId;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
