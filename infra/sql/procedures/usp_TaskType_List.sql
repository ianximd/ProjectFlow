CREATE OR ALTER PROCEDURE dbo.usp_TaskType_List
    @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.TaskTypes WHERE WorkspaceId = @WorkspaceId AND DeletedAt IS NULL ORDER BY Position, NameSingular;
END;
