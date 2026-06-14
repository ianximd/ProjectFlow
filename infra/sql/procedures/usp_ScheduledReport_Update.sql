CREATE OR ALTER PROCEDURE dbo.usp_ScheduledReport_Update
  @Id              UNIQUEIDENTIFIER,
  @Cadence         NVARCHAR(MAX) = NULL,
  @DeliveryChannel NVARCHAR(10)  = NULL,
  @Recipients      NVARCHAR(MAX) = NULL,
  @Enabled         BIT           = NULL,
  @NextRunAt       DATETIME2     = NULL
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.ScheduledReports SET
    Cadence         = ISNULL(@Cadence,         Cadence),
    DeliveryChannel = ISNULL(@DeliveryChannel, DeliveryChannel),
    Recipients      = ISNULL(@Recipients,      Recipients),
    Enabled         = ISNULL(@Enabled,         Enabled),
    NextRunAt       = ISNULL(@NextRunAt,       NextRunAt),
    UpdatedAt       = SYSUTCDATETIME()
  WHERE Id = @Id AND DeletedAt IS NULL;

  SELECT * FROM dbo.ScheduledReports WHERE Id = @Id;
END;
GO
