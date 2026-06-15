CREATE OR ALTER PROCEDURE dbo.usp_Project_SetVisibility
  @Id         UNIQUEIDENTIFIER,
  @Visibility NVARCHAR(10)        -- 'PUBLIC' | 'PRIVATE'
AS
BEGIN
  SET NOCOUNT ON;
  -- Minimal Space-visibility setter. The full project editor lives in
  -- usp_Project_Update; this focused SP lets the Phase 10b permission-matrix
  -- test toggle PUBLIC/PRIVATE deterministically without threading every
  -- project field through the update SP.
  UPDATE dbo.Projects SET Visibility = @Visibility WHERE Id = @Id AND Status <> 'DELETED';
  SELECT @@ROWCOUNT AS Updated;
END;
