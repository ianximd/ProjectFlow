-- Fetch one workspace by id. Hides soft-deleted rows so the settings page
-- and PATCH/DELETE routes consistently return 404 for deleted workspaces.
CREATE OR ALTER PROCEDURE usp_Workspace_GetById
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT *
    FROM   Workspaces
    WHERE  Id = @Id
      AND  DeletedAt IS NULL;
END;
