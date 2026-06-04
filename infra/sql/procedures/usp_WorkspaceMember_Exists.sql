CREATE OR ALTER PROCEDURE usp_WorkspaceMember_Exists
    @WorkspaceId UNIQUEIDENTIFIER,
    @UserId      UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(1) AS Cnt
    FROM dbo.WorkspaceMembers
    WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId;
END;
