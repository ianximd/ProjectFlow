-- Phase 5c: after a successful spawn, record the new occurrence + advance the
-- schedule. @Active is set to 0 by the service when the rule has ended (endsAt
-- passed or count exhausted). @NextRunAt may be NULL once there is no further
-- scheduled occurrence.
CREATE OR ALTER PROCEDURE dbo.usp_TaskRecurrence_AdvanceAfterSpawn
    @Id                UNIQUEIDENTIFIER,
    @LastSpawnedTaskId UNIQUEIDENTIFIER,
    @NextRunAt         DATETIME2 = NULL,
    @Active            BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        UPDATE dbo.TaskRecurrences
        SET    LastSpawnedTaskId = @LastSpawnedTaskId,
               NextRunAt         = @NextRunAt,
               Active            = @Active,
               UpdatedAt         = SYSUTCDATETIME()
        WHERE  Id = @Id AND DeletedAt IS NULL;

        SELECT * FROM dbo.TaskRecurrences WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
