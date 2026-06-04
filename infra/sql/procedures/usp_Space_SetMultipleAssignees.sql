CREATE OR ALTER PROCEDURE dbo.usp_Space_SetMultipleAssignees @SpaceId UNIQUEIDENTIFIER, @Value BIT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.Projects SET MultipleAssignees = @Value, UpdatedAt = SYSUTCDATETIME() WHERE Id = @SpaceId;
    SELECT * FROM dbo.Projects WHERE Id = @SpaceId;
END;
