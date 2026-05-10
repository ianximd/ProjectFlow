-- usp_Report_Velocity
-- Returns completed story points per sprint for the last N sprints in a project
-- ResultSet: SprintName, StartDate, EndDate, CommittedPoints, CompletedPoints
CREATE OR ALTER PROCEDURE dbo.usp_Report_Velocity
  @ProjectId  UNIQUEIDENTIFIER,
  @NumSprints INT = 5
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP (@NumSprints)
    s.Id            AS SprintId,
    s.Name          AS SprintName,
    CAST(s.StartDate AS DATE) AS StartDate,
    CAST(s.EndDate   AS DATE) AS EndDate,
    -- Committed = all tasks in sprint with story points
    ISNULL(SUM(ISNULL(t.StoryPoints, 0)), 0) AS CommittedPoints,
    -- Completed = tasks in DONE category (ResolvedAt IS NOT NULL)
    ISNULL(SUM(
      CASE WHEN t.ResolvedAt IS NOT NULL
           THEN ISNULL(t.StoryPoints, 0)
           ELSE 0
      END
    ), 0) AS CompletedPoints
  FROM dbo.Sprints s
  LEFT JOIN dbo.Tasks t
    ON t.SprintId = s.Id AND t.DeletedAt IS NULL
  WHERE s.ProjectId = @ProjectId
    AND s.StartDate IS NOT NULL
  GROUP BY s.Id, s.Name, s.StartDate, s.EndDate, s.CompletedAt
  ORDER BY ISNULL(s.CompletedAt, s.StartDate) DESC;
END;
GO
