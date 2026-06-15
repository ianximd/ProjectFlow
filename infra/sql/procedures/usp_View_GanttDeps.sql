CREATE OR ALTER PROCEDURE dbo.usp_View_GanttDeps
    @TaskIds NVARCHAR(MAX) = NULL   -- comma-delimited GUID list of in-scope tasks
AS
BEGIN
    SET NOCOUNT ON;
    IF @TaskIds IS NULL OR LEN(@TaskIds) = 0 RETURN;

    ;WITH ids AS (
        SELECT DISTINCT TRY_CONVERT(UNIQUEIDENTIFIER, LTRIM(RTRIM(value))) AS Id
        FROM STRING_SPLIT(@TaskIds, ',')
        WHERE TRY_CONVERT(UNIQUEIDENTIFIER, LTRIM(RTRIM(value))) IS NOT NULL
    )
    SELECT d.TaskId, d.DependsOn
    FROM dbo.TaskDependencies d
    WHERE d.TaskId    IN (SELECT Id FROM ids)
      AND d.DependsOn IN (SELECT Id FROM ids);
END;
GO
