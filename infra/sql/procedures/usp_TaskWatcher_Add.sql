CREATE OR ALTER PROCEDURE dbo.usp_TaskWatcher_Add @TaskId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL) THROW 51360, 'Task not found', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.TaskWatchers WHERE TaskId = @TaskId AND UserId = @UserId)
            INSERT INTO dbo.TaskWatchers (TaskId, UserId) VALUES (@TaskId, @UserId);
        SELECT * FROM dbo.TaskWatchers WHERE TaskId = @TaskId AND UserId = @UserId;
    END TRY BEGIN CATCH THROW; END CATCH
END;
