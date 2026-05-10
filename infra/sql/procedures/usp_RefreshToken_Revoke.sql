CREATE OR ALTER PROCEDURE usp_RefreshToken_Revoke
    @TokenHash NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE RefreshTokens
    SET    RevokedAt = GETUTCDATE(),
           UpdatedAt = GETUTCDATE()
    WHERE  TokenHash = @TokenHash;
END;
