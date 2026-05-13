-- Find identity rows whose stored token ciphertext was encrypted under a
-- key OTHER than the one passed in (typically the current PRIMARY).
-- The key-rotation worker (Phase 1.E) batches these and re-encrypts under
-- PRIMARY, walking the table over many runs rather than locking it all
-- at once.
--
-- The filtered index from migration 0026 makes this cheap even when the
-- overwhelming majority of rows have NULL TokenKeyVersion (no stored
-- tokens at all). Stable Id ordering so successive batches consume new
-- rows even if the worker restarts mid-sweep.
CREATE OR ALTER PROCEDURE dbo.usp_UserOAuthIdentity_ListByKeyVersion
    @PrimaryKeyVersion NVARCHAR(16),
    @Limit             INT = 100
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (@Limit)
           Id,
           UserId,
           Provider,
           Subject,
           AccessTokenEnc,
           RefreshTokenEnc,
           TokenExpiresAt,
           TokenKeyVersion
    FROM   dbo.UserOAuthIdentities
    WHERE  TokenKeyVersion IS NOT NULL
      AND  TokenKeyVersion <> @PrimaryKeyVersion
    ORDER BY Id;
END;
GO
