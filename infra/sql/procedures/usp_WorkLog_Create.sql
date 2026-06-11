CREATE OR ALTER PROCEDURE dbo.usp_WorkLog_Create
  @TaskId           UNIQUEIDENTIFIER,
  @UserId           UNIQUEIDENTIFIER,
  @TimeSpentSeconds INT,
  @StartedAt        DATETIME2,
  @Description      NVARCHAR(500) = NULL,
  @Billable         BIT           = 0,
  @Source           NVARCHAR(10)  = 'manual',
  @EndedAt          DATETIME2     = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

  INSERT INTO dbo.WorkLogs (Id, TaskId, UserId, TimeSpentSeconds, StartedAt, EndedAt, Description, Billable, Source)
  VALUES (@NewId, @TaskId, @UserId, @TimeSpentSeconds, @StartedAt, @EndedAt, @Description, @Billable, @Source);

  SELECT
    wl.Id, wl.TaskId, wl.UserId, u.Name AS UserName, u.AvatarUrl,
    wl.TimeSpentSeconds, wl.StartedAt, wl.EndedAt, wl.Billable, wl.Source,
    wl.Description, wl.CreatedAt
  FROM dbo.WorkLogs wl
  JOIN dbo.Users    u ON u.Id = wl.UserId
  WHERE wl.Id = @NewId;
END;
GO
