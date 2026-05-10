CREATE OR ALTER PROCEDURE usp_Workflow_AddStatus
    @WorkflowId UNIQUEIDENTIFIER,
    @Name       NVARCHAR(100),
    @Category   NVARCHAR(20)  = 'TODO',
    @Color      NVARCHAR(20)  = '#6b7280'
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @MaxPos INT;
    SELECT @MaxPos = ISNULL(MAX(Position), -1) FROM WorkflowStatuses WHERE WorkflowId = @WorkflowId;

    DECLARE @NewId UNIQUEIDENTIFIER = NEWID();
    INSERT INTO WorkflowStatuses (Id, WorkflowId, Name, Category, Color, Position)
    VALUES (@NewId, @WorkflowId, @Name, @Category, @Color, @MaxPos + 1);

    SELECT * FROM WorkflowStatuses WHERE Id = @NewId;
END;
