-- Phase 5c: patch the Rule JSON of an active recurrence in place. Used by the
-- spawn path to persist a decremented `count` so the countdown survives across
-- occurrences without creating a new row (which would reset count tracking).
CREATE OR ALTER PROCEDURE dbo.usp_TaskRecurrence_UpdateRule
    @Id   UNIQUEIDENTIFIER,
    @Rule NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        UPDATE dbo.TaskRecurrences
        SET    [Rule] = @Rule, UpdatedAt = SYSUTCDATETIME()
        WHERE  Id = @Id AND DeletedAt IS NULL;

        SELECT * FROM dbo.TaskRecurrences WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
