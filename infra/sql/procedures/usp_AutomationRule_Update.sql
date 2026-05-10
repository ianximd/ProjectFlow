-- usp_AutomationRule_Update
CREATE OR ALTER PROCEDURE dbo.usp_AutomationRule_Update
  @Id              UNIQUEIDENTIFIER,
  @Name            NVARCHAR(255)  = NULL,
  @IsEnabled       BIT            = NULL,
  @TriggerConfig   NVARCHAR(MAX)  = NULL,
  @ConditionConfig NVARCHAR(MAX)  = NULL,
  @ActionConfig    NVARCHAR(MAX)  = NULL
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.AutomationRules SET
    Name            = ISNULL(@Name,            Name),
    IsEnabled       = ISNULL(@IsEnabled,       IsEnabled),
    TriggerConfig   = ISNULL(@TriggerConfig,   TriggerConfig),
    ConditionConfig = ISNULL(@ConditionConfig, ConditionConfig),
    ActionConfig    = ISNULL(@ActionConfig,    ActionConfig),
    UpdatedAt       = GETUTCDATE()
  WHERE Id = @Id;

  SELECT * FROM dbo.AutomationRules WHERE Id = @Id;
END;
GO
