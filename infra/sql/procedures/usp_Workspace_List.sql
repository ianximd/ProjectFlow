CREATE OR ALTER PROCEDURE usp_Workspace_List
    @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT w.*
    FROM Workspaces w
    INNER JOIN WorkspaceMembers wm ON wm.WorkspaceId = w.Id
    WHERE wm.UserId = @UserId;
END;
