-- =============================================================================
-- usp_User_ClearLoginAttempts
-- =============================================================================
-- Resets FailedLoginCount to 0 and clears LockedUntil after a successful login.
-- =============================================================================
CREATE OR ALTER PROCEDURE usp_User_ClearLoginAttempts
    @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Users
    SET
        FailedLoginCount = 0,
        LockedUntil      = NULL
    WHERE Id = @UserId
      AND DeletedAt IS NULL;
END;
GO
