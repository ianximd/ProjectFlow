-- usp_Report_Burnup
-- Burnup for a sprint: cumulative COMPLETED story points vs total SCOPE per day.
-- Complement of usp_Report_Burndown (completed rises toward the scope line).
-- ResultSet 1: sprint meta (SprintId, SprintName, StartDate, EndDate, TotalScopePoints, CompletedPoints)
-- ResultSet 2: per-day (Date, CompletedPoints, ScopePoints)
CREATE OR ALTER PROCEDURE dbo.usp_Report_Burnup
  @SprintId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE
    @StartDate DATE,
    @EndDate   DATE,
    @ScopePts  FLOAT,
    @DonePts   FLOAT,
    @Name      NVARCHAR(255);

  SELECT
    @Name      = s.Name,
    @StartDate = CAST(s.StartDate AS DATE),
    @EndDate   = CAST(ISNULL(s.CompletedAt, ISNULL(s.EndDate, GETUTCDATE())) AS DATE)
  FROM dbo.Sprints s
  WHERE s.Id = @SprintId;

  IF @EndDate > CAST(GETUTCDATE() AS DATE)
    SET @EndDate = CAST(GETUTCDATE() AS DATE);

  SELECT @ScopePts = ISNULL(SUM(ISNULL(StoryPoints, 0)), 0)
  FROM dbo.Tasks
  WHERE SprintId = @SprintId AND DeletedAt IS NULL;

  SELECT @DonePts = ISNULL(SUM(CASE WHEN ResolvedAt IS NOT NULL THEN ISNULL(StoryPoints, 0) ELSE 0 END), 0)
  FROM dbo.Tasks
  WHERE SprintId = @SprintId AND DeletedAt IS NULL;

  SELECT
    @SprintId  AS SprintId,
    @Name      AS SprintName,
    @StartDate AS StartDate,
    @EndDate   AS EndDate,
    @ScopePts  AS TotalScopePoints,
    @DonePts   AS CompletedPoints;

  DECLARE @Days INT = DATEDIFF(DAY, @StartDate, @EndDate);

  WITH DateSeries AS (
    SELECT @StartDate AS [Date], 0 AS DayNum
    UNION ALL
    SELECT DATEADD(DAY, 1, [Date]), DayNum + 1
    FROM DateSeries
    WHERE DayNum < @Days
  )
  SELECT
    ds.[Date],
    ISNULL(SUM(
      CASE WHEN t.ResolvedAt IS NOT NULL AND CAST(t.ResolvedAt AS DATE) <= ds.[Date]
           THEN ISNULL(t.StoryPoints, 0)
           ELSE 0
      END
    ), 0) AS CompletedPoints,
    @ScopePts AS ScopePoints
  FROM DateSeries ds
  CROSS JOIN (
    SELECT StoryPoints, ResolvedAt
    FROM dbo.Tasks
    WHERE SprintId = @SprintId AND DeletedAt IS NULL
  ) t
  GROUP BY ds.[Date]
  ORDER BY ds.[Date]
  OPTION (MAXRECURSION 366);
END;
GO
