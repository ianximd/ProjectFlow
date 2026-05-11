-- Clears the auto-lockout state set by usp_User_RecordFailedLogin so a user
-- who got locked out by repeated bad passwords can log in again immediately.
-- Idempotent — running on an unlocked account is a no-op.
CREATE OR ALTER PROCEDURE dbo.usp_Admin_User_Unlock
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE Id = @Id)
        THROW 50004, 'User not found.', 1;

    UPDATE dbo.Users
    SET    FailedLoginCount = 0,
           LockedUntil      = NULL,
           UpdatedAt        = SYSUTCDATETIME()
    WHERE  Id = @Id;

    SELECT @Id AS Id, CAST(0 AS INT) AS FailedLoginCount;
END;
