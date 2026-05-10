-- usp_Report_SprintSummary
-- Returns summary stats and status breakdown for a sprint
-- ResultSet 1: sprint overview row
-- ResultSet 2: per-status breakdown
CREATE OR ALTER PROCEDURE dbo.usp_Report_SprintSummary
  @SprintId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  -- ResultSet 1: overview
  SELECT
    s.Id   AS SprintId,
    s.Name AS SprintName,
    CAST(s.StartDate AS DATE)    AS StartDate,
    CAST(s.EndDate   AS DATE)    AS EndDate,
    COUNT(t.Id)                  AS TotalIssues,
    SUM(CASE WHEN t.ResolvedAt IS NOT NULL THEN 1 ELSE 0 END) AS CompletedIssues,
    SUM(CASE WHEN t.ResolvedAt IS NULL     THEN 1 ELSE 0 END) AS IncompleteIssues,
    ISNULL(SUM(ISNULL(t.StoryPoints, 0)), 0) AS TotalPoints,
    ISNULL(SUM(CASE WHEN t.ResolvedAt IS NOT NULL THEN ISNULL(t.StoryPoints, 0) ELSE 0 END), 0) AS CompletedPoints
  FROM dbo.Sprints s
  LEFT JOIN dbo.Tasks t
    ON t.SprintId = s.Id AND t.DeletedAt IS NULL
  WHERE s.Id = @SprintId
  GROUP BY s.Id, s.Name, s.StartDate, s.EndDate;

  -- ResultSet 2: per-status breakdown
  SELECT
    t.Status,
    COUNT(t.Id) AS IssueCount,
    ISNULL(SUM(ISNULL(t.StoryPoints, 0)), 0) AS StoryPoints
  FROM dbo.Tasks t
  WHERE t.SprintId  = @SprintId
    AND t.DeletedAt IS NULL
  GROUP BY t.Status
  ORDER BY COUNT(t.Id) DESC;
END;
GO
