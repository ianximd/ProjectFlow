CREATE OR ALTER PROCEDURE dbo.usp_Dashboard_TimeTracked
  @WorkspaceId UNIQUEIDENTIFIER,
  @ScopePrefix NVARCHAR(901) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SELECT
    u.Id   AS UserId,
    u.Name AS UserName,
    SUM(wl.TimeSpentSeconds) AS TotalSeconds
  FROM dbo.WorkLogs wl
  JOIN dbo.Tasks t ON t.Id = wl.TaskId AND t.WorkspaceId = @WorkspaceId AND t.DeletedAt IS NULL
  JOIN dbo.Users u ON u.Id = wl.UserId
  WHERE (@ScopePrefix IS NULL OR t.ListPath LIKE @ScopePrefix)
  GROUP BY u.Id, u.Name
  ORDER BY TotalSeconds DESC;
END;
GO
