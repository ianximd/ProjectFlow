CREATE OR ALTER PROCEDURE usp_Project_List
    @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM Projects
    WHERE WorkspaceId = @WorkspaceId AND Status != 'DELETED';
END;
