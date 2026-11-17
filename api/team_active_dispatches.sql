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

-- SQLPage JSON endpoint: active or completed dispatches for the signed-in team.
-- A dispatch remains active until it has both a team OB number and a team incident report.
-- The Private & Confidential rollout snapshot below hides only the active dispatches
-- present on 2026-10-01. It does not change their records or future dispatches.
-- For every ground team, hide active dispatches dated before 2026-10-22.
-- This is a fixed display cutoff, not a rolling daily filter; completed history is unchanged.

WITH archived_dispatch_ids AS
(
    SELECT archived.id
    FROM (VALUES
        (35), (37), (41), (42), (44), (45), (46), (52), (54), (59),
        (105), (106), (111), (117), (124), (125), (126), (127), (128), (131),
        (132), (135), (136), (142), (148), (149), (152), (153), (154), (156),
        (157), (159), (160), (161), (162), (163), (173), (174), (177), (180),
        (181), (184), (185), (186), (187), (188), (189), (190), (194), (196),
        (197), (201), (203), (204), (207), (211), (216), (217), (218), (219),
        (221), (224), (232), (238), (240), (251), (254), (256), (257), (260),
        (261), (262), (264), (270), (274), (280), (282), (285)
    ) archived(id)
),
request_params AS
(
    SELECT
        CASE WHEN LOWER(COALESCE($view, N'')) = N'completed' THEN 1 ELSE 0 END AS ShowCompleted,
        LOWER(NULLIF(LTRIM(RTRIM(COALESCE($search, N''))), N'')) AS SearchText,
        CASE WHEN TRY_CONVERT(int, $page) BETWEEN 1 AND 100000 THEN TRY_CONVERT(int, $page) ELSE 1 END AS PageNumber
),
session_identity AS
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
        CASE
            WHEN identity_row.username IS NOT NULL
             AND TRY_CONVERT(int, profile.Usertype) = 11
             AND team.TeamId IS NOT NULL
                THEN N'DispatchTeam'
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
            user_info.DispatchTeamCode
        FROM Jobcard.dbo.User_info user_info
        WHERE LOWER(LTRIM(RTRIM(CAST(user_info.Username AS nvarchar(200))))) = LOWER(identity_row.username)
        ORDER BY user_info.Seqno
    ) profile
    LEFT JOIN CC.dbo.DispatchTeams team
        ON TRY_CONVERT(int, profile.Usertype) = 11
       AND LOWER(LTRIM(RTRIM(team.TeamCode))) = LOWER(LTRIM(RTRIM(profile.DispatchTeamCode)))
),
team_dispatches AS
(
    SELECT
        incident.id,
        incident.IncidentNumber,
        COALESCE(
            eta_request.RequestNumber,
            incident.RiskEventReference,
            CASE
                WHEN LEFT(incident.SaveRequestId, 12) = N'ETA_REQUEST_'
                 AND TRY_CONVERT(bigint, SUBSTRING(incident.SaveRequestId, 13, 30)) IS NOT NULL
                    THEN N'ETA-' + RIGHT(
                        REPLICATE(N'0', 12)
                        + CONVERT(nvarchar(20), TRY_CONVERT(bigint, SUBSTRING(incident.SaveRequestId, 13, 30))),
                        12
                    )
                ELSE NULL
            END
        ) AS RequestNumber,
        COALESCE(NULLIF(LTRIM(RTRIM(incident.RegNo)), N''), eta_request.Registration) AS Registration,
        COALESCE(NULLIF(LTRIM(RTRIM(incident.Event)), N''), eta_request.ShortDescription) AS IncidentType,
        incident.DispatchStatus,
        incident.ClosureApprovalStatus,
        incident.EventDateTime,
        incident.DispatchDateTime,
        incident.StandDownDateTime,
        incident.GeoLocation,
        COALESCE(incident.Latitude, eta_request.Latitude) AS Latitude,
        COALESCE(incident.Longitude, eta_request.Longitude) AS Longitude,
        COALESCE(eta_request.SelectedDistanceKm, TRY_CONVERT(decimal(8,1), incident.ETA)) AS SelectedDistanceKm,
        COALESCE(eta_request.SelectedAt, incident.CreatedAt) AS SelectedAt,
        incident.OBNumber,
        incident.UpdatedAt,
        CAST(CASE WHEN context.TeamCode = N'PanC'
                       AND EXISTS (SELECT 1 FROM archived_dispatch_ids archived WHERE archived.id = incident.id)
            THEN 1 ELSE 0 END AS bit) AS IsTeamArchived,
        CAST(CASE WHEN NULLIF(LTRIM(RTRIM(incident.OBNumber)), N'') IS NOT NULL
            THEN 1 ELSE 0 END AS bit) AS HasTeamOB,
        CAST(CASE WHEN EXISTS
        (
            SELECT 1
            FROM CC.dbo.DispatchIncidentFiles submitted_report
            WHERE submitted_report.dispatch_id = incident.id
              AND submitted_report.IsDeleted = 0
              AND submitted_report.FileType = N'TeamIncidentReport'
        ) THEN 1 ELSE 0 END AS bit) AS HasTeamReport,
        CAST(CASE WHEN NULLIF(LTRIM(RTRIM(incident.OBNumber)), N'') IS NOT NULL
                       AND EXISTS
                       (
                           SELECT 1
                           FROM CC.dbo.DispatchIncidentFiles completion_report
                           WHERE completion_report.dispatch_id = incident.id
                             AND completion_report.IsDeleted = 0
                             AND completion_report.FileType = N'TeamIncidentReport'
                       )
            THEN 1 ELSE 0 END AS bit) AS IsTeamCompleted
    FROM access_context context
    INNER JOIN CC.dbo.DispatchIncidents incident
       ON incident.IsDeleted = 0
       AND LOWER(LTRIM(RTRIM(incident.DispatchTeam))) = LOWER(LTRIM(RTRIM(context.TeamName)))
    LEFT JOIN CC.dbo.DispatchEtaRequests eta_request
        ON eta_request.DispatchIncidentId = incident.id
       AND eta_request.SelectedTeamId = context.TeamId
       AND eta_request.RequestStatus = N'Selected'
    WHERE context.AccessRole = N'DispatchTeam'
      AND context.TeamIsActive = 1
),
visible_dispatches AS
(
    SELECT dispatch.*
    FROM team_dispatches dispatch
    WHERE dispatch.IsTeamArchived = 0
      AND (dispatch.IsTeamCompleted = 1
           OR COALESCE(dispatch.DispatchDateTime, dispatch.SelectedAt) >= CONVERT(datetime2, '20261022', 112))
),
filtered_dispatches AS
(
    SELECT dispatch.*
    FROM visible_dispatches dispatch
    CROSS JOIN request_params params
    WHERE dispatch.IsTeamCompleted = params.ShowCompleted
      AND (params.SearchText IS NULL
           OR LOWER(COALESCE(dispatch.Registration, N'')) LIKE N'%' + params.SearchText + N'%'
           OR LOWER(COALESCE(dispatch.OBNumber, N'')) LIKE N'%' + params.SearchText + N'%')
)
SELECT (
SELECT
    JSON_QUERY((
        SELECT
            context.username,
            context.UserType AS userType,
            context.AccessRole AS role,
            context.TeamId AS teamId,
            context.TeamCode AS teamCode,
            context.TeamName AS teamName,
            context.TeamIsActive AS teamIsActive
        FROM access_context context
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    )) AS context,
    JSON_QUERY((
        SELECT
            (SELECT COUNT(*) FROM visible_dispatches WHERE IsTeamCompleted = 0) AS activeCount,
            (SELECT COUNT(*) FROM visible_dispatches WHERE IsTeamCompleted = 1) AS completedCount,
            (SELECT COUNT(*) FROM filtered_dispatches) AS filteredCount,
            params.PageNumber AS pageNumber,
            10 AS pageSize
        FROM request_params params
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    )) AS summary,
    JSON_QUERY(COALESCE((
        SELECT
            dispatch.id,
            dispatch.IncidentNumber AS incidentNumber,
            dispatch.RequestNumber AS etaRequestNumber,
            dispatch.Registration AS registration,
            dispatch.IncidentType AS incidentType,
            dispatch.DispatchStatus AS dispatchStatus,
            dispatch.ClosureApprovalStatus AS closureApprovalStatus,
            dispatch.EventDateTime AS eventDateTime,
            dispatch.DispatchDateTime AS dispatchDateTime,
            dispatch.StandDownDateTime AS standDownDateTime,
            dispatch.GeoLocation AS geoLocation,
            dispatch.Latitude AS latitude,
            dispatch.Longitude AS longitude,
            dispatch.SelectedDistanceKm AS acceptedDistanceKm,
            dispatch.SelectedAt AS acceptedAt,
            dispatch.OBNumber AS obNumber,
            dispatch.UpdatedAt AS updatedAt,
            JSON_QUERY(COALESCE((
                SELECT TOP (1)
                    report.id,
                    report.OriginalFileName AS originalFileName,
                    report.MimeType AS mimeType,
                    report.UploadedAt AS uploadedAt,
                    report.UploadedBy AS uploadedBy,
                    CASE
                        WHEN LEFT(REPLACE(report.FilePath, '\', '/'), 1) = '/'
                            THEN REPLACE(report.FilePath, '\', '/')
                        ELSE '/' + REPLACE(report.FilePath, '\', '/')
                    END AS downloadUrl
                FROM CC.dbo.DispatchIncidentFiles report
                WHERE report.dispatch_id = dispatch.id
                  AND report.IsDeleted = 0
                  AND report.FileType = N'TeamIncidentReport'
                ORDER BY report.UploadedAt DESC, report.id DESC
                FOR JSON PATH
            ), N'[]')) AS reports
        FROM filtered_dispatches dispatch
        ORDER BY COALESCE(dispatch.DispatchDateTime, dispatch.SelectedAt, dispatch.UpdatedAt) DESC,
                 dispatch.id DESC
        OFFSET ((SELECT PageNumber FROM request_params) - 1) * 10 ROWS
        FETCH NEXT 10 ROWS ONLY
        FOR JSON PATH
    ), N'[]')) AS dispatches
FROM access_context context
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS json;
