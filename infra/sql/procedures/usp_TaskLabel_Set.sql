-- Set the structured labels on a task (delete-insert replace pattern)
CREATE OR ALTER PROCEDURE dbo.usp_TaskLabel_Set
  @TaskId   UNIQUEIDENTIFIER,
  @LabelIds NVARCHAR(MAX)    -- comma-separated UUIDs, or empty string to clear
AS
BEGIN
  SET NOCOUNT ON;
  DELETE FROM dbo.TaskLabelLinks WHERE TaskId = @TaskId;

  IF LEN(ISNULL(@LabelIds, '')) > 0
  BEGIN
    INSERT INTO dbo.TaskLabelLinks (TaskId, LabelId)
    SELECT @TaskId, CAST(LTRIM(RTRIM(value)) AS UNIQUEIDENTIFIER)
    FROM STRING_SPLIT(@LabelIds, ',')
    WHERE LEN(LTRIM(RTRIM(value))) > 0;
  END
END;
GO
