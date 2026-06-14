-- Phase 9c: schedules the sweep should deliver — enabled, live schedules whose
-- NextRunAt has arrived. Disabled / soft-removed / future-dated schedules are
-- excluded. Mirrors usp_TaskRecurrence_ListDue.
CREATE OR ALTER PROCEDURE dbo.usp_ScheduledReport_ListDue
  @Now DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  SELECT *
  FROM   dbo.ScheduledReports
  WHERE  Enabled = 1
    AND  DeletedAt IS NULL
    AND  NextRunAt IS NOT NULL
    AND  NextRunAt <= @Now
  ORDER  BY NextRunAt;
END;
GO
