CREATE OR ALTER PROCEDURE usp_WorkspaceMember_Add
    @WorkspaceId UNIQUEIDENTIFIER,
    @UserId      UNIQUEIDENTIFIER,
    @Role        NVARCHAR(20) = 'MEMBER'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF EXISTS (SELECT 1 FROM WorkspaceMembers WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId)
            THROW 50011, 'User is already a member of this workspace.', 1;

        DECLARE @NewId UNIQUEIDENTIFIER = NEWID();
        INSERT INTO WorkspaceMembers (Id, WorkspaceId, UserId, Role)
        VALUES (@NewId, @WorkspaceId, @UserId, @Role);

        SELECT * FROM WorkspaceMembers WHERE Id = @NewId;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
