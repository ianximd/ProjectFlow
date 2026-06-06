-- Phase 5c (FIX 1): unconditionally stamp LastSpawnedTaskId for an already-claimed
-- recurrence. The atomic claim (usp_TaskRecurrence_AdvanceAfterSpawn) advances
-- NextRunAt/Active/Rule and is gated on Active=1 + ExpectedNextRunAt, so it
-- tentatively records the SOURCE task id. Once the clone exists, the spawn path
-- re-stamps the real clone id here. This is intentionally NOT gated on Active
-- (the claim may have just deactivated the row on the final occurrence) — the
-- caller already holds the claim, so this stamp races nothing.
CREATE OR ALTER PROCEDURE dbo.usp_TaskRecurrence_SetLastSpawned
    @Id                UNIQUEIDENTIFIER,
    @LastSpawnedTaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        UPDATE dbo.TaskRecurrences
        SET    LastSpawnedTaskId = @LastSpawnedTaskId,
               UpdatedAt         = SYSUTCDATETIME()
        WHERE  Id = @Id AND DeletedAt IS NULL;

        SELECT * FROM dbo.TaskRecurrences WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
