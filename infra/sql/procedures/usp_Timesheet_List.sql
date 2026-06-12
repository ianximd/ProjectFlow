CREATE OR ALTER PROCEDURE dbo.usp_Timesheet_List
  @WorkspaceId UNIQUEIDENTIFIER,
  @UserId      UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT Id, WorkspaceId, UserId, PeriodStart, PeriodEnd, Status,
         SubmittedAt, ReviewedById, ReviewedAt, Note, CreatedAt, UpdatedAt
  FROM dbo.Timesheets
  WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId
  ORDER BY PeriodStart DESC;
END;
GO
