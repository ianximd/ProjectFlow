CREATE OR ALTER PROCEDURE dbo.usp_WorkLog_GetContext
    @WorkLogId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1
        t.WorkspaceId,
        wl.UserId AS OwnerId
    FROM dbo.WorkLogs wl
    JOIN dbo.Tasks    t ON t.Id = wl.TaskId
    WHERE wl.Id = @WorkLogId
      AND t.DeletedAt IS NULL;
END;
