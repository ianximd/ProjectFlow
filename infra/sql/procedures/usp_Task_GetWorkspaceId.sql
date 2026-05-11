CREATE OR ALTER PROCEDURE dbo.usp_Task_GetWorkspaceId
    @TaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 WorkspaceId
    FROM dbo.Tasks
    WHERE Id = @TaskId AND DeletedAt IS NULL;
END;
