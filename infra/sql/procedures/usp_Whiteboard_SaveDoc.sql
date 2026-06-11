CREATE OR ALTER PROCEDURE dbo.usp_Whiteboard_SaveDoc
    @Id      UNIQUEIDENTIFIER,
    @DocYjs  VARBINARY(MAX),
    @DocJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.Whiteboards
       SET DocYjs    = @DocYjs,
           DocJson   = ISNULL(@DocJson, DocJson),
           UpdatedAt = SYSUTCDATETIME()
     WHERE Id = @Id AND DeletedAt IS NULL;
END;
GO
