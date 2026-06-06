-- Phase 5d: read the SHARED saved views for a scope, WITHOUT the per-user
-- visibility filter that usp_View_List applies (IsShared = 1 OR OwnerId = @User).
-- Template capture is actor-agnostic: it portably copies a list's shared views
-- (a private view belongs to one user and is intentionally NOT templated).
CREATE OR ALTER PROCEDURE dbo.usp_View_ListForScope
    @ScopeType NVARCHAR(12),
    @ScopeId   UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.SavedViews
     WHERE ScopeType = @ScopeType
       AND ((@ScopeId IS NULL AND ScopeId IS NULL) OR ScopeId = @ScopeId)
       AND IsShared = 1
       AND DeletedAt IS NULL
     ORDER BY Position ASC, CreatedAt ASC;
END;
