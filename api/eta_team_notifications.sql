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

-- SQLPage read-only endpoint: team-scoped pending ETA IDs for sidebar counts and alerts.

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
)
SELECT
    context.username,
    COALESCE(context.AccessRole, N'None') AS role,
    context.TeamId AS teamId,
    context.TeamCode AS teamCode,
    context.TeamName AS teamName,
    context.TeamIsActive AS teamIsActive,
    CASE
        WHEN context.AccessRole = N'CallCentre' THEN
        (
            SELECT COUNT(*)
            FROM CC.dbo.DispatchEtaRequests request
            WHERE request.RequestStatus = N'Open'
        )
        WHEN context.AccessRole = N'DispatchTeam' AND context.TeamIsActive = 1 THEN
        (
            SELECT COUNT(*)
            FROM CC.dbo.DispatchEtaResponses response
            JOIN CC.dbo.DispatchEtaRequests request ON request.EtaRequestId = response.EtaRequestId
            WHERE response.TeamId = context.TeamId
              AND response.ResponseStatus = N'Pending'
              AND request.RequestStatus = N'Open'
        )
        ELSE 0
    END AS actionCount,
    -- Only this active team's unanswered requests are exposed to its notification UI.
    JSON_QUERY(COALESCE((
        SELECT request.EtaRequestId AS id, request.RequestNumber AS requestNumber
        FROM CC.dbo.DispatchEtaResponses response
        JOIN CC.dbo.DispatchEtaRequests request ON request.EtaRequestId = response.EtaRequestId
        WHERE context.AccessRole = N'DispatchTeam'
          AND context.TeamIsActive = 1
          AND response.TeamId = context.TeamId
          AND response.ResponseStatus = N'Pending'
          AND request.RequestStatus = N'Open'
        ORDER BY request.CreatedAt, request.EtaRequestId
        FOR JSON PATH
    ), N'[]')) AS pendingRequests
FROM access_context context
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
