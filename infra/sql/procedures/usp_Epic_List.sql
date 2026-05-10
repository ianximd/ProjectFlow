-- Returns epics for a project with child issue counts and completion progress
CREATE OR ALTER PROCEDURE dbo.usp_Epic_List
  @ProjectId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT
    e.Id,
    e.IssueKey,
    e.Title,
    e.Status,
    e.Priority,
    e.CreatedAt,
    e.DueDate,
    COUNT(c.Id)                                                    AS TotalChildren,
    SUM(CASE WHEN c.Status IN ('DONE','CLOSED','RELEASED') THEN 1 ELSE 0 END) AS CompletedChildren
  FROM dbo.Tasks e
  LEFT JOIN dbo.Tasks c ON c.EpicId = e.Id AND c.DeletedAt IS NULL
  WHERE e.ProjectId = @ProjectId
    AND e.Type      = 'EPIC'
    AND e.DeletedAt IS NULL
  GROUP BY e.Id, e.IssueKey, e.Title, e.Status, e.Priority, e.CreatedAt, e.DueDate
  ORDER BY e.CreatedAt DESC;
END;
GO
