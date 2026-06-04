CREATE OR ALTER PROCEDURE dbo.usp_Space_GetMultipleAssignees @TaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT p.MultipleAssignees FROM dbo.Tasks t JOIN dbo.Projects p ON p.Id = t.ProjectId WHERE t.Id = @TaskId;
END;
