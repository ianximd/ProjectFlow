-- =============================================================================
-- Migration 0046b: legacy flat-sprint -> sprint-folder hierarchy data migration.
-- For each flat Sprint that is NOT yet bound to a List:
--   1. ensure a sprint Folder ("Sprints") under the sprint's Project (Space),
--   2. create a sprint List under that Folder, bind Sprints.ListId/FolderId,
--   3. re-home tasks currently referencing Sprints.Id via SprintId into the List
--      (Tasks.ListId/ListPath set; Tasks.SprintId denorm retained).
-- Idempotent: only processes Sprints whose ListId IS NULL; the Folder is reused
-- if it already exists. LOCAL-DOCKER ONLY (prod cutover deferred,
-- see DECISIONS.md / spec §10.6).
--
-- NOTE: renumbered from the plan's 0045b (0044/0045 were taken by Phase 8b).
-- =============================================================================

BEGIN
    SET NOCOUNT ON;

    DECLARE @sid UNIQUEIDENTIFIER, @pid UNIQUEIDENTIFIER, @wsid UNIQUEIDENTIFIER,
            @sname NVARCHAR(255), @folderId UNIQUEIDENTIFIER, @listId UNIQUEIDENTIFIER,
            @folderPath NVARCHAR(900), @listPath NVARCHAR(900);

    DECLARE sprint_cur CURSOR LOCAL FAST_FORWARD FOR
        SELECT s.Id, s.ProjectId, p.WorkspaceId, s.Name
        FROM   dbo.Sprints s
        JOIN   dbo.Projects p ON p.Id = s.ProjectId
        WHERE  s.ListId IS NULL
          AND  p.Status <> 'DELETED';

    OPEN sprint_cur;
    FETCH NEXT FROM sprint_cur INTO @sid, @pid, @wsid, @sname;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @folderId = NULL;  -- reset per-iteration (top of loop, before lookup)

        -- 1) Ensure ONE sprint Folder per Project (reuse if present).
        SELECT TOP 1 @folderId = f.Id
        FROM   dbo.Folders f
        WHERE  f.SpaceId = @pid AND f.IsSprintFolder = 1 AND f.DeletedAt IS NULL;

        IF @folderId IS NULL
        BEGIN
            SET @folderId = NEWID();
            SET @folderPath = '/' + CONVERT(NVARCHAR(36), @pid) + '/' + CONVERT(NVARCHAR(36), @folderId) + '/';
            INSERT INTO dbo.Folders (Id, WorkspaceId, SpaceId, ParentFolderId, Name, Position, Path, IsSprintFolder)
            VALUES (@folderId, @wsid, @pid, NULL, 'Sprints', 0, @folderPath, 1);

            -- Default cadence settings for the new sprint Folder.
            INSERT INTO dbo.SprintSettings (FolderId, DurationDays, AutoStart, AutoComplete, AutoRollForward)
            VALUES (@folderId, 14, 0, 0, 0);
        END

        -- 2) Create the sprint List + bind the Sprints row.
        SET @listId = NEWID();
        SET @listPath = '/' + CONVERT(NVARCHAR(36), @pid) + '/' + CONVERT(NVARCHAR(36), @folderId) + '/' + CONVERT(NVARCHAR(36), @listId) + '/';
        INSERT INTO dbo.Lists (Id, WorkspaceId, SpaceId, FolderId, Name, Position, Path, IsDefault)
        VALUES (@listId, @wsid, @pid, @folderId, @sname, 0, @listPath, 0);

        UPDATE dbo.Sprints SET ListId = @listId, FolderId = @folderId, UpdatedAt = GETUTCDATE()
        WHERE Id = @sid;

        -- 3) Re-home tasks referencing this sprint via the SprintId denorm.
        UPDATE dbo.Tasks
        SET ListId = @listId, ListPath = @listPath, UpdatedAt = GETUTCDATE()
        WHERE SprintId = @sid AND DeletedAt IS NULL;

        FETCH NEXT FROM sprint_cur INTO @sid, @pid, @wsid, @sname;
    END
    CLOSE sprint_cur; DEALLOCATE sprint_cur;
END
GO
