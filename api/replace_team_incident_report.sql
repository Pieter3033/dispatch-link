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

-- SQLPage 0.25-compatible endpoint: replace the latest incident report for
-- the signed-in dispatch team's assigned dispatch.

UPDATE current_report
SET
    OriginalFileName = sqlpage.uploaded_file_name('file'),
    StoredFileName = sqlpage.uploaded_file_name('file'),
    FilePath = sqlpage.persist_uploaded_file('file', 'dispatch_link/uploads/files/team-reports', 'pdf'),
    MimeType = sqlpage.uploaded_file_mime_type('file'),
    Bytes = NULL,
    UploadedAt = SYSDATETIME(),
    UploadedBy = (SELECT TOP (1) CAST(Username AS nvarchar(128)) FROM Current_session WHERE session_id = sqlpage.cookie('session')),
    UpdatedAt = SYSDATETIME(),
    UpdatedBy = (SELECT TOP (1) CAST(Username AS nvarchar(128)) FROM Current_session WHERE session_id = sqlpage.cookie('session'))
FROM CC.dbo.DispatchIncidentFiles current_report
INNER JOIN CC.dbo.DispatchIncidents incident
    ON incident.id = current_report.dispatch_id
WHERE current_report.id =
(
    SELECT TOP (1) latest_report.id
    FROM CC.dbo.DispatchIncidentFiles latest_report
    WHERE latest_report.dispatch_id = incident.id
      AND latest_report.IsDeleted = 0
      AND latest_report.FileType = N'TeamIncidentReport'
    ORDER BY latest_report.UploadedAt DESC, latest_report.id DESC
)
  AND incident.id = TRY_CONVERT(int, NULLIF(LTRIM(RTRIM(:incidentId)), ''))
  AND incident.IsDeleted = 0
  AND NULLIF(LTRIM(RTRIM(sqlpage.uploaded_file_name('file'))), '') IS NOT NULL
  AND LOWER(LTRIM(RTRIM(sqlpage.uploaded_file_name('file')))) LIKE '%.pdf'
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

INSERT INTO CC.dbo.DispatchAuditLog
(
    dispatch_id, AuditAction, FieldName, NewValue, AuditMessage, AuditUsername, CreatedAt
)
SELECT
    incident.id,
    N'File replaced',
    N'Dispatch Team Incident Report',
    sqlpage.uploaded_file_name('file'),
    incident.DispatchTeam + N' replaced the incident report with ' + sqlpage.uploaded_file_name('file') + N'.',
    (SELECT TOP (1) CAST(Username AS nvarchar(128)) FROM Current_session WHERE session_id = sqlpage.cookie('session')),
    SYSDATETIME()
FROM CC.dbo.DispatchIncidents incident
WHERE incident.id = TRY_CONVERT(int, NULLIF(LTRIM(RTRIM(:incidentId)), ''))
  AND EXISTS
  (
      SELECT 1
      FROM CC.dbo.DispatchIncidentFiles saved_report
      WHERE saved_report.dispatch_id = incident.id
        AND saved_report.IsDeleted = 0
        AND saved_report.FileType = N'TeamIncidentReport'
        AND saved_report.OriginalFileName = sqlpage.uploaded_file_name('file')
        AND saved_report.UploadedAt >= DATEADD(minute, -1, SYSDATETIME())
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
                WHEN NULLIF(LTRIM(RTRIM(sqlpage.uploaded_file_name('file'))), '') IS NULL
                    THEN 'missing_file'
                WHEN LOWER(LTRIM(RTRIM(sqlpage.uploaded_file_name('file')))) NOT LIKE '%.pdf'
                    THEN 'invalid_file_type'
                WHEN NOT EXISTS
                (
                    SELECT 1
                    FROM CC.dbo.DispatchIncidentFiles saved_report
                    WHERE saved_report.dispatch_id = TRY_CONVERT(int, NULLIF(LTRIM(RTRIM(:incidentId)), ''))
                      AND saved_report.IsDeleted = 0
                      AND saved_report.FileType = N'TeamIncidentReport'
                      AND saved_report.OriginalFileName = sqlpage.uploaded_file_name('file')
                      AND saved_report.UploadedAt >= DATEADD(minute, -1, SYSDATETIME())
                ) THEN 'db_error'
                ELSE 'ok'
            END AS nvarchar(40)) AS status,
            TRY_CONVERT(int, NULLIF(LTRIM(RTRIM(:incidentId)), '')) AS id,
            CAST(CASE
                WHEN NULLIF(LTRIM(RTRIM(sqlpage.uploaded_file_name('file'))), '') IS NULL
                    THEN 'Select a PDF incident report before saving.'
                WHEN LOWER(LTRIM(RTRIM(sqlpage.uploaded_file_name('file')))) NOT LIKE '%.pdf'
                    THEN 'The dispatch team incident report must be a PDF file.'
                ELSE NULL
            END AS nvarchar(500)) AS message,
            sqlpage.uploaded_file_name('file') AS originalFileName
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
