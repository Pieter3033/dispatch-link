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

-- SQLPage endpoint: select an available response and create one linked draft.
-- Each step is idempotent so a retry safely completes an interrupted request.

SET eta_select_username = (
    SELECT TOP (1) NULLIF(LTRIM(RTRIM(CAST(Username AS nvarchar(128)))), N'')
    FROM Current_session
    WHERE session_id = sqlpage.cookie('session')
);
SET eta_select_request_id = COALESCE(:requestId, '');
SET eta_select_response_id = COALESCE(:responseId, '');
SET eta_select_status = (
    SELECT CASE
        WHEN NULLIF($eta_select_username, N'') IS NULL THEN N'unauthorized'
        WHEN NOT EXISTS (
            SELECT 1
            FROM Jobcard.dbo.User_info user_info
            WHERE LOWER(LTRIM(RTRIM(user_info.Username))) = LOWER($eta_select_username)
              AND (
                    TRY_CONVERT(int, user_info.Usertype) IN (7, 8, 14)
                 OR (TRY_CONVERT(int, user_info.Usertype) = 1 AND COALESCE(user_info.Helpdesk, 0) = 1)
              )
        ) THEN N'forbidden'
        WHEN TRY_CONVERT(bigint, NULLIF(LTRIM(RTRIM($eta_select_request_id)), N'')) IS NULL
          OR TRY_CONVERT(bigint, NULLIF(LTRIM(RTRIM($eta_select_request_id)), N'')) <= 0
          OR TRY_CONVERT(bigint, NULLIF(LTRIM(RTRIM($eta_select_response_id)), N'')) IS NULL
          OR TRY_CONVERT(bigint, NULLIF(LTRIM(RTRIM($eta_select_response_id)), N'')) <= 0
            THEN N'invalid_selection'
        WHEN NOT EXISTS (
            SELECT 1 FROM CC.dbo.DispatchEtaRequests
            WHERE EtaRequestId = TRY_CONVERT(bigint, $eta_select_request_id)
        ) THEN N'not_found'
        WHEN EXISTS (
            SELECT 1 FROM CC.dbo.DispatchEtaRequests
            WHERE EtaRequestId = TRY_CONVERT(bigint, $eta_select_request_id)
              AND DispatchIncidentId IS NOT NULL
        ) THEN N'already_selected'
        WHEN NOT EXISTS (
            SELECT 1 FROM CC.dbo.DispatchEtaRequests
            WHERE EtaRequestId = TRY_CONVERT(bigint, $eta_select_request_id)
              AND RequestStatus = N'Open'
        ) THEN N'closed'
        WHEN NOT EXISTS (
            SELECT 1
            FROM CC.dbo.DispatchEtaResponses eta_response
            INNER JOIN CC.dbo.DispatchTeams team
                ON team.TeamId = eta_response.TeamId
               AND team.IsActive = 1
            WHERE eta_response.EtaResponseId = TRY_CONVERT(bigint, $eta_select_response_id)
              AND eta_response.EtaRequestId = TRY_CONVERT(bigint, $eta_select_request_id)
              AND eta_response.ResponseStatus IN (N'Available', N'Selected')
              AND eta_response.DistanceKm > 0
        ) THEN N'response_unavailable'
        WHEN EXISTS (
            SELECT 1
            FROM CC.dbo.DispatchEtaResponses eta_response
            INNER JOIN CC.dbo.DispatchTeams team
                ON team.TeamId = eta_response.TeamId
               AND team.IsActive = 1
               AND team.MonthlyDispatchLimit IS NOT NULL
            CROSS APPLY (
                SELECT
                    COUNT(DISTINCT CASE
                        WHEN incident.DispatchDateTime >= DATEFROMPARTS(YEAR(SYSDATETIME()), MONTH(SYSDATETIME()), 1)
                         AND incident.DispatchDateTime < DATEADD(month, 1, DATEFROMPARTS(YEAR(SYSDATETIME()), MONTH(SYSDATETIME()), 1))
                            THEN incident.id
                    END) AS used_count,
                    COUNT(DISTINCT CASE
                        WHEN incident.DispatchDateTime IS NULL
                         AND incident.CreatedAt >= DATEFROMPARTS(YEAR(SYSDATETIME()), MONTH(SYSDATETIME()), 1)
                         AND incident.CreatedAt < DATEADD(month, 1, DATEFROMPARTS(YEAR(SYSDATETIME()), MONTH(SYSDATETIME()), 1))
                         AND incident.DispatchStatus NOT IN (N'Closed', N'Cancelled')
                            THEN incident.id
                    END) AS pending_count
                FROM CC.dbo.DispatchIncidents incident
                WHERE incident.IsDeleted = 0
                  AND (
                      LOWER(LTRIM(RTRIM(incident.DispatchTeam))) = LOWER(LTRIM(RTRIM(team.TeamName)))
                      OR (
                          LOWER(LTRIM(RTRIM(team.TeamName))) = N'matrix'
                          AND LOWER(LTRIM(RTRIM(incident.DispatchTeam))) = N'rentrak'
                      )
                  )
            ) quota
            WHERE eta_response.EtaResponseId = TRY_CONVERT(bigint, $eta_select_response_id)
              AND eta_response.EtaRequestId = TRY_CONVERT(bigint, $eta_select_request_id)
              AND quota.used_count + quota.pending_count >= team.MonthlyDispatchLimit
        ) THEN N'quota_reached'
        ELSE N'ok'
    END
);
SET eta_select_save_request_id = (
    SELECT CASE WHEN $eta_select_status = N'ok'
        THEN N'ETA_REQUEST_' + CONVERT(nvarchar(20), TRY_CONVERT(bigint, $eta_select_request_id))
        ELSE NULL
    END
);

