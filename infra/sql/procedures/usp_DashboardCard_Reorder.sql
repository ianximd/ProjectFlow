CREATE OR ALTER PROCEDURE dbo.usp_DashboardCard_Reorder
  @DashboardId UNIQUEIDENTIFIER,
  @Cards       NVARCHAR(MAX)
AS
BEGIN
  SET NOCOUNT ON;
  BEGIN TRY
    BEGIN TRANSACTION;

    UPDATE c SET
      c.Layout    = j.Layout,
      c.Position  = j.Position,
      c.UpdatedAt = SYSUTCDATETIME()
    FROM dbo.DashboardCards c
    JOIN OPENJSON(@Cards) WITH (
      Id       UNIQUEIDENTIFIER '$.id',
      Layout   NVARCHAR(MAX)    '$.layout' AS JSON,
      Position FLOAT            '$.position'
    ) j ON j.Id = c.Id
    WHERE c.DashboardId = @DashboardId;

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;

  SELECT * FROM dbo.DashboardCards WHERE DashboardId = @DashboardId ORDER BY Position ASC, CreatedAt ASC;
END;
GO
