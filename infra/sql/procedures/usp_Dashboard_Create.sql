CREATE OR ALTER PROCEDURE dbo.usp_Dashboard_Create
  @Id          UNIQUEIDENTIFIER,
  @WorkspaceId UNIQUEIDENTIFIER,
  @OwnerId     UNIQUEIDENTIFIER,
  @ScopeType   NVARCHAR(12),
  @ScopeId     UNIQUEIDENTIFIER = NULL,
  @ScopePath   NVARCHAR(900)   = NULL,
  @Name        NVARCHAR(200),
  @Description NVARCHAR(MAX)   = NULL,
  @Visibility  NVARCHAR(10)    = 'shared',
  @IsDefault   BIT             = 0,
  @Position    FLOAT           = 0
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.Dashboards (Id, WorkspaceId, OwnerId, ScopeType, ScopeId, ScopePath, Name, Description, Visibility, IsDefault, Position)
  VALUES (@Id, @WorkspaceId, @OwnerId, @ScopeType, @ScopeId, @ScopePath, @Name, @Description, @Visibility, @IsDefault, @Position);

  SELECT * FROM dbo.Dashboards WHERE Id = @Id;
END;
GO
