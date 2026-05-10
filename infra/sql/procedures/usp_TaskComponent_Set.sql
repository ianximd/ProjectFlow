-- Set the components on a task (delete-insert replace pattern)
CREATE OR ALTER PROCEDURE dbo.usp_TaskComponent_Set
  @TaskId       UNIQUEIDENTIFIER,
  @ComponentIds NVARCHAR(MAX)    -- comma-separated UUIDs, or empty string to clear
AS
BEGIN
  SET NOCOUNT ON;
  DELETE FROM dbo.TaskComponents WHERE TaskId = @TaskId;

  IF LEN(ISNULL(@ComponentIds, '')) > 0
  BEGIN
    INSERT INTO dbo.TaskComponents (TaskId, ComponentId)
    SELECT @TaskId, CAST(LTRIM(RTRIM(value)) AS UNIQUEIDENTIFIER)
    FROM STRING_SPLIT(@ComponentIds, ',')
    WHERE LEN(LTRIM(RTRIM(value))) > 0;
  END
END;
GO
