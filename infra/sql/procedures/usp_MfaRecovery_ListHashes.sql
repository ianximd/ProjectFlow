-- Returns the current set of (Id, CodeHash) pairs for a user. The application
-- iterates them, bcrypt.compare()s each, and on a match calls
-- usp_MfaRecovery_Consume to delete that code.
CREATE OR ALTER PROCEDURE dbo.usp_MfaRecovery_ListHashes
    @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, CodeHash
    FROM   dbo.MfaRecoveryCodes
    WHERE  UserId = @UserId;
END;
