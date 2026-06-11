CREATE OR ALTER PROCEDURE dbo.usp_WorkLog_StartTimer
  @TaskId UNIQUEIDENTIFIER,
  @UserId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @NewId UNIQUEIDENTIFIER = NEWID();
  DECLARE @Now   DATETIME2        = SYSUTCDATETIME();

  BEGIN TRY
    BEGIN TRANSACTION;

    -- Auto-stop any existing open timer for this user so the new start is always
    -- safe under UQ_WorkLog_ActiveTimer.
    UPDATE dbo.WorkLogs
      SET EndedAt          = @Now,
          TimeSpentSeconds = DATEDIFF(SECOND, StartedAt, @Now)
      WHERE UserId = @UserId AND EndedAt IS NULL;

    INSERT INTO dbo.WorkLogs (Id, TaskId, UserId, TimeSpentSeconds, StartedAt, EndedAt, Source, Billable)
    VALUES (@NewId, @TaskId, @UserId, 0, @Now, NULL, 'timer', 0);

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;

  SELECT
    wl.Id, wl.TaskId, wl.UserId, u.Name AS UserName, u.AvatarUrl,
    wl.TimeSpentSeconds, wl.StartedAt, wl.EndedAt, wl.Billable, wl.Source,
    wl.Description, wl.CreatedAt
  FROM dbo.WorkLogs wl
  JOIN dbo.Users    u ON u.Id = wl.UserId
  WHERE wl.Id = @NewId;
END;
GO
