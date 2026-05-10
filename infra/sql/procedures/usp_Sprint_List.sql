CREATE OR ALTER PROCEDURE usp_Sprint_List
    @ProjectId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM Sprints
    WHERE ProjectId = @ProjectId
    ORDER BY CreatedAt DESC;
END;
