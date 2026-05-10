-- usp_Report_Workload
-- Returns per-assignee issue counts and story point totals for a project
CREATE OR ALTER PROCEDURE dbo.usp_Report_Workload
  @ProjectId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    u.Name                         AS AssigneeName,
    u.Id                           AS AssigneeId,
    COUNT(t.Id)                    AS TotalIssues,
    SUM(CASE WHEN t.ResolvedAt IS NULL THEN 1 ELSE 0 END) AS OpenIssues,
    SUM(CASE WHEN t.ResolvedAt IS NOT NULL THEN 1 ELSE 0 END) AS DoneIssues,
    ISNULL(SUM(ISNULL(t.StoryPoints, 0)), 0) AS TotalPoints,
    ISNULL(SUM(CASE WHEN t.ResolvedAt IS NULL THEN ISNULL(t.StoryPoints, 0) ELSE 0 END), 0) AS OpenPoints
  FROM dbo.Tasks t
  INNER JOIN dbo.TaskAssignees ta ON ta.TaskId = t.Id
  INNER JOIN dbo.Users u ON u.Id = ta.UserId
  WHERE t.ProjectId = @ProjectId
    AND t.DeletedAt IS NULL
  GROUP BY u.Id, u.Name
  ORDER BY TotalIssues DESC;
END;
GO
