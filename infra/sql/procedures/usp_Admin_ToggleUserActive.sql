-- Soft-delete (suspend) or restore a user account.
-- Sets DeletedAt to NOW() when suspending, NULL when restoring.
CREATE OR ALTER PROCEDURE dbo.usp_Admin_ToggleUserActive
  @UserId   NVARCHAR(255),
  @Suspend  BIT           -- 1 = suspend, 0 = restore
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.Users
  SET    DeletedAt = CASE WHEN @Suspend = 1 THEN GETUTCDATE() ELSE NULL END
  WHERE  Id = @UserId;

  SELECT Id, Email, Name, IsEmailVerified, DeletedAt, CreatedAt
  FROM   dbo.Users
  WHERE  Id = @UserId;
END;
