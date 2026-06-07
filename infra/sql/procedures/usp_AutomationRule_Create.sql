-- usp_AutomationRule_Create
CREATE OR ALTER PROCEDURE dbo.usp_AutomationRule_Create
  @ProjectId       UNIQUEIDENTIFIER = NULL,
  @WorkspaceId     UNIQUEIDENTIFIER,
  @ScopeType       NVARCHAR(12)     = 'PROJECT',
  @Name            NVARCHAR(255),
  @TriggerConfig   NVARCHAR(MAX),
  @ConditionConfig NVARCHAR(MAX),
  @ActionConfig    NVARCHAR(MAX)
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @Id UNIQUEIDENTIFIER = NEWID();
  DECLARE @ScopeId UNIQUEIDENTIFIER =
    CASE WHEN @ScopeType = 'WORKSPACE' THEN @WorkspaceId ELSE @ProjectId END;

  INSERT INTO dbo.AutomationRules
    (Id, ProjectId, WorkspaceId, ScopeType, ScopeId, Name, TriggerConfig, ConditionConfig, ActionConfig)
  VALUES
    (@Id, @ProjectId, @WorkspaceId, @ScopeType, @ScopeId, @Name, @TriggerConfig, @ConditionConfig, @ActionConfig);

  SELECT * FROM dbo.AutomationRules WHERE Id = @Id;
END;
GO
