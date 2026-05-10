CREATE OR ALTER PROCEDURE usp_Workflow_AddTransition
    @WorkflowId  UNIQUEIDENTIFIER,
    @FromStatus  NVARCHAR(100),
    @ToStatus    NVARCHAR(100),
    @Name        NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    -- Verify both statuses belong to this workflow
    IF NOT EXISTS (SELECT 1 FROM WorkflowStatuses WHERE WorkflowId=@WorkflowId AND Name=@FromStatus)
        THROW 50400, 'FromStatus not found in this workflow', 1;

    IF NOT EXISTS (SELECT 1 FROM WorkflowStatuses WHERE WorkflowId=@WorkflowId AND Name=@ToStatus)
        THROW 50400, 'ToStatus not found in this workflow', 1;

    IF @FromStatus = @ToStatus
        THROW 50400, 'FromStatus and ToStatus must be different', 1;

    DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

    -- INSERT OR IGNORE (ignore duplicate)
    IF NOT EXISTS (
        SELECT 1 FROM WorkflowTransitions
        WHERE WorkflowId=@WorkflowId AND FromStatus=@FromStatus AND ToStatus=@ToStatus
    )
    BEGIN
        INSERT INTO WorkflowTransitions (Id, WorkflowId, FromStatus, ToStatus, Name)
        VALUES (@NewId, @WorkflowId, @FromStatus, @ToStatus, ISNULL(@Name, @FromStatus + ' → ' + @ToStatus));
    END;

    SELECT * FROM WorkflowTransitions
    WHERE WorkflowId=@WorkflowId AND FromStatus=@FromStatus AND ToStatus=@ToStatus;
END;
