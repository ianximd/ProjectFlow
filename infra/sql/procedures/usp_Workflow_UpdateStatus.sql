CREATE OR ALTER PROCEDURE usp_Workflow_UpdateStatus
    @StatusId UNIQUEIDENTIFIER,
    @Name     NVARCHAR(100) = NULL,
    @Category NVARCHAR(20)  = NULL,
    @Color    NVARCHAR(20)  = NULL,
    @Position INT           = NULL
AS
BEGIN
    SET NOCOUNT ON;

    -- Cascade name change to transitions referencing old name
    DECLARE @OldName NVARCHAR(100);
    SELECT @OldName = Name FROM WorkflowStatuses WHERE Id = @StatusId;

    DECLARE @NewName NVARCHAR(100) = ISNULL(@Name, @OldName);

    UPDATE WorkflowStatuses
    SET
        Name     = ISNULL(@Name,     Name),
        Category = ISNULL(@Category, Category),
        Color    = ISNULL(@Color,    Color),
        Position = ISNULL(@Position, Position)
    WHERE Id = @StatusId;

    -- Update any transition rows that referenced the old status name
    IF @Name IS NOT NULL AND @OldName <> @Name
    BEGIN
        DECLARE @WfId UNIQUEIDENTIFIER;
        SELECT @WfId = WorkflowId FROM WorkflowStatuses WHERE Id = @StatusId;

        UPDATE WorkflowTransitions
        SET FromStatus = @NewName
        WHERE WorkflowId = @WfId AND FromStatus = @OldName;

        UPDATE WorkflowTransitions
        SET ToStatus = @NewName
        WHERE WorkflowId = @WfId AND ToStatus = @OldName;
    END;

    SELECT * FROM WorkflowStatuses WHERE Id = @StatusId;
END;
