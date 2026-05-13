-- Atomic create-user + link-identity. Used when /auth/oauth/:provider/callback
-- sees a (Provider, Subject) it has never seen before AND no existing
-- local account claims the email.
--
-- The new user has:
--   - PasswordHash NULL (OAuth-only — login via the password form is not
--     possible until the user sets a password explicitly).
--   - IsEmailVerified = 1 ONLY when the provider asserts the email is
--     verified. Caller passes @EmailVerified accordingly.
--   - MfaEnabled = 0 — MFA enrolment is a separate user-driven flow.
--
-- Throws 50001 (FK / uniqueness) propagates from the underlying INSERT
-- if Email is already taken — caller should have checked first, but the
-- DB-level guarantee is the last line of defence.
--
-- Returns the new Users row.
CREATE OR ALTER PROCEDURE dbo.usp_User_CreateFromOAuth
    @Email          NVARCHAR(255),
    @Name           NVARCHAR(255),
    @AvatarUrl      NVARCHAR(500) = NULL,
    @EmailVerified  BIT,
    @Provider       NVARCHAR(32),
    @Subject        NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

        INSERT INTO dbo.Users
            (Id, Email, Name, AvatarUrl, PasswordHash, IsEmailVerified, MfaEnabled, CreatedAt, UpdatedAt)
        VALUES
            (@NewId, @Email, @Name, @AvatarUrl, NULL, @EmailVerified, 0, SYSUTCDATETIME(), SYSUTCDATETIME());

        INSERT INTO dbo.UserOAuthIdentities (UserId, Provider, Subject, Email)
        VALUES (@NewId, @Provider, @Subject, @Email);

        COMMIT TRANSACTION;

        SELECT * FROM dbo.Users WHERE Id = @NewId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO
