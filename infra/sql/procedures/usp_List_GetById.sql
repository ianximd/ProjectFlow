-- Read a single live list's metadata by id. Added in Phase 5d: template capture
-- needs the source list's Name/Path/SpaceId/FolderId for a LIST-scope snapshot,
-- and the hierarchy module previously had no single-list read (only List_List).
CREATE OR ALTER PROCEDURE dbo.usp_List_GetById
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.Lists WHERE Id = @Id AND DeletedAt IS NULL;
END;
