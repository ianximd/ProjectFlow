-- Transitions a task to a new status.
-- If the project has a workflow, validates the transition is allowed.
-- If no workflow is attached, any transition is permitted.
CREATE OR ALTER PROCEDURE usp_Task_Transition
    @TaskId     UNIQUEIDENTIFIER,
    @NewStatus  NVARCHAR(100),
    @RequesterId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        -- Load task
        DECLARE @CurrentStatus NVARCHAR(100);
        DECLARE @ProjectId     UNIQUEIDENTIFIER;
        DECLARE @WorkflowId    UNIQUEIDENTIFIER;

        SELECT
            @CurrentStatus = t.Status,
            @ProjectId     = t.ProjectId,
            @WorkflowId    = p.WorkflowId
        FROM  Tasks    t
        JOIN  Projects p ON p.Id = t.ProjectId
        WHERE t.Id = @TaskId AND t.DeletedAt IS NULL;

        IF @CurrentStatus IS NULL
            THROW 50404, 'Task not found', 1;

        IF @CurrentStatus = @NewStatus
        BEGIN
            SELECT * FROM Tasks WHERE Id = @TaskId;
            COMMIT TRANSACTION;
            RETURN;
        END;

        -- Validate transition if a workflow exists
        IF @WorkflowId IS NOT NULL
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM WorkflowTransitions
                WHERE WorkflowId  = @WorkflowId
                  AND FromStatus  = @CurrentStatus
                  AND ToStatus    = @NewStatus
            )
                THROW 50422, 'Transition not allowed by workflow', 1;

            -- Validate target status belongs to the workflow
            IF NOT EXISTS (
                SELECT 1 FROM WorkflowStatuses
                WHERE WorkflowId = @WorkflowId AND Name = @NewStatus
            )
                THROW 50422, 'Target status is not part of this workflow', 1;
        END;

        -- Determine resolved timestamp
        DECLARE @ResolvedAt DATETIME2 = NULL;
        IF @WorkflowId IS NOT NULL
        BEGIN
            IF EXISTS (
                SELECT 1 FROM WorkflowStatuses
                WHERE WorkflowId = @WorkflowId AND Name = @NewStatus AND Category = 'DONE'
            )
                SET @ResolvedAt = GETUTCDATE();
        END
        ELSE
        BEGIN
            IF @NewStatus IN ('Done', 'Resolved', 'Closed', 'Completed')
                SET @ResolvedAt = GETUTCDATE();
        END;

        -- ResolvedAt reflects whether the task is CURRENTLY in a DONE-category
        -- status: a timestamp when transitioning into DONE, cleared to NULL when
        -- transitioning back out (reopen). The previous CASE kept a stale
        -- timestamp on reopen, which left progress_auto counting reopened
        -- subtasks as still-done forever.
        UPDATE Tasks
        SET
            Status     = @NewStatus,
            ResolvedAt = @ResolvedAt,
            UpdatedAt  = GETUTCDATE()
        WHERE Id = @TaskId;

        SELECT * FROM Tasks WHERE Id = @TaskId;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
