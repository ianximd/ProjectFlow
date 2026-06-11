CREATE OR ALTER PROCEDURE dbo.usp_WorkLogTag_Set
  @WorkLogId UNIQUEIDENTIFIER,
  @TagIds    NVARCHAR(MAX) = NULL   -- comma-delimited GUID list; NULL/'' clears all
AS
BEGIN
  SET NOCOUNT ON;

  BEGIN TRY
    BEGIN TRANSACTION;

    DELETE FROM dbo.WorkLogTags WHERE WorkLogId = @WorkLogId;

    IF @TagIds IS NOT NULL AND LEN(@TagIds) > 0
      INSERT INTO dbo.WorkLogTags (WorkLogId, TagId)
      SELECT DISTINCT @WorkLogId, TRY_CONVERT(UNIQUEIDENTIFIER, LTRIM(RTRIM(value)))
      FROM STRING_SPLIT(@TagIds, ',')
      WHERE TRY_CONVERT(UNIQUEIDENTIFIER, LTRIM(RTRIM(value))) IS NOT NULL
        AND EXISTS (SELECT 1 FROM dbo.Labels tg WHERE tg.Id = TRY_CONVERT(UNIQUEIDENTIFIER, LTRIM(RTRIM(value))));

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;

  SELECT t.Id, t.Name, t.Color
  FROM dbo.WorkLogTags wt
  JOIN dbo.Labels      t ON t.Id = wt.TagId
  WHERE wt.WorkLogId = @WorkLogId
  ORDER BY t.Name;
END;
GO
