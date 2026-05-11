-- Permanently delete a user. Refuses if any "load-bearing" reference exists
-- (workspace ownership, reported tasks, comments, attachments, work logs,
-- project ownership, component lead). The admin must clean those up first.
--
-- Trivial join-table rows that are safely orphaned by removing the user
-- (TaskAssignees, Notifications, Sessions, PasswordResetTokens, UserRoles)
-- are wiped inside the same transaction. UserMfaRecoveryCodes already
-- cascades via ON DELETE CASCADE on the FK declaration.
--
-- Throws 51040 with a CSV of blocker names so the API can surface a
-- friendly explanation in the UI ("Cannot delete: owns 2 workspaces, …").
CREATE OR ALTER PROCEDURE dbo.usp_Admin_User_HardDelete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE Id = @Id)
        THROW 50004, 'User not found.', 1;

    -- ── Build a CSV of blockers so a single message can list everything
    --    that's holding the row down. Avoids the admin playing whack-a-mole
    --    against five separate FK errors.
    DECLARE @Blockers NVARCHAR(MAX) = N'';

    DECLARE @WsOwned     INT = (SELECT COUNT(*) FROM dbo.Workspaces       WHERE OwnerId    = @Id);
    DECLARE @TasksRep    INT = (SELECT COUNT(*) FROM dbo.Tasks            WHERE ReporterId = @Id);
    DECLARE @ProjCreated INT = (SELECT COUNT(*) FROM dbo.Projects         WHERE CreatedById = @Id);
    DECLARE @Comments    INT = (SELECT COUNT(*) FROM dbo.Comments         WHERE AuthorId   = @Id);
    DECLARE @Attachments INT = (SELECT COUNT(*) FROM dbo.Attachments      WHERE UploadedById = @Id);
    DECLARE @WorkLogs    INT = (SELECT COUNT(*) FROM dbo.WorkLogs         WHERE UserId     = @Id);
    DECLARE @CompLead    INT = (SELECT COUNT(*) FROM dbo.Components       WHERE LeadUserId = @Id);
    DECLARE @WsMembers   INT = (SELECT COUNT(*) FROM dbo.WorkspaceMembers WHERE UserId     = @Id);

    IF @WsOwned     > 0 SET @Blockers += FORMATMESSAGE('owns %d workspace(s); ',    @WsOwned);
    IF @WsMembers   > 0 SET @Blockers += FORMATMESSAGE('member of %d workspace(s); ', @WsMembers);
    IF @TasksRep    > 0 SET @Blockers += FORMATMESSAGE('reporter on %d task(s); ',  @TasksRep);
    IF @ProjCreated > 0 SET @Blockers += FORMATMESSAGE('created %d project(s); ',   @ProjCreated);
    IF @Comments    > 0 SET @Blockers += FORMATMESSAGE('authored %d comment(s); ',  @Comments);
    IF @Attachments > 0 SET @Blockers += FORMATMESSAGE('uploaded %d attachment(s); ', @Attachments);
    IF @WorkLogs    > 0 SET @Blockers += FORMATMESSAGE('logged %d work entry(ies); ', @WorkLogs);
    IF @CompLead    > 0 SET @Blockers += FORMATMESSAGE('leads %d component(s); ',   @CompLead);

    IF LEN(@Blockers) > 0
    BEGIN
        DECLARE @Msg NVARCHAR(2048) = N'Cannot delete user: ' + LEFT(@Blockers, LEN(@Blockers) - 2) + N'.';
        THROW 51040, @Msg, 1;
    END

    BEGIN TRANSACTION;
    BEGIN TRY
        DELETE FROM dbo.TaskAssignees        WHERE UserId = @Id;
        DELETE FROM dbo.Notifications        WHERE UserId = @Id;
        DELETE FROM dbo.RefreshTokens        WHERE UserId = @Id;
        DELETE FROM dbo.PasswordResetTokens  WHERE UserId = @Id;
        DELETE FROM dbo.UserRoles            WHERE UserId = @Id OR AssignedBy = @Id;

        DELETE FROM dbo.Users WHERE Id = @Id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
