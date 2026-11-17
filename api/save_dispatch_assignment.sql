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

-- SQLPage JSON endpoint: create or update one of the maximum three ground-team assignments.

DECLARE @id INT = TRY_CAST(:incidentId AS INT);
DECLARE @sequenceNo TINYINT = TRY_CAST(:sequenceNo AS TINYINT);
DECLARE @username NVARCHAR(128) = (
    SELECT TOP (1) NULLIF(LTRIM(RTRIM(CAST(Username AS NVARCHAR(128)))), '')
    FROM Current_session
    WHERE session_id = sqlpage.cookie('session')
);
DECLARE @assignedTeam NVARCHAR(80) = NULLIF(LTRIM(RTRIM(:assignedTeam)), '');
DECLARE @eta DATETIME2(0) = TRY_CONVERT(DATETIME2(0), NULLIF(:eta, ''));
DECLARE @dispatchedAt DATETIME2(0) = TRY_CONVERT(DATETIME2(0), NULLIF(:dispatchedAt, ''));
DECLARE @teamOnSceneAt DATETIME2(0) = TRY_CONVERT(DATETIME2(0), NULLIF(:teamOnSceneAt, ''));
DECLARE @stoodDownAt DATETIME2(0) = TRY_CONVERT(DATETIME2(0), NULLIF(:stoodDownAt, ''));
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
IF @status = 'ok' AND (@sequenceNo IS NULL OR @sequenceNo NOT BETWEEN 1 AND 3)
    SET @status = 'invalid_sequence';
IF @status = 'ok' AND @assignedTeam NOT IN ('Capital Air','Private & Confidential','CSG','Matrix')
    SET @status = 'invalid_team';
IF @status = 'ok' AND NULLIF(:eta, '') IS NOT NULL AND @eta IS NULL
    SET @status = 'invalid_eta';
IF @status = 'ok' AND NULLIF(:dispatchedAt, '') IS NOT NULL AND @dispatchedAt IS NULL
    SET @status = 'invalid_dispatch_time';
IF @status = 'ok' AND NULLIF(:teamOnSceneAt, '') IS NOT NULL AND @teamOnSceneAt IS NULL
    SET @status = 'invalid_on_scene_time';
IF @status = 'ok' AND NULLIF(:stoodDownAt, '') IS NOT NULL AND @stoodDownAt IS NULL
    SET @status = 'invalid_stand_down_time';
IF @status = 'ok' AND @teamOnSceneAt IS NOT NULL AND (@dispatchedAt IS NULL OR @teamOnSceneAt < @dispatchedAt)
    SET @status = 'on_scene_before_dispatch';
IF @status = 'ok' AND @stoodDownAt IS NOT NULL AND (
    @dispatchedAt IS NULL OR @stoodDownAt < @dispatchedAt
    OR (@teamOnSceneAt IS NOT NULL AND @stoodDownAt < @teamOnSceneAt)
)
    SET @status = 'invalid_stand_down_order';

IF @status = 'ok'
BEGIN
    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @oldDispatchStatus = DispatchStatus
        FROM CC.dbo.DispatchIncidents WITH (UPDLOCK, HOLDLOCK)
        WHERE id = @id;

    UPDATE CC.dbo.DispatchAssignments
    SET AssignedTeam = @assignedTeam,
        ETA = @eta,
        DispatchedAt = @dispatchedAt,
        OBNumber = NULLIF(LTRIM(RTRIM(:obNumber)), ''),
        TeamOnSceneAt = @teamOnSceneAt,
        StoodDownAt = @stoodDownAt,
        UpdatedBy = @username,
        UpdatedAt = SYSDATETIME()
    WHERE dispatch_id = @id AND SequenceNo = @sequenceNo;

    INSERT INTO CC.dbo.DispatchAssignments
        (dispatch_id, SequenceNo, AssignedTeam, ETA, DispatchedAt, OBNumber,
         TeamOnSceneAt, StoodDownAt, CreatedBy, CreatedAt)
    SELECT
        @id, @sequenceNo, @assignedTeam, @eta, @dispatchedAt,
        NULLIF(LTRIM(RTRIM(:obNumber)), ''), @teamOnSceneAt, @stoodDownAt,
        @username, SYSDATETIME()
    WHERE NOT EXISTS (
        SELECT 1 FROM CC.dbo.DispatchAssignments
        WHERE dispatch_id = @id AND SequenceNo = @sequenceNo
    );

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
        (@id, 'Ground-team assignment saved', @oldDispatchStatus, @newDispatchStatus,
         CONCAT('Dispatch assignment ', @sequenceNo, ' saved for ', @assignedTeam, '.'), @username, SYSDATETIME());

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
