CREATE OR ALTER PROCEDURE usp_Project_Archive
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE Projects
    SET    Status    = 'ARCHIVED',
           UpdatedAt = GETUTCDATE()
    WHERE  Id     = @Id
      AND  Status = 'ACTIVE';

    SELECT * FROM Projects WHERE Id = @Id;
END;
