CREATE OR ALTER PROCEDURE dbo.usp_CustomField_Update
    @Id          UNIQUEIDENTIFIER,
    @Name        NVARCHAR(255) = NULL,
    @Config      NVARCHAR(MAX) = NULL,
    @ClearConfig BIT = 0,
    @Required    BIT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.CustomFields WHERE Id = @Id AND DeletedAt IS NULL)
            THROW 51300, 'Custom field not found', 1;
        UPDATE dbo.CustomFields
        SET    Name      = COALESCE(@Name, Name),
               Config    = CASE WHEN @ClearConfig = 1 THEN NULL ELSE COALESCE(@Config, Config) END,
               Required  = COALESCE(@Required, Required),
               UpdatedAt = SYSUTCDATETIME()
        WHERE  Id = @Id;
        SELECT * FROM dbo.CustomFields WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
