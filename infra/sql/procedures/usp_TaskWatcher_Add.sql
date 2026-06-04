CREATE OR ALTER PROCEDURE dbo.usp_TaskWatcher_Add @TaskId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL) THROW 51360, 'Task not found', 1;
        -- Tenant guard: the watcher must be a member of the task's workspace.
        -- Blocks cross-tenant user injection into a task's watcher list.
        IF NOT EXISTS (
            SELECT 1 FROM dbo.Tasks t
            JOIN dbo.WorkspaceMembers wm ON wm.WorkspaceId = t.WorkspaceId AND wm.UserId = @UserId
            WHERE t.Id = @TaskId
        )
            THROW 51361, 'User is not a member of the task''s workspace', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.TaskWatchers WHERE TaskId = @TaskId AND UserId = @UserId)
            INSERT INTO dbo.TaskWatchers (TaskId, UserId) VALUES (@TaskId, @UserId);
        SELECT * FROM dbo.TaskWatchers WHERE TaskId = @TaskId AND UserId = @UserId;
    END TRY BEGIN CATCH THROW; END CATCH
END;
