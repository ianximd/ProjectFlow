-- Phase 5c: upsert THE recurrence for a task (one active recurrence per task).
-- Replace semantics: soft-delete any existing active row, then insert a fresh
-- one. The UNIQUE filtered index (TaskId WHERE DeletedAt IS NULL) keeps this
-- legal because the prior row is stamped DeletedAt before the insert.
-- Validates the task exists (and yields its workspace if the caller passes NULL).
CREATE OR ALTER PROCEDURE dbo.usp_TaskRecurrence_SetForTask
    @TaskId              UNIQUEIDENTIFIER,
    @WorkspaceId         UNIQUEIDENTIFIER,
    @Rule                NVARCHAR(MAX),
    @RegenerateMode      NVARCHAR(20),
    @NextRunAt           DATETIME2 = NULL,
    @IncludeDependencies BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @TaskWs UNIQUEIDENTIFIER;
        SELECT @TaskWs = WorkspaceId FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL;
        IF @TaskWs IS NULL THROW 51700, 'Task not found', 1;

        -- Defense-in-depth: caller-supplied WorkspaceId must match the task's.
        IF @WorkspaceId IS NOT NULL AND @WorkspaceId <> @TaskWs
            THROW 51701, 'Workspace mismatch', 1;

        -- Soft-delete the prior active recurrence (replace).
        UPDATE dbo.TaskRecurrences
        SET    DeletedAt = SYSUTCDATETIME(), Active = 0, UpdatedAt = SYSUTCDATETIME()
        WHERE  TaskId = @TaskId AND DeletedAt IS NULL;

        DECLARE @NewId UNIQUEIDENTIFIER = NEWID();
        INSERT INTO dbo.TaskRecurrences (
            Id, TaskId, WorkspaceId, [Rule], RegenerateMode, NextRunAt,
            Active, LastSpawnedTaskId, IncludeDependencies
        ) VALUES (
            @NewId, @TaskId, @TaskWs, @Rule, @RegenerateMode, @NextRunAt,
            1, NULL, @IncludeDependencies
        );

        SELECT * FROM dbo.TaskRecurrences WHERE Id = @NewId;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
