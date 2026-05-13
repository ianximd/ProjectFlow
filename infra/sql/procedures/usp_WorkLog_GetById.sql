-- Single-row read for the audit-snapshot fetcher (Phase 6 W43 Option A
-- extension). Returns the canonical WorkLog row by primary key.
CREATE OR ALTER PROCEDURE dbo.usp_WorkLog_GetById
    @WorkLogId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1
           Id,
           TaskId,
           UserId,
           TimeSpentSeconds,
           StartedAt,
           Description,
           CreatedAt
    FROM   dbo.WorkLogs
    WHERE  Id = @WorkLogId;
END;
GO
