CREATE OR ALTER PROCEDURE dbo.usp_CustomField_List
    @ScopeType NVARCHAR(8),
    @ScopeId   UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.CustomFields
    WHERE ScopeType = @ScopeType AND ScopeId = @ScopeId AND DeletedAt IS NULL
    ORDER BY Position, CreatedAt;
END;
