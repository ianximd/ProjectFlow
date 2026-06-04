CREATE OR ALTER PROCEDURE dbo.usp_CustomField_GetWorkspaceId
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT WorkspaceId FROM dbo.CustomFields WHERE Id = @Id AND DeletedAt IS NULL;
END;
