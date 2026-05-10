-- Migration: 0001_create_core_tables.sql
-- Creates core tables for ProjectFlow

USE [ProjectFlow];
GO

-- =============================================
-- Users Table
-- =============================================
CREATE TABLE Users (
    Id              UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    Email           NVARCHAR(255) NOT NULL,
    Name            NVARCHAR(255) NOT NULL,
    AvatarUrl       NVARCHAR(500) NULL,
    PasswordHash    NVARCHAR(255) NULL,
    IsEmailVerified BIT NOT NULL DEFAULT 0,
    MfaEnabled      BIT NOT NULL DEFAULT 0,
    MfaSecret       NVARCHAR(255) NULL,
    CreatedAt       DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt       DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    DeletedAt       DATETIME2 NULL,
    CONSTRAINT UQ_Users_Email UNIQUE (Email)
);
GO

-- =============================================
-- Workspaces Table
-- =============================================
CREATE TABLE Workspaces (
    Id        UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    Name      NVARCHAR(255) NOT NULL,
    Slug      NVARCHAR(100) NOT NULL,
    AvatarUrl NVARCHAR(500) NULL,
    OwnerId   UNIQUEIDENTIFIER NOT NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_Workspaces_Owner FOREIGN KEY (OwnerId) REFERENCES Users(Id),
    CONSTRAINT UQ_Workspaces_Slug UNIQUE (Slug)
);
GO

-- =============================================
-- WorkspaceMembers Table
-- =============================================
CREATE TABLE WorkspaceMembers (
    Id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    WorkspaceId UNIQUEIDENTIFIER NOT NULL,
    UserId      UNIQUEIDENTIFIER NOT NULL,
    Role        NVARCHAR(20) NOT NULL DEFAULT 'MEMBER',
    JoinedAt    DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_WorkspaceMembers_Workspace FOREIGN KEY (WorkspaceId) REFERENCES Workspaces(Id),
    CONSTRAINT FK_WorkspaceMembers_User FOREIGN KEY (UserId) REFERENCES Users(Id),
    CONSTRAINT UQ_WorkspaceMember UNIQUE (WorkspaceId, UserId),
    CONSTRAINT CK_WorkspaceMembers_Role CHECK (Role IN ('OWNER', 'ADMIN', 'MEMBER', 'GUEST'))
);
GO

-- =============================================
-- Projects Table
-- =============================================
CREATE TABLE Projects (
    Id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    WorkspaceId UNIQUEIDENTIFIER NOT NULL,
    Name        NVARCHAR(255) NOT NULL,
    [Key]       NVARCHAR(20) NOT NULL,
    Description NVARCHAR(MAX) NULL,
    AvatarUrl   NVARCHAR(500) NULL,
    Type        NVARCHAR(20) NOT NULL DEFAULT 'SCRUM',
    Status      NVARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    CreatedById UNIQUEIDENTIFIER NOT NULL,
    StartDate   DATE NULL,
    EndDate     DATE NULL,
    CreatedAt   DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt   DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_Projects_Workspace FOREIGN KEY (WorkspaceId) REFERENCES Workspaces(Id),
    CONSTRAINT FK_Projects_CreatedBy FOREIGN KEY (CreatedById) REFERENCES Users(Id),
    CONSTRAINT UQ_ProjectKey UNIQUE (WorkspaceId, [Key]),
    CONSTRAINT CK_Projects_Type CHECK (Type IN ('SCRUM', 'KANBAN', 'BUSINESS')),
    CONSTRAINT CK_Projects_Status CHECK (Status IN ('ACTIVE', 'ARCHIVED', 'DELETED'))
);
GO

-- =============================================
-- Sprints Table
-- =============================================
CREATE TABLE Sprints (
    Id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    ProjectId   UNIQUEIDENTIFIER NOT NULL,
    Name        NVARCHAR(255) NOT NULL,
    Goal        NVARCHAR(MAX) NULL,
    Status      NVARCHAR(20) NOT NULL DEFAULT 'PLANNED',
    StartDate   DATETIME2 NULL,
    EndDate     DATETIME2 NULL,
    CompletedAt DATETIME2 NULL,
    CreatedAt   DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt   DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_Sprints_Project FOREIGN KEY (ProjectId) REFERENCES Projects(Id),
    CONSTRAINT CK_Sprints_Status CHECK (Status IN ('PLANNED', 'ACTIVE', 'COMPLETED'))
);
GO

