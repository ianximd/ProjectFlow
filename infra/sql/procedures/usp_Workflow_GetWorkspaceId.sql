CREATE OR ALTER PROCEDURE dbo.usp_Workflow_GetWorkspaceId
    @WorkflowId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 p.WorkspaceId
    FROM dbo.Workflows w
    JOIN dbo.Projects p ON p.Id = w.ProjectId
    WHERE w.Id = @WorkflowId
      AND p.Status != 'DELETED';
END;
