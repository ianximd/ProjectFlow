-- Admin emergency MFA reset. Used when a user lost access to their authenticator
-- AND their recovery codes. Wipes the secret + flag + recovery codes so the
-- user can log in with just the password (and re-enrol via /mfa/setup).
CREATE OR ALTER PROCEDURE dbo.usp_Admin_User_DisableMfa
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE Id = @Id)
        THROW 50004, 'User not found.', 1;

    UPDATE dbo.Users
    SET    MfaEnabled    = 0,
           MfaSecret     = NULL,
           MfaEnabledAt  = NULL,
           UpdatedAt     = SYSUTCDATETIME()
    WHERE  Id = @Id;

    -- Recovery codes are no longer meaningful once MFA is off.
    DELETE FROM dbo.UserMfaRecoveryCodes WHERE UserId = @Id;

    SELECT @Id AS Id, CAST(0 AS BIT) AS MfaEnabled;
END;
