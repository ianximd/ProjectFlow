CREATE OR ALTER PROCEDURE dbo.usp_GuestInvite_List
  @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  -- Accepted guests + each explicit object grant they hold.
  SELECT
    u.Id AS UserId, u.Email, u.Name, u.AvatarUrl,
    CASE WHEN EXISTS (
      SELECT 1 FROM dbo.UserRoles ur JOIN dbo.Roles r ON r.Id = ur.RoleId
      WHERE ur.UserId = u.Id AND ur.WorkspaceId = @WorkspaceId
        AND r.Slug = 'workspace-limited-member' AND r.WorkspaceId IS NULL
    ) THEN 'workspace-limited-member' ELSE 'workspace-guest' END AS RoleSlug,
    op.ObjectType, op.ObjectId, op.Level
  FROM dbo.WorkspaceMembers wm
  JOIN dbo.Users u ON u.Id = wm.UserId
  LEFT JOIN dbo.ObjectPermissions op
    ON op.WorkspaceId = @WorkspaceId AND op.SubjectType = 'USER' AND op.SubjectId = u.Id
  WHERE wm.WorkspaceId = @WorkspaceId AND wm.IsGuest = 1
  ORDER BY u.Email;

  -- Pending invites (not yet accepted, not revoked).
  SELECT Id, Email, ObjectType, ObjectId, Level, Token, Status, InvitedBy, ExpiresAt, CreatedAt
  FROM dbo.GuestInvites
  WHERE WorkspaceId = @WorkspaceId AND Status = 'pending'
  ORDER BY CreatedAt DESC;
END;
GO
