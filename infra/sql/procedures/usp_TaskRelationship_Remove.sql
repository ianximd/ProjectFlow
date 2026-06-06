CREATE OR ALTER PROCEDURE usp_TaskRelationship_Remove
    @FieldId UNIQUEIDENTIFIER, @FromTaskId UNIQUEIDENTIFIER, @ToTaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM dbo.TaskRelationships
     WHERE FieldId = @FieldId AND FromTaskId = @FromTaskId AND ToTaskId = @ToTaskId;
    SELECT @@ROWCOUNT AS Removed;
END;
