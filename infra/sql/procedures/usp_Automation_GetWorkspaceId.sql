CREATE OR ALTER PROCEDURE dbo.usp_Automation_GetWorkspaceId
    @RuleId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 p.WorkspaceId
    FROM dbo.AutomationRules ar
    JOIN dbo.Projects        p ON p.Id = ar.ProjectId
    WHERE ar.Id = @RuleId
      AND p.Status != 'DELETED';
END;
