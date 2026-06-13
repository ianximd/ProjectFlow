-- usp_Report_LeadCycleTime
-- Per-task lead time (created->resolved) and cycle time (first in-progress->resolved).
-- The in-progress transition is sourced from dbo.AuditLog status changes.
-- @ScopeType: 'space' | 'folder' | 'list' ; @ScopeId: the node id.
-- ResultSet: per-task rows (TaskId, IssueKey, Title, CreatedAt, StartedAt,
--            ResolvedAt, LeadTimeSeconds, CycleTimeSeconds).
CREATE OR ALTER PROCEDURE dbo.usp_Report_LeadCycleTime
  @ScopeType NVARCHAR(8),
  @ScopeId   UNIQUEIDENTIFIER,
  @Weeks     INT = 12
AS
BEGIN
  SET NOCOUNT ON;

  ;WITH ScopeTasks AS (
    SELECT t.Id, t.IssueKey, t.Title, t.CreatedAt, t.ResolvedAt
    FROM dbo.Tasks t
    WHERE t.DeletedAt IS NULL
      AND t.CreatedAt >= DATEADD(WEEK, -@Weeks, GETUTCDATE())
      AND (
        (@ScopeType = 'list'   AND t.ListId = @ScopeId) OR
        (@ScopeType = 'folder' AND t.ListId IN (SELECT l.Id FROM dbo.Lists l WHERE l.FolderId = @ScopeId AND l.DeletedAt IS NULL)) OR
        (@ScopeType = 'space'  AND t.ProjectId = @ScopeId)
      )
  ),
  FirstStart AS (
    SELECT
      a.ResourceId,
      MIN(a.CreatedAt) AS StartedAt
    FROM dbo.AuditLog a
    WHERE a.Resource = 'Task'
      AND a.Action   = 'UPDATE'
      AND a.NewValues IS NOT NULL
      AND (
        a.NewValues LIKE '%IN_PROGRESS%' OR
        a.NewValues LIKE '%In Progress%' OR
        a.NewValues LIKE '%"status":"IN PROGRESS"%'
      )
    GROUP BY a.ResourceId
  )
  SELECT
    st.Id        AS TaskId,
    st.IssueKey,
    st.Title,
    st.CreatedAt,
    fs.StartedAt,
    st.ResolvedAt,
    CASE WHEN st.ResolvedAt IS NOT NULL
         THEN DATEDIFF(SECOND, st.CreatedAt, st.ResolvedAt) END AS LeadTimeSeconds,
    CASE WHEN st.ResolvedAt IS NOT NULL AND fs.StartedAt IS NOT NULL
         THEN DATEDIFF(SECOND, fs.StartedAt, st.ResolvedAt) END AS CycleTimeSeconds
  FROM ScopeTasks st
  LEFT JOIN FirstStart fs
    ON TRY_CONVERT(UNIQUEIDENTIFIER, fs.ResourceId) = st.Id
  ORDER BY st.CreatedAt DESC;
END;
GO
