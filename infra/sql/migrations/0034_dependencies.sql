-- Migration 0034: Phase 5a dependencies
-- Repurpose legacy TaskDependencies (0007) to canonical (TaskId waits_on DependsOn).
-- DependsOn must complete before TaskId. Narrow Type to 'waiting_on'; add WorkspaceId + index.

IF COL_LENGTH('dbo.TaskDependencies','WorkspaceId') IS NULL
    ALTER TABLE dbo.TaskDependencies ADD WorkspaceId UNIQUEIDENTIFIER NULL;
GO

UPDATE d SET d.WorkspaceId = t.WorkspaceId
  FROM dbo.TaskDependencies d JOIN dbo.Tasks t ON t.Id = d.TaskId
 WHERE d.WorkspaceId IS NULL;
GO

-- legacy BLOCKS: "TaskId blocks DependsOn" = "DependsOn waits_on TaskId" => swap direction
UPDATE d SET TaskId = d.DependsOn, DependsOn = d.TaskId
  FROM dbo.TaskDependencies d WHERE d.Type = 'BLOCKS';
GO
-- relationship-kinds move to slice 5b; drop them here
DELETE FROM dbo.TaskDependencies WHERE Type IN ('RELATES_TO','DUPLICATES');
GO
UPDATE dbo.TaskDependencies SET Type = 'waiting_on';
GO

-- replace any existing default on Type with the canonical one
DECLARE @df sysname = (
  SELECT dc.name FROM sys.default_constraints dc
   JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID('dbo.TaskDependencies') AND c.name = 'Type');
IF @df IS NOT NULL EXEC('ALTER TABLE dbo.TaskDependencies DROP CONSTRAINT ' + @df);
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TaskDependencies_Type')
    ALTER TABLE dbo.TaskDependencies DROP CONSTRAINT CK_TaskDependencies_Type;
GO
ALTER TABLE dbo.TaskDependencies ADD CONSTRAINT DF_TaskDependencies_Type DEFAULT 'waiting_on' FOR Type;
GO
ALTER TABLE dbo.TaskDependencies WITH CHECK ADD CONSTRAINT CK_TaskDependencies_Type CHECK (Type = 'waiting_on');
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_TaskDep_Workspace' AND object_id = OBJECT_ID('dbo.TaskDependencies'))
    CREATE INDEX IX_TaskDep_Workspace ON dbo.TaskDependencies (WorkspaceId);
GO
