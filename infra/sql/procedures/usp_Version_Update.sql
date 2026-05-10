CREATE OR ALTER PROCEDURE dbo.usp_Version_Update
  @Id          UNIQUEIDENTIFIER,
  @Name        NVARCHAR(100)  = NULL,
  @Description NVARCHAR(MAX)  = NULL,
  @Status      NVARCHAR(20)   = NULL,
  @StartDate   DATE           = NULL,
  @ReleaseDate DATE           = NULL
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.Versions SET
    Name        = ISNULL(@Name,        Name),
    Description = ISNULL(@Description, Description),
    Status      = ISNULL(@Status,      Status),
    StartDate   = ISNULL(@StartDate,   StartDate),
    ReleaseDate = ISNULL(@ReleaseDate, ReleaseDate),
    ReleasedAt  = CASE WHEN @Status = 'RELEASED' AND ReleasedAt IS NULL
                       THEN GETUTCDATE() ELSE ReleasedAt END
  WHERE Id = @Id;
  SELECT * FROM dbo.Versions WHERE Id = @Id;
END;
GO
