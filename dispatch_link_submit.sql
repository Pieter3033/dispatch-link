SELECT 'redirect' AS component, '/signin.sql?error' AS link
WHERE (SELECT session_id FROM Current_session WHERE session_id = sqlpage.cookie('session')) IS NULL;

UPDATE CC.dbo.DispatchIncidents
SET
    Status = 'PendingApproval',
    SubmittedBy = COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    SubmittedAt = SYSDATETIME(),
    UpdatedBy = COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    UpdatedAt = SYSDATETIME(),
    zoho_update = 0
WHERE id = TRY_CAST(:incidentId AS INT)
  AND ISNULL(isdeleted, 0) = 0
  AND Status IN ('Draft', 'Rejected')
  AND NULLIF(RiskEventReference, '') IS NOT NULL
  AND EventDateTime IS NOT NULL
  AND NULLIF(Event, '') IS NOT NULL
  AND NULLIF(UnitId, '') IS NOT NULL
  AND NULLIF(RegNo, '') IS NOT NULL
  AND NULLIF(DriverName, '') IS NOT NULL
  AND NULLIF(DispatchReason, '') IS NOT NULL
  AND EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidentPhotos WHERE dispatch_id = TRY_CAST(:incidentId AS INT) AND PhotoCategory = 'UnitSidePhoto')
  AND EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidentPhotos WHERE dispatch_id = TRY_CAST(:incidentId AS INT) AND PhotoCategory = 'UnitFrontPhoto')
  AND EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidentPhotos WHERE dispatch_id = TRY_CAST(:incidentId AS INT) AND PhotoCategory = 'UnitBackPhoto')
  AND EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidentPhotos WHERE dispatch_id = TRY_CAST(:incidentId AS INT) AND PhotoCategory = 'UnitLicenseDisc')
  AND EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidentPhotos WHERE dispatch_id = TRY_CAST(:incidentId AS INT) AND PhotoCategory = 'UnitMileage')
  AND EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidentPhotos WHERE dispatch_id = TRY_CAST(:incidentId AS INT) AND PhotoCategory = 'DieselTank');

INSERT INTO CC.dbo.DispatchApprovals (
    dispatch_id,
    ApprovalStatus,
    CreatedBy,
    CreatedAt
)
SELECT
    TRY_CAST(:incidentId AS INT),
    'Pending',
    COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    SYSDATETIME()
WHERE EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:incidentId AS INT) AND Status = 'PendingApproval' AND ISNULL(isdeleted, 0) = 0
);

INSERT INTO CC.dbo.DispatchNotifications (
    dispatch_id,
    NotificationType,
    RecipientName,
    RecipientContact,
    MessageSubject,
    MessageBody,
    Status,
    AttemptCount,
    CreatedAt,
    CreatedBy
)
SELECT
    TRY_CAST(:incidentId AS INT),
    'ApprovalRequest',
    approver.Username,
    approver.Username,
    'Dispatch approval request',
    'Dispatch incident requires approval',
    'Pending',
    0,
    SYSDATETIME(),
    COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage')
FROM (VALUES ('Approver1'), ('Approver2'), ('Approver3')) AS approver(Username)
WHERE EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:incidentId AS INT) AND Status = 'PendingApproval' AND ISNULL(isdeleted, 0) = 0
);

INSERT INTO CC.dbo.DispatchAuditLog (dispatch_id, AuditAction, AuditMessage, AuditUsername, CreatedAt)
SELECT
    TRY_CAST(:incidentId AS INT),
    'Submitted for approval',
    'Incident passed SQLPage required-field and baseline-photo validation',
    COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    SYSDATETIME()
WHERE EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:incidentId AS INT) AND Status = 'PendingApproval' AND ISNULL(isdeleted, 0) = 0
);

SELECT 'redirect' AS component, '/dispatch_link/dispatch_link_view.sql?id=' + CAST(TRY_CAST(:incidentId AS INT) AS NVARCHAR(20)) AS link;
