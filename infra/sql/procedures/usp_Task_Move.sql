CREATE OR ALTER PROCEDURE dbo.usp_Task_Move
    @TaskId   UNIQUEIDENTIFIER,
    @ListId   UNIQUEIDENTIFIER,
    @Position FLOAT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        DECLARE @SpaceId UNIQUEIDENTIFIER, @ListPath NVARCHAR(900);
        SELECT @SpaceId = SpaceId, @ListPath = Path FROM dbo.Lists WHERE Id = @ListId AND DeletedAt IS NULL;
        IF @SpaceId IS NULL THROW 51213, 'List not found', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL)
            THROW 50404, 'Task not found', 1;

        UPDATE dbo.Tasks
        SET    ListId = @ListId, ListPath = @ListPath, ProjectId = @SpaceId,
               Position = @Position, UpdatedAt = SYSUTCDATETIME()
        WHERE  Id = @TaskId;

        SELECT * FROM dbo.Tasks WHERE Id = @TaskId;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
