CREATE OR ALTER PROCEDURE dbo.usp_Label_GetWorkspaceId
    @LabelId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 p.WorkspaceId
    FROM dbo.Labels l
    JOIN dbo.Projects p ON p.Id = l.ProjectId
    WHERE l.Id = @LabelId
      AND p.Status != 'DELETED';
END;
