CREATE OR ALTER PROCEDURE usp_Task_Update
    @TaskId       UNIQUEIDENTIFIER,
    @Title        NVARCHAR(500)    = NULL,
    @Description  NVARCHAR(MAX)    = NULL,
    @Type         NVARCHAR(20)     = NULL,
    @Priority     NVARCHAR(20)     = NULL,
    @SprintId     UNIQUEIDENTIFIER = NULL,
    @EpicId       UNIQUEIDENTIFIER = NULL,
    @StoryPoints  FLOAT            = NULL,
    @DueDate      DATE             = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE Tasks
        SET
            Title       = ISNULL(@Title, Title),
            Description = ISNULL(@Description, Description),
            Type        = ISNULL(@Type, Type),
            Priority    = ISNULL(@Priority, Priority),
            SprintId    = ISNULL(@SprintId, SprintId),
            EpicId      = ISNULL(@EpicId, EpicId),
            StoryPoints = ISNULL(@StoryPoints, StoryPoints),
            DueDate     = ISNULL(@DueDate, DueDate),
            UpdatedAt   = GETUTCDATE()
        WHERE Id = @TaskId AND DeletedAt IS NULL;

        SELECT * FROM Tasks WHERE Id = @TaskId;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