-- =============================================
-- Tasks Table (Issues)
-- =============================================
CREATE TABLE Tasks (
    Id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    ProjectId    UNIQUEIDENTIFIER NOT NULL,
    WorkspaceId  UNIQUEIDENTIFIER NOT NULL,
    IssueKey     NVARCHAR(30) NOT NULL,
    Title        NVARCHAR(500) NOT NULL,
    Description  NVARCHAR(MAX) NULL,
    Type         NVARCHAR(20) NOT NULL DEFAULT 'TASK',
    Status       NVARCHAR(100) NOT NULL DEFAULT 'To Do',
    Priority     NVARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    ReporterId   UNIQUEIDENTIFIER NOT NULL,
    SprintId     UNIQUEIDENTIFIER NULL,
    EpicId       UNIQUEIDENTIFIER NULL,
    ParentTaskId UNIQUEIDENTIFIER NULL,
    StoryPoints  FLOAT NULL,
    StartDate    DATE NULL,
    DueDate      DATE NULL,
    Position     FLOAT NOT NULL DEFAULT 0,
    CreatedAt    DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt    DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    ResolvedAt   DATETIME2 NULL,
    DeletedAt    DATETIME2 NULL,
    CONSTRAINT FK_Tasks_Project FOREIGN KEY (ProjectId) REFERENCES Projects(Id),
    CONSTRAINT FK_Tasks_Workspace FOREIGN KEY (WorkspaceId) REFERENCES Workspaces(Id),
    CONSTRAINT FK_Tasks_Reporter FOREIGN KEY (ReporterId) REFERENCES Users(Id),
    CONSTRAINT FK_Tasks_Sprint FOREIGN KEY (SprintId) REFERENCES Sprints(Id),
    CONSTRAINT FK_Tasks_Epic FOREIGN KEY (EpicId) REFERENCES Tasks(Id),
    CONSTRAINT FK_Tasks_Parent FOREIGN KEY (ParentTaskId) REFERENCES Tasks(Id),
    CONSTRAINT UQ_IssueKey UNIQUE (ProjectId, IssueKey),
    CONSTRAINT CK_Tasks_Type CHECK (Type IN ('EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK', 'IMPROVEMENT', 'FEATURE', 'TEST')),
    CONSTRAINT CK_Tasks_Priority CHECK (Priority IN ('HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'))
);
GO

-- =============================================
-- TaskAssignees Table
-- =============================================
CREATE TABLE TaskAssignees (
    TaskId UNIQUEIDENTIFIER NOT NULL,
    UserId UNIQUEIDENTIFIER NOT NULL,
    PRIMARY KEY (TaskId, UserId),
    CONSTRAINT FK_TaskAssignees_Task FOREIGN KEY (TaskId) REFERENCES Tasks(Id) ON DELETE CASCADE,
    CONSTRAINT FK_TaskAssignees_User FOREIGN KEY (UserId) REFERENCES Users(Id)
);
GO

-- =============================================
-- TaskLabels Table
-- =============================================
CREATE TABLE TaskLabels (
    TaskId UNIQUEIDENTIFIER NOT NULL,
    Label  NVARCHAR(100) NOT NULL,
    PRIMARY KEY (TaskId, Label),
    CONSTRAINT FK_TaskLabels_Task FOREIGN KEY (TaskId) REFERENCES Tasks(Id) ON DELETE CASCADE
);
GO

-- =============================================
-- Comments Table
-- =============================================
CREATE TABLE Comments (
    Id              UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    TaskId          UNIQUEIDENTIFIER NOT NULL,
    AuthorId        UNIQUEIDENTIFIER NOT NULL,
    ParentCommentId UNIQUEIDENTIFIER NULL,
    Body            NVARCHAR(MAX) NOT NULL,
    IsInternal      BIT NOT NULL DEFAULT 0,
    IsPinned        BIT NOT NULL DEFAULT 0,
    IsResolved      BIT NOT NULL DEFAULT 0,
    DeletedAt       DATETIME2 NULL,
    EditedAt        DATETIME2 NULL,
    CreatedAt       DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_Comments_Task FOREIGN KEY (TaskId) REFERENCES Tasks(Id),
    CONSTRAINT FK_Comments_Author FOREIGN KEY (AuthorId) REFERENCES Users(Id),
    CONSTRAINT FK_Comments_Parent FOREIGN KEY (ParentCommentId) REFERENCES Comments(Id)
);
GO

