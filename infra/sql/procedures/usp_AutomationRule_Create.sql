-- usp_AutomationRule_Create
CREATE OR ALTER PROCEDURE dbo.usp_AutomationRule_Create
  @ProjectId       UNIQUEIDENTIFIER,
  @Name            NVARCHAR(255),
  @TriggerConfig   NVARCHAR(MAX),
  @ConditionConfig NVARCHAR(MAX),
  @ActionConfig    NVARCHAR(MAX)
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @Id UNIQUEIDENTIFIER = NEWID();

  INSERT INTO dbo.AutomationRules
    (Id, ProjectId, Name, TriggerConfig, ConditionConfig, ActionConfig)
  VALUES
    (@Id, @ProjectId, @Name, @TriggerConfig, @ConditionConfig, @ActionConfig);

  SELECT * FROM dbo.AutomationRules WHERE Id = @Id;
END;
GO
