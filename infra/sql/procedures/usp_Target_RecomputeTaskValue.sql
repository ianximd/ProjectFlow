-- Phase 8e: recompute a task-kind target's CurrentValue (completed) + TargetValue
-- (total) over its TaskFilter task-id list. Done = ResolvedAt IS NOT NULL (same
-- "done" test as usp_TaskCustomField_RecomputeProgressAuto). No-op for non-task
-- targets. SELECT * of the (possibly updated) target row.
CREATE OR ALTER PROCEDURE dbo.usp_Target_RecomputeTaskValue
    @TargetId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        DECLARE @Kind NVARCHAR(10), @Filter NVARCHAR(MAX);
        SELECT @Kind = Kind, @Filter = TaskFilter FROM dbo.Targets WHERE Id = @TargetId;
        IF @Kind IS NULL RETURN;
        IF @Kind <> 'task' BEGIN SELECT * FROM dbo.Targets WHERE Id = @TargetId; RETURN; END

        DECLARE @Total INT = 0, @Done INT = 0;
        IF @Filter IS NOT NULL AND ISJSON(@Filter) = 1
        BEGIN
            ;WITH Ids AS (
                SELECT TRY_CONVERT(UNIQUEIDENTIFIER, value) AS TaskId
                FROM OPENJSON(@Filter, '$.taskIds')
            )
            SELECT @Total = COUNT(*),
                   @Done  = SUM(CASE WHEN t.ResolvedAt IS NOT NULL THEN 1 ELSE 0 END)
            FROM dbo.Tasks t
            JOIN Ids ON Ids.TaskId = t.Id
            WHERE t.DeletedAt IS NULL;
        END

        UPDATE dbo.Targets
        SET CurrentValue = ISNULL(@Done, 0),
            TargetValue  = ISNULL(@Total, 0),
            UpdatedAt    = SYSUTCDATETIME()
        WHERE Id = @TargetId;

        SELECT * FROM dbo.Targets WHERE Id = @TargetId;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