-- =============================================
-- CommentReactions Table
-- =============================================
CREATE TABLE CommentReactions (
    Id        UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    CommentId UNIQUEIDENTIFIER NOT NULL,
    UserId    UNIQUEIDENTIFIER NOT NULL,
    Emoji     NVARCHAR(10) NOT NULL,
    CONSTRAINT FK_CommentReactions_Comment FOREIGN KEY (CommentId) REFERENCES Comments(Id) ON DELETE CASCADE,
    CONSTRAINT FK_CommentReactions_User FOREIGN KEY (UserId) REFERENCES Users(Id),
    CONSTRAINT UQ_CommentReaction UNIQUE (CommentId, UserId, Emoji)
);
GO

-- =============================================
-- WorkLogs Table
-- =============================================
CREATE TABLE WorkLogs (
    Id               UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    TaskId           UNIQUEIDENTIFIER NOT NULL,
    UserId           UNIQUEIDENTIFIER NOT NULL,
    TimeSpentSeconds INT NOT NULL,
    StartedAt        DATETIME2 NOT NULL,
    Description      NVARCHAR(500) NULL,
    CreatedAt        DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_WorkLogs_Task FOREIGN KEY (TaskId) REFERENCES Tasks(Id),
    CONSTRAINT FK_WorkLogs_User FOREIGN KEY (UserId) REFERENCES Users(Id)
);
GO

-- =============================================
-- Attachments Table
-- =============================================
CREATE TABLE Attachments (
    Id         UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    TaskId     UNIQUEIDENTIFIER NOT NULL,
    UploaderId UNIQUEIDENTIFIER NOT NULL,
    FileName   NVARCHAR(255) NOT NULL,
    FileSize   BIGINT NOT NULL,
    MimeType   NVARCHAR(100) NOT NULL,
    StorageKey NVARCHAR(500) NOT NULL,
    CreatedAt  DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_Attachments_Task FOREIGN KEY (TaskId) REFERENCES Tasks(Id),
    CONSTRAINT FK_Attachments_Uploader FOREIGN KEY (UploaderId) REFERENCES Users(Id)
);
GO

-- =============================================
-- Notifications Table
-- =============================================
CREATE TABLE Notifications (
    Id        UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    UserId    UNIQUEIDENTIFIER NOT NULL,
    Type      NVARCHAR(50) NOT NULL,
    Payload   NVARCHAR(MAX) NOT NULL,
    IsRead    BIT NOT NULL DEFAULT 0,
    CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_Notifications_User FOREIGN KEY (UserId) REFERENCES Users(Id)
);
GO

-- =============================================
-- Versions Table
-- =============================================
CREATE TABLE Versions (
    Id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    ProjectId   UNIQUEIDENTIFIER NOT NULL,
    Name        NVARCHAR(100) NOT NULL,
    Description NVARCHAR(MAX) NULL,
    Status      NVARCHAR(20) NOT NULL DEFAULT 'UNRELEASED',
    StartDate   DATE NULL,
    ReleaseDate DATE NULL,
    ReleasedAt  DATETIME2 NULL,
    CreatedAt   DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_Versions_Project FOREIGN KEY (ProjectId) REFERENCES Projects(Id),
    CONSTRAINT CK_Versions_Status CHECK (Status IN ('UNRELEASED', 'RELEASED', 'ARCHIVED'))
);
GO

-- =============================================
-- Components Table
-- =============================================
CREATE TABLE Components (
    Id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    ProjectId   UNIQUEIDENTIFIER NOT NULL,
    Name        NVARCHAR(100) NOT NULL,
    Description NVARCHAR(MAX) NULL,
    LeadId      UNIQUEIDENTIFIER NULL,
    CreatedAt   DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_Components_Project FOREIGN KEY (ProjectId) REFERENCES Projects(Id),
    CONSTRAINT FK_Components_Lead FOREIGN KEY (LeadId) REFERENCES Users(Id),
    CONSTRAINT UQ_Components_Name UNIQUE (ProjectId, Name)
);
GO