INSERT INTO CC.dbo.DispatchIncidents
(
    SaveRequestId, EventDateTime, Event, ETA, DispatchCaptureVersion,
    RiskEventReference, RegNo, GeoLocation, Latitude, Longitude,
    DispatchTeam, DispatchDateTime,
    Status, CreatedAt, CreatedBy, UpdatedAt, UpdatedBy
)
SELECT
    $eta_select_save_request_id,
    eta_request.CreatedAt,
    CONVERT(nvarchar(255), eta_request.ShortDescription),
    CONVERT(nvarchar(30), eta_response.DistanceKm),
    1,
    eta_request.RequestNumber,
    eta_request.Registration,
    NULL,
    eta_request.Latitude,
    eta_request.Longitude,
    team.TeamName,
    NULL,
    N'Draft',
    SYSDATETIME(),
    $eta_select_username,
    SYSDATETIME(),
    $eta_select_username
FROM CC.dbo.DispatchEtaRequests eta_request
INNER JOIN CC.dbo.DispatchEtaResponses eta_response
    ON eta_response.EtaRequestId = eta_request.EtaRequestId
   AND eta_response.EtaResponseId = TRY_CONVERT(bigint, $eta_select_response_id)
INNER JOIN CC.dbo.DispatchTeams team
    ON team.TeamId = eta_response.TeamId
   AND team.IsActive = 1
WHERE eta_request.EtaRequestId = TRY_CONVERT(bigint, $eta_select_request_id)
  AND eta_request.RequestStatus = N'Open'
  AND eta_request.DispatchIncidentId IS NULL
  AND eta_response.ResponseStatus IN (N'Available', N'Selected')
  AND eta_response.DistanceKm > 0
  AND $eta_select_status = N'ok'
  AND NOT EXISTS (
      SELECT 1 FROM CC.dbo.DispatchIncidents existing_draft
      WHERE existing_draft.SaveRequestId = $eta_select_save_request_id
  );

SET eta_select_draft_id = (
    SELECT TOP (1) CONVERT(nvarchar(20), id)
    FROM CC.dbo.DispatchIncidents
    WHERE SaveRequestId = $eta_select_save_request_id
);

UPDATE CC.dbo.DispatchIncidents
SET IncidentNumber = N'DL-' + RIGHT(REPLICATE(N'0', 6) + CONVERT(nvarchar(20), id), 6),
    UpdatedAt = SYSDATETIME(),
    UpdatedBy = $eta_select_username
WHERE id = TRY_CONVERT(int, $eta_select_draft_id)
  AND IncidentNumber IS NULL;

INSERT INTO CC.dbo.DispatchAuditLog
    (dispatch_id, AuditAction, NewStatus, AuditMessage, AuditUsername, CreatedAt)
SELECT
    TRY_CONVERT(int, $eta_select_draft_id),
    N'Incident created',
    N'Draft',
    CONCAT(N'Draft created from ETA request ', eta_request.RequestNumber, N'.'),
    $eta_select_username,
    SYSDATETIME()
FROM CC.dbo.DispatchEtaRequests eta_request
WHERE eta_request.EtaRequestId = TRY_CONVERT(bigint, $eta_select_request_id)
  AND TRY_CONVERT(int, $eta_select_draft_id) IS NOT NULL
  AND $eta_select_status = N'ok'
  AND NOT EXISTS (
      SELECT 1
      FROM CC.dbo.DispatchAuditLog existing_audit
      WHERE existing_audit.dispatch_id = TRY_CONVERT(int, $eta_select_draft_id)
        AND existing_audit.AuditAction = N'Incident created'
        AND existing_audit.AuditMessage = CONCAT(N'Draft created from ETA request ', eta_request.RequestNumber, N'.')
  );

