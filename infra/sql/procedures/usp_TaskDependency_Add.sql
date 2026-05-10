CREATE OR ALTER PROCEDURE usp_TaskDependency_Add
    @TaskId    UNIQUEIDENTIFIER,
    @DependsOn UNIQUEIDENTIFIER,
    @Type      NVARCHAR(20) = 'BLOCKS'
AS
BEGIN
    SET NOCOUNT ON;

    IF @TaskId = @DependsOn
        THROW 50400, 'A task cannot depend on itself', 1;

    -- Prevent direct circular dependency
    IF EXISTS (
        SELECT 1 FROM TaskDependencies
        WHERE TaskId = @DependsOn AND DependsOn = @TaskId
    )
        THROW 50400, 'Circular dependency detected', 1;

    -- Validate type
    IF @Type NOT IN ('BLOCKS', 'IS_BLOCKED_BY', 'RELATES_TO', 'DUPLICATES')
        THROW 50400, 'Invalid dependency type', 1;

    IF NOT EXISTS (
        SELECT 1 FROM TaskDependencies
        WHERE TaskId = @TaskId AND DependsOn = @DependsOn
    )
    BEGIN
        INSERT INTO TaskDependencies (Id, TaskId, DependsOn, Type)
        VALUES (NEWID(), @TaskId, @DependsOn, @Type);
    END;

    SELECT * FROM TaskDependencies WHERE TaskId = @TaskId AND DependsOn = @DependsOn;
END;
