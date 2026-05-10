CREATE OR ALTER PROCEDURE dbo.usp_Admin_ListWorkspaces
  @Page     INT = 1,
  @PageSize INT = 50
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @Offset INT = (@Page - 1) * @PageSize;

  SELECT
    w.Id,
    w.Name,
    w.Slug,
    w.AvatarUrl,
    w.CreatedAt,
    (SELECT COUNT(*) FROM dbo.WorkspaceMembers wm WHERE wm.WorkspaceId = w.Id) AS MemberCount,
    (SELECT COUNT(*) FROM dbo.Projects         p  WHERE p.WorkspaceId  = w.Id) AS ProjectCount,
    (SELECT u.Email  FROM dbo.Users            u  WHERE u.Id           = w.OwnerId) AS OwnerEmail,
    COUNT(*) OVER () AS TotalCount
  FROM dbo.Workspaces w
  ORDER BY w.CreatedAt DESC
  OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END;
