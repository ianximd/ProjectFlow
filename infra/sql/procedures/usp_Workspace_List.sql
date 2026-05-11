-- List workspaces the user is a member of. Excludes soft-deleted rows
-- (DeletedAt IS NOT NULL) so a deleted workspace stops showing up in
-- switchers immediately, without the API needing extra filtering.
CREATE OR ALTER PROCEDURE usp_Workspace_List
    @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT w.*
    FROM   Workspaces w
    INNER JOIN WorkspaceMembers wm ON wm.WorkspaceId = w.Id
    WHERE  wm.UserId = @UserId
      AND  w.DeletedAt IS NULL;
END;
