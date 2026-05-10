CREATE OR ALTER PROCEDURE dbo.usp_Admin_ListUsers
  @Search   NVARCHAR(255) = NULL,
  @Page     INT           = 1,
  @PageSize INT           = 50
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @Offset INT = (@Page - 1) * @PageSize;

  SELECT
    u.Id,
    u.Email,
    u.Name,
    u.AvatarUrl,
    u.IsEmailVerified,
    u.MfaEnabled,
    u.CreatedAt,
    u.DeletedAt,
    (SELECT COUNT(*) FROM dbo.WorkspaceMembers wm WHERE wm.UserId = u.Id) AS WorkspaceCount,
    COUNT(*) OVER () AS TotalCount
  FROM dbo.Users u
  WHERE
    @Search IS NULL
    OR u.Email LIKE '%' + @Search + '%'
    OR u.Name  LIKE '%' + @Search + '%'
  ORDER BY u.CreatedAt DESC
  OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END;
