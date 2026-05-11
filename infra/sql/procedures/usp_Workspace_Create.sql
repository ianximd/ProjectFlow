CREATE OR ALTER PROCEDURE usp_Workspace_Create
    @Name    NVARCHAR(255),
    @Slug    NVARCHAR(100),
    @OwnerId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF EXISTS (SELECT 1 FROM Workspaces WHERE Slug = @Slug)
            THROW 50010, 'Workspace slug is already taken.', 1;

        DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

        INSERT INTO Workspaces (Id, Name, Slug, OwnerId)
        VALUES (@NewId, @Name, @Slug, @OwnerId);

        -- Add owner as a workspace member (legacy Role column dropped in 0020;
        -- the actual role grant lives in dbo.UserRoles below).
        INSERT INTO WorkspaceMembers (WorkspaceId, UserId)
        VALUES (@NewId, @OwnerId);

        -- Assign workspace-owner role so the RBAC gates
        -- (workspace.update / workspace.delete / workspace.members.*) work.
        DECLARE @OwnerRoleId UNIQUEIDENTIFIER;
        SELECT @OwnerRoleId = Id FROM dbo.Roles WHERE Slug = 'workspace-owner';
        IF @OwnerRoleId IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM dbo.UserRoles
                WHERE UserId = @OwnerId AND RoleId = @OwnerRoleId AND WorkspaceId = @NewId
            )
        BEGIN
            INSERT INTO dbo.UserRoles (UserId, RoleId, WorkspaceId, AssignedBy)
            VALUES (@OwnerId, @OwnerRoleId, @NewId, @OwnerId);
        END

        SELECT * FROM Workspaces WHERE Id = @NewId;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
