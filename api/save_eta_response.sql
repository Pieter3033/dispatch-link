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

-- SQLPage endpoint: save a dispatch team's availability and distance.

SET eta_respond_username = (
    SELECT TOP (1) NULLIF(LTRIM(RTRIM(CAST(Username AS nvarchar(128)))), N'')
    FROM Current_session
    WHERE session_id = sqlpage.cookie('session')
);
SET eta_respond_request_id = COALESCE(:requestId, '');
SET eta_respond_availability = COALESCE(:availability, '');
SET eta_respond_distance = COALESCE(:distanceKm, '');
SET eta_respond_team_id = (
    SELECT TOP (1) CONVERT(nvarchar(20), team.TeamId)
    FROM Jobcard.dbo.User_info user_info
    JOIN CC.dbo.DispatchTeams team
      ON LOWER(LTRIM(RTRIM(team.TeamCode))) = LOWER(LTRIM(RTRIM(user_info.DispatchTeamCode)))
    WHERE LOWER(LTRIM(RTRIM(user_info.Username))) = LOWER($eta_respond_username)
      AND TRY_CONVERT(int, user_info.Usertype) = 11
      AND team.IsActive = 1
    ORDER BY user_info.Seqno, team.TeamId
);

SET eta_respond_status = (
    SELECT CASE
        WHEN NULLIF($eta_respond_username, N'') IS NULL THEN N'unauthorized'
        WHEN TRY_CONVERT(int, $eta_respond_team_id) IS NULL THEN N'forbidden'
        WHEN TRY_CONVERT(bigint, NULLIF(LTRIM(RTRIM($eta_respond_request_id)), N'')) IS NULL
          OR TRY_CONVERT(bigint, NULLIF(LTRIM(RTRIM($eta_respond_request_id)), N'')) <= 0
            THEN N'invalid_request'
        WHEN NULLIF(LTRIM(RTRIM($eta_respond_availability)), N'') IS NULL
          OR NULLIF(LTRIM(RTRIM($eta_respond_availability)), N'') NOT IN (N'Available', N'Unavailable')
            THEN N'invalid_availability'
        WHEN LTRIM(RTRIM($eta_respond_availability)) = N'Available' AND (
            TRY_CONVERT(decimal(8,1), NULLIF(LTRIM(RTRIM($eta_respond_distance)), N'')) IS NULL
            OR TRY_CONVERT(decimal(8,1), NULLIF(LTRIM(RTRIM($eta_respond_distance)), N'')) <= 0
            OR LTRIM(RTRIM($eta_respond_distance)) LIKE N'%[^0-9.]%'
            OR LEN(LTRIM(RTRIM($eta_respond_distance))) - LEN(REPLACE(LTRIM(RTRIM($eta_respond_distance)), N'.', N'')) > 1
            OR LTRIM(RTRIM($eta_respond_distance)) LIKE N'.%'
            OR LTRIM(RTRIM($eta_respond_distance)) LIKE N'%.'
            OR (CHARINDEX(N'.', LTRIM(RTRIM($eta_respond_distance))) > 0
                AND LEN(LTRIM(RTRIM($eta_respond_distance))) - CHARINDEX(N'.', LTRIM(RTRIM($eta_respond_distance))) > 1)
        ) THEN N'distance_required'
        WHEN NOT EXISTS (
            SELECT 1
            FROM CC.dbo.DispatchEtaResponses eta_response
            WHERE eta_response.EtaRequestId = TRY_CONVERT(bigint, $eta_respond_request_id)
              AND eta_response.TeamId = TRY_CONVERT(int, $eta_respond_team_id)
        ) THEN N'not_found'
        WHEN NOT EXISTS (
            SELECT 1 FROM CC.dbo.DispatchEtaRequests
            WHERE EtaRequestId = TRY_CONVERT(bigint, $eta_respond_request_id)
              AND RequestStatus = N'Open'
        ) THEN N'closed'
        ELSE N'ok'
    END
);

UPDATE eta_response
SET ResponseStatus = LTRIM(RTRIM($eta_respond_availability)),
    DistanceKm = CASE WHEN LTRIM(RTRIM($eta_respond_availability)) = N'Available'
        THEN TRY_CONVERT(decimal(8,1), LTRIM(RTRIM($eta_respond_distance))) ELSE NULL END,
    RespondedAt = SYSDATETIME(),
    RespondedBy = $eta_respond_username,
    UpdatedAt = SYSDATETIME(),
    UpdatedBy = $eta_respond_username
FROM CC.dbo.DispatchEtaResponses eta_response
WHERE eta_response.EtaRequestId = TRY_CONVERT(bigint, $eta_respond_request_id)
  AND eta_response.TeamId = TRY_CONVERT(int, $eta_respond_team_id)
  AND $eta_respond_status = N'ok'
  AND EXISTS (
      SELECT 1 FROM CC.dbo.DispatchEtaRequests eta_request
      WHERE eta_request.EtaRequestId = eta_response.EtaRequestId
        AND eta_request.RequestStatus = N'Open'
  );

SET eta_respond_final_status = (
    SELECT CASE
        WHEN $eta_respond_status <> N'ok' THEN $eta_respond_status
        WHEN EXISTS (
            SELECT 1
            FROM CC.dbo.DispatchEtaResponses
            WHERE EtaRequestId = TRY_CONVERT(bigint, $eta_respond_request_id)
              AND TeamId = TRY_CONVERT(int, $eta_respond_team_id)
              AND ResponseStatus = LTRIM(RTRIM($eta_respond_availability))
              AND RespondedBy = $eta_respond_username
        ) THEN N'ok'
        WHEN NOT EXISTS (
            SELECT 1 FROM CC.dbo.DispatchEtaRequests
            WHERE EtaRequestId = TRY_CONVERT(bigint, $eta_respond_request_id)
              AND RequestStatus = N'Open'
        ) THEN N'closed'
        ELSE N'db_error'
    END
);

SELECT (
    SELECT
        $eta_respond_final_status AS status,
        TRY_CONVERT(bigint, $eta_respond_request_id) AS id,
        CASE $eta_respond_final_status
            WHEN N'ok' THEN N'Your ETA response has been saved.'
            WHEN N'unauthorized' THEN N'An active signed-in session is required.'
            WHEN N'forbidden' THEN N'An active dispatch-team profile is required.'
            WHEN N'invalid_request' THEN N'A valid ETA request is required.'
            WHEN N'invalid_availability' THEN N'Select available or unavailable.'
            WHEN N'distance_required' THEN N'Enter a distance greater than zero using numbers only.'
            WHEN N'not_found' THEN N'This ETA request is not assigned to your team.'
            WHEN N'closed' THEN N'This ETA request is already closed.'
            ELSE N'The ETA response could not be saved.'
        END AS message
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS json;