-- =============================================
-- TaskComponents Table
-- =============================================
CREATE TABLE TaskComponents (
    TaskId      UNIQUEIDENTIFIER NOT NULL,
    ComponentId UNIQUEIDENTIFIER NOT NULL,
    PRIMARY KEY (TaskId, ComponentId),
    CONSTRAINT FK_TaskComponents_Task FOREIGN KEY (TaskId) REFERENCES Tasks(Id) ON DELETE CASCADE,
    CONSTRAINT FK_TaskComponents_Component FOREIGN KEY (ComponentId) REFERENCES Components(Id)
);
GO

-- =============================================
-- TaskVersions Table
-- =============================================
CREATE TABLE TaskVersions (
    TaskId    UNIQUEIDENTIFIER NOT NULL,
    VersionId UNIQUEIDENTIFIER NOT NULL,
    Type      NVARCHAR(20) NOT NULL DEFAULT 'AFFECTS',
    PRIMARY KEY (TaskId, VersionId, Type),
    CONSTRAINT FK_TaskVersions_Task FOREIGN KEY (TaskId) REFERENCES Tasks(Id) ON DELETE CASCADE,
    CONSTRAINT FK_TaskVersions_Version FOREIGN KEY (VersionId) REFERENCES Versions(Id),
    CONSTRAINT CK_TaskVersions_Type CHECK (Type IN ('AFFECTS', 'FIX'))
);
GO

-- =============================================
-- RefreshTokens Table
-- =============================================
CREATE TABLE RefreshTokens (
    Id        UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    UserId    UNIQUEIDENTIFIER NOT NULL,
    Token     NVARCHAR(500) NOT NULL,
    ExpiresAt DATETIME2 NOT NULL,
    IsRevoked BIT NOT NULL DEFAULT 0,
    CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_RefreshTokens_User FOREIGN KEY (UserId) REFERENCES Users(Id),
    CONSTRAINT UQ_RefreshTokens_Token UNIQUE (Token)
);
GO

-- =============================================
-- WorkflowStatuses Table
-- =============================================
CREATE TABLE WorkflowStatuses (
    Id        UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    ProjectId UNIQUEIDENTIFIER NULL,
    Name      NVARCHAR(100) NOT NULL,
    Category  NVARCHAR(20) NOT NULL DEFAULT 'TODO',
    Color     NVARCHAR(7) NOT NULL DEFAULT '#94A3B8',
    Position  INT NOT NULL DEFAULT 0,
    CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_WorkflowStatuses_Project FOREIGN KEY (ProjectId) REFERENCES Projects(Id),
    CONSTRAINT CK_WorkflowStatuses_Category CHECK (Category IN ('TODO', 'IN_PROGRESS', 'DONE'))
);
GO

-- Insert default workflow statuses
INSERT INTO WorkflowStatuses (Id, ProjectId, Name, Category, Color, Position)
VALUES 
    (NEWID(), NULL, 'To Do', 'TODO', '#94A3B8', 1),
    (NEWID(), NULL, 'In Progress', 'IN_PROGRESS', '#3B82F6', 2),
    (NEWID(), NULL, 'Done', 'DONE', '#10B981', 3);
GO

-- =============================================
-- AuditLog Table
-- =============================================
CREATE TABLE AuditLog (
    Id         UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    UserId     UNIQUEIDENTIFIER NOT NULL,
    EntityType NVARCHAR(50) NOT NULL,
    EntityId   UNIQUEIDENTIFIER NOT NULL,
    Action     NVARCHAR(50) NOT NULL,
    OldValues  NVARCHAR(MAX) NULL,
    NewValues  NVARCHAR(MAX) NULL,
    CreatedAt  DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_AuditLog_User FOREIGN KEY (UserId) REFERENCES Users(Id)
);
GO

-- Insert migration record
INSERT INTO MigrationHistory (MigrationName) VALUES ('0001_create_core_tables.sql');
GO

PRINT 'Core tables created successfully';
GO