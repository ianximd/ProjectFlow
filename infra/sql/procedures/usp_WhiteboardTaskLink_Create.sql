CREATE OR ALTER PROCEDURE dbo.usp_WhiteboardTaskLink_Create
    @WhiteboardId UNIQUEIDENTIFIER,
    @TaskId       UNIQUEIDENTIFIER,
    @ShapeId      NVARCHAR(100),
    @CreatedById  UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

    BEGIN TRANSACTION;
    BEGIN TRY
        IF NOT EXISTS (
            SELECT 1 FROM dbo.WhiteboardTaskLinks
            WHERE WhiteboardId = @WhiteboardId AND TaskId = @TaskId AND ShapeId = @ShapeId
        )
            INSERT INTO dbo.WhiteboardTaskLinks (Id, WhiteboardId, TaskId, ShapeId, CreatedById)
            VALUES (@NewId, @WhiteboardId, @TaskId, @ShapeId, @CreatedById);

        COMMIT TRANSACTION;

        SELECT TOP 1
            l.Id, l.WhiteboardId, l.TaskId, l.ShapeId, l.CreatedAt,
            t.Title    AS TaskTitle,
            t.Status   AS TaskStatus,
            t.IssueKey AS TaskIssueKey
        FROM dbo.WhiteboardTaskLinks l
        JOIN dbo.Tasks t ON t.Id = l.TaskId
        WHERE l.WhiteboardId = @WhiteboardId AND l.TaskId = @TaskId AND l.ShapeId = @ShapeId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO
