-- Rollback 0033: Collaboration gaps (Phase 3.5)
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Notif_UserSaved')
    DROP INDEX IX_Notif_UserSaved ON dbo.Notifications;
GO
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Comments_AssignedToId')
    DROP INDEX IX_Comments_AssignedToId ON dbo.Comments;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CommentMentions')
    DROP TABLE dbo.CommentMentions;
GO
IF COL_LENGTH('dbo.Notifications', 'SavedAt') IS NOT NULL
    ALTER TABLE dbo.Notifications DROP COLUMN SavedAt;
GO
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_Notifications_SavedForLater')
    ALTER TABLE dbo.Notifications DROP CONSTRAINT DF_Notifications_SavedForLater;
GO
IF COL_LENGTH('dbo.Notifications', 'SavedForLater') IS NOT NULL
    ALTER TABLE dbo.Notifications DROP COLUMN SavedForLater;
GO
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Comments_ResolvedBy')
    ALTER TABLE dbo.Comments DROP CONSTRAINT FK_Comments_ResolvedBy;
GO
IF COL_LENGTH('dbo.Comments', 'ResolvedById') IS NOT NULL
    ALTER TABLE dbo.Comments DROP COLUMN ResolvedById;
GO
IF COL_LENGTH('dbo.Comments', 'ResolvedAt') IS NOT NULL
    ALTER TABLE dbo.Comments DROP COLUMN ResolvedAt;
GO
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Comments_AssignedTo')
    ALTER TABLE dbo.Comments DROP CONSTRAINT FK_Comments_AssignedTo;
GO
IF COL_LENGTH('dbo.Comments', 'AssignedToId') IS NOT NULL
    ALTER TABLE dbo.Comments DROP COLUMN AssignedToId;
GO
