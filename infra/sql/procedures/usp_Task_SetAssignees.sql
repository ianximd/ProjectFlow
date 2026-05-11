-- Replace the assignee set for a task atomically. UserIds is a comma-separated
-- list (empty string clears all assignees). Silently ignores user ids that
-- aren't members of the task's workspace — this prevents cross-workspace
-- assignment from leaking through a forged request.
CREATE OR ALTER PROCEDURE dbo.usp_Task_SetAssignees
    @TaskId  UNIQUEIDENTIFIER,
    @UserIds NVARCHAR(MAX)        -- e.g. 'guid1,guid2'  (empty = clear)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @WorkspaceId UNIQUEIDENTIFIER;
    SELECT @WorkspaceId = WorkspaceId
    FROM   dbo.Tasks
    WHERE  Id = @TaskId AND DeletedAt IS NULL;

    IF @WorkspaceId IS NULL
        THROW 51030, 'Task not found', 1;

    BEGIN TRANSACTION;
    BEGIN TRY
        -- Wipe + reinsert. Cheap because the assignee count per task is tiny
        -- (single digits in practice) and the API reads it back immediately.
        DELETE FROM dbo.TaskAssignees WHERE TaskId = @TaskId;

        ;WITH InputIds AS (
            SELECT TRY_CAST(LTRIM(RTRIM(value)) AS UNIQUEIDENTIFIER) AS UserId
            FROM   STRING_SPLIT(@UserIds, ',')
            WHERE  LTRIM(RTRIM(value)) <> ''
        )
        INSERT INTO dbo.TaskAssignees (TaskId, UserId)
        SELECT @TaskId, i.UserId
        FROM   InputIds i
        JOIN   dbo.WorkspaceMembers wm
               ON wm.UserId      = i.UserId
              AND wm.WorkspaceId = @WorkspaceId
        WHERE  i.UserId IS NOT NULL;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    -- Echo the new assignee set so the caller can refresh state without
    -- a follow-up GET.
    SELECT ta.TaskId,
           u.Id    AS UserId,
           u.Email,
           u.Name,
           u.AvatarUrl
    FROM   dbo.TaskAssignees ta
    JOIN   dbo.Users         u ON u.Id = ta.UserId
    WHERE  ta.TaskId = @TaskId
      AND  u.DeletedAt IS NULL
    ORDER  BY u.Name;
END;
