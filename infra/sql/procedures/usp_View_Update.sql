CREATE OR ALTER PROCEDURE dbo.usp_View_Update
    @Id        UNIQUEIDENTIFIER,
    @Name      NVARCHAR(255) = NULL,
    @IsShared  BIT = NULL,
    @IsDefault BIT = NULL,
    @Config    NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        DECLARE @Ws UNIQUEIDENTIFIER, @ScopeType NVARCHAR(12), @ScopeId UNIQUEIDENTIFIER, @Type NVARCHAR(10);
        SELECT @Ws = WorkspaceId, @ScopeType = ScopeType, @ScopeId = ScopeId, @Type = Type
          FROM dbo.SavedViews WHERE Id = @Id AND DeletedAt IS NULL;
        IF @Ws IS NULL THROW 51500, 'Saved view not found', 1;

        BEGIN TRANSACTION;

        IF @IsDefault = 1
            UPDATE dbo.SavedViews
               SET IsDefault = 0, UpdatedAt = SYSUTCDATETIME()
             WHERE WorkspaceId = @Ws AND ScopeType = @ScopeType
               AND ((@ScopeId IS NULL AND ScopeId IS NULL) OR ScopeId = @ScopeId)
               AND Type = @Type AND Id <> @Id AND DeletedAt IS NULL;

        UPDATE dbo.SavedViews
           SET Name      = COALESCE(@Name, Name),
               IsShared  = COALESCE(@IsShared, IsShared),
               IsDefault = COALESCE(@IsDefault, IsDefault),
               Config    = COALESCE(@Config, Config),
               UpdatedAt = SYSUTCDATETIME()
         WHERE Id = @Id;

        COMMIT TRANSACTION;

        SELECT * FROM dbo.SavedViews WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
