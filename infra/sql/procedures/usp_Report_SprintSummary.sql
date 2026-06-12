-- usp_Report_SprintSummary
-- Returns summary stats and status breakdown for a sprint.
-- Phase 8c: membership now reads the sprint's List (Tasks.ListId = Sprints.ListId),
-- falling back to the Tasks.SprintId denorm when the sprint isn't List-bound.
-- ResultSet 1: sprint overview row
-- ResultSet 2: per-status breakdown
CREATE OR ALTER PROCEDURE dbo.usp_Report_SprintSummary
  @SprintId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @ListId UNIQUEIDENTIFIER;
  SELECT @ListId = ListId FROM dbo.Sprints WHERE Id = @SprintId;

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
    ON t.DeletedAt IS NULL
   AND ( (@ListId IS NOT NULL AND t.ListId = @ListId) OR t.SprintId = s.Id )
  WHERE s.Id = @SprintId
  GROUP BY s.Id, s.Name, s.StartDate, s.EndDate;

  -- ResultSet 2: per-status breakdown
  SELECT
    t.Status,
    COUNT(t.Id) AS IssueCount,
    ISNULL(SUM(ISNULL(t.StoryPoints, 0)), 0) AS StoryPoints
  FROM dbo.Tasks t
  WHERE t.DeletedAt IS NULL
    AND ( (@ListId IS NOT NULL AND t.ListId = @ListId) OR t.SprintId = @SprintId )
  GROUP BY t.Status
  ORDER BY COUNT(t.Id) DESC;
END;
GO
