CREATE OR ALTER PROCEDURE dbo.usp_List_EffectiveStatuses
    @ListId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @WorkflowId UNIQUEIDENTIFIER;

    SELECT @WorkflowId = COALESCE(l.WorkflowId, f.WorkflowId, p.WorkflowId)
    FROM        dbo.Lists    l
    LEFT JOIN   dbo.Folders  f ON f.Id = l.FolderId
    JOIN        dbo.Projects p ON p.Id = l.SpaceId
    WHERE       l.Id = @ListId AND l.DeletedAt IS NULL;

    IF @WorkflowId IS NULL
    BEGIN
        SELECT TOP 0 Id, WorkflowId, Name, Category, Color, Position FROM dbo.WorkflowStatuses;
        RETURN;
    END

    SELECT Id, WorkflowId, Name, Category, Color, Position
    FROM   dbo.WorkflowStatuses
    WHERE  WorkflowId = @WorkflowId
    ORDER  BY Position;
END;
