-- Phase 5c: patch the Rule JSON of an active recurrence in place.
--
-- DEPRECATED (FIX 1, 2026): the spawn path no longer calls this. The decremented
-- `count` is now folded into the ATOMIC CLAIM (usp_TaskRecurrence_AdvanceAfterSpawn
-- @Rule param) so the count persist + schedule advance happen in ONE conditional
-- UPDATE with no read-then-write race. Kept (deployed but unreferenced) for any
-- ad-hoc/manual rule patching; safe to drop in a later cleanup.
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
