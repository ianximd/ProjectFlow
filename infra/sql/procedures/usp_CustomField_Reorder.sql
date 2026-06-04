CREATE OR ALTER PROCEDURE dbo.usp_CustomField_Reorder
    @Id       UNIQUEIDENTIFIER,
    @Position FLOAT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.CustomFields WHERE Id = @Id AND DeletedAt IS NULL)
            THROW 51300, 'Custom field not found', 1;
        UPDATE dbo.CustomFields SET Position = @Position, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id;
        SELECT * FROM dbo.CustomFields WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
