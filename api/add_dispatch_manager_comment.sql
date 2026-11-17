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

-- SQLPage JSON endpoint: add a manager comment to a dispatch or closure review.

DECLARE @id INT = TRY_CAST(:incidentId AS INT);
DECLARE @reviewId INT = TRY_CAST(NULLIF(:closureReviewId, '') AS INT);
DECLARE @commentText NVARCHAR(MAX) = NULLIF(LTRIM(RTRIM(:commentText)), '');
DECLARE @username NVARCHAR(128) = (
    SELECT TOP (1) NULLIF(LTRIM(RTRIM(CAST(Username AS NVARCHAR(128)))), '')
    FROM Current_session
    WHERE session_id = sqlpage.cookie('session')
);
DECLARE @status NVARCHAR(50) = 'ok';
DECLARE @message NVARCHAR(MAX);

IF @username IS NULL
    SET @status = 'unauthorized';
IF @status = 'ok' AND @username NOT IN ('Approver1', 'Approver2', 'Approver3')
    SET @status = 'forbidden';
IF @status = 'ok' AND @commentText IS NULL
    SET @status = 'missing_comment';
IF @status = 'ok' AND NOT EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents
    WHERE id = @id AND ISNULL(isdeleted, 0) = 0
)
    SET @status = 'not_found';
IF @status = 'ok' AND @reviewId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM CC.dbo.DispatchClosureReviews
    WHERE id = @reviewId AND dispatch_id = @id
)
    SET @status = 'closure_review_mismatch';

IF @status = 'ok'
BEGIN
    BEGIN TRY
        BEGIN TRANSACTION;

        INSERT INTO CC.dbo.DispatchManagerComments
            (dispatch_id, closure_review_id, CommentText, CommentBy, CommentedAt)
        VALUES
            (@id, @reviewId, @commentText, @username, SYSDATETIME());

        INSERT INTO CC.dbo.DispatchAuditLog
            (dispatch_id, AuditAction, AuditMessage, AuditUsername, CreatedAt)
        VALUES
            (@id, 'Manager comment added', 'Manager comment recorded.', @username, SYSDATETIME());

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
    @message AS message,
    CASE WHEN @status = 'ok' THEN (
        SELECT TOP (1) id FROM CC.dbo.DispatchManagerComments
        WHERE dispatch_id = @id AND CommentBy = @username
        ORDER BY id DESC
    ) END AS managerCommentId
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
