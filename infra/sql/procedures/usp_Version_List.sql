CREATE OR ALTER PROCEDURE dbo.usp_Version_List
  @ProjectId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  -- Versions with issue counts
  SELECT
    v.*,
    COUNT(tv.TaskId)                                             AS TotalIssues,
    SUM(CASE WHEN t.Status IN ('DONE','CLOSED','RELEASED') THEN 1 ELSE 0 END) AS CompletedIssues
  FROM dbo.Versions    v
  LEFT JOIN dbo.TaskVersions tv ON tv.VersionId = v.Id
  LEFT JOIN dbo.Tasks        t  ON t.Id = tv.TaskId AND t.DeletedAt IS NULL
  WHERE v.ProjectId = @ProjectId
  GROUP BY v.Id, v.ProjectId, v.Name, v.Description, v.Status,
           v.StartDate, v.ReleaseDate, v.ReleasedAt, v.CreatedAt
  ORDER BY v.ReleaseDate ASC, v.CreatedAt DESC;
END;
GO
