CREATE OR ALTER PROCEDURE dbo.usp_Component_Update
  @Id          UNIQUEIDENTIFIER,
  @Name        NVARCHAR(100)    = NULL,
  @Description NVARCHAR(500)    = NULL,
  @LeadUserId  UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.ProjectComponents SET
    Name        = ISNULL(@Name,        Name),
    Description = ISNULL(@Description, Description),
    LeadUserId  = ISNULL(@LeadUserId,  LeadUserId)
  WHERE Id = @Id;
  SELECT
    c.*,
    u.Name      AS LeadUserName,
    u.AvatarUrl AS LeadAvatarUrl
  FROM dbo.ProjectComponents c
  LEFT JOIN dbo.Users u ON u.Id = c.LeadUserId
  WHERE c.Id = @Id;
END;
GO
