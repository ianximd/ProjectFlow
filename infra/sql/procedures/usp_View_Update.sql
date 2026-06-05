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
        DECLARE @Ws UNIQUEIDENTIFIER, @Owner UNIQUEIDENTIFIER, @ScopeType NVARCHAR(12), @ScopeId UNIQUEIDENTIFIER, @Type NVARCHAR(10);

        BEGIN TRANSACTION;

        -- Existence check inside the transaction with an update lock so a
        -- concurrent soft-delete can't slip between the check and the writes
        -- below (the final UPDATE also re-asserts DeletedAt IS NULL).
        SELECT @Ws = WorkspaceId, @Owner = OwnerId, @ScopeType = ScopeType, @ScopeId = ScopeId, @Type = Type
          FROM dbo.SavedViews WITH (UPDLOCK, HOLDLOCK)
         WHERE Id = @Id AND DeletedAt IS NULL;
        IF @Ws IS NULL THROW 51500, 'Saved view not found', 1;

        -- Clearing the existing default is scoped to THIS owner: a user's default
        -- is per-user, so promoting one of your views must not touch (or silently
        -- un-default) another member's view in the same scope — including private
        -- ones you can't see.
        IF @IsDefault = 1
            UPDATE dbo.SavedViews
               SET IsDefault = 0, UpdatedAt = SYSUTCDATETIME()
             WHERE WorkspaceId = @Ws AND OwnerId = @Owner AND ScopeType = @ScopeType
               AND ((@ScopeId IS NULL AND ScopeId IS NULL) OR ScopeId = @ScopeId)
               AND Type = @Type AND Id <> @Id AND DeletedAt IS NULL;

        UPDATE dbo.SavedViews
           SET Name      = COALESCE(@Name, Name),
               IsShared  = COALESCE(@IsShared, IsShared),
               IsDefault = COALESCE(@IsDefault, IsDefault),
               Config    = COALESCE(@Config, Config),
               UpdatedAt = SYSUTCDATETIME()
         WHERE Id = @Id AND DeletedAt IS NULL;

        COMMIT TRANSACTION;

        SELECT * FROM dbo.SavedViews WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
