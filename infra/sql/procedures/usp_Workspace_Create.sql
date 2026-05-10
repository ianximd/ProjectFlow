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

        -- Auto-add owner as OWNER member
        INSERT INTO WorkspaceMembers (WorkspaceId, UserId, Role)
        VALUES (@NewId, @OwnerId, 'OWNER');

        SELECT * FROM Workspaces WHERE Id = @NewId;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
