-- usp_Report_CreatedVsResolved
-- Returns weekly created vs resolved task counts over the last N weeks
CREATE OR ALTER PROCEDURE dbo.usp_Report_CreatedVsResolved
  @ProjectId UNIQUEIDENTIFIER,
  @Weeks     INT = 8
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @StartDate DATE = DATEADD(WEEK, -@Weeks, CAST(GETUTCDATE() AS DATE));

  WITH WeekSeries AS (
    SELECT @StartDate AS WeekStart, 0 AS WeekNum
    UNION ALL
    SELECT DATEADD(WEEK, 1, WeekStart), WeekNum + 1
    FROM WeekSeries
    WHERE WeekNum < @Weeks - 1
  )
  SELECT
    ws.WeekStart,
    DATEADD(DAY, 6, ws.WeekStart) AS WeekEnd,
    COUNT(DISTINCT CASE WHEN CAST(t.CreatedAt AS DATE) >= ws.WeekStart
                         AND CAST(t.CreatedAt AS DATE) <= DATEADD(DAY, 6, ws.WeekStart)
                    THEN t.Id END) AS Created,
    COUNT(DISTINCT CASE WHEN t.ResolvedAt IS NOT NULL
                         AND CAST(t.ResolvedAt AS DATE) >= ws.WeekStart
                         AND CAST(t.ResolvedAt AS DATE) <= DATEADD(DAY, 6, ws.WeekStart)
                    THEN t.Id END) AS Resolved
  FROM WeekSeries ws
  CROSS JOIN (
    SELECT Id, CreatedAt, ResolvedAt
    FROM dbo.Tasks
    WHERE ProjectId = @ProjectId
      AND DeletedAt IS NULL
      AND CreatedAt >= DATEADD(WEEK, -@Weeks, GETUTCDATE())
  ) t
  GROUP BY ws.WeekStart
  ORDER BY ws.WeekStart
  OPTION (MAXRECURSION 52);
END;
GO
