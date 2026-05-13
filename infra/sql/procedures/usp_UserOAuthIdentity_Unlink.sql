-- Remove a linked OAuth identity. Used by the "Connected accounts" UI
-- in Phase 1.C.
--
-- Throws 51031 when removing the user's *last* credential — i.e. the
-- account would be left with no password AND no remaining OAuth identity.
-- Without this guard, the user would lock themselves out.
CREATE OR ALTER PROCEDURE dbo.usp_UserOAuthIdentity_Unlink
    @UserId   UNIQUEIDENTIFIER,
    @Provider NVARCHAR(32)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @HasPassword BIT;
        SELECT @HasPassword = CASE WHEN PasswordHash IS NULL THEN 0 ELSE 1 END
        FROM   dbo.Users WHERE Id = @UserId;

        DECLARE @OtherIdentityCount INT;
        SELECT @OtherIdentityCount = COUNT(*)
        FROM   dbo.UserOAuthIdentities
        WHERE  UserId = @UserId AND Provider <> @Provider;

        IF @HasPassword = 0 AND @OtherIdentityCount = 0
            THROW 51031, 'Cannot remove the last credential. Set a password or link another provider first.', 1;

        DELETE FROM dbo.UserOAuthIdentities
        WHERE UserId = @UserId AND Provider = @Provider;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO
