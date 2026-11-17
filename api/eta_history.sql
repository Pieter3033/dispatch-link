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

-- SQLPage JSON endpoint: paged, role-scoped historical ETA requests.

WITH request_params AS
(
    SELECT
        NULLIF(LOWER(LTRIM(RTRIM(COALESCE($search, N'')))), N'') AS SearchText,
        CASE WHEN TRY_CONVERT(int, $page) BETWEEN 1 AND 100000 THEN TRY_CONVERT(int, $page) ELSE 1 END AS PageNumber
),
session_identity AS
(
    SELECT
        (SELECT TOP (1) NULLIF(LTRIM(RTRIM(CAST(Username AS nvarchar(128)))), N'')
         FROM Current_session WHERE session_id = sqlpage.cookie('session')) AS username
),
access_context AS
(
    SELECT
        CASE
            WHEN identity_row.username IS NULL THEN N'None'
            WHEN TRY_CONVERT(int, profile.Usertype) = 11 AND team.TeamId IS NOT NULL THEN N'DispatchTeam'
            WHEN TRY_CONVERT(int, profile.Usertype) IN (7, 8, 14)
              OR (TRY_CONVERT(int, profile.Usertype) = 1 AND COALESCE(profile.Helpdesk, 0) = 1)
                THEN N'CallCentre'
            ELSE N'None'
        END AS AccessRole,
        team.TeamId
    FROM session_identity identity_row
    OUTER APPLY
    (
        SELECT TOP (1) user_info.Usertype, user_info.Helpdesk, user_info.DispatchTeamCode
        FROM Jobcard.dbo.User_info user_info
        WHERE LOWER(LTRIM(RTRIM(CAST(user_info.Username AS nvarchar(200))))) = LOWER(identity_row.username)
        ORDER BY user_info.Seqno
    ) profile
    LEFT JOIN CC.dbo.DispatchTeams team
        ON TRY_CONVERT(int, profile.Usertype) = 11
       AND LOWER(LTRIM(RTRIM(team.TeamCode))) = LOWER(LTRIM(RTRIM(profile.DispatchTeamCode)))
),
filtered_history AS
(
    SELECT
        request.EtaRequestId,
        request.RequestNumber,
        request.Latitude,
        request.Longitude,
        request.Registration,
        request.ShortDescription,
        request.RequestStatus,
        request.SelectedTeamId,
        selected_team.TeamName AS SelectedTeamName,
        request.SelectedDistanceKm,
        request.DispatchIncidentId,
        request.CreatedAt,
        ROW_NUMBER() OVER (ORDER BY request.CreatedAt DESC, request.EtaRequestId DESC) AS RowNumber
    FROM CC.dbo.DispatchEtaRequests request
    LEFT JOIN CC.dbo.DispatchTeams selected_team ON selected_team.TeamId = request.SelectedTeamId
    CROSS JOIN access_context context
    CROSS JOIN request_params params
    WHERE request.RequestStatus <> N'Open'
      AND (params.SearchText IS NULL OR CHARINDEX(params.SearchText, LOWER(COALESCE(request.Registration, N''))) > 0)
      AND
      (
          context.AccessRole = N'CallCentre'
          OR
          (
              context.AccessRole = N'DispatchTeam'
              AND EXISTS
              (
                  SELECT 1 FROM CC.dbo.DispatchEtaResponses response_scope
                  WHERE response_scope.EtaRequestId = request.EtaRequestId
                    AND response_scope.TeamId = context.TeamId
              )
          )
      )
)
SELECT (
SELECT
    (SELECT COUNT(*) FROM filtered_history) AS totalCount,
    (SELECT COUNT(*) FROM filtered_history WHERE RowNumber > (params.PageNumber - 1) * 10
       AND RowNumber <= params.PageNumber * 10) AS pageCount,
    params.PageNumber AS page,
    10 AS pageSize,
    JSON_QUERY(COALESCE((
        SELECT
            request.EtaRequestId AS id,
            request.RequestNumber AS requestNumber,
            request.Latitude AS latitude,
            request.Longitude AS longitude,
            request.Registration AS registration,
            request.ShortDescription AS shortDescription,
            request.RequestStatus AS status,
            request.SelectedTeamId AS selectedTeamId,
            request.SelectedTeamName AS selectedTeamName,
            request.SelectedDistanceKm AS selectedDistanceKm,
            CASE WHEN EXISTS
            (
                SELECT 1 FROM CC.dbo.DispatchIncidents incident
                WHERE incident.id = request.DispatchIncidentId AND incident.IsDeleted = 0
            ) THEN request.DispatchIncidentId ELSE NULL END AS dispatchIncidentId,
            request.CreatedAt AS createdAt,
            JSON_QUERY(COALESCE((
                SELECT
                    response.EtaResponseId AS id,
                    response.TeamId AS teamId,
                    team.TeamName AS teamName,
                    response.ResponseStatus AS status,
                    response.DistanceKm AS distanceKm
                FROM CC.dbo.DispatchEtaResponses response
                JOIN CC.dbo.DispatchTeams team ON team.TeamId = response.TeamId
                CROSS JOIN access_context response_context
                WHERE response.EtaRequestId = request.EtaRequestId
                  AND (response_context.AccessRole = N'CallCentre' OR response.TeamId = response_context.TeamId)
                ORDER BY CASE response.ResponseStatus
                    WHEN N'Selected' THEN 0 WHEN N'Available' THEN 1
                    WHEN N'Unavailable' THEN 2 ELSE 3 END,
                    response.DistanceKm, team.DisplayOrder, team.TeamName
                FOR JSON PATH
            ), N'[]')) AS responses
        FROM filtered_history request
        WHERE request.RowNumber > (params.PageNumber - 1) * 10
          AND request.RowNumber <= params.PageNumber * 10
        ORDER BY request.RowNumber
        FOR JSON PATH
    ), N'[]')) AS requests
FROM request_params params
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS json;
