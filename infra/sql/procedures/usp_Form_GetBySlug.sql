CREATE OR ALTER PROCEDURE dbo.usp_Form_GetBySlug
    @PublicSlug NVARCHAR(64)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.Forms
    WHERE PublicSlug = @PublicSlug AND IsPublic = 1 AND DeletedAt IS NULL;
END;
GO
