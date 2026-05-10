CREATE OR ALTER PROCEDURE usp_Project_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE Projects
    SET    Status    = 'DELETED',
           UpdatedAt = GETUTCDATE()
    WHERE  Id     = @Id
      AND  Status <> 'DELETED';
END;
