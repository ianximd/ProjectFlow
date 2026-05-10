CREATE OR ALTER PROCEDURE dbo.usp_Label_Update
  @Id    UNIQUEIDENTIFIER,
  @Name  NVARCHAR(100) = NULL,
  @Color NVARCHAR(7)   = NULL
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.Labels SET
    Name  = ISNULL(@Name,  Name),
    Color = ISNULL(@Color, Color)
  WHERE Id = @Id;
  SELECT * FROM dbo.Labels WHERE Id = @Id;
END;
GO
