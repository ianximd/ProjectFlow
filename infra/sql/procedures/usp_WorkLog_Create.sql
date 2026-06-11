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

  -- A non-timer entry is a COMPLETED log, never an open timer. Derive its EndedAt
  -- from StartedAt + duration when the caller didn't supply one, so it stays OUT of
  -- the filtered UQ_WorkLog_ActiveTimer (EndedAt IS NULL) index — otherwise a user's
  -- second manual entry collides with their first. Only Source='timer' rows (created
  -- via usp_WorkLog_StartTimer) are allowed to stay open (EndedAt NULL).
  IF @EndedAt IS NULL AND @Source <> 'timer'
    SET @EndedAt = DATEADD(SECOND, @TimeSpentSeconds, @StartedAt);

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
