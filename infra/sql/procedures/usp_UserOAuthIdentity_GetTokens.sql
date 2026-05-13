-- Fetch the stored access + refresh ciphertext for one identity. The
-- caller is expected to decrypt them via tokenCrypto.open() — the SP
-- never sees plaintext. Used by:
--   - The (future) silent-refresh worker — needs RefreshTokenEnc.
--   - The (future) key-rotation worker — needs both columns to re-encrypt
--     and rewrite when TokenKeyVersion <> PRIMARY.
--
-- Returns one row or zero rows. The KeyVersion is exposed so the caller
-- can decide whether to re-encrypt without a second round trip.
CREATE OR ALTER PROCEDURE dbo.usp_UserOAuthIdentity_GetTokens
    @UserId   UNIQUEIDENTIFIER,
    @Provider NVARCHAR(32)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP 1
           Id,
           UserId,
           Provider,
           Subject,
           AccessTokenEnc,
           RefreshTokenEnc,
           TokenExpiresAt,
           TokenKeyVersion
    FROM   dbo.UserOAuthIdentities
    WHERE  UserId   = @UserId
      AND  Provider = @Provider;
END;
GO
