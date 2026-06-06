CREATE OR ALTER PROCEDURE usp_Task_HasOpenBlockers
    @TaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    -- A blocker is "open" if its status is NOT in a DONE-category group.
    -- Workflow lives on Projects.WorkflowId; fallback to hardcoded done names (mirrors usp_Task_Transition).
    SELECT b.Id AS TaskId, b.Title, b.Status
      FROM dbo.TaskDependencies d
      JOIN dbo.Tasks b ON b.Id = d.DependsOn AND b.DeletedAt IS NULL
      JOIN dbo.Projects p ON p.Id = b.ProjectId
      LEFT JOIN dbo.WorkflowStatuses ws ON ws.WorkflowId = p.WorkflowId AND ws.Name = b.Status
     WHERE d.TaskId = @TaskId
       AND ( (p.WorkflowId IS NOT NULL AND (ws.Category IS NULL OR ws.Category <> 'DONE'))
             OR (p.WorkflowId IS NULL AND b.Status NOT IN ('Done','Resolved','Closed','Completed')) );
END;
