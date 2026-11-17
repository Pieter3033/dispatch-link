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

-- SQLPage JSON endpoint: role-scoped ETA request register.

WITH session_identity AS
(
    SELECT
        (
            SELECT TOP (1)
                NULLIF(LTRIM(RTRIM(CAST(Username AS nvarchar(128)))), N'')
            FROM Current_session
            WHERE session_id = sqlpage.cookie('session')
        ) AS username
),
access_context AS
(
    SELECT
        identity_row.username,
        profile.Usertype AS UserType,
        profile.Helpdesk,
        CASE
            WHEN identity_row.username IS NULL THEN N'None'
            WHEN profile.Usertype IS NULL THEN N'None'
            WHEN TRY_CONVERT(int, profile.Usertype) = 11 AND team.TeamId IS NOT NULL THEN N'DispatchTeam'
            WHEN TRY_CONVERT(int, profile.Usertype) IN (7, 8, 14)
              OR (TRY_CONVERT(int, profile.Usertype) = 1 AND COALESCE(profile.Helpdesk, 0) = 1)
                THEN N'CallCentre'
            ELSE N'None'
        END AS AccessRole,
        team.TeamId,
        team.TeamCode,
        team.TeamName,
        COALESCE(team.IsActive, 0) AS TeamIsActive
    FROM session_identity identity_row
    OUTER APPLY
    (
        SELECT TOP (1)
            user_info.Usertype,
            user_info.Helpdesk,
            user_info.DispatchTeamCode
        FROM Jobcard.dbo.User_info user_info
        WHERE LOWER(LTRIM(RTRIM(CAST(user_info.Username AS nvarchar(200))))) = LOWER(identity_row.username)
        ORDER BY user_info.Seqno
    ) profile
    LEFT JOIN CC.dbo.DispatchTeams team
        ON TRY_CONVERT(int, profile.Usertype) = 11
       AND LOWER(LTRIM(RTRIM(team.TeamCode))) = LOWER(LTRIM(RTRIM(profile.DispatchTeamCode)))
),
scoped_requests AS
(
    SELECT TOP (200)
        request.EtaRequestId,
        request.RequestNumber,
        request.Latitude,
        request.Longitude,
        request.Registration,
        request.ShortDescription,
        request.RequestStatus AS EffectiveStatus,
        request.RequestStatus,
        request.ExpiresAt,
        CAST(CASE
            WHEN request.RequestStatus = N'Open' AND request.ExpiresAt <= SYSDATETIME() THEN 1
            ELSE 0
        END AS bit) AS IsOverdue,
        request.SelectedTeamId,
        selected_team.TeamName AS SelectedTeamName,
        request.SelectedDistanceKm,
        request.DispatchIncidentId,
        request.SelectedAt,
        request.SelectedBy,
        request.CancelledAt,
        request.CancelledBy,
        request.CreatedAt,
        request.CreatedBy
    FROM CC.dbo.DispatchEtaRequests request
    LEFT JOIN CC.dbo.DispatchTeams selected_team
        ON selected_team.TeamId = request.SelectedTeamId
    CROSS JOIN access_context context
    WHERE context.AccessRole = N'CallCentre'
       OR
       (
           context.AccessRole = N'DispatchTeam'
           AND EXISTS
           (
               SELECT 1
               FROM CC.dbo.DispatchEtaResponses response_scope
               WHERE response_scope.EtaRequestId = request.EtaRequestId
                 AND response_scope.TeamId = context.TeamId
           )
       )
    ORDER BY
        CASE
            WHEN request.RequestStatus = N'Open' THEN 0
            ELSE 1
        END,
        request.CreatedAt DESC,
        request.EtaRequestId DESC
)
SELECT (
SELECT
    JSON_QUERY((
        SELECT
            context.username,
            context.UserType AS userType,
            context.Helpdesk AS helpdesk,
            COALESCE(context.AccessRole, N'None') AS role,
            context.TeamId AS teamId,
            context.TeamCode AS teamCode,
            context.TeamName AS teamName,
            context.TeamIsActive AS teamIsActive,
            SYSDATETIME() AS serverTime
        FROM access_context context
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    )) AS context,
    JSON_QUERY(COALESCE((
        SELECT
            request.EtaRequestId AS id,
            request.RequestNumber AS requestNumber,
            request.Latitude AS latitude,
            request.Longitude AS longitude,
            request.Registration AS registration,
            request.ShortDescription AS shortDescription,
            request.EffectiveStatus AS status,
            request.ExpiresAt AS expiresAt,
            request.IsOverdue AS isOverdue,
            request.SelectedTeamId AS selectedTeamId,
            request.SelectedTeamName AS selectedTeamName,
            request.SelectedDistanceKm AS selectedDistanceKm,
            CASE
                WHEN EXISTS
                (
                    SELECT 1
                    FROM CC.dbo.DispatchIncidents incident
                    WHERE incident.id = request.DispatchIncidentId
                      AND incident.IsDeleted = 0
                )
                THEN request.DispatchIncidentId
                ELSE NULL
            END AS dispatchIncidentId,
            request.SelectedAt AS selectedAt,
            request.SelectedBy AS selectedBy,
            request.CreatedAt AS createdAt,
            request.CreatedBy AS createdBy,
            JSON_QUERY(COALESCE((
                SELECT
                    response.EtaResponseId AS id,
                    response.TeamId AS teamId,
                    team.TeamName AS teamName,
                    response.ResponseStatus AS status,
                    response.DistanceKm AS distanceKm,
                    response.RespondedAt AS respondedAt,
                    response.RespondedBy AS respondedBy
                FROM CC.dbo.DispatchEtaResponses response
                JOIN CC.dbo.DispatchTeams team ON team.TeamId = response.TeamId
                CROSS JOIN access_context response_context
                WHERE response.EtaRequestId = request.EtaRequestId
                  AND
                  (
                      response_context.AccessRole = N'CallCentre'
                      OR response.TeamId = response_context.TeamId
                  )
                ORDER BY
                    CASE response.ResponseStatus
                        WHEN N'Selected' THEN 0
                        WHEN N'Available' THEN 1
                        WHEN N'Unavailable' THEN 2
                        ELSE 3
                    END,
                    response.DistanceKm,
                    team.DisplayOrder,
                    team.TeamName
                FOR JSON PATH
            ), N'[]')) AS responses
        FROM scoped_requests request
        ORDER BY
            CASE WHEN request.EffectiveStatus = N'Open' THEN 0 ELSE 1 END,
            request.CreatedAt DESC,
            request.EtaRequestId DESC
        FOR JSON PATH
    ), N'[]')) AS requests,
    JSON_QUERY((
        SELECT
            (
                SELECT COUNT(*)
                FROM scoped_requests open_request
                WHERE open_request.RequestStatus = N'Open'
            ) AS openCount,
            CASE
                WHEN context.AccessRole = N'DispatchTeam' AND context.TeamIsActive = 1 THEN
                (
                    SELECT COUNT(*)
                    FROM scoped_requests team_request
                    JOIN CC.dbo.DispatchEtaResponses pending_response
                      ON pending_response.EtaRequestId = team_request.EtaRequestId
                     AND pending_response.TeamId = context.TeamId
                     AND pending_response.ResponseStatus = N'Pending'
                    WHERE team_request.RequestStatus = N'Open'
                )
                WHEN context.AccessRole = N'CallCentre' THEN
                (
                    SELECT COUNT(*)
                    FROM scoped_requests call_centre_request
                    WHERE call_centre_request.RequestStatus = N'Open'
                )
                ELSE 0
            END AS actionCount,
            (
                SELECT COUNT(*)
                FROM scoped_requests selected_request
                WHERE selected_request.RequestStatus = N'Selected'
            ) AS selectedCount
        FROM access_context context
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    )) AS summary
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS json;
