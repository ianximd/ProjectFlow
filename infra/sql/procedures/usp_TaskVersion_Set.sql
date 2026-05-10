-- Set the versions on a task (delete-insert replace pattern)
CREATE OR ALTER PROCEDURE dbo.usp_TaskVersion_Set
  @TaskId     UNIQUEIDENTIFIER,
  @VersionIds NVARCHAR(MAX)    -- comma-separated UUIDs, or empty string to clear
AS
BEGIN
  SET NOCOUNT ON;
  DELETE FROM dbo.TaskVersions WHERE TaskId = @TaskId;

  IF LEN(ISNULL(@VersionIds, '')) > 0
  BEGIN
    INSERT INTO dbo.TaskVersions (TaskId, VersionId)
    SELECT @TaskId, CAST(LTRIM(RTRIM(value)) AS UNIQUEIDENTIFIER)
    FROM STRING_SPLIT(@VersionIds, ',')
    WHERE LEN(LTRIM(RTRIM(value))) > 0;
  END
END;
GO
