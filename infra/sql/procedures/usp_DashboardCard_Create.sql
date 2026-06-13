CREATE OR ALTER PROCEDURE dbo.usp_DashboardCard_Create
  @Id          UNIQUEIDENTIFIER,
  @DashboardId UNIQUEIDENTIFIER,
  @Type        NVARCHAR(24),
  @Title       NVARCHAR(200) = NULL,
  @Config      NVARCHAR(MAX),
  @Layout      NVARCHAR(MAX),
  @Position    FLOAT = 0
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.DashboardCards (Id, DashboardId, Type, Title, Config, Layout, Position)
  VALUES (@Id, @DashboardId, @Type, @Title, @Config, @Layout, @Position);

  SELECT * FROM dbo.DashboardCards WHERE Id = @Id;
END;
GO
