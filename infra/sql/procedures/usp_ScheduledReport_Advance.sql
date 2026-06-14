-- Set NextRunAt after a run; @NextRunAt IS NULL means the cadence ended → disable.
CREATE OR ALTER PROCEDURE dbo.usp_ScheduledReport_Advance
  @Id        UNIQUEIDENTIFIER,
  @NextRunAt DATETIME2 = NULL,
  @Enabled   BIT       = NULL
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.ScheduledReports SET
    NextRunAt = @NextRunAt,
    Enabled   = ISNULL(@Enabled, CASE WHEN @NextRunAt IS NULL THEN 0 ELSE 1 END),
    UpdatedAt = SYSUTCDATETIME()
  WHERE Id = @Id AND DeletedAt IS NULL;

  SELECT * FROM dbo.ScheduledReports WHERE Id = @Id;
END;
GO