UPDATE eta_response
SET ResponseStatus = CASE
        WHEN eta_response.EtaResponseId = TRY_CONVERT(bigint, $eta_select_response_id)
            THEN N'Selected'
        ELSE N'NotSelected'
    END,
    UpdatedAt = SYSDATETIME(),
    UpdatedBy = $eta_select_username
FROM CC.dbo.DispatchEtaResponses eta_response
WHERE eta_response.EtaRequestId = TRY_CONVERT(bigint, $eta_select_request_id)
  AND eta_response.ResponseStatus IN (N'Pending', N'Available', N'Unavailable', N'Selected', N'NotSelected')
  AND TRY_CONVERT(int, $eta_select_draft_id) IS NOT NULL
  AND $eta_select_status = N'ok'
  AND EXISTS (
      SELECT 1
      FROM CC.dbo.DispatchEtaResponses selected_response
      WHERE selected_response.EtaResponseId = TRY_CONVERT(bigint, $eta_select_response_id)
        AND selected_response.EtaRequestId = eta_response.EtaRequestId
        AND selected_response.ResponseStatus IN (N'Available', N'Selected')
        AND selected_response.DistanceKm > 0
  );

UPDATE eta_request
SET RequestStatus = N'Selected',
    SelectedTeamId = selected_response.TeamId,
    SelectedDistanceKm = selected_response.DistanceKm,
    DispatchIncidentId = TRY_CONVERT(int, $eta_select_draft_id),
    SelectedAt = SYSDATETIME(),
    SelectedBy = $eta_select_username,
    UpdatedAt = SYSDATETIME(),
    UpdatedBy = $eta_select_username
FROM CC.dbo.DispatchEtaRequests eta_request
INNER JOIN CC.dbo.DispatchEtaResponses selected_response
    ON selected_response.EtaRequestId = eta_request.EtaRequestId
   AND selected_response.EtaResponseId = TRY_CONVERT(bigint, $eta_select_response_id)
   AND selected_response.ResponseStatus = N'Selected'
   AND selected_response.DistanceKm > 0
WHERE eta_request.EtaRequestId = TRY_CONVERT(bigint, $eta_select_request_id)
  AND eta_request.RequestStatus = N'Open'
  AND eta_request.DispatchIncidentId IS NULL
  AND TRY_CONVERT(int, $eta_select_draft_id) IS NOT NULL
  AND $eta_select_status = N'ok';

SET eta_select_final_status = (
    SELECT CASE
        WHEN $eta_select_status = N'already_selected' THEN N'already_selected'
        WHEN $eta_select_status <> N'ok' THEN $eta_select_status
        WHEN EXISTS (
            SELECT 1
            FROM CC.dbo.DispatchEtaRequests
            WHERE EtaRequestId = TRY_CONVERT(bigint, $eta_select_request_id)
              AND RequestStatus = N'Selected'
              AND DispatchIncidentId = TRY_CONVERT(int, $eta_select_draft_id)
        ) THEN N'ok'
        ELSE N'db_error'
    END
);
SET eta_select_final_draft_id = (
    SELECT TOP (1) CONVERT(nvarchar(20), DispatchIncidentId)
    FROM CC.dbo.DispatchEtaRequests
    WHERE EtaRequestId = TRY_CONVERT(bigint, $eta_select_request_id)
);

SELECT (
    SELECT
        $eta_select_final_status AS status,
        TRY_CONVERT(bigint, $eta_select_request_id) AS id,
        TRY_CONVERT(int, $eta_select_final_draft_id) AS dispatchIncidentId,
        CASE $eta_select_final_status
            WHEN N'ok' THEN N'Dispatch team selected and draft created.'
            WHEN N'already_selected' THEN N'This ETA request already has a dispatch draft.'
            WHEN N'unauthorized' THEN N'An active signed-in session is required.'
            WHEN N'forbidden' THEN N'Call Centre access is required.'
            WHEN N'invalid_selection' THEN N'Select a valid available response.'
            WHEN N'not_found' THEN N'ETA request not found.'
            WHEN N'closed' THEN N'This ETA request is already closed.'
            WHEN N'response_unavailable' THEN N'The selected team is not currently available for this request.'
            WHEN N'quota_reached' THEN N'This dispatch team has no unreserved monthly capacity remaining.'
            ELSE N'The dispatch team could not be selected.'
        END AS message
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS json;
