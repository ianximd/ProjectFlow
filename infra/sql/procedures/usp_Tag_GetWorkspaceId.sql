CREATE OR ALTER PROCEDURE dbo.usp_Tag_GetWorkspaceId
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT p.WorkspaceId FROM dbo.Labels l JOIN dbo.Projects p ON p.Id = l.ProjectId WHERE l.Id = @Id;
END;
