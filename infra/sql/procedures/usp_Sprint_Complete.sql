CREATE OR ALTER PROCEDURE usp_Sprint_Complete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM Sprints WHERE Id = @Id AND Status = 'ACTIVE')
            THROW 50031, 'Sprint not found or not active.', 1;

        UPDATE Sprints
        SET Status = 'COMPLETED', CompletedAt = GETUTCDATE(), UpdatedAt = GETUTCDATE()
        WHERE Id = @Id;

        -- Move incomplete tasks to backlog (remove sprintId)
        UPDATE Tasks
        SET SprintId = NULL, UpdatedAt = GETUTCDATE()
        WHERE SprintId = @Id AND Status NOT IN ('Done', 'DONE') AND DeletedAt IS NULL;

        SELECT * FROM Sprints WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
