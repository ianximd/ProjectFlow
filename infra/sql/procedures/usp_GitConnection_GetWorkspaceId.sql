CREATE OR ALTER PROCEDURE dbo.usp_GitConnection_GetWorkspaceId
    @ConnectionId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 WorkspaceId
    FROM dbo.GitConnections
    WHERE Id = @ConnectionId;
END;
