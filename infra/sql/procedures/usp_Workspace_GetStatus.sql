-- Lookup the operational Status + soft-delete flag for one workspace
-- (Phase 6 W43 — freeze guard).
--
-- The permission middleware calls this on every write request that
-- resolves to a workspace, so it MUST be cheap: single PK lookup, two
-- scalar columns, no joins. Returns zero rows when the workspace
-- doesn't exist (middleware treats that as "no freeze to check" —
-- existing handlers will 404 via their own resource lookup).
--
-- Unlike usp_Workspace_GetById this does NOT filter on DeletedAt, so
-- an archived workspace is also visible. The freeze guard doesn't
-- block archived writes (those already fail elsewhere via the
-- soft-delete check) but the column is returned so callers can use it
-- if they want.
CREATE OR ALTER PROCEDURE dbo.usp_Workspace_GetStatus
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1
           Id,
           Status,
           DeletedAt
    FROM   dbo.Workspaces
    WHERE  Id = @Id;
END;
GO
