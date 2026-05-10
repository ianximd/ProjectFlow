-- =============================================================================
-- usp_User_RecordFailedLogin
-- =============================================================================
-- Increments FailedLoginCount for the given user.
-- If the count reaches the threshold (default 5), sets LockedUntil for the
-- configured lockout duration (default 15 minutes).
-- Returns the current FailedLoginCount and LockedUntil after the update.
-- =============================================================================
CREATE OR ALTER PROCEDURE usp_User_RecordFailedLogin
    @UserId             UNIQUEIDENTIFIER,
    @MaxAttempts        INT      = 5,
    @LockoutMinutes     INT      = 15
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Users
    SET
        FailedLoginCount = FailedLoginCount + 1,
        LockedUntil = CASE
            WHEN FailedLoginCount + 1 >= @MaxAttempts
            THEN DATEADD(MINUTE, @LockoutMinutes, SYSUTCDATETIME())
            ELSE LockedUntil   -- preserve existing lockout if already locked
        END
    WHERE Id = @UserId
      AND DeletedAt IS NULL;

    SELECT FailedLoginCount, LockedUntil
    FROM   dbo.Users
    WHERE  Id = @UserId;
END;
GO
