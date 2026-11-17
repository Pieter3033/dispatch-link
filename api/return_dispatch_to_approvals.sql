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

-- Return an approved report to the editable approval queue (SQLPage 0.25).
-- The existing trg_DispatchIncidents_Audit records the workflow and comment
-- changes atomically with this update. Preserve submission and Zoho fields.
-- Repeat auth per statement because SQLPage prepares them independently.

SET return_approval_started_at = (SELECT CONVERT(varchar(23), SYSDATETIME(), 126));

WITH admin_user AS (
    SELECT TOP (1) NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS nvarchar(128)))), N'') AS Username
    FROM Current_session current_session
    CROSS APPLY (SELECT NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS nvarchar(200)))), N'') AS username) session_raw
    CROSS APPLY (SELECT RIGHT(REPLACE(session_raw.username, '/', '\'), CHARINDEX('\', REVERSE(REPLACE(session_raw.username, '/', '\')) + '\') - 1) AS login_name) session_login
    CROSS JOIN Jobcard.dbo.User_info user_info
    CROSS APPLY (SELECT NULLIF(LTRIM(RTRIM(CAST(user_info.Username AS nvarchar(200)))), N'') AS username) user_raw
    CROSS APPLY (SELECT RIGHT(REPLACE(user_raw.username, '/', '\'), CHARINDEX('\', REVERSE(REPLACE(user_raw.username, '/', '\')) + '\') - 1) AS login_name) user_login
    WHERE current_session.session_id = sqlpage.cookie('session')
      AND TRY_CONVERT(int, user_info.Usertype) = 7
      AND LOWER(LEFT(user_login.login_name, CHARINDEX('@', user_login.login_name + '@') - 1))
          = LOWER(LEFT(session_login.login_name, CHARINDEX('@', session_login.login_name + '@') - 1))
)
UPDATE incident
SET Status = N'PendingApproval',
    ApprovedAt = NULL,
    ApprovedBy = NULL,
    ApprovalComments = NULL,
    UpdatedBy = admin_user.Username,
    UpdatedAt = SYSDATETIME()
FROM CC.dbo.DispatchIncidents incident
CROSS JOIN admin_user
WHERE incident.id = TRY_CONVERT(int, :incidentId)
  AND incident.IsDeleted = 0
  AND incident.Status = N'Approved'
  AND incident.DispatchStatus NOT IN (N'Closed', N'Cancelled')
  AND incident.UpdatedAt = TRY_CONVERT(datetime2(3), :expectedUpdatedAt, 126);

WITH admin_user AS (
    SELECT TOP (1) NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS nvarchar(128)))), N'') AS Username
    FROM Current_session current_session
    CROSS APPLY (SELECT NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS nvarchar(200)))), N'') AS username) session_raw
    CROSS APPLY (SELECT RIGHT(REPLACE(session_raw.username, '/', '\'), CHARINDEX('\', REVERSE(REPLACE(session_raw.username, '/', '\')) + '\') - 1) AS login_name) session_login
    CROSS JOIN Jobcard.dbo.User_info user_info
    CROSS APPLY (SELECT NULLIF(LTRIM(RTRIM(CAST(user_info.Username AS nvarchar(200)))), N'') AS username) user_raw
    CROSS APPLY (SELECT RIGHT(REPLACE(user_raw.username, '/', '\'), CHARINDEX('\', REVERSE(REPLACE(user_raw.username, '/', '\')) + '\') - 1) AS login_name) user_login
    WHERE current_session.session_id = sqlpage.cookie('session')
      AND TRY_CONVERT(int, user_info.Usertype) = 7
      AND LOWER(LEFT(user_login.login_name, CHARINDEX('@', user_login.login_name + '@') - 1))
          = LOWER(LEFT(session_login.login_name, CHARINDEX('@', session_login.login_name + '@') - 1))
)
SELECT 'json' AS component, (SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM Current_session WHERE session_id = sqlpage.cookie('session')) THEN N'unauthorized'
    WHEN NOT EXISTS (SELECT 1 FROM admin_user) THEN N'forbidden'
    WHEN TRY_CONVERT(int, :incidentId) IS NULL OR TRY_CONVERT(int, :incidentId) <= 0
      OR TRY_CONVERT(datetime2(3), :expectedUpdatedAt, 126) IS NULL THEN N'validation_error'
    WHEN NOT EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = TRY_CONVERT(int, :incidentId) AND IsDeleted = 0) THEN N'not_found'
    WHEN EXISTS (
        SELECT 1 FROM CC.dbo.DispatchIncidents incident
        CROSS JOIN admin_user
        WHERE incident.id = TRY_CONVERT(int, :incidentId)
          AND incident.IsDeleted = 0
          AND incident.Status = N'PendingApproval'
          AND incident.DispatchStatus NOT IN (N'Closed', N'Cancelled')
          AND incident.ApprovedAt IS NULL AND incident.ApprovedBy IS NULL AND incident.ApprovalComments IS NULL
          AND incident.UpdatedBy = admin_user.Username
          AND incident.UpdatedAt >= TRY_CONVERT(datetime2(7), $return_approval_started_at, 126)
          AND EXISTS (
              SELECT 1 FROM CC.dbo.DispatchAuditLog audit_entry
              WHERE audit_entry.dispatch_id = incident.id
                AND audit_entry.FieldName = N'Status'
                AND audit_entry.OldValue = N'Approved' AND audit_entry.NewValue = N'PendingApproval'
                AND audit_entry.AuditUsername = admin_user.Username
                AND audit_entry.CreatedAt >= TRY_CONVERT(datetime2(7), $return_approval_started_at, 126)
          )
    ) THEN N'ok'
    WHEN EXISTS (
        SELECT 1 FROM CC.dbo.DispatchIncidents
        WHERE id = TRY_CONVERT(int, :incidentId) AND IsDeleted = 0
          AND Status = N'Approved' AND DispatchStatus NOT IN (N'Closed', N'Cancelled')
          AND UpdatedAt <> TRY_CONVERT(datetime2(3), :expectedUpdatedAt, 126)
    ) THEN N'conflict'
    ELSE N'locked_status'
END AS status,
TRY_CONVERT(int, :incidentId) AS id
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS contents;
