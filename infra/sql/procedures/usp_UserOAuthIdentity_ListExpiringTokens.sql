-- Find identity rows whose access token is about to expire (or already
-- has) AND that have a stored refresh token we can use to rotate.
--
-- The silent-refresh worker (Phase 1.E) calls this on a fixed cadence
-- (default every 5 minutes) with @WithinSeconds set to roughly twice the
-- worker interval — that gives the worker two chances to refresh before
-- the access token actually expires, even if one run is slow.
--
-- Rows with NULL TokenExpiresAt are excluded: we can't decide when those
-- expire, so leave them alone (they were likely written by a path that
-- never set the column, e.g. a refresh response without expires_in).
CREATE OR ALTER PROCEDURE dbo.usp_UserOAuthIdentity_ListExpiringTokens
    @WithinSeconds INT = 600,
    @Limit         INT = 100
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
    WHERE  RefreshTokenEnc IS NOT NULL
      AND  TokenExpiresAt  IS NOT NULL
      AND  TokenExpiresAt  <= DATEADD(SECOND, @WithinSeconds, SYSUTCDATETIME())
    ORDER BY TokenExpiresAt ASC;
END;
GO
