-- Phase 8b — period lock. Returns IsLocked = 1 when a submitted/approved
-- Timesheet for (@UserId) covers @WorkDate, so the 8a worklog write path can
-- reject create/update whose work date falls inside a locked period (§5.2).
-- Reopening (status back to rejected/draft) lifts the lock — only
-- submitted/approved rows count.
CREATE OR ALTER PROCEDURE dbo.usp_WorkLog_PeriodLocked
    @UserId   UNIQUEIDENTIFIER,
    @WorkDate DATE
AS
BEGIN
    SET NOCOUNT ON;
    SELECT CAST(
      CASE WHEN EXISTS (
        SELECT 1 FROM dbo.Timesheets
        WHERE UserId = @UserId
          AND Status IN ('submitted','approved')
          AND @WorkDate BETWEEN PeriodStart AND PeriodEnd
      ) THEN 1 ELSE 0 END
    AS BIT) AS IsLocked;
END;
GO
