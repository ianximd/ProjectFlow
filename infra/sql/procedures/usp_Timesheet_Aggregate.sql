CREATE OR ALTER PROCEDURE dbo.usp_Timesheet_Aggregate
  @TimesheetId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @UserId UNIQUEIDENTIFIER, @PeriodStart DATE, @PeriodEnd DATE;
  SELECT @UserId = UserId, @PeriodStart = PeriodStart, @PeriodEnd = PeriodEnd
  FROM dbo.Timesheets WHERE Id = @TimesheetId;

  IF @UserId IS NULL
  BEGIN
    ;THROW 51820, 'Timesheet not found', 1;
  END

  -- Result set 1: one row per (work date, task), billable split.
  SELECT
    CAST(wl.StartedAt AS DATE)                                            AS WorkDate,
    wl.TaskId                                                             AS TaskId,
    tk.Title                                                             AS TaskTitle,
    SUM(wl.TimeSpentSeconds)                                             AS TotalSeconds,
    SUM(CASE WHEN wl.Billable = 1 THEN wl.TimeSpentSeconds ELSE 0 END)   AS BillableSeconds,
    SUM(CASE WHEN wl.Billable = 0 THEN wl.TimeSpentSeconds ELSE 0 END)   AS NonBillableSeconds
  FROM dbo.WorkLogs wl
  JOIN dbo.Tasks    tk ON tk.Id = wl.TaskId
  WHERE wl.UserId = @UserId
    AND wl.EndedAt IS NOT NULL                       -- closed entries only (no running timer)
    AND CAST(wl.StartedAt AS DATE) BETWEEN @PeriodStart AND @PeriodEnd
  GROUP BY CAST(wl.StartedAt AS DATE), wl.TaskId, tk.Title
  ORDER BY WorkDate ASC, TaskTitle ASC;

  -- Result set 2: period grand totals.
  SELECT
    SUM(wl.TimeSpentSeconds)                                             AS TotalSeconds,
    SUM(CASE WHEN wl.Billable = 1 THEN wl.TimeSpentSeconds ELSE 0 END)   AS BillableSeconds,
    SUM(CASE WHEN wl.Billable = 0 THEN wl.TimeSpentSeconds ELSE 0 END)   AS NonBillableSeconds
  FROM dbo.WorkLogs wl
  WHERE wl.UserId = @UserId
    AND wl.EndedAt IS NOT NULL
    AND CAST(wl.StartedAt AS DATE) BETWEEN @PeriodStart AND @PeriodEnd;
END;
GO
