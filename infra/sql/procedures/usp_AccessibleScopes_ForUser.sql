CREATE OR ALTER PROCEDURE dbo.usp_AccessibleScopes_ForUser
    @UserId      UNIQUEIDENTIFIER,
    @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    -- =========================================================================
    -- Set-based ACL pre-filter for AI retrieval.
    --
    -- Returns the SET of scope nodes (SPACE / FOLDER / LIST), all alive, in
    -- @WorkspaceId that @UserId can VIEW. "Can VIEW" ⟺ the effective level is
    -- non-NULL. The semantics here MIRROR dbo.usp_ObjectAccess_Resolve EXACTLY,
    -- only computed across the whole workspace in one pass instead of per object:
    --
    --   * Floor (computed ONCE per user): owner=FULL, else guest=NULL (guest
    --     beats member so the EDIT floor never leaks to a guest), else
    --     member=EDIT, else NULL.
    --   * Explicit grant for a node = ANY ObjectPermissions row on the node
    --     ITSELF or any ANCESTOR (containing SPACE + ancestor folders whose Path
    --     is a prefix of the node's Path), matched to the user as USER=@UserId
    --     or ROLE in the user's roles (UserRoles, WorkspaceId=@WorkspaceId OR
    --     NULL). The resolver picks the MOST-SPECIFIC winning level, but because
    --     "can VIEW" only needs non-NULL, here we only need EXISTENCE of any
    --     qualifying grant — any non-NULL level satisfies VIEW.
    --   * Effective level = COALESCE(explicit, floor). Node is VIEW-able iff that
    --     is non-NULL ...
    --   * ... EXCEPT the PRIVATE-space exclusion: a node in a PRIVATE space is
    --     hidden when the user is NOT a real workspace member AND NOT the owner
    --     AND has NO explicit grant on node-or-ancestor. For a GUEST @IsMember=1,
    --     so this early-exclusion does NOT fire — instead the guest's NULL floor
    --     hides the node unless an explicit grant exists. Both branches collapse
    --     to the same observable result and are preserved precisely below.
    -- =========================================================================

    -- ── Membership / ownership / guest flags (computed once) ────────────────
    DECLARE @IsMember BIT = 0, @IsOwner BIT = 0, @IsGuest BIT = 0;

    IF EXISTS (SELECT 1 FROM dbo.WorkspaceMembers WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId)
        SET @IsMember = 1;
    IF EXISTS (SELECT 1 FROM dbo.Workspaces WHERE Id = @WorkspaceId AND OwnerId = @UserId)
        SET @IsOwner = 1;

    -- A guest / limited member holds workspace-guest or workspace-limited-member
    -- in THIS workspace (or globally). The role assignment (UserRoles) is the
    -- authoritative signal — see usp_ObjectAccess_Resolve.
    IF EXISTS (
        SELECT 1 FROM dbo.UserRoles ur
        JOIN dbo.Roles r ON r.Id = ur.RoleId
        WHERE ur.UserId = @UserId
          AND (ur.WorkspaceId = @WorkspaceId OR ur.WorkspaceId IS NULL)
          AND r.Slug IN ('workspace-guest', 'workspace-limited-member')
    ) SET @IsGuest = 1;

    -- Floor: owner=FULL, guest=NONE (guest wins over member), member=EDIT, else NONE.
    DECLARE @Floor NVARCHAR(8) =
        CASE WHEN @IsOwner = 1 THEN 'FULL'
             WHEN @IsGuest = 1 THEN NULL
             WHEN @IsMember = 1 THEN 'EDIT'
             ELSE NULL END;

    -- ── The user's roles in this workspace (USER + ROLE grant matching) ─────
    DECLARE @MyRoles TABLE (RoleId UNIQUEIDENTIFIER PRIMARY KEY);
    INSERT INTO @MyRoles (RoleId)
        SELECT DISTINCT ur.RoleId FROM dbo.UserRoles ur
        WHERE ur.UserId = @UserId AND (ur.WorkspaceId = @WorkspaceId OR ur.WorkspaceId IS NULL);

    -- ── Every alive scope node in the workspace, with its Space + Path ──────
    -- Space Path = '/' + spaceId + '/'; Folder/List Path is the materialized path.
    DECLARE @Nodes TABLE (
        ScopeType   NVARCHAR(10),
        ScopeId     UNIQUEIDENTIFIER,
        SpaceId     UNIQUEIDENTIFIER,
        Path        NVARCHAR(900),
        Visibility  NVARCHAR(10)
    );

    INSERT INTO @Nodes (ScopeType, ScopeId, SpaceId, Path, Visibility)
        SELECT 'SPACE', p.Id, p.Id, '/' + CONVERT(NVARCHAR(36), p.Id) + '/', p.Visibility
        FROM dbo.Projects p
        WHERE p.WorkspaceId = @WorkspaceId AND p.Status <> 'DELETED';

    INSERT INTO @Nodes (ScopeType, ScopeId, SpaceId, Path, Visibility)
        SELECT 'FOLDER', f.Id, f.SpaceId, f.Path, p.Visibility
        FROM dbo.Folders f
        JOIN dbo.Projects p ON p.Id = f.SpaceId AND p.Status <> 'DELETED'
        WHERE f.WorkspaceId = @WorkspaceId AND f.DeletedAt IS NULL;

    INSERT INTO @Nodes (ScopeType, ScopeId, SpaceId, Path, Visibility)
        SELECT 'LIST', l.Id, l.SpaceId, l.Path, p.Visibility
        FROM dbo.Lists l
        JOIN dbo.Projects p ON p.Id = l.SpaceId AND p.Status <> 'DELETED'
        WHERE l.WorkspaceId = @WorkspaceId AND l.DeletedAt IS NULL;

    -- ── Result: a node is VIEW-able iff COALESCE(explicit, floor) is non-NULL,
    --    with the PRIVATE-space exclusion applied exactly as the resolver does.
    --
    -- @HasExplicit per node = EXISTS a qualifying ObjectPermissions grant on the
    -- node ITSELF or any ANCESTOR. Ancestors of node n:
    --   * the containing SPACE (op.ObjectType='SPACE' AND op.ObjectId=n.SpaceId)
    --   * ancestor folders f in the same space, alive, whose Path is a prefix of
    --     n.Path  (n.Path LIKE f.Path + '%')  — matches resolver's ancestry
    --   * the node itself (op.ObjectType=n.ScopeType AND op.ObjectId=n.ScopeId)
    -- The resolver's own LIST/FOLDER/SPACE rows are all covered by these three
    -- arms: a node always matches a self-grant; a FOLDER/LIST always matches its
    -- SPACE; a folder/list grant on an ancestor folder is the prefix arm. A
    -- folder is its own ancestor under the prefix arm (its Path LIKE its Path+'%'),
    -- which collapses into the self arm — harmless for EXISTENCE.
    SELECT
        n.ScopeType,
        n.ScopeId
    FROM @Nodes n
    CROSS APPLY (
        SELECT CAST(CASE WHEN EXISTS (
            SELECT 1
            FROM dbo.ObjectPermissions op
            WHERE op.WorkspaceId = @WorkspaceId
              AND (
                    (op.SubjectType = 'USER' AND op.SubjectId = @UserId)
                 OR (op.SubjectType = 'ROLE' AND op.SubjectId IN (SELECT RoleId FROM @MyRoles))
                  )
              AND (
                    -- node itself
                    (op.ObjectType = n.ScopeType AND op.ObjectId = n.ScopeId)
                    -- containing space
                 OR (op.ObjectType = 'SPACE' AND op.ObjectId = n.SpaceId)
                    -- ancestor folder (Path is a prefix of the node's Path)
                 OR (op.ObjectType = 'FOLDER' AND EXISTS (
                        SELECT 1 FROM dbo.Folders f
                        WHERE f.Id = op.ObjectId
                          AND f.SpaceId = n.SpaceId
                          AND f.DeletedAt IS NULL
                          AND n.Path LIKE f.Path + '%'))
                  )
        ) THEN 1 ELSE 0 END AS BIT) AS HasExplicit
    ) g
    WHERE
        -- PRIVATE-space exclusion (resolver: returns NULL when PRIVATE, not a
        -- real member/owner, and no explicit grant). Equivalent to dropping the node.
        NOT (n.Visibility = 'PRIVATE' AND @IsMember = 0 AND @IsOwner = 0 AND g.HasExplicit = 0)
        -- Effective level non-NULL: an explicit grant OR a non-NULL floor.
        AND (g.HasExplicit = 1 OR @Floor IS NOT NULL);
END;
GO
