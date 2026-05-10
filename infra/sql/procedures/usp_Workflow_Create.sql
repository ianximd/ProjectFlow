-- Creates a workflow for a project with default statuses and transitions.
-- @Template: 'DEFAULT' | 'BUG' | 'AGILE'
CREATE OR ALTER PROCEDURE usp_Workflow_Create
    @ProjectId UNIQUEIDENTIFIER,
    @Name      NVARCHAR(100),
    @Template  NVARCHAR(20)  = 'DEFAULT'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @WfId UNIQUEIDENTIFIER = NEWID();

        INSERT INTO Workflows (Id, ProjectId, Name, IsDefault)
        VALUES (@WfId, @ProjectId, @Name, 1);

        -- Seed statuses and transitions based on template
        IF @Template = 'DEFAULT'
        BEGIN
            INSERT INTO WorkflowStatuses (Id, WorkflowId, Name, Category, Color, Position) VALUES
                (NEWID(), @WfId, 'To Do',       'TODO',        '#6b7280', 0),
                (NEWID(), @WfId, 'In Progress',  'IN_PROGRESS', '#2563eb', 1),
                (NEWID(), @WfId, 'Done',         'DONE',        '#16a34a', 2);

            INSERT INTO WorkflowTransitions (Id, WorkflowId, FromStatus, ToStatus, Name) VALUES
                (NEWID(), @WfId, 'To Do',      'In Progress', 'Start'),
                (NEWID(), @WfId, 'In Progress','Done',        'Complete'),
                (NEWID(), @WfId, 'In Progress','To Do',       'Reopen'),
                (NEWID(), @WfId, 'Done',       'In Progress', 'Reopen');
        END
        ELSE IF @Template = 'BUG'
        BEGIN
            INSERT INTO WorkflowStatuses (Id, WorkflowId, Name, Category, Color, Position) VALUES
                (NEWID(), @WfId, 'Open',        'TODO',        '#ef4444', 0),
                (NEWID(), @WfId, 'In Progress', 'IN_PROGRESS', '#f59e0b', 1),
                (NEWID(), @WfId, 'In Review',   'IN_PROGRESS', '#8b5cf6', 2),
                (NEWID(), @WfId, 'Done',        'DONE',        '#16a34a', 3),
                (NEWID(), @WfId, 'Won''t Fix',  'DONE',        '#6b7280', 4);

            INSERT INTO WorkflowTransitions (Id, WorkflowId, FromStatus, ToStatus, Name) VALUES
                (NEWID(), @WfId, 'Open',        'In Progress', 'Start'),
                (NEWID(), @WfId, 'In Progress', 'In Review',   'Submit for Review'),
                (NEWID(), @WfId, 'In Review',   'Done',        'Resolve'),
                (NEWID(), @WfId, 'In Review',   'In Progress', 'Send Back'),
                (NEWID(), @WfId, 'Open',        'Won''t Fix',  'Won''t Fix'),
                (NEWID(), @WfId, 'Done',        'Open',        'Reopen');
        END
        ELSE IF @Template = 'AGILE'
        BEGIN
            INSERT INTO WorkflowStatuses (Id, WorkflowId, Name, Category, Color, Position) VALUES
                (NEWID(), @WfId, 'To Do',       'TODO',        '#6b7280', 0),
                (NEWID(), @WfId, 'In Progress', 'IN_PROGRESS', '#2563eb', 1),
                (NEWID(), @WfId, 'In Review',   'IN_PROGRESS', '#8b5cf6', 2),
                (NEWID(), @WfId, 'Testing',     'IN_PROGRESS', '#f59e0b', 3),
                (NEWID(), @WfId, 'Done',        'DONE',        '#16a34a', 4);

            INSERT INTO WorkflowTransitions (Id, WorkflowId, FromStatus, ToStatus, Name) VALUES
                (NEWID(), @WfId, 'To Do',       'In Progress', 'Start'),
                (NEWID(), @WfId, 'In Progress', 'In Review',   'Submit for Review'),
                (NEWID(), @WfId, 'In Review',   'Testing',     'Approve for Testing'),
                (NEWID(), @WfId, 'In Review',   'In Progress', 'Request Changes'),
                (NEWID(), @WfId, 'Testing',     'Done',        'Pass'),
                (NEWID(), @WfId, 'Testing',     'In Progress', 'Fail'),
                (NEWID(), @WfId, 'Done',        'To Do',       'Reopen');
        END;

        -- Set as active workflow on the project
        UPDATE Projects SET WorkflowId = @WfId, UpdatedAt = GETUTCDATE()
        WHERE Id = @ProjectId;

        -- Return workflow + statuses + transitions
        SELECT * FROM Workflows WHERE Id = @WfId;
        SELECT * FROM WorkflowStatuses WHERE WorkflowId = @WfId ORDER BY Position;
        SELECT * FROM WorkflowTransitions WHERE WorkflowId = @WfId;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
