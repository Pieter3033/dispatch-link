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

-- SQLPage 0.25-compatible endpoint: let a dispatch team update its own
-- assigned, active dispatch. SQLPage parses each statement independently.

UPDATE incident
SET
    OBNumber = NULLIF(LTRIM(RTRIM(:obNumber)), ''),
    StandDownDateTime = TRY_CONVERT(datetime2(0), REPLACE(NULLIF(LTRIM(RTRIM(:standDownDateTime)), ''), 'T', ' '), 120),
    UpdatedBy = (
        SELECT TOP (1) CAST(current_session.Username AS nvarchar(128))
        FROM Current_session current_session
        WHERE current_session.session_id = sqlpage.cookie('session')
    ),
    UpdatedAt = SYSDATETIME()
FROM CC.dbo.DispatchIncidents incident
WHERE incident.id = TRY_CONVERT(int, NULLIF(LTRIM(RTRIM(:incidentId)), ''))
  AND incident.IsDeleted = 0
  AND COALESCE(incident.DispatchStatus, '') NOT IN ('Closed', 'Cancelled')
  AND NOT
  (
      NULLIF(LTRIM(RTRIM(incident.OBNumber)), '') IS NOT NULL
      AND EXISTS
      (
          SELECT 1 FROM CC.dbo.DispatchIncidentFiles team_report
          WHERE team_report.dispatch_id = incident.id
            AND team_report.IsDeleted = 0
            AND team_report.FileType = N'TeamIncidentReport'
      )
  )
  AND LEN(LTRIM(RTRIM(COALESCE(:obNumber, '')))) <= 100
  AND (
      NULLIF(LTRIM(RTRIM(:standDownDateTime)), '') IS NULL
      OR TRY_CONVERT(datetime2(0), REPLACE(NULLIF(LTRIM(RTRIM(:standDownDateTime)), ''), 'T', ' '), 120) IS NOT NULL
  )
  AND (
      NULLIF(LTRIM(RTRIM(:standDownDateTime)), '') IS NULL
      OR incident.DispatchDateTime IS NULL
      OR TRY_CONVERT(datetime2(0), REPLACE(NULLIF(LTRIM(RTRIM(:standDownDateTime)), ''), 'T', ' '), 120) >= incident.DispatchDateTime
  )
  AND EXISTS
  (
      SELECT 1
      FROM Current_session current_session
      INNER JOIN Jobcard.dbo.User_info user_info
          ON LOWER(LTRIM(RTRIM(CAST(user_info.Username AS nvarchar(200))))) = LOWER(LTRIM(RTRIM(CAST(current_session.Username AS nvarchar(200)))))
         AND TRY_CONVERT(int, user_info.Usertype) = 11
      INNER JOIN CC.dbo.DispatchTeams team
          ON team.IsActive = 1
         AND LOWER(LTRIM(RTRIM(team.TeamCode))) = LOWER(LTRIM(RTRIM(user_info.DispatchTeamCode)))
      WHERE current_session.session_id = sqlpage.cookie('session')
        AND LOWER(LTRIM(RTRIM(incident.DispatchTeam))) = LOWER(LTRIM(RTRIM(team.TeamName)))
  );

