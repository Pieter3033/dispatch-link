SELECT 'redirect' AS component, '/signin.sql?error' AS link
WHERE (SELECT session_id FROM Current_session WHERE session_id = sqlpage.cookie('session')) IS NULL;

INSERT INTO CC.dbo.DispatchIncidentPhotos (
    dispatch_id,
    PhotoCategory,
    OriginalFileName,
    StoredFileName,
    FilePath,
    MimeType,
    bytes,
    Notes,
    UploadedBy,
    UploadedAt,
    ValidationStatus,
    CreatedBy,
    CreatedAt
)
SELECT
    TRY_CAST(:incidentId AS INT),
    :category,
    sqlpage.uploaded_file_name('photo'),
    sqlpage.uploaded_file_name('photo'),
    sqlpage.persist_uploaded_file('photo', 'storage/dispatch-uploads/photos', 'jpg,jpeg,png,webp'),
    sqlpage.uploaded_file_mime_type('photo'),
    sqlpage.uploaded_file_size('photo'),
    :caption,
    COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    SYSDATETIME(),
    'Valid',
    COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    SYSDATETIME()
WHERE EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:incidentId AS INT) AND ISNULL(isdeleted, 0) = 0
);

INSERT INTO CC.dbo.DispatchAuditLog (dispatch_id, AuditAction, AuditMessage, AuditUsername, CreatedAt)
SELECT
    TRY_CAST(:incidentId AS INT),
    'Photo uploaded',
    'Category: ' + COALESCE(:category, ''),
    COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    SYSDATETIME()
WHERE EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:incidentId AS INT) AND ISNULL(isdeleted, 0) = 0
);

SELECT 'redirect' AS component, '/dispatch_link/dispatch_link_view.sql?id=' + CAST(TRY_CAST(:incidentId AS INT) AS NVARCHAR(20)) AS link;
