CREATE OR ALTER PROCEDURE usp_Task_Delete
    @Id UNIQUEIDENTIFIER,
    @ActorId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        -- Soft delete
        UPDATE Tasks
        SET DeletedAt = GETUTCDATE(),
            UpdatedAt = GETUTCDATE()
        WHERE Id = @Id AND DeletedAt IS NULL;

        IF @@ROWCOUNT = 0
            THROW 50004, 'Task not found or already deleted.', 1;

        SELECT * FROM Tasks WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
