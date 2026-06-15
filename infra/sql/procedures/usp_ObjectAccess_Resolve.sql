CREATE OR ALTER PROCEDURE dbo.usp_ObjectAccess_Resolve
    @UserId     UNIQUEIDENTIFIER,
    @ObjectType NVARCHAR(8),     -- 'SPACE' | 'FOLDER' | 'LIST'
    @ObjectId   UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @SpaceId UNIQUEIDENTIFIER, @WorkspaceId UNIQUEIDENTIFIER, @Path NVARCHAR(900);
    IF @ObjectType = 'SPACE'
        SELECT @SpaceId = Id, @WorkspaceId = WorkspaceId, @Path = '/' + CONVERT(NVARCHAR(36), Id) + '/'
        FROM dbo.Projects WHERE Id = @ObjectId AND Status <> 'DELETED';
    ELSE IF @ObjectType = 'FOLDER'
        SELECT @SpaceId = SpaceId, @WorkspaceId = WorkspaceId, @Path = Path
        FROM dbo.Folders WHERE Id = @ObjectId AND DeletedAt IS NULL;
    ELSE IF @ObjectType = 'LIST'
        SELECT @SpaceId = SpaceId, @WorkspaceId = WorkspaceId, @Path = Path
        FROM dbo.Lists WHERE Id = @ObjectId AND DeletedAt IS NULL;

    IF @SpaceId IS NULL
    BEGIN
        SELECT CAST(NULL AS NVARCHAR(8)) AS Level, CAST(0 AS BIT) AS Found;  -- object missing
        RETURN;
    END

    DECLARE @IsMember BIT = 0, @IsOwner BIT = 0, @IsGuest BIT = 0, @Visibility NVARCHAR(10);
    SELECT @Visibility = Visibility FROM dbo.Projects WHERE Id = @SpaceId;
    IF EXISTS (SELECT 1 FROM dbo.WorkspaceMembers WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId) SET @IsMember = 1;
    IF EXISTS (SELECT 1 FROM dbo.Workspaces WHERE Id = @WorkspaceId AND OwnerId = @UserId) SET @IsOwner = 1;

    -- A guest / limited member holds workspace-guest or workspace-limited-member
    -- in THIS workspace. They are WorkspaceMembers rows, so @IsMember is 1 — but
    -- they must contribute NO floor, so the Space tree is invisible by
    -- construction and access comes ONLY from an explicit ObjectPermissions grant.
    -- The authoritative signal is the role assignment (UserRoles); the
    -- WorkspaceMembers.IsGuest flag is a denormalized fast-path corroborant.
    IF EXISTS (
        SELECT 1 FROM dbo.UserRoles ur
        JOIN dbo.Roles r ON r.Id = ur.RoleId
        WHERE ur.UserId = @UserId
          AND (ur.WorkspaceId = @WorkspaceId OR ur.WorkspaceId IS NULL)
          AND r.Slug IN ('workspace-guest', 'workspace-limited-member')
    ) SET @IsGuest = 1;

    -- Floor: owner=FULL, member=EDIT, guest/limited-member=NONE.
    -- Guest wins over member so the EDIT floor never leaks to a guest.
    DECLARE @Floor NVARCHAR(8) =
        CASE WHEN @IsOwner = 1 THEN 'FULL'
             WHEN @IsGuest = 1 THEN NULL
             WHEN @IsMember = 1 THEN 'EDIT'
             ELSE NULL END;

    -- Ancestry object ids: the Space, ancestor folders (path is a prefix of @Path), and the object itself.
    DECLARE @Ancestry TABLE (ObjectType NVARCHAR(8), ObjectId UNIQUEIDENTIFIER, Depth INT);
    INSERT INTO @Ancestry VALUES ('SPACE', @SpaceId, 0);
    INSERT INTO @Ancestry
        SELECT 'FOLDER', f.Id, LEN(f.Path)
        FROM dbo.Folders f
        WHERE f.SpaceId = @SpaceId AND f.DeletedAt IS NULL AND @Path LIKE f.Path + '%';
    IF @ObjectType = 'LIST'
        INSERT INTO @Ancestry VALUES ('LIST', @ObjectId, 9999);

    DECLARE @Explicit NVARCHAR(8);
    SELECT TOP 1 @Explicit = op.Level
    FROM   dbo.ObjectPermissions op
    JOIN   @Ancestry a ON a.ObjectType = op.ObjectType AND a.ObjectId = op.ObjectId
    WHERE  op.WorkspaceId = @WorkspaceId
      AND  (
            (op.SubjectType = 'USER' AND op.SubjectId = @UserId)
            OR (op.SubjectType = 'ROLE' AND op.SubjectId IN (
                  SELECT ur.RoleId FROM dbo.UserRoles ur
                  WHERE ur.UserId = @UserId AND (ur.WorkspaceId = @WorkspaceId OR ur.WorkspaceId IS NULL)))
           )
    ORDER BY a.Depth DESC,
             CASE op.SubjectType WHEN 'USER' THEN 0 ELSE 1 END;

    -- PRIVATE space, no explicit grant, not a real member/owner → no access.
    -- A guest has @Floor = NULL, so the COALESCE below already yields NULL
    -- without an explicit grant; the original predicate stays intact.
    IF @Visibility = 'PRIVATE' AND @IsMember = 0 AND @IsOwner = 0 AND @Explicit IS NULL
    BEGIN
        SELECT CAST(NULL AS NVARCHAR(8)) AS Level, CAST(1 AS BIT) AS Found;
        RETURN;
    END

    SELECT COALESCE(@Explicit, @Floor) AS Level, CAST(1 AS BIT) AS Found;
END;
GO
