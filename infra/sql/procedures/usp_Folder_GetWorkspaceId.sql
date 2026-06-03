CREATE OR ALTER PROCEDURE dbo.usp_Folder_GetWorkspaceId
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT WorkspaceId FROM dbo.Folders WHERE Id = @Id AND DeletedAt IS NULL;
END;
