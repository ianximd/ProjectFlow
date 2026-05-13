-- Single-row read for the audit-snapshot fetcher (Phase 6 W43 Option A
-- extension). Returns the top-level Workflow row. Statuses and
-- transitions live in separate child tables; they get their own audit
-- rows from PATCH /workflows/:id/statuses/:statusId etc. — but those
-- sub-resource paths surface the *child* id as resourceId, which won't
-- match a Workflow row here. That's the documented fallback (no diff,
-- still gets the WHO/WHAT/WHEN audit entry).
CREATE OR ALTER PROCEDURE dbo.usp_Workflow_GetById
    @WorkflowId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1
           Id,
           ProjectId,
           Name,
           IsDefault,
           CreatedAt,
           UpdatedAt
    FROM   dbo.Workflows
    WHERE  Id = @WorkflowId;
END;
GO
