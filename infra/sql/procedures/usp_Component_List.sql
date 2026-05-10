CREATE OR ALTER PROCEDURE dbo.usp_Component_List
  @ProjectId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT
    c.*,
    u.Name      AS LeadUserName,
    u.AvatarUrl AS LeadAvatarUrl,
    COUNT(tc.TaskId) AS IssueCount
  FROM dbo.ProjectComponents c
  LEFT JOIN dbo.Users          u  ON u.Id  = c.LeadUserId
  LEFT JOIN dbo.TaskComponents tc ON tc.ComponentId = c.Id
  WHERE c.ProjectId = @ProjectId
  GROUP BY c.Id, c.ProjectId, c.Name, c.Description, c.LeadUserId, c.CreatedAt,
           u.Name, u.AvatarUrl
  ORDER BY c.Name ASC;
END;
GO
