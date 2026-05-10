CREATE OR ALTER PROCEDURE dbo.usp_WorkLog_Create
  @TaskId           UNIQUEIDENTIFIER,
  @UserId           UNIQUEIDENTIFIER,
  @TimeSpentSeconds INT,
  @StartedAt        DATETIME2,
  @Description      NVARCHAR(500) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

  INSERT INTO dbo.WorkLogs (Id, TaskId, UserId, TimeSpentSeconds, StartedAt, Description)
  VALUES (@NewId, @TaskId, @UserId, @TimeSpentSeconds, @StartedAt, @Description);

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
  WHERE wl.Id = @NewId;
END;
GO
