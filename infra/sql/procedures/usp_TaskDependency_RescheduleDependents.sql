CREATE OR ALTER PROCEDURE usp_TaskDependency_RescheduleDependents
    @TaskId UNIQUEIDENTIFIER, @DeltaDays INT
AS
BEGIN
    SET NOCOUNT ON;
    IF @DeltaDays = 0 RETURN;
    -- All tasks transitively waiting on @TaskId. Recursive CTE requires UNION ALL;
    -- the PK table var + SELECT DISTINCT dedupe diamonds. Add-time cycle prevention keeps this a DAG.
    DECLARE @dependents TABLE (Id UNIQUEIDENTIFIER PRIMARY KEY);
    ;WITH deps AS (
        SELECT TaskId AS Id FROM dbo.TaskDependencies WHERE DependsOn = @TaskId
        UNION ALL
        SELECT d.TaskId FROM dbo.TaskDependencies d JOIN deps x ON d.DependsOn = x.Id
    )
    INSERT INTO @dependents (Id) SELECT DISTINCT Id FROM deps WHERE Id <> @TaskId OPTION (MAXRECURSION 1000);
    UPDATE t SET StartDate = DATEADD(DAY, @DeltaDays, t.StartDate),
                 DueDate   = DATEADD(DAY, @DeltaDays, t.DueDate),
                 UpdatedAt = GETUTCDATE()
      FROM dbo.Tasks t JOIN @dependents dd ON dd.Id = t.Id
     WHERE t.DeletedAt IS NULL AND (t.StartDate IS NOT NULL OR t.DueDate IS NOT NULL);
    SELECT Id AS TaskId FROM @dependents;
END;
