CREATE OR ALTER PROCEDURE usp_Workflow_RemoveTransition
    @WorkflowId  UNIQUEIDENTIFIER,
    @FromStatus  NVARCHAR(100),
    @ToStatus    NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM WorkflowTransitions
    WHERE WorkflowId = @WorkflowId
      AND FromStatus = @FromStatus
      AND ToStatus   = @ToStatus;
END;
