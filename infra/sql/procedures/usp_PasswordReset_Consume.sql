CREATE OR ALTER PROCEDURE usp_PasswordReset_Consume
    @TokenHash    NVARCHAR(255),
    @PasswordHash NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;
    BEGIN TRY
        DECLARE @UserId    UNIQUEIDENTIFIER;
        DECLARE @ExpiresAt DATETIME2;
        DECLARE @UsedAt    DATETIME2;

        SELECT @UserId    = UserId,
               @ExpiresAt = ExpiresAt,
               @UsedAt    = UsedAt
        FROM   PasswordResetTokens
        WHERE  TokenHash = @TokenHash;

        IF @UserId IS NULL
        BEGIN
            ROLLBACK TRANSACTION;
            RAISERROR('TOKEN_NOT_FOUND', 16, 1);
            RETURN;
        END;

        IF @UsedAt IS NOT NULL
        BEGIN
            ROLLBACK TRANSACTION;
            RAISERROR('TOKEN_ALREADY_USED', 16, 1);
            RETURN;
        END;

        IF @ExpiresAt < GETUTCDATE()
        BEGIN
            ROLLBACK TRANSACTION;
            RAISERROR('TOKEN_EXPIRED', 16, 1);
            RETURN;
        END;

        -- Mark token consumed
        UPDATE PasswordResetTokens
        SET    UsedAt = GETUTCDATE()
        WHERE  TokenHash = @TokenHash;

        -- Update the user's password
        UPDATE Users
        SET    PasswordHash = @PasswordHash,
               UpdatedAt    = GETUTCDATE()
        WHERE  Id = @UserId
          AND  DeletedAt IS NULL;

        COMMIT TRANSACTION;

        -- Return the user id so the service can log the event
        SELECT @UserId AS UserId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
