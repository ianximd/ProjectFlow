CREATE OR ALTER PROCEDURE usp_TaskRelationship_Remove
    @FieldId UNIQUEIDENTIFIER, @FromTaskId UNIQUEIDENTIFIER, @ToTaskId UNIQUEIDENTIFIER, @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    -- Workspace-scoped (defense-in-depth, mirrors usp_TaskRelationship_Add):
    -- only remove a link that lives in @WorkspaceId. Not currently exploitable
    -- (the route keys on the ACL-gated :taskId and links are same-workspace by
    -- Add-time validation) — this is hardening + consistency.
    DELETE FROM dbo.TaskRelationships
     WHERE FieldId = @FieldId AND FromTaskId = @FromTaskId AND ToTaskId = @ToTaskId
       AND WorkspaceId = @WorkspaceId;
    SELECT @@ROWCOUNT AS Removed;
END;
