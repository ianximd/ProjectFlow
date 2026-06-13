-- usp_Report_Portfolio
-- Rollup across a SET of folders or lists (comma-delimited @ScopeIds).
-- @ScopeType: 'folder' | 'list'.
-- ResultSet: per-scope rows (ScopeType, ScopeId, ScopeName, TotalIssues,
--            CompletedIssues, TotalPoints, CompletedPoints).
-- progressPct + onTrack are derived in the service (portfolioRollup).
CREATE OR ALTER PROCEDURE dbo.usp_Report_Portfolio
  @ScopeType NVARCHAR(8),
  @ScopeIds  NVARCHAR(MAX)
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @Ids TABLE (Id UNIQUEIDENTIFIER PRIMARY KEY);
  INSERT INTO @Ids (Id)
  SELECT DISTINCT TRY_CONVERT(UNIQUEIDENTIFIER, LTRIM(RTRIM(value)))
  FROM STRING_SPLIT(ISNULL(@ScopeIds, ''), ',')
  WHERE TRY_CONVERT(UNIQUEIDENTIFIER, LTRIM(RTRIM(value))) IS NOT NULL;

  IF @ScopeType = 'list'
  BEGIN
    SELECT
      'list'        AS ScopeType,
      l.Id          AS ScopeId,
      l.Name        AS ScopeName,
      COUNT(t.Id)   AS TotalIssues,
      ISNULL(SUM(CASE WHEN t.ResolvedAt IS NOT NULL THEN 1 ELSE 0 END), 0) AS CompletedIssues,
      ISNULL(SUM(ISNULL(t.StoryPoints, 0)), 0) AS TotalPoints,
      ISNULL(SUM(CASE WHEN t.ResolvedAt IS NOT NULL THEN ISNULL(t.StoryPoints, 0) ELSE 0 END), 0) AS CompletedPoints
    FROM dbo.Lists l
    JOIN @Ids i ON i.Id = l.Id
    LEFT JOIN dbo.Tasks t ON t.ListId = l.Id AND t.DeletedAt IS NULL
    WHERE l.DeletedAt IS NULL
    GROUP BY l.Id, l.Name
    ORDER BY l.Name;
  END
  ELSE
  BEGIN
    SELECT
      'folder'      AS ScopeType,
      f.Id          AS ScopeId,
      f.Name        AS ScopeName,
      COUNT(t.Id)   AS TotalIssues,
      ISNULL(SUM(CASE WHEN t.ResolvedAt IS NOT NULL THEN 1 ELSE 0 END), 0) AS CompletedIssues,
      ISNULL(SUM(ISNULL(t.StoryPoints, 0)), 0) AS TotalPoints,
      ISNULL(SUM(CASE WHEN t.ResolvedAt IS NOT NULL THEN ISNULL(t.StoryPoints, 0) ELSE 0 END), 0) AS CompletedPoints
    FROM dbo.Folders f
    JOIN @Ids i ON i.Id = f.Id
    LEFT JOIN dbo.Lists l ON l.FolderId = f.Id AND l.DeletedAt IS NULL
    LEFT JOIN dbo.Tasks t ON t.ListId = l.Id AND t.DeletedAt IS NULL
    WHERE f.DeletedAt IS NULL
    GROUP BY f.Id, f.Name
    ORDER BY f.Name;
  END
END;
GO
