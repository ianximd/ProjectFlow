CREATE OR ALTER PROCEDURE dbo.usp_Timesheet_Submit
  @Id     UNIQUEIDENTIFIER,
  @UserId UNIQUEIDENTIFIER,
  @Note   NVARCHAR(500) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @Status NVARCHAR(12);
    SELECT @Status = Status FROM dbo.Timesheets WITH (UPDLOCK, ROWLOCK) WHERE Id = @Id;

    IF @Status IS NULL
    BEGIN
      ROLLBACK TRANSACTION;
      ;THROW 51812, 'Timesheet not found', 1;
    END
    IF @Status NOT IN ('draft','rejected')
    BEGIN
      ROLLBACK TRANSACTION;
      ;THROW 51810, 'Only a draft or rejected timesheet can be submitted', 1;
    END

    UPDATE dbo.Timesheets
    SET Status      = 'submitted',
        SubmittedAt = SYSUTCDATETIME(),
        ReviewedById = NULL,
        ReviewedAt   = NULL,
        Note        = COALESCE(@Note, Note),
        UpdatedAt   = SYSUTCDATETIME()
    WHERE Id = @Id;

    COMMIT TRANSACTION;

    SELECT Id, WorkspaceId, UserId, PeriodStart, PeriodEnd, Status,
           SubmittedAt, ReviewedById, ReviewedAt, Note, CreatedAt, UpdatedAt
    FROM dbo.Timesheets WHERE Id = @Id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH
END;
GO
