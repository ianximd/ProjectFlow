CREATE OR ALTER PROCEDURE dbo.usp_Whiteboard_GetDoc
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, DocYjs, DocJson FROM dbo.Whiteboards WHERE Id = @Id AND DeletedAt IS NULL;
END;
GO
