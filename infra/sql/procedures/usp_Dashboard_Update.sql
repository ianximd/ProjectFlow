CREATE OR ALTER PROCEDURE dbo.usp_Dashboard_Update
  @Id          UNIQUEIDENTIFIER,
  @Name        NVARCHAR(200) = NULL,
  @Description NVARCHAR(MAX) = NULL,
  @Visibility  NVARCHAR(10)  = NULL,
  @Position    FLOAT         = NULL
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.Dashboards SET
    Name        = ISNULL(@Name,        Name),
    Description = ISNULL(@Description, Description),
    Visibility  = ISNULL(@Visibility,  Visibility),
    Position    = ISNULL(@Position,    Position),
    UpdatedAt   = SYSUTCDATETIME()
  WHERE Id = @Id AND DeletedAt IS NULL;

  SELECT * FROM dbo.Dashboards WHERE Id = @Id;
END;
GO
