SELECT 'redirect' AS component, '/signin.sql?error' AS link
WHERE (SELECT session_id FROM Current_session WHERE session_id = sqlpage.cookie('session')) IS NULL;

SELECT
    'shell' AS component,
    'Dispatch Link' AS title,
    '/dispatch_link/dispatch_link.sql' AS link,
    'Incident Details' AS description;

SELECT 'button' AS component;
SELECT 'Back to Dispatch Link' AS title, '/dispatch_link/dispatch_link.sql' AS link, 'arrow-left' AS icon, 'secondary' AS color;

SELECT 'title' AS component, IncidentNumber AS contents, 1 AS level
FROM CC.dbo.DispatchIncidents
WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0;

SELECT 'alert' AS component, 'red' AS color, 'Incident not found' AS title, 'The requested incident does not exist or is deleted.' AS description
WHERE NOT EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0
);

SELECT 'card' AS component, 3 AS columns
WHERE EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0
);
SELECT 'Status' AS title, Status AS description, 'flag' AS icon
FROM CC.dbo.DispatchIncidents
WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0;
SELECT 'Risk Event' AS title, RiskEventReference AS description, 'alert-triangle' AS icon
FROM CC.dbo.DispatchIncidents
WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0;
SELECT 'Unit / Reg' AS title, UnitId + ' / ' + RegNo AS description, 'truck' AS icon
FROM CC.dbo.DispatchIncidents
WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0;

SELECT 'table' AS component, 0 AS search, 0 AS sort
WHERE EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0
);
SELECT
    RiskEventReference AS [Risk Event],
    CONVERT(NVARCHAR(19), EventDateTime, 120) AS [Event Time],
    Event,
    UnitId AS [Unit],
    RegNo AS [Reg No],
    Company,
    FleetCode AS [Fleet Code],
    DriverName AS [Driver],
    DriverContactNumber AS [Driver Contact],
    GroundTeamDetails AS [Ground Team],
    DispatchReason AS [Dispatch Reason],
    OperatorNotes AS [Operator Notes],
    ApprovedBy,
    CONVERT(NVARCHAR(19), ApprovedAt, 120) AS [Approved At],
    RejectedBy,
    CONVERT(NVARCHAR(19), RejectedAt, 120) AS [Rejected At],
    RejectionReason AS [Rejection Reason]
FROM CC.dbo.DispatchIncidents
WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0;

SELECT
    'form' AS component,
    'dispatch_link_upload_photo.sql' AS action,
    'post' AS method,
    'Upload Photo' AS title,
    'Upload Photo' AS validate
WHERE EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0
);
SELECT 'incidentId' AS name, 'hidden' AS type, :id AS value
WHERE EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0);
SELECT 'category' AS name, 'Category' AS label, 'select' AS type, 4 AS width, 1 AS required, 'UnitSidePhoto;UnitFrontPhoto;UnitBackPhoto;UnitLicenseDisc;UnitMileage;DieselTank;Damage;Waybill;FleetSheet;StockLoad;Trailer' AS options
WHERE EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0);
SELECT 'caption' AS name, 'Caption' AS label, 'text' AS type, 4 AS width
WHERE EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0);
SELECT 'photo' AS name, 'Photo' AS label, 'file' AS type, 4 AS width, 1 AS required, 'image/*' AS accept
WHERE EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0);

SELECT
    'form' AS component,
    'dispatch_link_upload_file.sql' AS action,
    'post' AS method,
    'Upload Supporting File' AS title,
    'Upload File' AS validate
WHERE EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0
);
SELECT 'incidentId' AS name, 'hidden' AS type, :id AS value
WHERE EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0);
SELECT 'fileType' AS name, 'File Type' AS label, 'select' AS type, 4 AS width, 1 AS required, 'Documents;FleetSheet;Waybill;Other' AS options
WHERE EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0);
SELECT 'description' AS name, 'Description' AS label, 'text' AS type, 4 AS width
WHERE EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0);
SELECT 'file' AS name, 'File' AS label, 'file' AS type, 4 AS width, 1 AS required, '.pdf,.xlsx,.xls,.csv,.jpg,.jpeg,.png,.webp' AS accept
WHERE EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0);

