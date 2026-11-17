SELECT 'redirect' AS component, '/signin.sql?error' AS link
WHERE (SELECT session_id FROM Current_session WHERE session_id = sqlpage.cookie('session')) IS NULL;

INSERT INTO CC.dbo.DispatchIncidentFiles (
    dispatch_id,
    FileType,
    OriginalFileName,
    StoredFileName,
    filepath,
    mimetype,
    bytes,
    UploadedBy,
    UploadedAt,
    CreatedBy,
    CreatedAt
)
SELECT
    TRY_CAST(:incidentId AS INT),
    :fileType,
    sqlpage.uploaded_file_name('file'),
    sqlpage.uploaded_file_name('file'),
    sqlpage.persist_uploaded_file('file', 'storage/dispatch-uploads/files', 'pdf,xlsx,xls,csv,jpg,jpeg,png,webp'),
    sqlpage.uploaded_file_mime_type('file'),
    sqlpage.uploaded_file_size('file'),
    COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    SYSDATETIME(),
    COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    SYSDATETIME()
WHERE EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:incidentId AS INT) AND ISNULL(isdeleted, 0) = 0
);

INSERT INTO CC.dbo.DispatchAuditLog (dispatch_id, AuditAction, AuditMessage, AuditUsername, CreatedAt)
SELECT
    TRY_CAST(:incidentId AS INT),
    'File uploaded',
    'Type: ' + COALESCE(:fileType, '') + '; ' + COALESCE(:description, ''),
    COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    SYSDATETIME()
WHERE EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:incidentId AS INT) AND ISNULL(isdeleted, 0) = 0
);

SELECT 'redirect' AS component, '/dispatch_link/dispatch_link_view.sql?id=' + CAST(TRY_CAST(:incidentId AS INT) AS NVARCHAR(20)) AS link;
