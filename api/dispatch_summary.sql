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

-- SQLPage JSON endpoint: lightweight Dispatch Link sidebar summary.

WITH auth AS
(
    SELECT TOP (1) CAST(Username AS nvarchar(128)) AS username
    FROM Current_session
    WHERE session_id = sqlpage.cookie('session')
)
SELECT
    COALESCE(SUM(CASE
        WHEN incident.DispatchStatus NOT IN (N'Closed', N'Cancelled')
         AND incident.Status NOT IN (N'PendingApproval', N'Approved', N'Rejected')
            THEN 1 ELSE 0
    END), 0) AS draftCount,
    COALESCE(SUM(CASE
        WHEN incident.Status IN (N'PendingApproval', N'Rejected')
         AND incident.DispatchStatus NOT IN (N'Closed', N'Cancelled')
            THEN 1 ELSE 0
    END), 0) AS pendingCount,
    COALESCE(SUM(CASE WHEN incident.Status = N'Approved' AND incident.DispatchStatus <> N'Cancelled' THEN 1 ELSE 0 END), 0) AS approvedCount,
    COALESCE((
        SELECT COUNT(*)
        FROM CC.dbo.DispatchIncidents cancelled_incident
        WHERE (cancelled_incident.IsDeleted = 0 AND cancelled_incident.DispatchStatus = N'Cancelled')
           OR (
                cancelled_incident.IsDeleted = 1
                AND EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchAuditLog entry_audit
                    WHERE entry_audit.dispatch_id = cancelled_incident.id
                      AND entry_audit.AuditAction = N'Entry cancelled'
                )
           )
    ), 0) AS cancelledDispatchCount
FROM CC.dbo.DispatchIncidents incident
WHERE incident.IsDeleted = 0
  AND EXISTS (SELECT 1 FROM auth)
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
