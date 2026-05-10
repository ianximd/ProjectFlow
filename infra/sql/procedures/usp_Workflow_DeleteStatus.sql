CREATE OR ALTER PROCEDURE usp_Workflow_DeleteStatus
    @StatusId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @WfId UNIQUEIDENTIFIER;
    DECLARE @Name NVARCHAR(100);
    SELECT @WfId = WorkflowId, @Name = Name FROM WorkflowStatuses WHERE Id = @StatusId;

    -- Check for tasks currently in this status
    IF EXISTS (
        SELECT 1 FROM Tasks t
        JOIN Projects p ON p.Id = t.ProjectId
        WHERE p.WorkflowId = @WfId
          AND t.Status     = @Name
          AND t.DeletedAt  IS NULL
    )
        THROW 50409, 'Cannot delete status: tasks are currently in this status', 1;

    -- Remove transitions referencing this status
    DELETE FROM WorkflowTransitions
    WHERE WorkflowId = @WfId
      AND (FromStatus = @Name OR ToStatus = @Name);

    DELETE FROM WorkflowStatuses WHERE Id = @StatusId;
END;
