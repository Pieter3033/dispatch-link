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

-- SQLPage JSON endpoint: manager approval or rejection of a pending closure request.

DECLARE @reviewId INT = TRY_CAST(:closureReviewId AS INT);
DECLARE @decision NVARCHAR(20) = NULLIF(LTRIM(RTRIM(:decision)), '');
DECLARE @managerComments NVARCHAR(MAX) = NULLIF(LTRIM(RTRIM(:managerComments)), '');
DECLARE @rejectionReason NVARCHAR(MAX) = NULLIF(LTRIM(RTRIM(:rejectionReason)), '');
DECLARE @username NVARCHAR(128) = (
    SELECT TOP (1) NULLIF(LTRIM(RTRIM(CAST(Username AS NVARCHAR(128)))), '')
    FROM Current_session
    WHERE session_id = sqlpage.cookie('session')
);
DECLARE @status NVARCHAR(50) = 'ok';
DECLARE @message NVARCHAR(MAX);
DECLARE @id INT = (
    SELECT TOP (1) dispatch_id
    FROM CC.dbo.DispatchClosureReviews
    WHERE id = @reviewId AND ReviewStatus = 'Pending'
);

IF @username IS NULL
    SET @status = 'unauthorized';
IF @status = 'ok' AND @username NOT IN ('Approver1', 'Approver2', 'Approver3')
    SET @status = 'forbidden';
IF @status = 'ok' AND @decision NOT IN ('Approved', 'Rejected')
    SET @status = 'invalid_decision';
IF @status = 'ok' AND @id IS NULL
    SET @status = 'pending_review_not_found';
IF @status = 'ok' AND @decision = 'Rejected' AND @rejectionReason IS NULL
    SET @status = 'missing_rejection_reason';
IF @status = 'ok' AND EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents
    WHERE id = @id AND (ISNULL(isdeleted, 0) = 1 OR DispatchStatus = 'Cancelled')
)
    SET @status = 'locked_status';

IF @status = 'ok'
BEGIN
    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE CC.dbo.DispatchClosureReviews WITH (UPDLOCK)
        SET ReviewStatus = @decision,
            ReviewedBy = @username,
            ReviewedAt = SYSDATETIME(),
            ManagerComments = @managerComments,
            RejectionReason = CASE WHEN @decision = 'Rejected' THEN @rejectionReason ELSE NULL END
        WHERE id = @reviewId AND ReviewStatus = 'Pending';

        IF @@ROWCOUNT = 0
            THROW 51053, 'Pending closure review was not found.', 1;

        INSERT INTO CC.dbo.DispatchManagerComments
        (dispatch_id, closure_review_id, CommentText, CommentBy, CommentedAt)
    SELECT @id, @reviewId, @managerComments, @username, SYSDATETIME()
    WHERE @managerComments IS NOT NULL;

        UPDATE CC.dbo.DispatchIncidents
    SET ClosureApprovalStatus = @decision,
        DispatchStatus = CASE WHEN @decision = 'Approved' THEN 'Closed' ELSE 'Stood Down' END,
        ClosedBy = CASE WHEN @decision = 'Approved' THEN @username ELSE NULL END,
        ClosedAt = CASE WHEN @decision = 'Approved' THEN SYSDATETIME() ELSE NULL END,
        UpdatedBy = @username,
        UpdatedAt = SYSDATETIME()
    WHERE id = @id;

        INSERT INTO CC.dbo.DispatchAuditLog
        (dispatch_id, AuditAction, OldStatus, NewStatus, AuditMessage, AuditUsername, CreatedAt)
    VALUES
        (@id, 'Closure reviewed', 'Pending', @decision,
         CASE WHEN @decision = 'Approved' THEN 'Manager approved dispatch closure.' ELSE @rejectionReason END,
         @username, SYSDATETIME());

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
    @reviewId AS closureReviewId,
    @message AS message,
    (SELECT TOP (1) DispatchStatus FROM CC.dbo.DispatchIncidents WHERE id = @id) AS dispatchStatus,
    (SELECT TOP (1) ClosureApprovalStatus FROM CC.dbo.DispatchIncidents WHERE id = @id) AS closureApprovalStatus
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
