-- BEGIN COMPLETED VIEWER ACCESS GUARD
-- This profile may only read completed dispatches, even through a direct API request.
SELECT 'redirect' AS component, '/dispatch_link/public/completed.html' AS link
WHERE EXISTS (
    SELECT 1 FROM Jobcard.dbo.Current_session restricted_session
    JOIN Jobcard.dbo.User_info restricted_user ON restricted_user.Username = restricted_session.Username
    WHERE restricted_user.Usertype = 15
      AND restricted_session.session_id IN (sqlpage.cookie('session'), sqlpage.cookie('session_admin'),
          sqlpage.cookie('session_tech'), sqlpage.cookie('session_inspect'),
          sqlpage.cookie('session_reload'), sqlpage.cookie('session_checklist'))
);
-- END COMPLETED VIEWER ACCESS GUARD

-- SQLPage JSON endpoint: submit a stood-down dispatch for manager closure approval.

DECLARE @id INT = TRY_CAST(:incidentId AS INT);
DECLARE @closingComments NVARCHAR(MAX) = NULLIF(LTRIM(RTRIM(:closingComments)), '');
DECLARE @username NVARCHAR(128) = (
    SELECT TOP (1) NULLIF(LTRIM(RTRIM(CAST(Username AS NVARCHAR(128)))), '')
    FROM Current_session
    WHERE session_id = sqlpage.cookie('session')
);
DECLARE @status NVARCHAR(50) = 'ok';
DECLARE @requestSequence INT;
DECLARE @oldApprovalStatus NVARCHAR(30);
DECLARE @message NVARCHAR(MAX);

IF @username IS NULL
    SET @status = 'unauthorized';
IF @status = 'ok' AND NOT EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents
    WHERE id = @id AND ISNULL(isdeleted, 0) = 0
)
    SET @status = 'not_found';
IF @status = 'ok' AND @closingComments IS NULL
    SET @status = 'missing_closing_comments';
IF @status = 'ok' AND EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents
    WHERE id = @id AND DispatchStatus IN ('Closed', 'Cancelled')
)
    SET @status = 'locked_status';
IF @status = 'ok' AND EXISTS (
    SELECT 1 FROM CC.dbo.DispatchClosureReviews
    WHERE dispatch_id = @id AND ReviewStatus = 'Pending'
)
    SET @status = 'closure_already_pending';
IF @status = 'ok' AND NOT EXISTS (
    SELECT 1 FROM CC.dbo.DispatchAssignments
    WHERE dispatch_id = @id AND DispatchedAt IS NOT NULL
)
    SET @status = 'dispatch_assignment_required';
IF @status = 'ok' AND EXISTS (
    SELECT 1 FROM CC.dbo.DispatchAssignments
    WHERE dispatch_id = @id AND DispatchedAt IS NOT NULL AND StoodDownAt IS NULL
)
    SET @status = 'ground_team_not_stood_down';
IF @status = 'ok' AND EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents
    WHERE id = @id AND (
        DispatchStatus <> 'Stood Down'
        OR NULLIF(LTRIM(RTRIM(SummaryOfIncident)), '') IS NULL
        OR VehicleRecovered IS NULL
        OR LoadRecovered IS NULL
        OR TrailersRecovered IS NULL
        OR DriverOnScene IS NULL
        OR TrackingUnitStatus IS NULL
    )
)
    SET @status = 'closure_requirements_missing';

IF @status = 'ok'
BEGIN
    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @oldApprovalStatus = ClosureApprovalStatus
        FROM CC.dbo.DispatchIncidents WITH (UPDLOCK, HOLDLOCK)
        WHERE id = @id;

        SELECT @requestSequence = ISNULL(MAX(RequestSequence), 0) + 1
        FROM CC.dbo.DispatchClosureReviews WITH (UPDLOCK, HOLDLOCK)
        WHERE dispatch_id = @id;

    INSERT INTO CC.dbo.DispatchClosureReviews
        (dispatch_id, RequestSequence, ReviewStatus, ClosingComments, RequestedBy, RequestedAt)
    VALUES
        (@id, @requestSequence, 'Pending', @closingComments, @username, SYSDATETIME());

    UPDATE CC.dbo.DispatchIncidents
    SET ClosureApprovalStatus = 'Pending',
        UpdatedBy = @username,
        UpdatedAt = SYSDATETIME()
    WHERE id = @id;

    INSERT INTO CC.dbo.DispatchAuditLog
        (dispatch_id, AuditAction, OldStatus, NewStatus, AuditMessage, AuditUsername, CreatedAt)
    VALUES
        (@id, 'Closure requested', @oldApprovalStatus, 'Pending',
         'Dispatch submitted for manager closure approval.', @username, SYSDATETIME());

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @status = 'db_error';
        SET @message = ERROR_MESSAGE();
    END CATCH;
END;

SELECT
    @status AS status,
    @id AS id,
    @requestSequence AS requestSequence,
    @message AS message,
    (SELECT TOP (1) id FROM CC.dbo.DispatchClosureReviews
     WHERE dispatch_id = @id AND RequestSequence = @requestSequence) AS closureReviewId,
    (SELECT TOP (1) DispatchStatus FROM CC.dbo.DispatchIncidents WHERE id = @id) AS dispatchStatus,
    (SELECT TOP (1) ClosureApprovalStatus FROM CC.dbo.DispatchIncidents WHERE id = @id) AS closureApprovalStatus
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
