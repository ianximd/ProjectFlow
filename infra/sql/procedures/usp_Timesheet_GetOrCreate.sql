CREATE OR ALTER PROCEDURE dbo.usp_Timesheet_GetOrCreate
  @WorkspaceId UNIQUEIDENTIFIER,
  @UserId      UNIQUEIDENTIFIER,
  @PeriodStart DATE,
  @PeriodEnd   DATE
AS
BEGIN
  SET NOCOUNT ON;

  IF NOT EXISTS (
    SELECT 1 FROM dbo.Timesheets
    WHERE UserId = @UserId AND PeriodStart = @PeriodStart AND PeriodEnd = @PeriodEnd
  )
  BEGIN
    INSERT INTO dbo.Timesheets (WorkspaceId, UserId, PeriodStart, PeriodEnd)
    VALUES (@WorkspaceId, @UserId, @PeriodStart, @PeriodEnd);
  END

  SELECT Id, WorkspaceId, UserId, PeriodStart, PeriodEnd, Status,
         SubmittedAt, ReviewedById, ReviewedAt, Note, CreatedAt, UpdatedAt
  FROM dbo.Timesheets
  WHERE UserId = @UserId AND PeriodStart = @PeriodStart AND PeriodEnd = @PeriodEnd;
END;
GO
