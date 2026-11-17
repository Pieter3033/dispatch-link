SELECT 'redirect' AS component, '/signin.sql?error' AS link
WHERE (SELECT session_id FROM Current_session WHERE session_id = sqlpage.cookie('session')) IS NULL;

UPDATE CC.dbo.DispatchIncidents
SET
    Status = 'Rejected',
    RejectedBy = COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    RejectedAt = SYSDATETIME(),
    RejectionReason = :reason,
    UpdatedBy = COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    UpdatedAt = SYSDATETIME(),
    zoho_update = 0
WHERE id = TRY_CAST(:incidentId AS INT)
  AND ISNULL(isdeleted, 0) = 0
  AND Status = 'PendingApproval'
  AND NULLIF(:reason, '') IS NOT NULL
  AND COALESCE(NULLIF(sqlpage.cookie('username'), ''), '') IN ('Approver1', 'Approver2', 'Approver3', 'cctest');

UPDATE CC.dbo.DispatchApprovals
SET
    ApprovalStatus = 'Rejected',
    RejectedBy = COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    RejectedAt = SYSDATETIME(),
    RejectionReason = :reason
WHERE dispatch_id = TRY_CAST(:incidentId AS INT)
  AND ApprovalStatus = 'Pending';

INSERT INTO CC.dbo.DispatchAuditLog (dispatch_id, AuditAction, AuditMessage, AuditUsername, CreatedAt)
SELECT
    TRY_CAST(:incidentId AS INT),
    'Rejected',
    :reason,
    COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    SYSDATETIME()
WHERE EXISTS (
    SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CAST(:incidentId AS INT) AND Status = 'Rejected' AND ISNULL(isdeleted, 0) = 0
);

SELECT 'redirect' AS component, '/dispatch_link/dispatch_link_view.sql?id=' + CAST(TRY_CAST(:incidentId AS INT) AS NVARCHAR(20)) AS link;
