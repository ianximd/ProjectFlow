CREATE OR ALTER PROCEDURE usp_PasswordReset_Create
    @UserId    UNIQUEIDENTIFIER,
    @TokenHash NVARCHAR(255),
    @ExpiresAt DATETIME2
AS
BEGIN
    SET NOCOUNT ON;

    -- Invalidate any existing unused tokens for this user
    UPDATE PasswordResetTokens
    SET    UsedAt = GETUTCDATE()
    WHERE  UserId  = @UserId
      AND  UsedAt  IS NULL;

    INSERT INTO PasswordResetTokens (UserId, TokenHash, ExpiresAt)
    VALUES (@UserId, @TokenHash, @ExpiresAt);
END;
