-- Admin overrides a user's password. The plaintext is generated and bcrypted
-- by the API; this SP only stores the hash. We also clear any active lockout
-- + failed-attempt counter so the temp password isn't immediately bounced
-- by a stale lockout.
CREATE OR ALTER PROCEDURE dbo.usp_Admin_User_SetPassword
    @Id           UNIQUEIDENTIFIER,
    @PasswordHash NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE Id = @Id)
        THROW 50004, 'User not found.', 1;

    UPDATE dbo.Users
    SET    PasswordHash     = @PasswordHash,
           FailedLoginCount = 0,
           LockedUntil      = NULL,
           UpdatedAt        = SYSUTCDATETIME()
    WHERE  Id = @Id;

    SELECT @Id AS Id;
END;
