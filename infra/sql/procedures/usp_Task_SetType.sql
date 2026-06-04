CREATE OR ALTER PROCEDURE dbo.usp_Task_SetType
    @TaskId     UNIQUEIDENTIFIER,
    @TaskTypeId UNIQUEIDENTIFIER,
    @LegacyType NVARCHAR(20)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        DECLARE @ws UNIQUEIDENTIFIER;
        SELECT @ws = WorkspaceId FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL;
        IF @ws IS NULL THROW 51322, 'Task not found', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.TaskTypes WHERE Id = @TaskTypeId AND WorkspaceId = @ws AND DeletedAt IS NULL)
            THROW 51323, 'Task type not found in this workspace', 1;
        UPDATE dbo.Tasks SET TaskTypeId = @TaskTypeId, Type = @LegacyType, UpdatedAt = SYSUTCDATETIME() WHERE Id = @TaskId;
        SELECT * FROM dbo.Tasks WHERE Id = @TaskId;
    END TRY BEGIN CATCH THROW; END CATCH
END;
