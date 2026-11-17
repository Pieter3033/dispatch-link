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

-- SQLPage 0.25-compatible endpoint: cancel an active dispatch without
-- manager approval. Cancellation details are retained in DispatchAuditLog.

-- Capture the actual stage before the update; recovery must not infer it from dates.
SET cancellation_previous_status = (
    SELECT TOP (1) DispatchStatus
    FROM CC.dbo.DispatchIncidents
    WHERE id = TRY_CONVERT(int, :incidentId)
      AND IsDeleted = 0
      AND DispatchStatus NOT IN (N'Closed', N'Cancelled')
      AND EXISTS (SELECT 1 FROM Current_session WHERE session_id = sqlpage.cookie('session'))
);

UPDATE incident
SET DispatchStatus = N'Cancelled',
    UpdatedBy = authenticated_user.Username,
    UpdatedAt = SYSDATETIME()
FROM CC.dbo.DispatchIncidents incident
CROSS APPLY (
    SELECT TOP (1) NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS nvarchar(128)))), N'') AS Username
    FROM Current_session current_session
    WHERE current_session.session_id = sqlpage.cookie('session')
) authenticated_user
WHERE incident.id = TRY_CONVERT(int, :incidentId)
  AND incident.IsDeleted = 0
  AND incident.DispatchStatus NOT IN (N'Closed', N'Cancelled')
  AND incident.DispatchStatus = $cancellation_previous_status
  AND authenticated_user.Username IS NOT NULL
  AND NULLIF(LTRIM(RTRIM(:cancellationReason)), N'') IS NOT NULL;

INSERT INTO CC.dbo.DispatchAuditLog
    (dispatch_id, AuditAction, FieldName, OldValue, NewValue, OldStatus, NewStatus, AuditMessage, AuditUsername, CreatedAt)
SELECT
    incident.id,
    N'Dispatch cancelled',
    N'Dispatch Status',
    $cancellation_previous_status,
    N'Cancelled',
    incident.Status,
    incident.Status,
    NULLIF(LTRIM(RTRIM(:cancellationReason)), N''),
    incident.UpdatedBy,
    incident.UpdatedAt
FROM CC.dbo.DispatchIncidents incident
WHERE incident.id = TRY_CONVERT(int, :incidentId)
  AND incident.IsDeleted = 0
  AND incident.DispatchStatus = N'Cancelled'
  AND $cancellation_previous_status IS NOT NULL
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
        AND audit_entry.AuditAction = N'Dispatch cancelled'
        AND audit_entry.CreatedAt >= incident.UpdatedAt
  );

SELECT
    'json' AS component,
    (
        SELECT
            CAST(CASE
                WHEN NOT EXISTS (
                    SELECT 1 FROM Current_session
                    WHERE session_id = sqlpage.cookie('session')
                ) THEN N'unauthorized'
                WHEN TRY_CONVERT(int, :incidentId) IS NULL
                  OR TRY_CONVERT(int, :incidentId) <= 0 THEN N'validation_error'
                WHEN NULLIF(LTRIM(RTRIM(:cancellationReason)), N'') IS NULL
                    THEN N'missing_cancellation_reason'
                WHEN NOT EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE id = TRY_CONVERT(int, :incidentId)
                      AND IsDeleted = 0
                ) THEN N'not_found'
                WHEN EXISTS (
                    SELECT 1
                    FROM CC.dbo.DispatchAuditLog audit_entry
                    WHERE audit_entry.dispatch_id = TRY_CONVERT(int, :incidentId)
                      AND audit_entry.AuditAction = N'Dispatch cancelled'
                      AND audit_entry.AuditUsername = (
                          SELECT TOP (1) NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS nvarchar(128)))), N'')
                          FROM Current_session current_session
                          WHERE current_session.session_id = sqlpage.cookie('session')
                      )
                      AND audit_entry.AuditMessage = NULLIF(LTRIM(RTRIM(:cancellationReason)), N'')
                      AND audit_entry.CreatedAt >= DATEADD(second, -10, SYSDATETIME())
                ) THEN N'ok'
                WHEN EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE id = TRY_CONVERT(int, :incidentId)
                      AND DispatchStatus IN (N'Closed', N'Cancelled')
                ) THEN N'locked_status'
                ELSE N'cancel_failed'
            END AS nvarchar(40)) AS status,
            TRY_CONVERT(int, :incidentId) AS id,
            incident.DispatchStatus AS dispatchStatus,
            CAST(CASE
                WHEN incident.DispatchStatus = N'Cancelled'
                    THEN N'Dispatch cancelled and retained in the audit history.'
                ELSE NULL
            END AS nvarchar(500)) AS message
        FROM (VALUES (1)) seed(value)
        OUTER APPLY (
            SELECT TOP (1) DispatchStatus
            FROM CC.dbo.DispatchIncidents
            WHERE id = TRY_CONVERT(int, :incidentId)
        ) incident
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
