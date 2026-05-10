-- Roadmap: Task Dependencies
-- Week 12 migration

IF NOT EXISTS (
    SELECT 1 FROM sys.tables WHERE name = 'TaskDependencies'
)
BEGIN
    CREATE TABLE TaskDependencies (
        Id        UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
        TaskId    UNIQUEIDENTIFIER NOT NULL REFERENCES Tasks(Id),
        DependsOn UNIQUEIDENTIFIER NOT NULL REFERENCES Tasks(Id),
        Type      NVARCHAR(20)     NOT NULL DEFAULT 'BLOCKS',
        CreatedAt DATETIME2        NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT UQ_TaskDependency UNIQUE (TaskId, DependsOn)
    );

    CREATE INDEX IX_TaskDep_TaskId    ON TaskDependencies (TaskId);
    CREATE INDEX IX_TaskDep_DependsOn ON TaskDependencies (DependsOn);
END;
