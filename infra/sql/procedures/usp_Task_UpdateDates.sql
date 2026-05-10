CREATE OR ALTER PROCEDURE usp_Task_UpdateDates
    @TaskId         UNIQUEIDENTIFIER,
    @RequesterId    UNIQUEIDENTIFIER,
    @StartDate      DATE = NULL,
    @DueDate        DATE = NULL,
    @ClearStartDate BIT  = 0,
    @ClearDueDate   BIT  = 0
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (
        SELECT 1 FROM Tasks WHERE Id = @TaskId AND DeletedAt IS NULL
    )
        THROW 50404, 'Task not found', 1;

    UPDATE Tasks
    SET
        StartDate = CASE
                        WHEN @ClearStartDate = 1   THEN NULL
                        WHEN @StartDate IS NOT NULL THEN @StartDate
                        ELSE StartDate
                    END,
        DueDate   = CASE
                        WHEN @ClearDueDate = 1     THEN NULL
                        WHEN @DueDate IS NOT NULL  THEN @DueDate
                        ELSE DueDate
                    END,
        UpdatedAt = GETUTCDATE()
    WHERE Id = @TaskId AND DeletedAt IS NULL;

    SELECT * FROM Tasks WHERE Id = @TaskId;
END;
