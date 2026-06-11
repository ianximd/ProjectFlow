CREATE OR ALTER PROCEDURE dbo.usp_WorkLog_StopTimer
  @UserId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @Now DATETIME2 = SYSUTCDATETIME();
  DECLARE @Id  UNIQUEIDENTIFIER;

  SELECT TOP 1 @Id = Id FROM dbo.WorkLogs WHERE UserId = @UserId AND EndedAt IS NULL;

  IF @Id IS NOT NULL
    UPDATE dbo.WorkLogs
      SET EndedAt          = @Now,
          TimeSpentSeconds = DATEDIFF(SECOND, StartedAt, @Now)
      WHERE Id = @Id;

  SELECT
    wl.Id, wl.TaskId, wl.UserId, u.Name AS UserName, u.AvatarUrl,
    wl.TimeSpentSeconds, wl.StartedAt, wl.EndedAt, wl.Billable, wl.Source,
    wl.Description, wl.CreatedAt
  FROM dbo.WorkLogs wl
  JOIN dbo.Users    u ON u.Id = wl.UserId
  WHERE wl.Id = @Id;
END;
GO
