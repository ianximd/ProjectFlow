CREATE OR ALTER PROCEDURE dbo.usp_ScheduledReportRun_ListBySchedule
  @ScheduledReportId UNIQUEIDENTIFIER,
  @Page              INT = 1,
  @PageSize          INT = 20
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @Offset INT = (@Page - 1) * @PageSize;

  SELECT *
  FROM   dbo.ScheduledReportRuns
  WHERE  ScheduledReportId = @ScheduledReportId
  ORDER  BY RanAt DESC
  OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;

  SELECT COUNT(*) AS TotalCount
  FROM   dbo.ScheduledReportRuns
  WHERE  ScheduledReportId = @ScheduledReportId;
END;
GO
