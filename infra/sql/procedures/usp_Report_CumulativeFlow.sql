-- usp_Report_CumulativeFlow
-- Status-band issue counts over time for a hierarchy scope.
-- @ScopeType: 'space' | 'folder' | 'list' ; @ScopeId: the node id.
-- v1 band: resolved-on/before-day -> 'DONE', else the task's current Status
-- (true per-status history from AuditLog is a documented follow-up).
-- ResultSet: (Date, Status, IssueCount) -- long form, one row per (day, status).
CREATE OR ALTER PROCEDURE dbo.usp_Report_CumulativeFlow
  @ScopeType NVARCHAR(8),
  @ScopeId   UNIQUEIDENTIFIER,
  @Weeks     INT = 8
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @StartDate DATE = DATEADD(WEEK, -@Weeks, CAST(GETUTCDATE() AS DATE));
  DECLARE @EndDate   DATE = CAST(GETUTCDATE() AS DATE);
  DECLARE @Days INT = DATEDIFF(DAY, @StartDate, @EndDate);

  ;WITH ScopeTasks AS (
    SELECT t.Id, t.Status, t.CreatedAt, t.ResolvedAt
    FROM dbo.Tasks t
    WHERE t.DeletedAt IS NULL
      AND (
        (@ScopeType = 'list'   AND t.ListId = @ScopeId) OR
        (@ScopeType = 'folder' AND t.ListId IN (SELECT l.Id FROM dbo.Lists l WHERE l.FolderId = @ScopeId AND l.DeletedAt IS NULL)) OR
        (@ScopeType = 'space'  AND t.ProjectId = @ScopeId)
      )
  ),
  DateSeries AS (
    SELECT @StartDate AS [Date], 0 AS DayNum
    UNION ALL
    SELECT DATEADD(DAY, 1, [Date]), DayNum + 1
    FROM DateSeries
    WHERE DayNum < @Days
  )
  SELECT
    ds.[Date],
    CASE WHEN st.ResolvedAt IS NOT NULL AND CAST(st.ResolvedAt AS DATE) <= ds.[Date]
         THEN 'DONE' ELSE st.Status END AS Status,
    COUNT(st.Id) AS IssueCount
  FROM DateSeries ds
  JOIN ScopeTasks st
    ON CAST(st.CreatedAt AS DATE) <= ds.[Date]
  GROUP BY
    ds.[Date],
    CASE WHEN st.ResolvedAt IS NOT NULL AND CAST(st.ResolvedAt AS DATE) <= ds.[Date]
         THEN 'DONE' ELSE st.Status END
  ORDER BY ds.[Date], Status
  OPTION (MAXRECURSION 366);
END;
GO