SELECT
    'json' AS component,
    (
        SELECT
            CAST(CASE
                WHEN NOT EXISTS (SELECT 1 FROM Current_session WHERE session_id = sqlpage.cookie('session'))
                    THEN 'unauthorized'
                WHEN NOT EXISTS
                (
                    SELECT 1
                    FROM Current_session current_session
                    INNER JOIN Jobcard.dbo.User_info user_info
                        ON LOWER(LTRIM(RTRIM(CAST(user_info.Username AS nvarchar(200))))) = LOWER(LTRIM(RTRIM(CAST(current_session.Username AS nvarchar(200)))))
                       AND TRY_CONVERT(int, user_info.Usertype) = 11
                    INNER JOIN CC.dbo.DispatchTeams team
                        ON team.IsActive = 1
                       AND LOWER(LTRIM(RTRIM(team.TeamCode))) = LOWER(LTRIM(RTRIM(user_info.DispatchTeamCode)))
                    WHERE current_session.session_id = sqlpage.cookie('session')
                ) THEN 'forbidden'
                WHEN TRY_CONVERT(int, NULLIF(LTRIM(RTRIM(:incidentId)), '')) IS NULL
                  OR TRY_CONVERT(int, NULLIF(LTRIM(RTRIM(:incidentId)), '')) <= 0
                    THEN 'validation_error'
                WHEN LEN(LTRIM(RTRIM(COALESCE(:obNumber, '')))) > 100
                    THEN 'invalid_ob_number'
                WHEN NULLIF(LTRIM(RTRIM(:standDownDateTime)), '') IS NOT NULL
                 AND TRY_CONVERT(datetime2(0), REPLACE(NULLIF(LTRIM(RTRIM(:standDownDateTime)), ''), 'T', ' '), 120) IS NULL
                    THEN 'invalid_stand_down_time'
                WHEN NOT EXISTS
                (
                    SELECT 1
                    FROM CC.dbo.DispatchIncidents incident
                    INNER JOIN Jobcard.dbo.User_info user_info
                        ON TRY_CONVERT(int, user_info.Usertype) = 11
                    INNER JOIN Current_session current_session
                        ON LOWER(LTRIM(RTRIM(CAST(current_session.Username AS nvarchar(200))))) = LOWER(LTRIM(RTRIM(CAST(user_info.Username AS nvarchar(200)))))
                    INNER JOIN CC.dbo.DispatchTeams team
                        ON team.IsActive = 1
                       AND LOWER(LTRIM(RTRIM(team.TeamCode))) = LOWER(LTRIM(RTRIM(user_info.DispatchTeamCode)))
                    WHERE current_session.session_id = sqlpage.cookie('session')
                      AND incident.id = TRY_CONVERT(int, NULLIF(LTRIM(RTRIM(:incidentId)), ''))
                      AND incident.IsDeleted = 0
                      AND LOWER(LTRIM(RTRIM(incident.DispatchTeam))) = LOWER(LTRIM(RTRIM(team.TeamName)))
                ) THEN 'not_assigned'
                WHEN EXISTS
                (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE id = TRY_CONVERT(int, NULLIF(LTRIM(RTRIM(:incidentId)), ''))
                      AND DispatchStatus IN ('Closed', 'Cancelled')
                ) THEN 'locked_status'
                WHEN EXISTS
                (
                    SELECT 1
                    FROM CC.dbo.DispatchIncidents completed_incident
                    WHERE completed_incident.id = TRY_CONVERT(int, NULLIF(LTRIM(RTRIM(:incidentId)), ''))
                      AND NULLIF(LTRIM(RTRIM(completed_incident.OBNumber)), '') IS NOT NULL
                      AND EXISTS
                      (
                          SELECT 1 FROM CC.dbo.DispatchIncidentFiles team_report
                          WHERE team_report.dispatch_id = completed_incident.id
                            AND team_report.IsDeleted = 0
                            AND team_report.FileType = N'TeamIncidentReport'
                      )
                      AND
                      (
                          COALESCE(LTRIM(RTRIM(completed_incident.OBNumber)), '')
                              <> COALESCE(LTRIM(RTRIM(:obNumber)), '')
                          OR COALESCE(CONVERT(nvarchar(19), completed_incident.StandDownDateTime, 126), '')
                              <> COALESCE(CONVERT(nvarchar(19), TRY_CONVERT(datetime2(0), REPLACE(NULLIF(LTRIM(RTRIM(:standDownDateTime)), ''), 'T', ' '), 120), 126), '')
                      )
                ) THEN 'completed_dispatch'
                WHEN EXISTS
                (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE id = TRY_CONVERT(int, NULLIF(LTRIM(RTRIM(:incidentId)), ''))
                      AND DispatchDateTime IS NOT NULL
                      AND TRY_CONVERT(datetime2(0), REPLACE(NULLIF(LTRIM(RTRIM(:standDownDateTime)), ''), 'T', ' '), 120) < DispatchDateTime
                ) THEN 'invalid_stand_down_order'
                ELSE 'ok'
            END AS nvarchar(40)) AS status,
            TRY_CONVERT(int, NULLIF(LTRIM(RTRIM(:incidentId)), '')) AS id,
            CAST(CASE
                WHEN LEN(LTRIM(RTRIM(COALESCE(:obNumber, '')))) > 100 THEN 'The OB number cannot exceed 100 characters.'
                WHEN NULLIF(LTRIM(RTRIM(:standDownDateTime)), '') IS NOT NULL
                 AND TRY_CONVERT(datetime2(0), REPLACE(NULLIF(LTRIM(RTRIM(:standDownDateTime)), ''), 'T', ' '), 120) IS NULL
                    THEN 'Enter a valid stand down date and time.'
                WHEN EXISTS
                (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE id = TRY_CONVERT(int, NULLIF(LTRIM(RTRIM(:incidentId)), ''))
                      AND DispatchDateTime IS NOT NULL
                      AND TRY_CONVERT(datetime2(0), REPLACE(NULLIF(LTRIM(RTRIM(:standDownDateTime)), ''), 'T', ' '), 120) < DispatchDateTime
                ) THEN 'Stand down time cannot be before dispatch time.'
                ELSE NULL
            END AS nvarchar(500)) AS message,
            NULLIF(LTRIM(RTRIM(:obNumber)), '') AS obNumber,
            TRY_CONVERT(datetime2(0), REPLACE(NULLIF(LTRIM(RTRIM(:standDownDateTime)), ''), 'T', ' '), 120) AS standDownDateTime
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
