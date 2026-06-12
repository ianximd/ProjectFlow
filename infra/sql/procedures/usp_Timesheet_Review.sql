CREATE OR ALTER PROCEDURE dbo.usp_Timesheet_Review
  @Id           UNIQUEIDENTIFIER,
  @ReviewerId   UNIQUEIDENTIFIER,
  @Decision     NVARCHAR(12),    -- 'approved' | 'rejected'
  @Note         NVARCHAR(500) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  BEGIN TRY
    IF @Decision NOT IN ('approved','rejected')
    BEGIN
      ;THROW 51813, 'Decision must be approved or rejected', 1;
    END

    BEGIN TRANSACTION;

    DECLARE @Status NVARCHAR(12);
    SELECT @Status = Status FROM dbo.Timesheets WITH (UPDLOCK, ROWLOCK) WHERE Id = @Id;

    IF @Status IS NULL
    BEGIN
      ROLLBACK TRANSACTION;
      ;THROW 51812, 'Timesheet not found', 1;
    END
    IF @Status <> 'submitted'
    BEGIN
      ROLLBACK TRANSACTION;
      ;THROW 51811, 'Only a submitted timesheet can be reviewed', 1;
    END

    UPDATE dbo.Timesheets
    SET Status       = @Decision,
        ReviewedById = @ReviewerId,
        ReviewedAt   = SYSUTCDATETIME(),
        Note         = COALESCE(@Note, Note),
        UpdatedAt    = SYSUTCDATETIME()
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
