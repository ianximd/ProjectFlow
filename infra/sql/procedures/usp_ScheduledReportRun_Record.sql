-- Idempotent run record. The first call for a (ScheduledReportId, PeriodKey)
-- INSERTs and returns Inserted=1. Any later call for the SAME period (a worker
-- restart re-attempting the occurrence) is a NO-OP: it returns Inserted=0 + the
-- EXISTING run row, so the caller skips delivery → a report is never double-sent.
-- The IF NOT EXISTS pre-check (UPDLOCK,HOLDLOCK) + the UNIQUE constraint together
-- make this safe even under a concurrent double-sweep (the loser's INSERT hits the
-- constraint 2627/2601, caught and folded into the Inserted=0 path).
CREATE OR ALTER PROCEDURE dbo.usp_ScheduledReportRun_Record
  @ScheduledReportId UNIQUEIDENTIFIER,
  @PeriodKey         NVARCHAR(40),
  @Status            NVARCHAR(12)  = 'delivered',
  @SnapshotRef       NVARCHAR(MAX) = NULL,
  @Error             NVARCHAR(MAX) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @Inserted BIT = 0;
  DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

  BEGIN TRY
    BEGIN TRANSACTION;

    IF NOT EXISTS (
      SELECT 1 FROM dbo.ScheduledReportRuns WITH (UPDLOCK, HOLDLOCK)
      WHERE ScheduledReportId = @ScheduledReportId AND PeriodKey = @PeriodKey
    )
    BEGIN
      INSERT INTO dbo.ScheduledReportRuns (Id, ScheduledReportId, PeriodKey, Status, SnapshotRef, Error)
      VALUES (@NewId, @ScheduledReportId, @PeriodKey, @Status, @SnapshotRef, @Error);
      SET @Inserted = 1;
    END

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    -- A concurrent INSERT won the race (unique-violation 2627/2601) → treat as a
    -- no-op duplicate, not an error.
    IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
    SET @Inserted = 0;
  END CATCH;

  SELECT @Inserted AS Inserted;
  SELECT * FROM dbo.ScheduledReportRuns
    WHERE ScheduledReportId = @ScheduledReportId AND PeriodKey = @PeriodKey;
END;
GO
