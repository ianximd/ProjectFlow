CREATE OR ALTER PROCEDURE dbo.usp_ScheduledReport_ListByWorkspace
  @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM dbo.ScheduledReports
    WHERE WorkspaceId = @WorkspaceId AND DeletedAt IS NULL
    ORDER BY CreatedAt DESC;
END;
GO
