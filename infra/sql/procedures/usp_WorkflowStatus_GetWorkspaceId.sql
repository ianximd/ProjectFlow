CREATE OR ALTER PROCEDURE dbo.usp_WorkflowStatus_GetWorkspaceId
    @StatusId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 p.WorkspaceId
    FROM dbo.WorkflowStatuses ws
    JOIN dbo.Workflows        w ON w.Id = ws.WorkflowId
    JOIN dbo.Projects         p ON p.Id = w.ProjectId
    WHERE ws.Id = @StatusId
      AND p.Status != 'DELETED';
END;