SELECT 'title' AS component, 'Photos' AS contents, 2 AS level
WHERE EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidentPhotos WHERE dispatch_id = TRY_CAST(:id AS INT));
SELECT 'table' AS component, 1 AS search, 1 AS sort
WHERE EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidentPhotos WHERE dispatch_id = TRY_CAST(:id AS INT));
SELECT
    PhotoCategory AS Category,
    Notes AS Caption,
    OriginalFileName AS [File],
    UploadedBy AS [Uploaded By],
    CONVERT(NVARCHAR(19), UploadedAt, 120) AS [Uploaded At],
    ValidationStatus AS [Validation]
FROM CC.dbo.DispatchIncidentPhotos
WHERE dispatch_id = TRY_CAST(:id AS INT)
ORDER BY UploadedAt DESC;

SELECT 'title' AS component, 'Files' AS contents, 2 AS level
WHERE EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidentFiles WHERE dispatch_id = TRY_CAST(:id AS INT));
SELECT 'table' AS component, 1 AS search, 1 AS sort
WHERE EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidentFiles WHERE dispatch_id = TRY_CAST(:id AS INT));
SELECT
    FileType AS [Type],
    OriginalFileName AS [File],
    UploadedBy AS [Uploaded By],
    CONVERT(NVARCHAR(19), UploadedAt, 120) AS [Uploaded At]
FROM CC.dbo.DispatchIncidentFiles
WHERE dispatch_id = TRY_CAST(:id AS INT)
ORDER BY UploadedAt DESC;

SELECT 'title' AS component, 'Workflow' AS contents, 2 AS level
WHERE EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0
);

SELECT
    'form' AS component,
    'dispatch_link_submit.sql' AS action,
    'post' AS method,
    'Submit for Approval' AS validate
WHERE EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents
    WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0 AND Status IN ('Draft', 'Rejected')
);
SELECT 'incidentId' AS name, 'hidden' AS type, :id AS value
WHERE EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents
    WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0 AND Status IN ('Draft', 'Rejected')
);

SELECT
    'form' AS component,
    'dispatch_link_approve.sql' AS action,
    'post' AS method,
    'Approve Dispatch' AS validate
WHERE EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents
    WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0 AND Status = 'PendingApproval'
);
SELECT 'incidentId' AS name, 'hidden' AS type, :id AS value
WHERE EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents
    WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0 AND Status = 'PendingApproval'
);
SELECT 'comments' AS name, 'Approval Comments' AS label, 'textarea' AS type, 12 AS width
WHERE EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents
    WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0 AND Status = 'PendingApproval'
);

SELECT
    'form' AS component,
    'dispatch_link_reject.sql' AS action,
    'post' AS method,
    'Reject Dispatch' AS validate
WHERE EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents
    WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0 AND Status = 'PendingApproval'
);
SELECT 'incidentId' AS name, 'hidden' AS type, :id AS value
WHERE EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents
    WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0 AND Status = 'PendingApproval'
);
SELECT 'reason' AS name, 'Rejection Reason' AS label, 'textarea' AS type, 12 AS width, 1 AS required
WHERE EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents
    WHERE id = TRY_CAST(:id AS INT) AND ISNULL(isdeleted, 0) = 0 AND Status = 'PendingApproval'
);

SELECT 'title' AS component, 'Audit Log' AS contents, 2 AS level
WHERE EXISTS (SELECT 1 FROM CC.dbo.DispatchAuditLog WHERE dispatch_id = TRY_CAST(:id AS INT));
SELECT 'table' AS component, 1 AS search, 1 AS sort
WHERE EXISTS (SELECT 1 FROM CC.dbo.DispatchAuditLog WHERE dispatch_id = TRY_CAST(:id AS INT));
SELECT
    AuditAction AS Action,
    AuditMessage AS Details,
    AuditUsername AS [By],
    CONVERT(NVARCHAR(19), CreatedAt, 120) AS [At]
FROM CC.dbo.DispatchAuditLog
WHERE dispatch_id = TRY_CAST(:id AS INT)
ORDER BY CreatedAt DESC;
