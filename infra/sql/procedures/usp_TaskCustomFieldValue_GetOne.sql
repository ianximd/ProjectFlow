CREATE OR ALTER PROCEDURE dbo.usp_TaskCustomFieldValue_GetOne
    @TaskId  UNIQUEIDENTIFIER,
    @FieldId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    -- Targeted single-value read for rollup source resolution. Reading ONE
    -- (task, field) value directly avoids re-computing the task's full effective
    -- field set (which would re-evaluate rollups → rollup-of-rollup recursion).
    SELECT TOP (1) Value
      FROM dbo.TaskCustomFieldValues
     WHERE TaskId = @TaskId AND FieldId = @FieldId;
END;
