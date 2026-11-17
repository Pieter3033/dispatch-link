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

-- SQLPage 0.25-compatible endpoint: upload a PDF incident report for the
-- signed-in dispatch team's assigned dispatch. Reports remain uploadable
-- after operational closure because the report itself completes the team's task.

INSERT INTO CC.dbo.DispatchIncidentFiles
(
    dispatch_id, FileType, OriginalFileName, StoredFileName, FilePath, MimeType,
    Bytes, UploadedAt, UploadedBy, CreatedBy, UpdatedBy
)
SELECT
    incident.id,
    N'TeamIncidentReport',
    sqlpage.uploaded_file_name('file'),
    sqlpage.uploaded_file_name('file'),
    sqlpage.persist_uploaded_file('file', 'dispatch_link/uploads/files/team-reports', 'pdf'),
    sqlpage.uploaded_file_mime_type('file'),
    NULL,
    SYSDATETIME(),
    (SELECT TOP (1) CAST(Username AS nvarchar(128)) FROM Current_session WHERE session_id = sqlpage.cookie('session')),
    (SELECT TOP (1) CAST(Username AS nvarchar(128)) FROM Current_session WHERE session_id = sqlpage.cookie('session')),
    (SELECT TOP (1) CAST(Username AS nvarchar(128)) FROM Current_session WHERE session_id = sqlpage.cookie('session'))
FROM CC.dbo.DispatchIncidents incident
WHERE incident.id = TRY_CONVERT(int, NULLIF(LTRIM(RTRIM(:incidentId)), ''))
  AND incident.IsDeleted = 0
  AND NULLIF(LTRIM(RTRIM(sqlpage.uploaded_file_name('file'))), '') IS NOT NULL
  AND LOWER(LTRIM(RTRIM(sqlpage.uploaded_file_name('file')))) LIKE '%.pdf'
  AND NOT EXISTS
  (
      SELECT 1
      FROM CC.dbo.DispatchIncidentFiles existing_report WITH (UPDLOCK, HOLDLOCK)
      WHERE existing_report.dispatch_id = incident.id
        AND existing_report.IsDeleted = 0
        AND existing_report.FileType = N'TeamIncidentReport'
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

INSERT INTO CC.dbo.DispatchAuditLog
(
    dispatch_id, AuditAction, FieldName, NewValue, AuditMessage, AuditUsername, CreatedAt
)
SELECT
    incident.id,
    N'File uploaded',
    N'Dispatch Team Incident Report',
    sqlpage.uploaded_file_name('file'),
    incident.DispatchTeam + N' uploaded incident report ' + sqlpage.uploaded_file_name('file') + N'.',
    (SELECT TOP (1) CAST(Username AS nvarchar(128)) FROM Current_session WHERE session_id = sqlpage.cookie('session')),
    SYSDATETIME()
FROM CC.dbo.DispatchIncidents incident
WHERE incident.id = TRY_CONVERT(int, NULLIF(LTRIM(RTRIM(:incidentId)), ''))
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
                      AND LOWER(LTRIM(RTRIM(saved_report.UploadedBy))) = LOWER(LTRIM(RTRIM((
                          SELECT TOP (1) CAST(Username AS nvarchar(128))
                          FROM Current_session
                          WHERE session_id = sqlpage.cookie('session')
                      ))))
                ) THEN 'db_error'
                ELSE 'ok'
            END AS nvarchar(40)) AS status,
            TRY_CONVERT(int, NULLIF(LTRIM(RTRIM(:incidentId)), '')) AS id,
            CAST(CASE
                WHEN NULLIF(LTRIM(RTRIM(sqlpage.uploaded_file_name('file'))), '') IS NULL
                    THEN 'Select a PDF incident report before uploading.'
                WHEN LOWER(LTRIM(RTRIM(sqlpage.uploaded_file_name('file')))) NOT LIKE '%.pdf'
                    THEN 'The dispatch team incident report must be a PDF file.'
                ELSE NULL
            END AS nvarchar(500)) AS message,
            CASE
                WHEN LOWER(LTRIM(RTRIM(COALESCE(sqlpage.uploaded_file_name('file'), '')))) LIKE '%.pdf'
                    THEN sqlpage.uploaded_file_name('file')
            END AS originalFileName
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
