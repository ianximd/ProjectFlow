CREATE OR ALTER PROCEDURE dbo.usp_Whiteboard_GetWorkspaceId
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT WorkspaceId FROM dbo.Whiteboards WHERE Id = @Id AND DeletedAt IS NULL;
END;
GO
