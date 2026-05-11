CREATE OR ALTER PROCEDURE dbo.usp_Project_GetWorkspaceId
    @ProjectId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 WorkspaceId
    FROM dbo.Projects
    WHERE Id = @ProjectId AND Status != 'DELETED';
END;
