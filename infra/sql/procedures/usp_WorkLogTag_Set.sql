CREATE OR ALTER PROCEDURE dbo.usp_WorkLogTag_Set
  @WorkLogId UNIQUEIDENTIFIER,
  @TagIds    NVARCHAR(MAX) = NULL   -- comma-delimited GUID list; NULL/'' clears all
AS
BEGIN
  SET NOCOUNT ON;

  -- A "tag" (Label) is Space-scoped (dbo.Labels.ProjectId). Only allow labels that
  -- live in the SAME Space as the worklog's task, so a caller can't attach (and
  -- thereby disclose the name/color of) another tenant's Label by guessing its id.
  -- Mirrors usp_Tag_LinkTask's l.ProjectId = t.ProjectId guard.
  DECLARE @ProjectId UNIQUEIDENTIFIER =
    (SELECT t.ProjectId FROM dbo.WorkLogs wl JOIN dbo.Tasks t ON t.Id = wl.TaskId WHERE wl.Id = @WorkLogId);

  BEGIN TRY
    BEGIN TRANSACTION;

    DELETE FROM dbo.WorkLogTags WHERE WorkLogId = @WorkLogId;

    IF @TagIds IS NOT NULL AND LEN(@TagIds) > 0
      INSERT INTO dbo.WorkLogTags (WorkLogId, TagId)
      SELECT DISTINCT @WorkLogId, TRY_CONVERT(UNIQUEIDENTIFIER, LTRIM(RTRIM(value)))
      FROM STRING_SPLIT(@TagIds, ',')
      WHERE TRY_CONVERT(UNIQUEIDENTIFIER, LTRIM(RTRIM(value))) IS NOT NULL
        AND EXISTS (SELECT 1 FROM dbo.Labels tg
                    WHERE tg.Id = TRY_CONVERT(UNIQUEIDENTIFIER, LTRIM(RTRIM(value)))
                      AND tg.ProjectId = @ProjectId);

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
