CREATE OR ALTER PROCEDURE dbo.usp_Label_Create
  @ProjectId UNIQUEIDENTIFIER,
  @Name      NVARCHAR(100),
  @Color     NVARCHAR(7) = '#6c63ff'
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @NewId UNIQUEIDENTIFIER = NEWID();
  INSERT INTO dbo.Labels (Id, ProjectId, Name, Color)
  VALUES (@NewId, @ProjectId, @Name, @Color);
  SELECT * FROM dbo.Labels WHERE Id = @NewId;
END;
GO
