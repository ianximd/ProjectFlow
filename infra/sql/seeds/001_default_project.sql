-- Seed default workspace and project for Phase 1 MVP
-- These IDs match the hardcoded values in the frontend

-- Insert default workspace (only if not exists)
IF NOT EXISTS (SELECT 1 FROM Workspaces WHERE Id = '00000000-0000-0000-0000-000000000000')
BEGIN
    -- Need a user first (use the test user we already created)
    DECLARE @UserId UNIQUEIDENTIFIER;
    SELECT TOP 1 @UserId = Id FROM Users WHERE Email = 'test@projectflow.app';

    IF @UserId IS NULL
    BEGIN
        -- Create a system user if test user doesn't exist
        SET @UserId = '00000000-0000-0000-0000-000000000001';
        INSERT INTO Users (Id, Email, Name, PasswordHash)
        VALUES (@UserId, 'system@projectflow.app', 'System', 'N/A');
    END

    INSERT INTO Workspaces (Id, Name, Slug, OwnerId)
    VALUES ('00000000-0000-0000-0000-000000000000', 'Default Workspace', 'default', @UserId);

    INSERT INTO Projects (Id, WorkspaceId, Name, [Key], Type, Status, CreatedById)
    VALUES (
        '00000000-0000-0000-0000-000000000000',
        '00000000-0000-0000-0000-000000000000',
        'ProjectFlow MVP',
        'PF',
        'KANBAN',
        'ACTIVE',
        @UserId
    );

    PRINT 'Seeded default workspace and project.';
END
ELSE
BEGIN
    PRINT 'Default workspace already exists.';
END
