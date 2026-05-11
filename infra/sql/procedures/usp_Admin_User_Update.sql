-- Admin edits a user's identity fields. Email change rechecks uniqueness
-- against live (non-deleted) accounts. NULL parameters mean "leave unchanged"
-- so the API can patch a single field without resending the whole row.
CREATE OR ALTER PROCEDURE dbo.usp_Admin_User_Update
    @Id    UNIQUEIDENTIFIER,
    @Email NVARCHAR(255) = NULL,
    @Name  NVARCHAR(255) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE Id = @Id)
        THROW 50004, 'User not found.', 1;

    IF @Email IS NOT NULL
       AND EXISTS (SELECT 1 FROM dbo.Users
                   WHERE Email = @Email AND Id <> @Id AND DeletedAt IS NULL)
        THROW 50001, 'Email is already registered.', 1;

    UPDATE dbo.Users
    SET    Email     = COALESCE(@Email, Email),
           Name      = COALESCE(@Name,  Name),
           UpdatedAt = SYSUTCDATETIME()
    WHERE  Id = @Id;

    SELECT u.Id,
           u.Email,
           u.Name,
           u.AvatarUrl,
           u.IsEmailVerified,
           u.MfaEnabled,
           (SELECT COUNT(*) FROM dbo.WorkspaceMembers wm WHERE wm.UserId = u.Id) AS WorkspaceCount,
           u.CreatedAt,
           u.DeletedAt
    FROM   dbo.Users u
    WHERE  u.Id = @Id;
END;
