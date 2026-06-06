CREATE OR ALTER PROCEDURE usp_TaskDependency_ListForTask
    @TaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    -- waiting on: tasks @TaskId depends on (blockers)
    SELECT d.DependsOn AS TaskId, t.Title, t.Status, t.IssueKey
      FROM dbo.TaskDependencies d JOIN dbo.Tasks t ON t.Id = d.DependsOn
     WHERE d.TaskId = @TaskId AND t.DeletedAt IS NULL
       AND d.WorkspaceId = (SELECT WorkspaceId FROM dbo.Tasks WHERE Id = @TaskId);
    -- blocking: tasks that depend on @TaskId
    SELECT d.TaskId AS TaskId, t.Title, t.Status, t.IssueKey
      FROM dbo.TaskDependencies d JOIN dbo.Tasks t ON t.Id = d.TaskId
     WHERE d.DependsOn = @TaskId AND t.DeletedAt IS NULL
       AND d.WorkspaceId = (SELECT WorkspaceId FROM dbo.Tasks WHERE Id = @TaskId);
END;
