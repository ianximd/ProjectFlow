CREATE OR ALTER PROCEDURE usp_TaskDependency_Remove
    @TaskId    UNIQUEIDENTIFIER,
    @DependsOn UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM TaskDependencies WHERE TaskId = @TaskId AND DependsOn = @DependsOn;
END;
