-- Phase 5c: ATOMIC CLAIM + advance of a recurrence occurrence.
--
-- The on-complete trigger and the scheduled sweep can both reach spawnNext for
-- the SAME occurrence (mode 'both'). To avoid a double-spawn + lost count
-- decrement, the spawn path CLAIMS the occurrence here BEFORE cloning, using a
-- CONDITIONAL update keyed on the recurrence's currently-observed NextRunAt
-- (@ExpectedNextRunAt). Only one caller's WHERE matches; the loser sees
-- Claimed = 0 and bails out without spawning.
--
-- @Rule is optional: when the caller is folding a decremented `count` into the
-- claim, it passes the new Rule JSON so the count persist happens in the SAME
-- atomic UPDATE (no separate read-then-write race). When NULL, [Rule] is left
-- untouched.
--
-- @Active is set to 0 by the service when the rule has ended (endsAt passed or
-- count exhausted). @NextRunAt may be NULL once there is no further occurrence.
CREATE OR ALTER PROCEDURE dbo.usp_TaskRecurrence_AdvanceAfterSpawn
    @Id                UNIQUEIDENTIFIER,
    @LastSpawnedTaskId UNIQUEIDENTIFIER,
    @NextRunAt         DATETIME2 = NULL,
    @Active            BIT = 1,
    @ExpectedNextRunAt DATETIME2 = NULL,
    @Rule              NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        DECLARE @Claimed INT = 0;

        UPDATE dbo.TaskRecurrences
        SET    LastSpawnedTaskId = @LastSpawnedTaskId,
               NextRunAt         = @NextRunAt,
               Active            = @Active,
               [Rule]            = COALESCE(@Rule, [Rule]),
               UpdatedAt         = SYSUTCDATETIME()
        WHERE  Id = @Id
          AND  DeletedAt IS NULL
          AND  Active = 1
          AND  (
                 (@ExpectedNextRunAt IS NULL AND NextRunAt IS NULL)
                 OR NextRunAt = @ExpectedNextRunAt
               );

        SET @Claimed = @@ROWCOUNT;

        SELECT @Claimed AS Claimed;
        SELECT * FROM dbo.TaskRecurrences WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
