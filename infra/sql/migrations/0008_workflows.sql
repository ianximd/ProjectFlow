-- Custom Workflows migration (Week 13)

-- Workflow definitions (one per project, or shared templates)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Workflows')
BEGIN
    CREATE TABLE Workflows (
        Id          UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
        ProjectId   UNIQUEIDENTIFIER NOT NULL REFERENCES Projects(Id),
        Name        NVARCHAR(100) NOT NULL,
        IsDefault   BIT          NOT NULL DEFAULT 0,
        CreatedAt   DATETIME2    NOT NULL DEFAULT GETUTCDATE(),
        UpdatedAt   DATETIME2    NOT NULL DEFAULT GETUTCDATE()
    );

    CREATE INDEX IX_Workflow_Project ON Workflows (ProjectId);
END;

-- Statuses belonging to a workflow
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WorkflowStatuses')
BEGIN
    CREATE TABLE WorkflowStatuses (
        Id         UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
        WorkflowId UNIQUEIDENTIFIER NOT NULL REFERENCES Workflows(Id) ON DELETE CASCADE,
        Name       NVARCHAR(100)    NOT NULL,
        Category   NVARCHAR(20)     NOT NULL DEFAULT 'TODO',
                       -- TODO | IN_PROGRESS | DONE
        Color      NVARCHAR(20)     NOT NULL DEFAULT '#6b7280',
        Position   INT              NOT NULL DEFAULT 0,
        CreatedAt  DATETIME2        NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT UQ_WorkflowStatus UNIQUE (WorkflowId, Name)
    );
END;

-- Allowed transitions between named statuses within a workflow
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WorkflowTransitions')
BEGIN
    CREATE TABLE WorkflowTransitions (
        Id         UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
        WorkflowId UNIQUEIDENTIFIER NOT NULL REFERENCES Workflows(Id) ON DELETE CASCADE,
        FromStatus NVARCHAR(100)    NOT NULL,
        ToStatus   NVARCHAR(100)    NOT NULL,
        Name       NVARCHAR(100)    NULL,
        CreatedAt  DATETIME2        NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT UQ_WorkflowTransition UNIQUE (WorkflowId, FromStatus, ToStatus)
    );

    CREATE INDEX IX_WfTransition_Wf ON WorkflowTransitions (WorkflowId, FromStatus);
END;

-- Link projects to their active workflow
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('Projects') AND name = 'WorkflowId'
)
BEGIN
    ALTER TABLE Projects
    ADD WorkflowId UNIQUEIDENTIFIER NULL REFERENCES Workflows(Id);
END;
