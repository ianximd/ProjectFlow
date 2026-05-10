CREATE OR ALTER PROCEDURE dbo.usp_Component_Create
  @ProjectId   UNIQUEIDENTIFIER,
  @Name        NVARCHAR(100),
  @Description NVARCHAR(500)    = NULL,
  @LeadUserId  UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @NewId UNIQUEIDENTIFIER = NEWID();
  INSERT INTO dbo.ProjectComponents (Id, ProjectId, Name, Description, LeadUserId)
  VALUES (@NewId, @ProjectId, @Name, @Description, @LeadUserId);
  SELECT
    c.*,
    u.Name     AS LeadUserName,
    u.AvatarUrl AS LeadAvatarUrl
  FROM dbo.ProjectComponents c
  LEFT JOIN dbo.Users u ON u.Id = c.LeadUserId
  WHERE c.Id = @NewId;
END;
GO
