CREATE OR ALTER PROCEDURE dbo.usp_DashboardCard_Update
  @Id       UNIQUEIDENTIFIER,
  @Title    NVARCHAR(200) = NULL,
  @Config   NVARCHAR(MAX) = NULL,
  @Layout   NVARCHAR(MAX) = NULL,
  @Position FLOAT         = NULL
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.DashboardCards SET
    Title     = ISNULL(@Title,    Title),
    Config    = ISNULL(@Config,   Config),
    Layout    = ISNULL(@Layout,   Layout),
    Position  = ISNULL(@Position, Position),
    UpdatedAt = SYSUTCDATETIME()
  WHERE Id = @Id;

  SELECT * FROM dbo.DashboardCards WHERE Id = @Id;
END;
GO
