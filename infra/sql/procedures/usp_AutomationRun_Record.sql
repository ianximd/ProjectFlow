-- usp_AutomationRun_Record
-- Writes one AutomationRuns audit row and bumps AutomationUsage for the run's
-- workspace+period. Counted statuses are the terminal ones (success/partial/
-- failed); skipped/loop_blocked are audited but not metered.
CREATE OR ALTER PROCEDURE dbo.usp_AutomationRun_Record
  @RuleId        UNIQUEIDENTIFIER,
  @WorkspaceId   UNIQUEIDENTIFIER,
  @ProjectId     UNIQUEIDENTIFIER = NULL,
  @TriggerType   NVARCHAR(40),
  @Status        NVARCHAR(16),
  @Payload       NVARCHAR(MAX)    = NULL,
  @ActionResults NVARCHAR(MAX)    = NULL,
  @Error         NVARCHAR(MAX)    = NULL,
  @Depth         INT              = 0,
  @StartedAt     DATETIME2,
  @DurationMs    INT              = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @Id     UNIQUEIDENTIFIER = NEWID();
  DECLARE @Period CHAR(6) = CONVERT(CHAR(6), SYSUTCDATETIME(), 112); -- YYYYMM

  BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO dbo.AutomationRuns
      (Id, RuleId, WorkspaceId, ProjectId, TriggerType, Status, Payload, ActionResults, Error, Depth, StartedAt, FinishedAt, DurationMs)
    VALUES
      (@Id, @RuleId, @WorkspaceId, @ProjectId, @TriggerType, @Status, @Payload, @ActionResults, @Error, @Depth, @StartedAt, SYSUTCDATETIME(), @DurationMs);

    IF @Status IN ('success', 'partial', 'failed')
    BEGIN
      MERGE dbo.AutomationUsage AS tgt
      USING (SELECT @WorkspaceId AS WorkspaceId, @Period AS Period) AS src
        ON tgt.WorkspaceId = src.WorkspaceId AND tgt.Period = src.Period
      WHEN MATCHED THEN UPDATE SET RunCount = tgt.RunCount + 1
      WHEN NOT MATCHED THEN INSERT (WorkspaceId, Period, RunCount) VALUES (@WorkspaceId, @Period, 1);
    END

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;

  SELECT * FROM dbo.AutomationRuns WHERE Id = @Id;
END;
GO
