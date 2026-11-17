-- Generate MSTrack history through the localhost-only read-only connector.
-- SQLPage remains the only public web server.

SELECT 'redirect' AS component, '/signin.sql?error' AS link
WHERE NOT EXISTS (
    SELECT 1
    FROM Current_session
    WHERE session_id = sqlpage.cookie('session')
      AND EXISTS (SELECT 1 FROM Jobcard.dbo.User_info u WHERE u.Username = Current_session.Username AND u.Usertype <> 15)
) AND NOT EXISTS (SELECT reader_user.Username, reader_user.Seqno, reader_user.Name, reader_user.Surname,
        reader_user.Usertype, reader_user.Helpdesk, reader_user.DispatchTeamCode
    FROM Jobcard.dbo.Current_session reader_session
    JOIN Jobcard.dbo.User_info reader_user ON reader_user.Username = reader_session.Username
    WHERE reader_session.session_id = sqlpage.cookie('session') AND reader_user.Usertype = 15);

SELECT 'redirect' AS component, '/dispatch_link/public/completed.html?reportError=invalid' AS link
WHERE TRY_CONVERT(int, $incidentId) IS NULL
   OR TRY_CONVERT(int, $incidentId) <= 0
   OR LOWER(COALESCE(NULLIF(LTRIM(RTRIM($format)), ''), 'json')) NOT IN ('json', 'xls', 'pdf');

SELECT 'redirect' AS component, '/dispatch_link/public/completed.html?reportError=invalid' AS link
WHERE NOT EXISTS (
    SELECT 1
    FROM CC.dbo.DispatchIncidents incident
    WHERE incident.id = TRY_CONVERT(int, $incidentId)
      AND ISNULL(incident.IsDeleted, 0) = 0
);


-- Enforce the Completed page's record scope before running a report generator.
SELECT 'redirect' AS component, '/dispatch_link/public/completed.html?reportError=not-approved' AS link
WHERE EXISTS (SELECT reader_user.Username, reader_user.Seqno, reader_user.Name, reader_user.Surname,
        reader_user.Usertype, reader_user.Helpdesk, reader_user.DispatchTeamCode
    FROM Jobcard.dbo.Current_session reader_session
    JOIN Jobcard.dbo.User_info reader_user ON reader_user.Username = reader_session.Username
    WHERE reader_session.session_id = sqlpage.cookie('session') AND reader_user.Usertype = 15)
  AND NOT EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidents i
      WHERE i.id = TRY_CONVERT(int, $incidentId) AND i.Status = N'Approved' AND i.DispatchStatus <> N'Cancelled' AND i.IsDeleted = 0);

SET incident_id_text = (SELECT CONVERT(nvarchar(20), TRY_CONVERT(int, $incidentId)));
SET report_format = (SELECT LOWER(COALESCE(NULLIF(LTRIM(RTRIM($format)), ''), 'json')));
-- Read dispatch details with SQLPage's active connection. The report generator
-- must not establish a separate Dispatch database connection.
-- These columns store Johannesburg local time; send explicit UTC timestamps.
SET incident_json = (
    SELECT TOP (1)
        incident.id,
        incident.IncidentNumber,
        incident.RegNo,
        CONVERT(varchar(33), DATEADD(hour, -2, incident.EventDateTime), 126) + 'Z' AS EventDateTime,
        CONVERT(varchar(33), DATEADD(hour, -2, incident.DispatchDateTime), 126) + 'Z' AS DispatchDateTime,
        CONVERT(varchar(33), DATEADD(hour, -2, incident.StandDownDateTime), 126) + 'Z' AS StandDownDateTime,
        CONVERT(varchar(33), DATEADD(hour, -2, incident.UpdatedAt), 126) + 'Z' AS UpdatedAt,
        incident.Status,
        incident.DispatchStatus
    FROM CC.dbo.DispatchIncidents incident
    WHERE incident.id = TRY_CONVERT(int, $incidentId)
      AND ISNULL(incident.IsDeleted, 0) = 0
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
);
SET report_url = sqlpage.exec(
    'dispatch_link/tools/runtime/node.exe',
    'dispatch_link/tools/generate_mstrack_history.js',
    $incident_id_text,
    $report_format,
    $incident_json
);

SELECT 'redirect' AS component, $report_url AS link;
