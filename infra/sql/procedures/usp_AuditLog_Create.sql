CREATE OR ALTER PROCEDURE dbo.usp_AuditLog_Create
  @WorkspaceId  NVARCHAR(255)  = NULL,
  @UserId       NVARCHAR(255),
  @UserEmail    NVARCHAR(320)  = NULL,
  @Action       NVARCHAR(50),
  @Resource     NVARCHAR(100),
  @ResourceId   NVARCHAR(255)  = NULL,
  @OldValues    NVARCHAR(MAX)  = NULL,
  @NewValues    NVARCHAR(MAX)  = NULL,
  @IpAddress    NVARCHAR(50)   = NULL,
  @UserAgent    NVARCHAR(512)  = NULL
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.AuditLog
    (WorkspaceId, UserId, UserEmail, Action, Resource, ResourceId, OldValues, NewValues, IpAddress, UserAgent)
  VALUES
    (@WorkspaceId, @UserId, @UserEmail, @Action, @Resource, @ResourceId, @OldValues, @NewValues, @IpAddress, @UserAgent);
END;
