-- Persist a fresh access/refresh token pair for an existing identity.
-- Used by the OAuth callback path (Phase 1.D) and, in the future, by the
-- silent-refresh worker that swaps an expired access token for a new one
-- using the stored refresh token.
--
-- Identified by (Provider, Subject) which is the natural unique key the
-- caller has right after the provider exchange. NVARCHAR(MAX) for the
-- ciphertext columns matches the existing 0025 schema.
--
-- Returns the (Updated, NotFound) status so the caller can distinguish
-- "we never linked this identity" from "we linked it but didn't have a
-- token to store" (e.g. an OAuth flow that doesn't grant offline access).
CREATE OR ALTER PROCEDURE dbo.usp_UserOAuthIdentity_UpsertTokens
    @Provider        NVARCHAR(32),
    @Subject         NVARCHAR(255),
    @AccessTokenEnc  NVARCHAR(MAX) = NULL,
    @RefreshTokenEnc NVARCHAR(MAX) = NULL,
    @TokenExpiresAt  DATETIME2     = NULL,
    @TokenKeyVersion NVARCHAR(16)  = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.UserOAuthIdentities
    SET    AccessTokenEnc  = @AccessTokenEnc,
           -- Don't overwrite a previously-saved refresh token with NULL —
           -- providers (notably Google) only return the refresh token on
           -- the first authorization. Subsequent refreshes reuse it.
           RefreshTokenEnc = COALESCE(@RefreshTokenEnc, RefreshTokenEnc),
           TokenExpiresAt  = @TokenExpiresAt,
           TokenKeyVersion = @TokenKeyVersion,
           UpdatedAt       = SYSUTCDATETIME()
    WHERE  Provider = @Provider
      AND  Subject  = @Subject;

    SELECT @@ROWCOUNT AS RowsAffected;
END;
GO
