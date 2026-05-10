-- Returns the active workflow for a project (statuses + transitions).
-- Returns empty recordsets if no workflow exists.
CREATE OR ALTER PROCEDURE usp_Workflow_GetByProject
    @ProjectId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @WfId UNIQUEIDENTIFIER;
    SELECT @WfId = WorkflowId FROM Projects WHERE Id = @ProjectId;

    IF @WfId IS NULL
    BEGIN
        -- Return empty recordsets
        SELECT TOP 0 * FROM Workflows;
        SELECT TOP 0 * FROM WorkflowStatuses;
        SELECT TOP 0 * FROM WorkflowTransitions;
        RETURN;
    END;

    SELECT * FROM Workflows WHERE Id = @WfId;
    SELECT * FROM WorkflowStatuses  WHERE WorkflowId = @WfId ORDER BY Position;
    SELECT * FROM WorkflowTransitions WHERE WorkflowId = @WfId;
END;
