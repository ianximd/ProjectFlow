CREATE OR ALTER PROCEDURE dbo.usp_ScheduledReport_Create
  @WorkspaceId     UNIQUEIDENTIFIER,
  @DashboardId     UNIQUEIDENTIFIER = NULL,
  @ReportKind      NVARCHAR(24)     = NULL,
  @ReportParams    NVARCHAR(MAX)    = NULL,
  @Cadence         NVARCHAR(MAX),
  @DeliveryChannel NVARCHAR(10)     = 'inbox',
  @Recipients      NVARCHAR(MAX),
  @NextRunAt       DATETIME2        = NULL,
  @OwnerId         UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

  INSERT INTO dbo.ScheduledReports
    (Id, WorkspaceId, DashboardId, ReportKind, ReportParams, Cadence, DeliveryChannel, Recipients, Enabled, NextRunAt, OwnerId)
  VALUES
    (@NewId, @WorkspaceId, @DashboardId, @ReportKind, @ReportParams, @Cadence, @DeliveryChannel, @Recipients, 1, @NextRunAt, @OwnerId);

  SELECT * FROM dbo.ScheduledReports WHERE Id = @NewId;
END;
GO
