-- Replaces all recovery codes for a user with a fresh batch. The CodeHashes
-- are passed in via a single comma-separated string (caller already ensured
-- they are bcrypt hashes — the SP is shape-blind to the hashing algorithm).
CREATE OR ALTER PROCEDURE dbo.usp_MfaRecovery_CreateBatch
    @UserId      UNIQUEIDENTIFIER,
    @CodeHashes  NVARCHAR(MAX)   -- newline-separated bcrypt hashes
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRANSACTION;
    BEGIN TRY
        -- Wipe any existing codes — recovery codes are always rotated as a set.
        DELETE FROM dbo.MfaRecoveryCodes WHERE UserId = @UserId;

        ;WITH parts AS (
            SELECT LTRIM(RTRIM(value)) AS hash
            FROM   STRING_SPLIT(@CodeHashes, CHAR(10))
            WHERE  LTRIM(RTRIM(value)) <> ''
        )
        INSERT INTO dbo.MfaRecoveryCodes (UserId, CodeHash)
        SELECT @UserId, hash FROM parts;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
