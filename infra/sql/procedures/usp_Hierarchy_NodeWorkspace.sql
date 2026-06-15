CREATE OR ALTER PROCEDURE dbo.usp_Hierarchy_NodeWorkspace
  @NodeType NVARCHAR(8),     -- 'SPACE' | 'FOLDER' | 'LIST'
  @NodeId   UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  IF @NodeType = 'SPACE'
    SELECT WorkspaceId FROM dbo.Projects WHERE Id = @NodeId AND Status <> 'DELETED';
  ELSE IF @NodeType = 'FOLDER'
    SELECT WorkspaceId FROM dbo.Folders WHERE Id = @NodeId AND DeletedAt IS NULL;
  ELSE IF @NodeType = 'LIST'
    SELECT WorkspaceId FROM dbo.Lists WHERE Id = @NodeId AND DeletedAt IS NULL;
END;
