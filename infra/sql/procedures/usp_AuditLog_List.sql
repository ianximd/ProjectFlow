CREATE OR ALTER PROCEDURE dbo.usp_AuditLog_List
  @WorkspaceId  NVARCHAR(255)  = NULL,
  @UserId       NVARCHAR(255)  = NULL,
  @Resource     NVARCHAR(100)  = NULL,
  @Action       NVARCHAR(50)   = NULL,
  @ResourceId   NVARCHAR(255)  = NULL,
  @FromDate     DATETIME2      = NULL,
  @ToDate       DATETIME2      = NULL,
  @Page         INT            = 1,
  @PageSize     INT            = 50
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @Offset INT = (@Page - 1) * @PageSize;

  SELECT
    a.Id, a.WorkspaceId, a.UserId, a.UserEmail,
    a.Action, a.Resource, a.ResourceId,
    a.OldValues, a.NewValues,
    a.IpAddress, a.UserAgent, a.CreatedAt,
    COUNT(*) OVER () AS TotalCount
  FROM dbo.AuditLog a
  WHERE
    (@WorkspaceId IS NULL OR a.WorkspaceId = @WorkspaceId)
    AND (@UserId     IS NULL OR a.UserId     = @UserId)
    AND (@Resource   IS NULL OR a.Resource   = @Resource)
    AND (@Action     IS NULL OR a.Action     = @Action)
    AND (@ResourceId IS NULL OR a.ResourceId = @ResourceId)
    AND (@FromDate   IS NULL OR a.CreatedAt >= @FromDate)
    AND (@ToDate     IS NULL OR a.CreatedAt <= @ToDate)
  ORDER BY a.CreatedAt DESC
  OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END;
