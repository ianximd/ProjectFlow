CREATE OR ALTER PROCEDURE usp_Sprint_Start
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM Sprints WHERE Id = @Id AND Status = 'PLANNED')
            THROW 50030, 'Sprint not found or already started.', 1;

        UPDATE Sprints
        SET Status = 'ACTIVE', StartDate = COALESCE(StartDate, GETUTCDATE()), UpdatedAt = GETUTCDATE()
        WHERE Id = @Id;

        SELECT * FROM Sprints WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
