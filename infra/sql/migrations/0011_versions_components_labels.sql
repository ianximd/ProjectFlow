-- 0011_versions_components_labels.sql
-- Creates: Versions (already defined in schema), ProjectComponents, Labels tables

-- Versions table (may already exist from schema; idempotent guard)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Versions')
BEGIN
  CREATE TABLE dbo.Versions (
    Id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Versions PRIMARY KEY DEFAULT NEWID(),
    ProjectId   UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_Versions_Project REFERENCES dbo.Projects(Id) ON DELETE CASCADE,
    Name        NVARCHAR(100)    NOT NULL,
    Description NVARCHAR(MAX)    NULL,
    Status      NVARCHAR(20)     NOT NULL CONSTRAINT DF_Versions_Status DEFAULT 'UNRELEASED',
    StartDate   DATE             NULL,
    ReleaseDate DATE             NULL,
    ReleasedAt  DATETIME2        NULL,
    CreatedAt   DATETIME2        NOT NULL CONSTRAINT DF_Versions_CreatedAt DEFAULT GETUTCDATE()
  );
  CREATE NONCLUSTERED INDEX IX_Version_Project ON dbo.Versions (ProjectId);
END
GO

-- TaskVersions junction
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskVersions')
BEGIN
  CREATE TABLE dbo.TaskVersions (
    TaskId    UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_TaskVersions_Task    REFERENCES dbo.Tasks(Id)    ON DELETE CASCADE,
    VersionId UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_TaskVersions_Version REFERENCES dbo.Versions(Id) ON DELETE NO ACTION,
    CONSTRAINT PK_TaskVersions PRIMARY KEY (TaskId, VersionId)
  );
END
GO

-- ProjectComponents (sub-sections of a project)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ProjectComponents')
BEGIN
  CREATE TABLE dbo.ProjectComponents (
    Id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_ProjectComponents PRIMARY KEY DEFAULT NEWID(),
    ProjectId   UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_Components_Project REFERENCES dbo.Projects(Id) ON DELETE CASCADE,
    Name        NVARCHAR(100)    NOT NULL,
    Description NVARCHAR(500)    NULL,
    LeadUserId  UNIQUEIDENTIFIER NULL CONSTRAINT FK_Components_Lead REFERENCES dbo.Users(Id),
    CreatedAt   DATETIME2        NOT NULL CONSTRAINT DF_Components_CreatedAt DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_Component_ProjectName UNIQUE (ProjectId, Name)
  );
  CREATE NONCLUSTERED INDEX IX_Component_Project ON dbo.ProjectComponents (ProjectId);
END
GO

-- TaskComponents junction
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskComponents')
BEGIN
  CREATE TABLE dbo.TaskComponents (
    TaskId      UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_TaskComponents_Task      REFERENCES dbo.Tasks(Id)             ON DELETE CASCADE,
    ComponentId UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_TaskComponents_Component REFERENCES dbo.ProjectComponents(Id) ON DELETE NO ACTION,
    CONSTRAINT PK_TaskComponents PRIMARY KEY (TaskId, ComponentId)
  );
END
GO

-- Labels (project-scoped, with color)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Labels')
BEGIN
  CREATE TABLE dbo.Labels (
    Id        UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Labels PRIMARY KEY DEFAULT NEWID(),
    ProjectId UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_Labels_Project REFERENCES dbo.Projects(Id) ON DELETE CASCADE,
    Name      NVARCHAR(100)    NOT NULL,
    Color     NVARCHAR(7)      NOT NULL CONSTRAINT DF_Labels_Color DEFAULT '#6c63ff',
    CreatedAt DATETIME2        NOT NULL CONSTRAINT DF_Labels_CreatedAt DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_Label_ProjectName UNIQUE (ProjectId, Name)
  );
  CREATE NONCLUSTERED INDEX IX_Label_Project ON dbo.Labels (ProjectId);
END
GO

-- TaskLabelsV2 junction (links tasks to structured Labels records)
-- Note: TaskLabels already exists as a string-based junction.
-- We add TaskLabelLinks for the structured label FK approach.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskLabelLinks')
BEGIN
  CREATE TABLE dbo.TaskLabelLinks (
    TaskId  UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_TaskLabelLinks_Task  REFERENCES dbo.Tasks(Id)  ON DELETE CASCADE,
    LabelId UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_TaskLabelLinks_Label REFERENCES dbo.Labels(Id) ON DELETE NO ACTION,
    CONSTRAINT PK_TaskLabelLinks PRIMARY KEY (TaskId, LabelId)
  );
END
GO
