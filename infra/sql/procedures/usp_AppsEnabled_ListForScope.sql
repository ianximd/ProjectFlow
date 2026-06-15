-- =============================================================================
-- usp_AppsEnabled_ListForScope (Phase 10a)
-- Given a scope node (workspace|space|folder|list), resolve its ancestry and
-- return the OVERRIDE CHAIN: every AppsEnabled row on any ancestor (the workspace
-- row at Depth 0, the Space at Depth 1, ancestor Folders by LEN(Path), and the
-- List at Depth 9999), each tagged with a Depth so the service picks the deepest
-- per AppKey (most-specific-wins). Reuses the exact Path LIKE ancestor scan from
-- usp_ObjectAccess_Resolve. A NULL @ScopeId (workspace scope) leaves @SpaceId/@Path
-- NULL so only the workspace-level overrides apply.
-- =============================================================================
CREATE OR ALTER PROCEDURE dbo.usp_AppsEnabled_ListForScope
  @WorkspaceId UNIQUEIDENTIFIER,
  @ScopeType   NVARCHAR(12),            -- 'workspace'|'space'|'folder'|'list'
  @ScopeId     UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @SpaceId UNIQUEIDENTIFIER, @Path NVARCHAR(900);

  IF @ScopeType = 'space'
    SELECT @SpaceId = Id, @Path = '/' + CONVERT(NVARCHAR(36), Id) + '/'
    FROM dbo.Projects WHERE Id = @ScopeId AND Status <> 'DELETED';
  ELSE IF @ScopeType = 'folder'
    SELECT @SpaceId = SpaceId, @Path = Path FROM dbo.Folders WHERE Id = @ScopeId AND DeletedAt IS NULL;
  ELSE IF @ScopeType = 'list'
    SELECT @SpaceId = SpaceId, @Path = Path FROM dbo.Lists WHERE Id = @ScopeId AND DeletedAt IS NULL;
  -- @ScopeType = 'workspace' leaves @SpaceId/@Path NULL -> only the workspace row applies.

  -- Ancestry: the workspace (depth 0), the Space (depth 1), ancestor folders
  -- (Path is a prefix of @Path, ordered by LEN(Path)), and the scope object itself.
  DECLARE @Ancestry TABLE (ScopeType NVARCHAR(12), ScopeId UNIQUEIDENTIFIER, Depth INT);
  INSERT INTO @Ancestry VALUES ('workspace', NULL, 0);
  IF @SpaceId IS NOT NULL
    INSERT INTO @Ancestry VALUES ('space', @SpaceId, 1);
  IF @Path IS NOT NULL
    INSERT INTO @Ancestry
      SELECT 'folder', f.Id, LEN(f.Path)
      FROM dbo.Folders f
      WHERE f.SpaceId = @SpaceId AND f.DeletedAt IS NULL AND @Path LIKE f.Path + '%';
  IF @ScopeType = 'list'
    INSERT INTO @Ancestry VALUES ('list', @ScopeId, 9999);

  SELECT ae.AppKey, ae.Enabled, a.ScopeType, a.ScopeId, a.Depth
  FROM   dbo.AppsEnabled ae
  JOIN   @Ancestry a
         ON a.ScopeType = ae.ScopeType
        AND ((a.ScopeId IS NULL AND ae.ScopeId IS NULL) OR a.ScopeId = ae.ScopeId)
  WHERE  ae.WorkspaceId = @WorkspaceId
  ORDER BY ae.AppKey, a.Depth DESC;
END;
GO
