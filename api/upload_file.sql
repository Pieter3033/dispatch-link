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

-- SQLPage 0.25-compatible history report upload endpoint for the rebuilt table.

INSERT INTO CC.dbo.DispatchIncidentFiles
(
    dispatch_id,
    FileType,
    OriginalFileName,
    StoredFileName,
    FilePath,
    MimeType,
    Bytes,
    UploadedAt,
    UploadedBy,
    CreatedBy,
    UpdatedBy
)
SELECT
    incident.id,
    :fileType,
    sqlpage.uploaded_file_name('file'),
    sqlpage.uploaded_file_name('file'),
    sqlpage.persist_uploaded_file(
        'file',
        'dispatch_link/uploads/files',
        'pdf,xlsx,xls,csv'
    ),
    sqlpage.uploaded_file_mime_type('file'),
    NULL,
    SYSDATETIME(),
    COALESCE(NULLIF((
        SELECT TOP (1) CAST(Username AS nvarchar(128))
        FROM Current_session
        WHERE session_id = sqlpage.cookie('session')
    ), ''), 'SQLPage'),
    COALESCE(NULLIF((
        SELECT TOP (1) CAST(Username AS nvarchar(128))
        FROM Current_session
        WHERE session_id = sqlpage.cookie('session')
    ), ''), 'SQLPage'),
    COALESCE(NULLIF((
        SELECT TOP (1) CAST(Username AS nvarchar(128))
        FROM Current_session
        WHERE session_id = sqlpage.cookie('session')
    ), ''), 'SQLPage')
FROM CC.dbo.DispatchIncidents incident
WHERE incident.id = TRY_CONVERT(int, :incidentId)
  AND incident.IsDeleted = 0
  AND incident.Status IN ('Draft', 'Rejected', 'PendingApproval')
  AND incident.DispatchStatus NOT IN ('Closed', 'Cancelled')
  AND :fileType IN ('HistoryExcel', 'HistoryPdf')
  AND NULLIF(sqlpage.uploaded_file_name('file'), '') IS NOT NULL
  AND
  (
      (:fileType = 'HistoryPdf'
       AND LOWER(sqlpage.uploaded_file_name('file')) LIKE '%.pdf')
      OR
      (:fileType = 'HistoryExcel'
       AND
       (
           LOWER(sqlpage.uploaded_file_name('file')) LIKE '%.xlsx'
           OR LOWER(sqlpage.uploaded_file_name('file')) LIKE '%.xls'
           OR LOWER(sqlpage.uploaded_file_name('file')) LIKE '%.csv'
       ))
  )
  AND EXISTS
  (
      SELECT 1
      FROM Current_session
      WHERE session_id = sqlpage.cookie('session')
  );

INSERT INTO CC.dbo.DispatchAuditLog
(
    dispatch_id,
    AuditAction,
    FieldName,
    NewValue,
    OldStatus,
    NewStatus,
    AuditMessage,
    AuditUsername,
    CreatedAt
)
SELECT
    incident.id,
    N'File uploaded',
    CASE WHEN :fileType = 'HistoryPdf' THEN N'History PDF' ELSE N'History Excel' END,
    sqlpage.uploaded_file_name('file'),
    incident.Status,
    incident.Status,
    N'Uploaded ' + sqlpage.uploaded_file_name('file') + N'.',
    COALESCE(NULLIF((
        SELECT TOP (1) CAST(Username AS nvarchar(128))
        FROM Current_session
        WHERE session_id = sqlpage.cookie('session')
    ), ''), 'SQLPage'),
    SYSDATETIME()
FROM CC.dbo.DispatchIncidents incident
WHERE incident.id = TRY_CONVERT(int, :incidentId)
  AND incident.IsDeleted = 0
  AND incident.Status IN ('Draft', 'Rejected', 'PendingApproval')
  AND incident.DispatchStatus NOT IN ('Closed', 'Cancelled')
  AND :fileType IN ('HistoryExcel', 'HistoryPdf')
  AND NULLIF(sqlpage.uploaded_file_name('file'), '') IS NOT NULL
  AND
  (
      (:fileType = 'HistoryPdf'
       AND LOWER(sqlpage.uploaded_file_name('file')) LIKE '%.pdf')
      OR
      (:fileType = 'HistoryExcel'
       AND
       (
           LOWER(sqlpage.uploaded_file_name('file')) LIKE '%.xlsx'
           OR LOWER(sqlpage.uploaded_file_name('file')) LIKE '%.xls'
           OR LOWER(sqlpage.uploaded_file_name('file')) LIKE '%.csv'
       ))
  )
  AND EXISTS
  (
      SELECT 1
      FROM Current_session
      WHERE session_id = sqlpage.cookie('session')
  );

SELECT
    'json' AS component,
    (
        SELECT
            CAST(CASE
                WHEN NOT EXISTS (
                    SELECT 1 FROM Current_session
                    WHERE session_id = sqlpage.cookie('session')
                ) THEN 'unauthorized'
                WHEN TRY_CONVERT(int, :incidentId) IS NULL THEN 'validation_error'
                WHEN NOT EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE id = TRY_CONVERT(int, :incidentId)
                      AND IsDeleted = 0
                ) THEN 'not_found'
                WHEN NOT EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE id = TRY_CONVERT(int, :incidentId)
                      AND IsDeleted = 0
                      AND Status IN ('Draft', 'Rejected', 'PendingApproval')
                      AND DispatchStatus NOT IN ('Closed', 'Cancelled')
                ) THEN 'locked_status'
                WHEN :fileType NOT IN ('HistoryExcel', 'HistoryPdf')
                    THEN 'invalid_file_type'
                WHEN NULLIF(sqlpage.uploaded_file_name('file'), '') IS NULL
                    THEN 'missing_file'
                WHEN :fileType = 'HistoryPdf'
                     AND LOWER(sqlpage.uploaded_file_name('file')) NOT LIKE '%.pdf'
                    THEN 'invalid_file_type'
                WHEN :fileType = 'HistoryExcel'
                     AND LOWER(sqlpage.uploaded_file_name('file')) NOT LIKE '%.xlsx'
                     AND LOWER(sqlpage.uploaded_file_name('file')) NOT LIKE '%.xls'
                     AND LOWER(sqlpage.uploaded_file_name('file')) NOT LIKE '%.csv'
                    THEN 'invalid_file_type'
                ELSE 'ok'
            END AS nvarchar(40)) AS status,
            CAST(CASE
                WHEN :fileType = 'HistoryPdf'
                     AND LOWER(COALESCE(sqlpage.uploaded_file_name('file'), '')) NOT LIKE '%.pdf'
                    THEN 'History PDF must be a PDF file.'
                WHEN :fileType = 'HistoryExcel'
                     AND LOWER(COALESCE(sqlpage.uploaded_file_name('file'), '')) NOT LIKE '%.xlsx'
                     AND LOWER(COALESCE(sqlpage.uploaded_file_name('file'), '')) NOT LIKE '%.xls'
                     AND LOWER(COALESCE(sqlpage.uploaded_file_name('file'), '')) NOT LIKE '%.csv'
                    THEN 'History Excel must be an XLSX, XLS, or CSV file.'
                WHEN NULLIF(sqlpage.uploaded_file_name('file'), '') IS NULL
                    THEN 'Select a file before uploading.'
                ELSE NULL
            END AS nvarchar(500)) AS message
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
