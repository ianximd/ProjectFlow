CREATE OR ALTER PROCEDURE dbo.usp_GuestInvite_Accept
  @Token          NVARCHAR(64),
  @AccepterUserId UNIQUEIDENTIFIER,
  @RoleSlug       NVARCHAR(100)    -- 'workspace-guest' | 'workspace-limited-member'
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @InviteId   UNIQUEIDENTIFIER, @WorkspaceId UNIQUEIDENTIFIER,
          @ObjectType NVARCHAR(8),      @ObjectId    UNIQUEIDENTIFIER,
          @Level      NVARCHAR(8),      @ExpiresAt   DATETIME2, @Status NVARCHAR(12);

  SELECT @InviteId = Id, @WorkspaceId = WorkspaceId, @ObjectType = ObjectType,
         @ObjectId = ObjectId, @Level = Level, @ExpiresAt = ExpiresAt, @Status = Status
  FROM dbo.GuestInvites WHERE Token = @Token;

  IF @InviteId IS NULL                                   THROW 51410, 'Invite not found.', 1;
  IF @Status <> 'pending'                                THROW 51411, 'Invite is not pending.', 1;
  IF @ExpiresAt IS NOT NULL AND @ExpiresAt < SYSUTCDATETIME() THROW 51412, 'Invite has expired.', 1;

  -- The role the service resolved must be a seeded system role.
  DECLARE @RoleId UNIQUEIDENTIFIER;
  SELECT @RoleId = Id FROM dbo.Roles WHERE Slug = @RoleSlug AND IsSystem = 1 AND WorkspaceId IS NULL;
  IF @RoleId IS NULL                                     THROW 51413, 'Guest role not seeded.', 1;

  BEGIN TRY
    BEGIN TRANSACTION;

    -- Do NOT downgrade an existing real (non-guest) member who accepts an invite
    -- to their own email — only create the guest membership + role when the
    -- accepter is not already a non-guest member. A re-accepting guest has
    -- IsGuest=1, so it still takes this path (idempotent). Fail-safe: a real
    -- member keeps their full membership + floor; we still write the grant below.
    IF NOT EXISTS (SELECT 1 FROM dbo.WorkspaceMembers
                   WHERE WorkspaceId = @WorkspaceId AND UserId = @AccepterUserId AND IsGuest = 0)
    BEGIN
      -- Guest WorkspaceMembers row (IsGuest=1). Idempotent on re-accept.
      IF NOT EXISTS (SELECT 1 FROM dbo.WorkspaceMembers WHERE WorkspaceId = @WorkspaceId AND UserId = @AccepterUserId)
        INSERT INTO dbo.WorkspaceMembers (Id, WorkspaceId, UserId, IsGuest)
        VALUES (NEWID(), @WorkspaceId, @AccepterUserId, 1);
      ELSE
        UPDATE dbo.WorkspaceMembers SET IsGuest = 1
        WHERE WorkspaceId = @WorkspaceId AND UserId = @AccepterUserId;

      -- Role assignment.
      IF NOT EXISTS (SELECT 1 FROM dbo.UserRoles WHERE UserId = @AccepterUserId AND RoleId = @RoleId AND WorkspaceId = @WorkspaceId)
        INSERT INTO dbo.UserRoles (UserId, RoleId, WorkspaceId) VALUES (@AccepterUserId, @RoleId, @WorkspaceId);
    END

    -- Object grant (same write usp_ObjectPermission_Set performs; upsert on the
    -- UQ_ObjPerm unique key so re-accept doesn't duplicate).
    IF EXISTS (SELECT 1 FROM dbo.ObjectPermissions
               WHERE SubjectType = 'USER' AND SubjectId = @AccepterUserId
                 AND ObjectType = @ObjectType AND ObjectId = @ObjectId)
      UPDATE dbo.ObjectPermissions SET Level = @Level
      WHERE SubjectType = 'USER' AND SubjectId = @AccepterUserId
        AND ObjectType = @ObjectType AND ObjectId = @ObjectId;
    ELSE
      INSERT INTO dbo.ObjectPermissions (WorkspaceId, SubjectType, SubjectId, ObjectType, ObjectId, Level)
      VALUES (@WorkspaceId, 'USER', @AccepterUserId, @ObjectType, @ObjectId, @Level);

    UPDATE dbo.GuestInvites SET Status = 'accepted', AcceptedAt = SYSUTCDATETIME() WHERE Id = @InviteId;

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;

  SELECT gi.Id, gi.WorkspaceId, gi.Email, gi.ObjectType, gi.ObjectId, gi.Level,
         gi.Status, gi.AcceptedAt, @AccepterUserId AS UserId
  FROM dbo.GuestInvites gi WHERE gi.Id = @InviteId;
END;
GO
