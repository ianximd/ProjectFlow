CREATE OR ALTER PROCEDURE dbo.usp_Task_SetEstimate
  @TaskId          UNIQUEIDENTIFIER,
  @UserId          UNIQUEIDENTIFIER = NULL,   -- when set, upserts a per-assignee estimate
  @EstimateSeconds INT              = NULL    -- NULL clears the targeted estimate
AS
BEGIN
  SET NOCOUNT ON;

  BEGIN TRY
    BEGIN TRANSACTION;

    IF @UserId IS NULL
    BEGIN
      UPDATE dbo.Tasks SET TimeEstimateSeconds = @EstimateSeconds WHERE Id = @TaskId;
    END
    ELSE IF @EstimateSeconds IS NULL
    BEGIN
      DELETE FROM dbo.TaskEstimates WHERE TaskId = @TaskId AND UserId = @UserId;
    END
    ELSE
    BEGIN
      MERGE dbo.TaskEstimates AS tgt
      USING (SELECT @TaskId AS TaskId, @UserId AS UserId) AS src
        ON tgt.TaskId = src.TaskId AND tgt.UserId = src.UserId
      WHEN MATCHED THEN
        UPDATE SET EstimateSeconds = @EstimateSeconds, UpdatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (TaskId, UserId, EstimateSeconds) VALUES (@TaskId, @UserId, @EstimateSeconds);
    END

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;

  SELECT
    t.Id AS TaskId,
    t.TimeEstimateSeconds,
    (SELECT ISNULL(SUM(te.EstimateSeconds), 0) FROM dbo.TaskEstimates te WHERE te.TaskId = t.Id) AS PerAssigneeTotalSeconds
  FROM dbo.Tasks t
  WHERE t.Id = @TaskId;
END;
GO
