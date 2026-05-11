-- Admin-driven user creation. Mirrors usp_User_Create but lets the caller
-- pre-mark the email as verified (admin-vouched accounts skip the email
-- verification flow). PasswordHash is computed by the API (bcrypt cost 12).
CREATE OR ALTER PROCEDURE dbo.usp_Admin_User_Create
    @Email           NVARCHAR(255),
    @Name            NVARCHAR(255),
    @PasswordHash    NVARCHAR(255),
    @IsEmailVerified BIT = 1
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1 FROM dbo.Users WHERE Email = @Email AND DeletedAt IS NULL)
        THROW 50001, 'Email is already registered.', 1;

    DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

    INSERT INTO dbo.Users (Id, Email, Name, PasswordHash, IsEmailVerified)
    VALUES (@NewId, @Email, @Name, @PasswordHash, @IsEmailVerified);

    -- Echo back via the same shape the admin list uses so the UI can append
    -- the new row without a refetch.
    SELECT u.Id,
           u.Email,
           u.Name,
           u.AvatarUrl,
           u.IsEmailVerified,
           u.MfaEnabled,
           CAST(0 AS INT) AS WorkspaceCount,
           u.CreatedAt,
           u.DeletedAt
    FROM   dbo.Users u
    WHERE  u.Id = @NewId;
END;
