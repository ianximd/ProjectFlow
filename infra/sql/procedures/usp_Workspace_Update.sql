CREATE OR ALTER PROCEDURE usp_Workspace_Update
    @Id        UNIQUEIDENTIFIER,
    @Name           NVARCHAR(255) = NULL,
    @Slug           NVARCHAR(100) = NULL,
    @AvatarUrl      NVARCHAR(500) = NULL,
    @VerifiedDomain NVARCHAR(255) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE Workspaces
        SET
            Name           = ISNULL(@Name,           Name),
            Slug           = ISNULL(@Slug,           Slug),
            AvatarUrl      = ISNULL(@AvatarUrl,      AvatarUrl),
            VerifiedDomain = ISNULL(@VerifiedDomain, VerifiedDomain),
            UpdatedAt = GETUTCDATE()
        WHERE Id = @Id;

        IF @@ROWCOUNT = 0
        BEGIN
            ROLLBACK TRANSACTION;
            RAISERROR('WORKSPACE_NOT_FOUND', 16, 1);
            RETURN;
        END;

        SELECT * FROM Workspaces WHERE Id = @Id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
