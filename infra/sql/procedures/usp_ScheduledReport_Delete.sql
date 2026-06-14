CREATE OR ALTER PROCEDURE dbo.usp_ScheduledReport_Delete
  @Id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.ScheduledReports SET DeletedAt = SYSUTCDATETIME(), Enabled = 0
    WHERE Id = @Id AND DeletedAt IS NULL;
  SELECT @@ROWCOUNT AS Deleted;
END;
GO
