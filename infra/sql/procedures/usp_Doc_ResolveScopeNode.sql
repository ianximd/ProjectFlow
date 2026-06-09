CREATE OR ALTER PROCEDURE dbo.usp_Doc_ResolveScopeNode
    @DocPageId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT d.ScopeType, d.ScopeId, d.WorkspaceId, d.Id AS DocId
    FROM dbo.DocPages p
    JOIN dbo.Docs     d ON d.Id = p.DocId
    WHERE p.Id = @DocPageId
      AND p.DeletedAt IS NULL
      AND d.DeletedAt IS NULL;
END;
GO
