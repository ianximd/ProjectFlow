-- Phase 5c: rows the scheduler sweep should spawn — active, scheduled-eligible
-- recurrences whose NextRunAt has arrived. on_complete-only recurrences are
-- intentionally excluded (they spawn on transition, not on a timer).
CREATE OR ALTER PROCEDURE dbo.usp_TaskRecurrence_ListDue
    @Now DATETIME2
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        SELECT *
        FROM   dbo.TaskRecurrences
        WHERE  Active = 1
          AND  DeletedAt IS NULL
          AND  RegenerateMode IN ('schedule', 'both')
          AND  NextRunAt IS NOT NULL
          AND  NextRunAt <= @Now
        ORDER  BY NextRunAt;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
