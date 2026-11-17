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

-- SQLPage 0.25-compatible endpoint: recover a cancelled dispatch.
-- Access is restricted server-side to Dispatch Link administrators (Usertype 7).

UPDATE incident
SET DispatchStatus = CASE
        WHEN incident.DispatchStatus <> N'Cancelled' THEN incident.DispatchStatus
        WHEN previous_status.OldValue IN (N'Dispatch Requested', N'Dispatched', N'On Scene', N'Recovered', N'Stood Down')
            THEN previous_status.OldValue
        WHEN incident.StandDownDateTime IS NOT NULL THEN N'Stood Down'
        WHEN incident.VehicleRecovered = N'Yes'
          OR incident.LoadRecovered = N'Yes'
          OR incident.TrailersRecovered = N'Yes' THEN N'Recovered'
        WHEN incident.DispatchDateTime IS NOT NULL THEN N'Dispatched'
        ELSE N'Dispatch Requested'
    END,
    IsDeleted = 0,
    DeletedAt = NULL,
    DeletedBy = NULL,
    UpdatedBy = authenticated_user.Username,
    UpdatedAt = SYSDATETIME()
FROM CC.dbo.DispatchIncidents incident
CROSS APPLY (
    SELECT TOP (1) NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS nvarchar(128)))), N'') AS Username
    FROM Current_session current_session
    WHERE current_session.session_id = sqlpage.cookie('session')
) authenticated_user
OUTER APPLY (
    SELECT TOP (1) audit_entry.OldValue
    FROM CC.dbo.DispatchAuditLog audit_entry
    WHERE audit_entry.dispatch_id = incident.id
      AND audit_entry.FieldName = N'Dispatch Status'
      AND audit_entry.NewValue = N'Cancelled'
    ORDER BY audit_entry.CreatedAt DESC, audit_entry.id DESC
) previous_status
WHERE incident.id = TRY_CONVERT(int, :incidentId)
  AND (
      (incident.IsDeleted = 0 AND incident.DispatchStatus = N'Cancelled')
      OR (
          incident.IsDeleted = 1
          AND EXISTS (
              SELECT 1
              FROM CC.dbo.DispatchAuditLog entry_audit
              WHERE entry_audit.dispatch_id = incident.id
                AND entry_audit.AuditAction = N'Entry cancelled'
          )
      )
  )
  AND EXISTS (
      SELECT 1
      FROM Jobcard.dbo.User_info user_info
      CROSS APPLY (SELECT NULLIF(LTRIM(RTRIM(CAST(user_info.Username AS nvarchar(200)))), '') AS username) user_raw
      CROSS APPLY (SELECT RIGHT(REPLACE(user_raw.username, '/', '\'), CHARINDEX('\', REVERSE(REPLACE(user_raw.username, '/', '\')) + '\') - 1) AS login_name) user_login
      CROSS APPLY (SELECT RIGHT(REPLACE(authenticated_user.Username, '/', '\'), CHARINDEX('\', REVERSE(REPLACE(authenticated_user.Username, '/', '\')) + '\') - 1) AS login_name) session_login
      WHERE TRY_CONVERT(int, user_info.Usertype) = 7
        AND LOWER(LEFT(user_login.login_name, CHARINDEX('@', user_login.login_name + '@') - 1))
            = LOWER(LEFT(session_login.login_name, CHARINDEX('@', session_login.login_name + '@') - 1))
  );

INSERT INTO CC.dbo.DispatchAuditLog
    (dispatch_id, AuditAction, FieldName, OldValue, NewValue, OldStatus, NewStatus, AuditMessage, AuditUsername, CreatedAt)
SELECT
    incident.id,
    N'Dispatch recovered',
    N'Dispatch Status',
    N'Cancelled',
    incident.DispatchStatus,
    N'Cancelled',
    incident.DispatchStatus,
    N'Cancelled dispatch recovered by an administrator.',
    incident.UpdatedBy,
    incident.UpdatedAt
FROM CC.dbo.DispatchIncidents incident
WHERE incident.id = TRY_CONVERT(int, :incidentId)
  AND incident.IsDeleted = 0
  AND incident.DispatchStatus <> N'Cancelled'
  AND incident.UpdatedBy = (
      SELECT TOP (1) NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS nvarchar(128)))), N'')
      FROM Current_session current_session
      WHERE current_session.session_id = sqlpage.cookie('session')
  )
  AND incident.UpdatedAt >= DATEADD(second, -10, SYSDATETIME())
  AND NOT EXISTS (
      SELECT 1
      FROM CC.dbo.DispatchAuditLog audit_entry
      WHERE audit_entry.dispatch_id = incident.id
        AND audit_entry.AuditAction = N'Dispatch recovered'
        AND audit_entry.CreatedAt >= incident.UpdatedAt
  );

SELECT 'json' AS component,
(
    SELECT
        CAST(CASE
            WHEN NOT EXISTS (
                SELECT 1 FROM Current_session
                WHERE session_id = sqlpage.cookie('session')
            ) THEN N'unauthorized'
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
            ) THEN N'forbidden'
            WHEN TRY_CONVERT(int, :incidentId) IS NULL OR TRY_CONVERT(int, :incidentId) <= 0 THEN N'validation_error'
            WHEN NOT EXISTS (
                SELECT 1 FROM CC.dbo.DispatchIncidents
                WHERE id = TRY_CONVERT(int, :incidentId)
            ) THEN N'not_found'
            WHEN EXISTS (
                SELECT 1 FROM CC.dbo.DispatchAuditLog
                WHERE dispatch_id = TRY_CONVERT(int, :incidentId)
                  AND AuditAction = N'Dispatch recovered'
                  AND AuditUsername = (
                      SELECT TOP (1) NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS nvarchar(128)))), N'')
                      FROM Current_session current_session
                      WHERE current_session.session_id = sqlpage.cookie('session')
                  )
                  AND CreatedAt >= DATEADD(second, -10, SYSDATETIME())
            ) THEN N'ok'
            ELSE N'locked_status'
        END AS nvarchar(40)) AS status,
        TRY_CONVERT(int, :incidentId) AS id,
        incident.DispatchStatus AS dispatchStatus,
        CAST(CASE WHEN incident.DispatchStatus <> N'Cancelled' THEN N'Dispatch recovered.' ELSE NULL END AS nvarchar(500)) AS message
    FROM (VALUES (1)) seed(value)
    OUTER APPLY (
        SELECT TOP (1) DispatchStatus
        FROM CC.dbo.DispatchIncidents
        WHERE id = TRY_CONVERT(int, :incidentId)
    ) incident
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS contents;
