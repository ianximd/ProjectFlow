CREATE OR ALTER PROCEDURE dbo.usp_Timesheet_GetById
  @Id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT Id, WorkspaceId, UserId, PeriodStart, PeriodEnd, Status,
         SubmittedAt, ReviewedById, ReviewedAt, Note, CreatedAt, UpdatedAt
  FROM dbo.Timesheets
  WHERE Id = @Id;
END;
GO
