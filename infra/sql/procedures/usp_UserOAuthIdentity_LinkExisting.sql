-- Attach a (Provider, Subject) to an existing UserId. Used by the link
-- flow (an authenticated user adding a second provider) and by the
-- email-collision auto-link path (provider-verified email matches a
-- local-account-verified email).
--
-- Throws 51030 when (Provider, Subject) is already linked to a *different*
-- user — protects against an attacker hijacking an existing identity.
CREATE OR ALTER PROCEDURE dbo.usp_UserOAuthIdentity_LinkExisting
    @UserId   UNIQUEIDENTIFIER,
    @Provider NVARCHAR(32),
    @Subject  NVARCHAR(255),
    @Email    NVARCHAR(255) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ExistingUserId UNIQUEIDENTIFIER;
    SELECT @ExistingUserId = UserId
    FROM   dbo.UserOAuthIdentities
    WHERE  Provider = @Provider AND Subject = @Subject;

    IF @ExistingUserId IS NOT NULL AND @ExistingUserId <> @UserId
        THROW 51030, 'This OAuth identity is already linked to a different account.', 1;

    -- Idempotent: return the existing row without touching anything if
    -- the same user has already linked this identity.
    IF @ExistingUserId = @UserId
    BEGIN
        SELECT * FROM dbo.UserOAuthIdentities
        WHERE Provider = @Provider AND Subject = @Subject;
        RETURN;
    END

    INSERT INTO dbo.UserOAuthIdentities (UserId, Provider, Subject, Email)
    VALUES (@UserId, @Provider, @Subject, @Email);

    SELECT * FROM dbo.UserOAuthIdentities
    WHERE Provider = @Provider AND Subject = @Subject;
END;
GO
