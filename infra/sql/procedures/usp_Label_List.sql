CREATE OR ALTER PROCEDURE dbo.usp_Label_List
  @ProjectId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT
    l.*,
    COUNT(tll.TaskId) AS IssueCount
  FROM dbo.Labels         l
  LEFT JOIN dbo.TaskLabelLinks tll ON tll.LabelId = l.Id
  WHERE l.ProjectId = @ProjectId
  GROUP BY l.Id, l.ProjectId, l.Name, l.Color, l.CreatedAt
  ORDER BY l.Name ASC;
END;
GO
