-- usp_Report_Burndown
-- Returns day-by-day remaining story points for a sprint
-- ResultSet 1: sprint meta  (TotalPoints, StartDate, EndDate)
-- ResultSet 2: per-day data (Date, RemainingPoints, IdealPoints)
CREATE OR ALTER PROCEDURE dbo.usp_Report_Burndown
  @SprintId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE
    @StartDate  DATE,
    @EndDate    DATE,
    @TotalPts   FLOAT;

  SELECT
    @StartDate = CAST(StartDate AS DATE),
    @EndDate   = CAST(ISNULL(CompletedAt, ISNULL(EndDate, GETUTCDATE())) AS DATE)
  FROM dbo.Sprints
  WHERE Id = @SprintId;

  -- Cap end date at today
  IF @EndDate > CAST(GETUTCDATE() AS DATE)
    SET @EndDate = CAST(GETUTCDATE() AS DATE);

  -- Total committed points (all tasks in sprint)
  SELECT @TotalPts = ISNULL(SUM(StoryPoints), 0)
  FROM dbo.Tasks
  WHERE SprintId = @SprintId
    AND DeletedAt IS NULL;

  -- ResultSet 1: sprint meta
  SELECT
    @TotalPts AS TotalPoints,
    @StartDate AS StartDate,
    @EndDate   AS EndDate;

  -- ResultSet 2: per-day remaining and ideal points
  -- Build date series via recursive CTE
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
    -- Remaining: tasks whose ResolvedAt is NULL or after this day
    ISNULL(SUM(
      CASE WHEN t.ResolvedAt IS NULL OR CAST(t.ResolvedAt AS DATE) > ds.[Date]
           THEN ISNULL(t.StoryPoints, 0)
           ELSE 0
      END
    ), 0) AS RemainingPoints,
    -- Ideal burndown: linear decrease from TotalPts to 0
    ROUND(
      @TotalPts * (1.0 - (CAST(DayNum AS FLOAT) / NULLIF(DATEDIFF(DAY, @StartDate, @EndDate), 0))),
      2
    ) AS IdealPoints
  FROM DateSeries ds
  CROSS JOIN (
    SELECT StoryPoints, ResolvedAt
    FROM dbo.Tasks
    WHERE SprintId = @SprintId AND DeletedAt IS NULL
  ) t
  GROUP BY ds.[Date], ds.DayNum
  ORDER BY ds.[Date]
  OPTION (MAXRECURSION 366);
END;
GO
