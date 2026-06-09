CREATE OR ALTER PROCEDURE dbo.usp_DocPage_PersistYjs
    @PageId   UNIQUEIDENTIFIER,
    @BodyYjs  VARBINARY(MAX),
    @BodyJson NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.DocPages
       SET BodyYjs   = @BodyYjs,
           BodyJson  = @BodyJson,
           UpdatedAt = SYSUTCDATETIME()
     WHERE Id = @PageId AND DeletedAt IS NULL;
END;
GO
