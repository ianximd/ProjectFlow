CREATE OR ALTER PROCEDURE dbo.usp_Component_GetWorkspaceId
    @ComponentId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 p.WorkspaceId
    FROM dbo.ProjectComponents c
    JOIN dbo.Projects p ON p.Id = c.ProjectId
    WHERE c.Id = @ComponentId
      AND p.Status != 'DELETED';
END;
