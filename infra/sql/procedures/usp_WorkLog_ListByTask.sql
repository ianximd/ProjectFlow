CREATE OR ALTER PROCEDURE dbo.usp_WorkLog_ListByTask
  @TaskId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    wl.Id, wl.TaskId, wl.UserId, u.Name AS UserName, u.AvatarUrl,
    wl.TimeSpentSeconds, wl.StartedAt, wl.EndedAt, wl.Billable, wl.Source,
    wl.Description, wl.CreatedAt
  FROM dbo.WorkLogs wl
  JOIN dbo.Users    u ON u.Id = wl.UserId
  WHERE wl.TaskId = @TaskId
  ORDER BY wl.StartedAt DESC;

  SELECT
    wl.UserId, u.Name AS UserName, u.AvatarUrl,
    SUM(wl.TimeSpentSeconds) AS TotalSeconds
  FROM dbo.WorkLogs wl
  JOIN dbo.Users    u ON u.Id = wl.UserId
  WHERE wl.TaskId = @TaskId
  GROUP BY wl.UserId, u.Name, u.AvatarUrl
  ORDER BY TotalSeconds DESC;
END;
GO
