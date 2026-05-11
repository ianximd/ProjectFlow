CREATE OR ALTER PROCEDURE dbo.usp_Sprint_GetWorkspaceId
    @SprintId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 p.WorkspaceId
    FROM dbo.Sprints s
    JOIN dbo.Projects p ON p.Id = s.ProjectId
    WHERE s.Id = @SprintId AND p.Status != 'DELETED';
END;
