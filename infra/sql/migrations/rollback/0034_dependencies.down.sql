-- Rollback 0034: dependencies (data direction/type conversion is NOT reversed — destructive)
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_TaskDep_Workspace' AND object_id = OBJECT_ID('dbo.TaskDependencies'))
    DROP INDEX IX_TaskDep_Workspace ON dbo.TaskDependencies;
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TaskDependencies_Type')
    ALTER TABLE dbo.TaskDependencies DROP CONSTRAINT CK_TaskDependencies_Type;
GO
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_TaskDependencies_Type')
    ALTER TABLE dbo.TaskDependencies DROP CONSTRAINT DF_TaskDependencies_Type;
GO
IF COL_LENGTH('dbo.TaskDependencies','WorkspaceId') IS NOT NULL
    ALTER TABLE dbo.TaskDependencies DROP COLUMN WorkspaceId;
GO
