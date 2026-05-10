CREATE OR ALTER PROCEDURE dbo.usp_WorkLog_Delete
  @Id     UNIQUEIDENTIFIER,
  @UserId UNIQUEIDENTIFIER   -- must match owner
AS
BEGIN
  SET NOCOUNT ON;
  DELETE FROM dbo.WorkLogs
  WHERE Id = @Id AND UserId = @UserId;
END;
GO
