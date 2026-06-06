CREATE OR ALTER PROCEDURE usp_TaskRelationship_Add
    @FieldId UNIQUEIDENTIFIER, @FromTaskId UNIQUEIDENTIFIER, @ToTaskId UNIQUEIDENTIFIER, @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        -- The field must be a 'relationship'-type CustomFields row in this workspace.
        IF NOT EXISTS (
            SELECT 1 FROM dbo.CustomFields
             WHERE Id = @FieldId AND WorkspaceId = @WorkspaceId
               AND Type = 'relationship' AND DeletedAt IS NULL)
            THROW 51600, 'Relationship field not found in workspace', 1;
        -- IDOR guard: BOTH tasks must live in @WorkspaceId.
        IF NOT EXISTS (SELECT 1 FROM dbo.Tasks WHERE Id = @FromTaskId AND WorkspaceId = @WorkspaceId AND DeletedAt IS NULL)
            THROW 51601, 'From task not found in workspace', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.Tasks WHERE Id = @ToTaskId AND WorkspaceId = @WorkspaceId AND DeletedAt IS NULL)
            THROW 51602, 'To task not found in workspace', 1;
        IF @FromTaskId = @ToTaskId THROW 51603, 'A task cannot link to itself', 1;

        -- Idempotent insert (UQ_TaskRel covers (FieldId, FromTaskId, ToTaskId)).
        IF NOT EXISTS (
            SELECT 1 FROM dbo.TaskRelationships
             WHERE FieldId = @FieldId AND FromTaskId = @FromTaskId AND ToTaskId = @ToTaskId)
            INSERT INTO dbo.TaskRelationships (Id, WorkspaceId, FieldId, FromTaskId, ToTaskId)
            VALUES (NEWID(), @WorkspaceId, @FieldId, @FromTaskId, @ToTaskId);

        SELECT * FROM dbo.TaskRelationships
         WHERE FieldId = @FieldId AND FromTaskId = @FromTaskId AND ToTaskId = @ToTaskId;
    END TRY
    BEGIN CATCH THROW; END CATCH
END;
