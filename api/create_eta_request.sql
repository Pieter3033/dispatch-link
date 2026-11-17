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

-- SQLPage endpoint: create and broadcast an ETA request without an external process.

SET eta_create_username = (
    SELECT TOP (1) NULLIF(LTRIM(RTRIM(CAST(Username AS nvarchar(128)))), N'')
    FROM Current_session
    WHERE session_id = sqlpage.cookie('session')
);
SET eta_create_latitude = COALESCE(:latitude, '');
SET eta_create_longitude = COALESCE(:longitude, '');
SET eta_create_registration = COALESCE(:registration, '');
SET eta_create_incident_type = COALESCE(:incidentType, '');

SET eta_create_status = (
    SELECT CASE
        WHEN NULLIF($eta_create_username, N'') IS NULL THEN N'unauthorized'
        WHEN NOT EXISTS (
            SELECT 1
            FROM Jobcard.dbo.User_info user_info
            WHERE LOWER(LTRIM(RTRIM(user_info.Username))) = LOWER($eta_create_username)
              AND (
                    TRY_CONVERT(int, user_info.Usertype) IN (7, 8, 14)
                 OR (TRY_CONVERT(int, user_info.Usertype) = 1 AND COALESCE(user_info.Helpdesk, 0) = 1)
              )
        ) THEN N'forbidden'
        WHEN TRY_CONVERT(decimal(9,6), NULLIF(LTRIM(RTRIM($eta_create_latitude)), N'')) IS NULL
          OR TRY_CONVERT(decimal(9,6), NULLIF(LTRIM(RTRIM($eta_create_latitude)), N'')) NOT BETWEEN -90 AND 90
            THEN N'invalid_latitude'
        WHEN TRY_CONVERT(decimal(9,6), NULLIF(LTRIM(RTRIM($eta_create_longitude)), N'')) IS NULL
          OR TRY_CONVERT(decimal(9,6), NULLIF(LTRIM(RTRIM($eta_create_longitude)), N'')) NOT BETWEEN -180 AND 180
            THEN N'invalid_longitude'
        WHEN NULLIF(LTRIM(RTRIM($eta_create_registration)), N'') IS NULL THEN N'registration_required'
        WHEN NULLIF(LTRIM(RTRIM($eta_create_incident_type)), N'') IS NULL
          OR NULLIF(LTRIM(RTRIM($eta_create_incident_type)), N'') NOT IN (
            N'Accident', N'After Hours Movement', N'Armed Robbery', N'Attempted Hijacking',
            N'Battery Critical', N'Battery Disconnect', N'Breakdown', N'Breaking Convoy',
            N'Bureau Update', N'Camera Cover', N'Canopy Lock', N'Canopy Unlock',
            N'Capital Air Dispatch', N'Cargo Area Panic', N'Cargo Door Lock', N'Cargo Door Unlock',
            N'Convoy Break', N'Customer Request', N'C_Lock - Lock', N'C_Lock - Unlock',
            N'Door Possible Hijack', N'Escort Request', N'ETA Request', N'Fatigue Event',
            N'Fuel Drop', N'Gate Jamming Detected', N'Guarding Services', N'Harness Tamper',
            N'Hijacking', N'Jamming Detected', N'Jamming Timer Expired', N'Limp Geofence Entrance',
            N'Maglock Locked', N'Maglock Unlocked', N'Max Time Exceeded', N'Moving Into Geofence',
            N'Moving Out Of Geofence', N'Net Alarm', N'Off Route', N'OTA Limp mode',
            N'OTA Limp Mode Test', N'Panic', N'Panic Test', N'Protest Action', N'PTO Disabled',
            N'PTO Enabled', N'Reload', N'Reload Copper Tracking - Clamped', N'Reload Dispatch',
            N'Removed Received', N'Tailgate Locked', N'Tailgate Unlocked', N'Tamper',
            N'Technical Event', N'Tilt', N'Trailer Disconnect', N'Travel Stop',
            N'Unauthorised Driving', N'Unit Not Updating', N'Unlimp Vehicle', N'Upliftment',
            N'Vehicle Theft'
        ) THEN N'incident_type_required'
        WHEN NOT EXISTS (SELECT 1 FROM CC.dbo.DispatchTeams WHERE IsActive = 1) THEN N'no_active_teams'
        ELSE N'ok'
    END
);

