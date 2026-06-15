CREATE OR ALTER PROCEDURE dbo.usp_GuestInvite_Revoke
  @WorkspaceId UNIQUEIDENTIFIER,
  @UserId      UNIQUEIDENTIFIER = NULL,   -- revoke an accepted guest
  @InviteId    UNIQUEIDENTIFIER = NULL    -- cancel a pending invite
AS
BEGIN
  SET NOCOUNT ON;

  BEGIN TRY
    BEGIN TRANSACTION;

    IF @InviteId IS NOT NULL
      UPDATE dbo.GuestInvites SET Status = 'revoked'
      WHERE Id = @InviteId AND WorkspaceId = @WorkspaceId AND Status = 'pending';

    IF @UserId IS NOT NULL
    BEGIN
      -- Only ever touch a GUEST membership — never a real member.
      IF EXISTS (SELECT 1 FROM dbo.WorkspaceMembers WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId AND IsGuest = 1)
      BEGIN
        DELETE FROM dbo.ObjectPermissions
        WHERE WorkspaceId = @WorkspaceId AND SubjectType = 'USER' AND SubjectId = @UserId;

        DELETE ur FROM dbo.UserRoles ur
        JOIN dbo.Roles r ON r.Id = ur.RoleId
        WHERE ur.UserId = @UserId AND ur.WorkspaceId = @WorkspaceId
          AND r.Slug IN ('workspace-guest', 'workspace-limited-member') AND r.WorkspaceId IS NULL;

        DELETE FROM dbo.WorkspaceMembers WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId AND IsGuest = 1;

        UPDATE dbo.GuestInvites SET Status = 'revoked'
        WHERE WorkspaceId = @WorkspaceId AND Email = (SELECT LOWER(Email) FROM dbo.Users WHERE Id = @UserId) AND Status = 'pending';
      END
    END

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;

  SELECT @UserId AS RevokedUserId, @InviteId AS CancelledInviteId;
END;
GO
