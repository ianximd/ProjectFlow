CREATE OR ALTER PROCEDURE dbo.usp_WorkLog_Update
  @Id               UNIQUEIDENTIFIER,
  @UserId           UNIQUEIDENTIFIER,
  @TimeSpentSeconds INT           = NULL,
  @StartedAt        DATETIME2     = NULL,
  @Description      NVARCHAR(500) = NULL,
  @Billable         BIT           = NULL,
  @EndedAt          DATETIME2     = NULL
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.WorkLogs SET
    TimeSpentSeconds = ISNULL(@TimeSpentSeconds, TimeSpentSeconds),
    StartedAt        = ISNULL(@StartedAt,        StartedAt),
    Description      = ISNULL(@Description,      Description),
    Billable         = ISNULL(@Billable,         Billable),
    EndedAt          = ISNULL(@EndedAt,          EndedAt)
  WHERE Id = @Id AND UserId = @UserId;

  SELECT
    wl.Id, wl.TaskId, wl.UserId, u.Name AS UserName, u.AvatarUrl,
    wl.TimeSpentSeconds, wl.StartedAt, wl.EndedAt, wl.Billable, wl.Source,
    wl.Description, wl.CreatedAt
  FROM dbo.WorkLogs wl
  JOIN dbo.Users    u ON u.Id = wl.UserId
  WHERE wl.Id = @Id;
END;
GO