SET eta_create_token = (
    SELECT CASE WHEN $eta_create_status = N'ok'
        THEN N'TMP-' + LEFT(REPLACE(CONVERT(nvarchar(36), NEWID()), N'-', N''), 26)
        ELSE NULL
    END
);

INSERT INTO CC.dbo.DispatchEtaRequests
(
    RequestNumber, Latitude, Longitude, Registration, ShortDescription,
    RequestStatus, ExpiresAt, CreatedAt, CreatedBy
)
SELECT
    $eta_create_token,
    TRY_CONVERT(decimal(9,6), NULLIF(LTRIM(RTRIM($eta_create_latitude)), N'')),
    TRY_CONVERT(decimal(9,6), NULLIF(LTRIM(RTRIM($eta_create_longitude)), N'')),
    UPPER(LTRIM(RTRIM($eta_create_registration))),
    LTRIM(RTRIM($eta_create_incident_type)),
    N'Open', DATEADD(MINUTE, 10, SYSDATETIME()), SYSDATETIME(), $eta_create_username
WHERE $eta_create_status = N'ok';

SET eta_create_request_id = (
    SELECT TOP (1) CONVERT(nvarchar(20), EtaRequestId)
    FROM CC.dbo.DispatchEtaRequests
    WHERE RequestNumber = $eta_create_token
);

UPDATE CC.dbo.DispatchEtaRequests
SET RequestNumber = N'ETA-' + RIGHT(REPLICATE(N'0', 12) + $eta_create_request_id, 12)
WHERE EtaRequestId = TRY_CONVERT(bigint, $eta_create_request_id)
  AND RequestNumber = $eta_create_token;

INSERT INTO CC.dbo.DispatchEtaResponses (EtaRequestId, TeamId, ResponseStatus, CreatedAt)
SELECT TRY_CONVERT(bigint, $eta_create_request_id), team.TeamId, N'Pending', SYSDATETIME()
FROM CC.dbo.DispatchTeams team
WHERE team.IsActive = 1
  AND TRY_CONVERT(bigint, $eta_create_request_id) IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM CC.dbo.DispatchEtaResponses existing_response
      WHERE existing_response.EtaRequestId = TRY_CONVERT(bigint, $eta_create_request_id)
        AND existing_response.TeamId = team.TeamId
  );

SET eta_create_final_status = (
    SELECT CASE
        WHEN $eta_create_status <> N'ok' THEN $eta_create_status
        WHEN TRY_CONVERT(bigint, $eta_create_request_id) IS NOT NULL
         AND (SELECT COUNT(*) FROM CC.dbo.DispatchEtaResponses WHERE EtaRequestId = TRY_CONVERT(bigint, $eta_create_request_id))
             = (SELECT COUNT(*) FROM CC.dbo.DispatchTeams WHERE IsActive = 1)
            THEN N'ok'
        ELSE N'db_error'
    END
);

SELECT (
    SELECT
        $eta_create_final_status AS status,
        TRY_CONVERT(bigint, $eta_create_request_id) AS id,
        CASE $eta_create_final_status
            WHEN N'ok' THEN N'ETA request sent to all active dispatch teams.'
            WHEN N'unauthorized' THEN N'An active signed-in session is required.'
            WHEN N'forbidden' THEN N'Call Centre access is required to create ETA requests.'
            WHEN N'invalid_latitude' THEN N'Enter a latitude between -90 and 90.'
            WHEN N'invalid_longitude' THEN N'Enter a longitude between -180 and 180.'
            WHEN N'registration_required' THEN N'Registration is required.'
            WHEN N'incident_type_required' THEN N'Select a valid incident type.'
            WHEN N'no_active_teams' THEN N'No active dispatch teams are configured.'
            ELSE N'The ETA request could not be created.'
        END AS message
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS json;
