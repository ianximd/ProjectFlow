CREATE OR ALTER PROCEDURE dbo.usp_Version_GetWorkspaceId
    @VersionId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 p.WorkspaceId
    FROM dbo.Versions v
    JOIN dbo.Projects p ON p.Id = v.ProjectId
    WHERE v.Id = @VersionId
      AND p.Status != 'DELETED';
END;
