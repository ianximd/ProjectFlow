CREATE OR ALTER PROCEDURE dbo.usp_Version_Create
  @ProjectId   UNIQUEIDENTIFIER,
  @Name        NVARCHAR(100),
  @Description NVARCHAR(MAX)  = NULL,
  @StartDate   DATE           = NULL,
  @ReleaseDate DATE           = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @NewId UNIQUEIDENTIFIER = NEWID();
  INSERT INTO dbo.Versions (Id, ProjectId, Name, Description, StartDate, ReleaseDate)
  VALUES (@NewId, @ProjectId, @Name, @Description, @StartDate, @ReleaseDate);
  SELECT * FROM dbo.Versions WHERE Id = @NewId;
END;
GO
