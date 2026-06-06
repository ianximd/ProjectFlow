CREATE OR ALTER PROCEDURE usp_TaskDependency_Add
    @TaskId UNIQUEIDENTIFIER, @DependsOn UNIQUEIDENTIFIER, @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF @TaskId = @DependsOn THROW 51500, 'A task cannot depend on itself', 1;
        -- Transitive cycle: would (TaskId waits_on DependsOn) let DependsOn already reach TaskId?
        DECLARE @cnt INT = 0;
        ;WITH reach AS (
            SELECT DependsOn AS NodeId FROM dbo.TaskDependencies WHERE TaskId = @DependsOn
            UNION ALL
            SELECT d.DependsOn FROM dbo.TaskDependencies d JOIN reach r ON d.TaskId = r.NodeId
        )
        SELECT @cnt = COUNT(*) FROM reach WHERE NodeId = @TaskId OPTION (MAXRECURSION 1000);
        IF @cnt > 0 THROW 51501, 'Circular dependency detected', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.TaskDependencies WHERE TaskId = @TaskId AND DependsOn = @DependsOn)
            INSERT INTO dbo.TaskDependencies (Id, TaskId, DependsOn, Type, WorkspaceId)
            VALUES (NEWID(), @TaskId, @DependsOn, 'waiting_on', @WorkspaceId);
        SELECT * FROM dbo.TaskDependencies WHERE TaskId = @TaskId AND DependsOn = @DependsOn;
    END TRY
    BEGIN CATCH THROW; END CATCH
END;
