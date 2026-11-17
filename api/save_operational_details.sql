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

-- SQLPage JSON endpoint: save incident-level operational and recovery details.
-- Uses direct SQL because SQLPage 0.25 does not reliably support EXEC.

DECLARE @id INT = TRY_CAST(:incidentId AS INT);
DECLARE @username NVARCHAR(128) = (
    SELECT TOP (1) NULLIF(LTRIM(RTRIM(CAST(Username AS NVARCHAR(128)))), '')
    FROM Current_session
    WHERE session_id = sqlpage.cookie('session')
);
DECLARE @status NVARCHAR(50) = 'ok';
DECLARE @oldDispatchStatus NVARCHAR(30);
DECLARE @newDispatchStatus NVARCHAR(30);
DECLARE @message NVARCHAR(MAX);
DECLARE @positiveHijacking NVARCHAR(30) = NULLIF(LTRIM(RTRIM(:positiveHijacking)), '');
DECLARE @vehicleRecovered NVARCHAR(30) = NULLIF(LTRIM(RTRIM(:vehicleRecovered)), '');
DECLARE @loadRecovered NVARCHAR(30) = NULLIF(LTRIM(RTRIM(:loadRecovered)), '');
DECLARE @trailersRecovered NVARCHAR(30) = NULLIF(LTRIM(RTRIM(:trailersRecovered)), '');
DECLARE @vehicleKeyAvailable NVARCHAR(30) = NULLIF(LTRIM(RTRIM(:vehicleKeyAvailable)), '');
DECLARE @driverOnScene NVARCHAR(30) = NULLIF(LTRIM(RTRIM(:driverOnScene)), '');
DECLARE @trackingUnitStatus NVARCHAR(100) = NULLIF(LTRIM(RTRIM(:trackingUnitStatus)), '');

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

IF @status = 'ok' AND @positiveHijacking IS NOT NULL AND @positiveHijacking NOT IN ('Yes','No','Not Applicable')
    SET @status = 'invalid_positive_hijacking';
IF @status = 'ok' AND @vehicleRecovered IS NOT NULL AND @vehicleRecovered NOT IN ('Yes','No','Not Applicable','Vehicle Not On Scene')
    SET @status = 'invalid_vehicle_recovered';
IF @status = 'ok' AND @loadRecovered IS NOT NULL AND @loadRecovered NOT IN ('Yes','No','Not Applicable')
    SET @status = 'invalid_load_recovered';
IF @status = 'ok' AND @trailersRecovered IS NOT NULL AND @trailersRecovered NOT IN ('Yes','No','Not Applicable')
    SET @status = 'invalid_trailers_recovered';
IF @status = 'ok' AND @vehicleKeyAvailable IS NOT NULL AND @vehicleKeyAvailable NOT IN ('Yes','No','Not Applicable')
    SET @status = 'invalid_vehicle_key_available';
IF @status = 'ok' AND @driverOnScene IS NOT NULL AND @driverOnScene NOT IN ('Yes','No','Not Applicable')
    SET @status = 'invalid_driver_on_scene';
IF @status = 'ok' AND @trackingUnitStatus IS NOT NULL AND @trackingUnitStatus NOT IN (
    'Asset Lost - Unit Lost',
    'Asset Lost - Unit Found',
    'Asset Found - Unit Lost',
    'Asset Found - Unit Working',
    'Asset Found - Unit Not Working',
    'Dispatch Cancelled - Unit Working',
    'Dispatch Cancelled - Unit Not Working',
    'Mobile Unit',
    'Not fitted with Pulsit Tracking'
)
    SET @status = 'invalid_tracking_unit_status';

IF @status = 'ok'
BEGIN
    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @oldDispatchStatus = DispatchStatus
        FROM CC.dbo.DispatchIncidents WITH (UPDLOCK, HOLDLOCK)
        WHERE id = @id;

    UPDATE CC.dbo.DispatchIncidents
    SET TrailerRegistration1 = NULLIF(LTRIM(RTRIM(:trailerRegistration1)), ''),
        TrailerRegistration2 = NULLIF(LTRIM(RTRIM(:trailerRegistration2)), ''),
        AssignedControlRoomAgent = COALESCE(NULLIF(LTRIM(RTRIM(:assignedControlRoomAgent)), ''), @username),
        ClientContactName = NULLIF(LTRIM(RTRIM(:clientContactName)), ''),
        ClientContactNumber = NULLIF(LTRIM(RTRIM(:clientContactNumber)), ''),
        ClientPO = NULLIF(LTRIM(RTRIM(:clientPO)), ''),
        StockNumber = NULLIF(LTRIM(RTRIM(:stockNumber)), ''),
        SummaryOfIncident = NULLIF(LTRIM(RTRIM(:summaryOfIncident)), ''),
        PositiveHijacking = @positiveHijacking,
        VehicleRecovered = @vehicleRecovered,
        LoadRecovered = @loadRecovered,
        TrailersRecovered = @trailersRecovered,
        VehicleKeyAvailable = @vehicleKeyAvailable,
        DriverOnScene = @driverOnScene,
        TrackingUnitStatus = @trackingUnitStatus,
        UpdatedBy = @username,
        UpdatedAt = SYSDATETIME()
    WHERE id = @id;

    UPDATE incident
    SET DispatchStatus = CASE
            WHEN incident.CancelledAt IS NOT NULL THEN 'Cancelled'
            WHEN incident.ClosureApprovalStatus = 'Approved' AND incident.ClosedAt IS NOT NULL THEN 'Closed'
            WHEN EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchAssignments assignment
                    WHERE assignment.dispatch_id = incident.id AND assignment.DispatchedAt IS NOT NULL
                 )
                 AND NOT EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchAssignments assignment
                    WHERE assignment.dispatch_id = incident.id
                      AND assignment.DispatchedAt IS NOT NULL
                      AND assignment.StoodDownAt IS NULL
                 ) THEN 'Stood Down'
            WHEN incident.VehicleRecovered = 'Yes'
              OR incident.LoadRecovered = 'Yes'
              OR incident.TrailersRecovered = 'Yes' THEN 'Recovered'
            WHEN EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchAssignments assignment
                    WHERE assignment.dispatch_id = incident.id AND assignment.TeamOnSceneAt IS NOT NULL
                 ) THEN 'On Scene'
            WHEN EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchAssignments assignment
                    WHERE assignment.dispatch_id = incident.id AND assignment.DispatchedAt IS NOT NULL
                 ) THEN 'Dispatched'
            ELSE 'Dispatch Requested'
        END
    FROM CC.dbo.DispatchIncidents incident
    WHERE incident.id = @id;

    SELECT @newDispatchStatus = DispatchStatus
    FROM CC.dbo.DispatchIncidents
    WHERE id = @id;

        INSERT INTO CC.dbo.DispatchAuditLog
        (dispatch_id, AuditAction, OldStatus, NewStatus, AuditMessage, AuditUsername, CreatedAt)
    VALUES
        (@id, 'Operational details updated', @oldDispatchStatus, @newDispatchStatus,
         'Incident-level operational and recovery details updated.', @username, SYSDATETIME());

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
    (SELECT TOP (1) ClosureApprovalStatus FROM CC.dbo.DispatchIncidents WHERE id = @id) AS closureApprovalStatus
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
