CREATE OR ALTER PROCEDURE dbo.usp_Task_GetTimeRollup
  @TaskId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  ;WITH Subtree AS (
    SELECT Id, ParentTaskId, TimeEstimateSeconds
      FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL
    UNION ALL
    SELECT c.Id, c.ParentTaskId, c.TimeEstimateSeconds
      FROM dbo.Tasks c
      JOIN Subtree s ON c.ParentTaskId = s.Id
      WHERE c.DeletedAt IS NULL
  )
  SELECT
    @TaskId AS TaskId,
    -- own-only
    (SELECT ISNULL(SUM(wl.TimeSpentSeconds), 0) FROM dbo.WorkLogs wl WHERE wl.TaskId = @TaskId) AS OwnLoggedSeconds,
    (SELECT TimeEstimateSeconds FROM dbo.Tasks WHERE Id = @TaskId)                              AS OwnEstimateSeconds,
    -- subtree (own + descendants)
    (SELECT ISNULL(SUM(wl.TimeSpentSeconds), 0)
       FROM dbo.WorkLogs wl WHERE wl.TaskId IN (SELECT Id FROM Subtree))                        AS RollupLoggedSeconds,
    (SELECT ISNULL(SUM(s.TimeEstimateSeconds), 0) FROM Subtree s)                               AS RollupEstimateSeconds
  OPTION (MAXRECURSION 0);
END;
GO
