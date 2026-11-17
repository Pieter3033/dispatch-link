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

-- SQLPage 0.25-compatible rejection endpoint.
-- Keep request values inline because SQLPage prepares statements independently.

UPDATE CC.dbo.DispatchIncidents
SET Status = 'Rejected',
    RejectedBy = COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    RejectedAt = SYSDATETIME(),
    RejectionReason = NULLIF(:rejectionReason, ''),
    UpdatedBy = COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    UpdatedAt = SYSDATETIME(),
    ZohoUpdate = 0
WHERE id = TRY_CONVERT(int, :incidentId)
  AND ISNULL(IsDeleted, 0) = 0
  AND Status = 'PendingApproval'
  AND DispatchStatus NOT IN ('Closed', 'Cancelled')
  AND NULLIF(:rejectionReason, '') IS NOT NULL
  AND EXISTS (
      SELECT 1
      FROM Current_session current_session
      CROSS APPLY (SELECT NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS nvarchar(200)))), '') AS username) session_raw
      CROSS APPLY (SELECT RIGHT(REPLACE(session_raw.username, '/', '\'), CHARINDEX('\', REVERSE(REPLACE(session_raw.username, '/', '\')) + '\') - 1) AS login_name) session_login
      CROSS JOIN Jobcard.dbo.User_info user_info
      CROSS APPLY (SELECT NULLIF(LTRIM(RTRIM(CAST(user_info.Username AS nvarchar(200)))), '') AS username) user_raw
      CROSS APPLY (SELECT RIGHT(REPLACE(user_raw.username, '/', '\'), CHARINDEX('\', REVERSE(REPLACE(user_raw.username, '/', '\')) + '\') - 1) AS login_name) user_login
      WHERE current_session.session_id = sqlpage.cookie('session')
        AND TRY_CONVERT(int, user_info.Usertype) = 7
        AND LOWER(LEFT(user_login.login_name, CHARINDEX('@', user_login.login_name + '@') - 1))
            = LOWER(LEFT(session_login.login_name, CHARINDEX('@', session_login.login_name + '@') - 1))
  );

INSERT INTO CC.dbo.DispatchAuditLog
    (dispatch_id, AuditAction, OldStatus, NewStatus, AuditMessage, AuditUsername, CreatedAt)
SELECT incident.id,
       N'Rejected',
       N'PendingApproval',
       N'Rejected',
       NULLIF(:rejectionReason, ''),
       COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
       SYSDATETIME()
FROM CC.dbo.DispatchIncidents incident
WHERE incident.id = TRY_CONVERT(int, :incidentId)
  AND incident.Status = 'Rejected'
  AND incident.RejectedBy = COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage')
  AND incident.RejectedAt >= DATEADD(second, -5, SYSDATETIME())
  AND NOT EXISTS (
      SELECT 1 FROM CC.dbo.DispatchAuditLog audit_entry
      WHERE audit_entry.dispatch_id = incident.id
        AND audit_entry.AuditAction = N'Rejected'
        AND audit_entry.CreatedAt >= incident.RejectedAt
  );

SELECT 'json' AS component,
       (
           SELECT CASE
               WHEN NOT EXISTS (
                   SELECT 1 FROM Current_session
                   WHERE session_id = sqlpage.cookie('session')
               ) THEN 'unauthorized'
               WHEN NOT EXISTS (
                   SELECT 1
                   FROM Current_session current_session
                   CROSS APPLY (SELECT NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS nvarchar(200)))), '') AS username) session_raw
                   CROSS APPLY (SELECT RIGHT(REPLACE(session_raw.username, '/', '\'), CHARINDEX('\', REVERSE(REPLACE(session_raw.username, '/', '\')) + '\') - 1) AS login_name) session_login
                   CROSS JOIN Jobcard.dbo.User_info user_info
                   CROSS APPLY (SELECT NULLIF(LTRIM(RTRIM(CAST(user_info.Username AS nvarchar(200)))), '') AS username) user_raw
                   CROSS APPLY (SELECT RIGHT(REPLACE(user_raw.username, '/', '\'), CHARINDEX('\', REVERSE(REPLACE(user_raw.username, '/', '\')) + '\') - 1) AS login_name) user_login
                   WHERE current_session.session_id = sqlpage.cookie('session')
                     AND TRY_CONVERT(int, user_info.Usertype) = 7
                     AND LOWER(LEFT(user_login.login_name, CHARINDEX('@', user_login.login_name + '@') - 1))
                         = LOWER(LEFT(session_login.login_name, CHARINDEX('@', session_login.login_name + '@') - 1))
               ) THEN 'forbidden'
               WHEN TRY_CONVERT(int, :incidentId) IS NULL THEN 'validation_error'
               WHEN NOT EXISTS (
                   SELECT 1 FROM CC.dbo.DispatchIncidents
                   WHERE id = TRY_CONVERT(int, :incidentId)
                     AND ISNULL(IsDeleted, 0) = 0
               ) THEN 'not_found'
               WHEN NULLIF(:rejectionReason, '') IS NULL THEN 'missing_rejection_reason'
               WHEN EXISTS (
                   SELECT 1 FROM CC.dbo.DispatchAuditLog
                   WHERE dispatch_id = TRY_CONVERT(int, :incidentId)
                     AND AuditAction = N'Rejected'
                     AND AuditUsername = COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage')
                     AND CreatedAt >= DATEADD(second, -5, SYSDATETIME())
               ) THEN 'ok'
               ELSE 'locked_status'
           END AS status,
           TRY_CONVERT(int, :incidentId) AS id
           FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
       ) AS contents;
