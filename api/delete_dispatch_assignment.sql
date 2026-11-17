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

-- SQLPage JSON endpoint: delete a ground-team assignment before closure.

DECLARE @id INT = TRY_CAST(:incidentId AS INT);
DECLARE @sequenceNo TINYINT = TRY_CAST(:sequenceNo AS TINYINT);
DECLARE @username NVARCHAR(128) = (
    SELECT TOP (1) NULLIF(LTRIM(RTRIM(CAST(Username AS NVARCHAR(128)))), '')
    FROM Current_session
    WHERE session_id = sqlpage.cookie('session')
);
DECLARE @status NVARCHAR(50) = 'ok';
DECLARE @oldDispatchStatus NVARCHAR(30);
DECLARE @newDispatchStatus NVARCHAR(30);
DECLARE @message NVARCHAR(MAX);

IF @username IS NULL
    SET @status = 'unauthorized';
IF @status = 'ok' AND NOT EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents
    WHERE id = @id AND ISNULL(isdeleted, 0) = 0
)
    SET @status = 'not_found';
IF @status = 'ok' AND EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents
    WHERE id = @id
      AND (DispatchStatus IN ('Closed', 'Cancelled') OR ClosureApprovalStatus = 'Pending')
)
    SET @status = 'locked_status';
IF @status = 'ok' AND NOT EXISTS (
    SELECT 1 FROM CC.dbo.DispatchAssignments
    WHERE dispatch_id = @id AND SequenceNo = @sequenceNo
)
    SET @status = 'assignment_not_found';

IF @status = 'ok'
BEGIN
    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @oldDispatchStatus = DispatchStatus
        FROM CC.dbo.DispatchIncidents WITH (UPDLOCK, HOLDLOCK)
        WHERE id = @id;

    DELETE FROM CC.dbo.DispatchAssignments
    WHERE dispatch_id = @id AND SequenceNo = @sequenceNo;

    UPDATE incident
    SET DispatchStatus = CASE
            WHEN incident.CancelledAt IS NOT NULL THEN 'Cancelled'
            WHEN incident.ClosureApprovalStatus = 'Approved' AND incident.ClosedAt IS NOT NULL THEN 'Closed'
            WHEN EXISTS (SELECT 1 FROM CC.dbo.DispatchAssignments a WHERE a.dispatch_id = incident.id AND a.DispatchedAt IS NOT NULL)
             AND NOT EXISTS (SELECT 1 FROM CC.dbo.DispatchAssignments a WHERE a.dispatch_id = incident.id AND a.DispatchedAt IS NOT NULL AND a.StoodDownAt IS NULL)
                THEN 'Stood Down'
            WHEN incident.VehicleRecovered = 'Yes' OR incident.LoadRecovered = 'Yes' OR incident.TrailersRecovered = 'Yes'
                THEN 'Recovered'
            WHEN EXISTS (SELECT 1 FROM CC.dbo.DispatchAssignments a WHERE a.dispatch_id = incident.id AND a.TeamOnSceneAt IS NOT NULL)
                THEN 'On Scene'
            WHEN EXISTS (SELECT 1 FROM CC.dbo.DispatchAssignments a WHERE a.dispatch_id = incident.id AND a.DispatchedAt IS NOT NULL)
                THEN 'Dispatched'
            ELSE 'Dispatch Requested'
        END,
        UpdatedBy = @username,
        UpdatedAt = SYSDATETIME()
    FROM CC.dbo.DispatchIncidents incident
    WHERE incident.id = @id;

    SELECT @newDispatchStatus = DispatchStatus
    FROM CC.dbo.DispatchIncidents
    WHERE id = @id;

        INSERT INTO CC.dbo.DispatchAuditLog
        (dispatch_id, AuditAction, OldStatus, NewStatus, AuditMessage, AuditUsername, CreatedAt)
    VALUES
        (@id, 'Ground-team assignment deleted', @oldDispatchStatus, @newDispatchStatus,
         CONCAT('Dispatch assignment ', @sequenceNo, ' deleted.'), @username, SYSDATETIME());

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
    (SELECT TOP (1) DispatchStatus FROM CC.dbo.DispatchIncidents WHERE id = @id) AS dispatchStatus,
    JSON_QUERY(COALESCE((
        SELECT *
        FROM CC.dbo.DispatchAssignments
        WHERE dispatch_id = @id
        ORDER BY SequenceNo
        FOR JSON PATH
    ), '[]')) AS assignments
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
