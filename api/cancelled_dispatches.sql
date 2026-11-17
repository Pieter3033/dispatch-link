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

-- SQLPage JSON endpoint: list cancelled dispatches for Dispatch Link administrators.

WITH session_identity AS
(
    SELECT TOP (1)
        current_session.Username AS session_username,
        LOWER(LEFT(session_login.login_name, CHARINDEX('@', session_login.login_name + '@') - 1)) AS canonical_username
    FROM Current_session current_session
    CROSS APPLY (SELECT NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS nvarchar(200)))), '') AS username) session_raw
    CROSS APPLY (SELECT RIGHT(REPLACE(session_raw.username, '/', '\'), CHARINDEX('\', REVERSE(REPLACE(session_raw.username, '/', '\')) + '\') - 1) AS login_name) session_login
    WHERE current_session.session_id = sqlpage.cookie('session')
),
admin_auth AS
(
    SELECT TOP (1) session_identity.session_username AS username
    FROM session_identity
    CROSS JOIN Jobcard.dbo.User_info user_info
    CROSS APPLY (SELECT NULLIF(LTRIM(RTRIM(CAST(user_info.Username AS nvarchar(200)))), '') AS username) user_raw
    CROSS APPLY (SELECT RIGHT(REPLACE(user_raw.username, '/', '\'), CHARINDEX('\', REVERSE(REPLACE(user_raw.username, '/', '\')) + '\') - 1) AS login_name) user_login
    WHERE TRY_CONVERT(int, user_info.Usertype) = 7
      AND LOWER(LEFT(user_login.login_name, CHARINDEX('@', user_login.login_name + '@') - 1)) = session_identity.canonical_username
)
SELECT
    CASE
        WHEN NOT EXISTS (SELECT 1 FROM session_identity) THEN N'unauthorized'
        WHEN NOT EXISTS (SELECT 1 FROM admin_auth) THEN N'forbidden'
        ELSE N'ok'
    END AS status,
    JSON_QUERY(COALESCE((
        SELECT
            incident.id,
            incident.IncidentNumber,
            incident.UnitId,
            incident.RegNo,
            incident.Company,
            incident.DispatchTeam,
            incident.Status,
            incident.DispatchStatus,
            CASE WHEN incident.IsDeleted = 1 THEN N'Cancelled entry' ELSE N'Cancelled dispatch' END AS CancellationType,
            cancellation_audit.AuditMessage AS CancellationReason,
            cancellation_audit.CreatedAt AS CancelledAt,
            cancellation_audit.AuditUsername AS CancelledBy,
            COALESCE(
                NULLIF(LTRIM(RTRIM(CONCAT(cancelled_by.Name, ' ', cancelled_by.Surname))), ''),
                cancellation_audit.AuditUsername
            ) AS CancelledByDisplayName,
            incident.CreatedAt,
            incident.UpdatedAt,
            incident.UpdatedBy
        FROM CC.dbo.DispatchIncidents incident
        CROSS JOIN admin_auth
        OUTER APPLY
        (
            SELECT TOP (1) audit_entry.AuditMessage, audit_entry.AuditUsername, audit_entry.CreatedAt
            FROM CC.dbo.DispatchAuditLog audit_entry
            WHERE audit_entry.dispatch_id = incident.id
              AND (
                  audit_entry.AuditAction IN (N'Dispatch cancelled', N'Bulk dispatch cancellation', N'Entry cancelled')
                  OR (audit_entry.FieldName = N'Dispatch Status' AND audit_entry.NewValue = N'Cancelled')
              )
            ORDER BY audit_entry.CreatedAt DESC, audit_entry.id DESC
        ) cancellation_audit
        OUTER APPLY
        (
            SELECT TOP (1) user_info.Name, user_info.Surname
            FROM Jobcard.dbo.User_info user_info
            WHERE LOWER(LTRIM(RTRIM(user_info.Username))) = LOWER(LTRIM(RTRIM(cancellation_audit.AuditUsername)))
        ) cancelled_by
        WHERE (incident.IsDeleted = 0 AND incident.DispatchStatus = N'Cancelled')
           OR (
                incident.IsDeleted = 1
                AND EXISTS (
                    SELECT 1
                    FROM CC.dbo.DispatchAuditLog entry_audit
                    WHERE entry_audit.dispatch_id = incident.id
                      AND entry_audit.AuditAction = N'Entry cancelled'
                )
           )
        ORDER BY COALESCE(cancellation_audit.CreatedAt, incident.UpdatedAt) DESC, incident.id DESC
        FOR JSON PATH
    ), '[]')) AS incidents
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
