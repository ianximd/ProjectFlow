-- Phase 8e: task-kind targets whose TaskFilter.taskIds includes @TaskId. Drives
-- goalService.recomputeForTask — when a task transitions, recompute only the
-- targets that actually count it. Returns Target Id + GoalId.
CREATE OR ALTER PROCEDURE dbo.usp_Target_ListTaskTargetsForTask
    @TaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        SELECT t.Id, t.GoalId
        FROM dbo.Targets t
        WHERE t.Kind = 'task'
          AND t.TaskFilter IS NOT NULL
          AND ISJSON(t.TaskFilter) = 1
          AND EXISTS (
              SELECT 1 FROM OPENJSON(t.TaskFilter, '$.taskIds') j
              WHERE TRY_CONVERT(UNIQUEIDENTIFIER, j.value) = @TaskId
          );
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
