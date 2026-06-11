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

  -- usp_WorkLog_Create only ever creates COMPLETED entries — the single OPEN timer
  -- row is created exclusively by usp_WorkLog_StartTimer. So always derive a non-NULL
  -- EndedAt when the caller didn't supply one (regardless of @Source), keeping every
  -- Create row OUT of the filtered UQ_WorkLog_ActiveTimer (EndedAt IS NULL) index.
  -- Without this a user's second manual entry — or any source='timer' create —
  -- collides on that unique index.
  IF @EndedAt IS NULL
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
