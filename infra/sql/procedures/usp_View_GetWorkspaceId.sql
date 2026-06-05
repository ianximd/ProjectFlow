CREATE OR ALTER PROCEDURE dbo.usp_View_GetWorkspaceId
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT WorkspaceId FROM dbo.SavedViews WHERE Id = @Id AND DeletedAt IS NULL;
END;
