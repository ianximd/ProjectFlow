CREATE OR ALTER PROCEDURE dbo.usp_WorkLog_ListByTask
  @TaskId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  -- Individual log entries
  SELECT
    wl.Id,
    wl.TaskId,
    wl.UserId,
    u.Name           AS UserName,
    u.AvatarUrl,
    wl.TimeSpentSeconds,
    wl.StartedAt,
    wl.Description,
    wl.CreatedAt
  FROM dbo.WorkLogs wl
  JOIN dbo.Users    u  ON u.Id = wl.UserId
  WHERE wl.TaskId = @TaskId
  ORDER BY wl.StartedAt DESC;

  -- Aggregate totals per user (second result set)
  SELECT
    wl.UserId,
    u.Name     AS UserName,
    u.AvatarUrl,
    SUM(wl.TimeSpentSeconds) AS TotalSeconds
  FROM dbo.WorkLogs wl
  JOIN dbo.Users    u ON u.Id = wl.UserId
  WHERE wl.TaskId = @TaskId
  GROUP BY wl.UserId, u.Name, u.AvatarUrl
  ORDER BY TotalSeconds DESC;
END;
GO
