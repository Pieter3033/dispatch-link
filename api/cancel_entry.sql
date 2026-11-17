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

-- SQLPage endpoint: soft-cancel an unused draft entry without schema or procedure changes.

UPDATE CC.dbo.DispatchIncidents
SET
    IsDeleted = 1,
    DeletedAt = SYSDATETIME(),
    DeletedBy = COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    UpdatedAt = SYSDATETIME(),
    UpdatedBy = COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage')
WHERE id = TRY_CONVERT(INT, :incidentId)
  AND IsDeleted = 0
  AND Status = N'Draft'
  AND DispatchStatus NOT IN (N'Closed', N'Cancelled')
  AND EXISTS
  (
      SELECT 1
      FROM Current_session
      WHERE session_id = sqlpage.cookie('session')
  );

INSERT INTO CC.dbo.DispatchAuditLog
    (dispatch_id, AuditAction, OldStatus, NewStatus, AuditMessage, AuditUsername, CreatedAt)
SELECT
    incident.id,
    N'Entry cancelled',
    incident.Status,
    incident.Status,
    N'Draft entry cancelled and removed from active use.',
    incident.DeletedBy,
    SYSDATETIME()
FROM CC.dbo.DispatchIncidents incident
WHERE incident.id = TRY_CONVERT(INT, :incidentId)
  AND incident.IsDeleted = 1
  AND incident.DeletedAt >= DATEADD(SECOND, -5, SYSDATETIME())
  AND incident.DeletedBy = COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage')
  AND NOT EXISTS
  (
      SELECT 1
      FROM CC.dbo.DispatchAuditLog audit_entry
      WHERE audit_entry.dispatch_id = incident.id
        AND audit_entry.AuditAction = N'Entry cancelled'
        AND audit_entry.CreatedAt >= incident.DeletedAt
  );

SELECT 'json' AS component,
(
    SELECT
        CAST(CASE
            WHEN NOT EXISTS
            (
                SELECT 1
                FROM Current_session
                WHERE session_id = sqlpage.cookie('session')
            ) THEN N'unauthorized'
            WHEN TRY_CONVERT(INT, :incidentId) IS NULL
              OR TRY_CONVERT(INT, :incidentId) <= 0 THEN N'validation_error'
            WHEN EXISTS
            (
                SELECT 1
                FROM CC.dbo.DispatchIncidents incident
                WHERE incident.id = TRY_CONVERT(INT, :incidentId)
                  AND incident.IsDeleted = 1
                  AND incident.DeletedAt >= DATEADD(SECOND, -5, SYSDATETIME())
                  AND incident.DeletedBy = COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage')
            ) THEN N'ok'
            WHEN EXISTS
            (
                SELECT 1
                FROM CC.dbo.DispatchIncidents
                WHERE id = TRY_CONVERT(INT, :incidentId)
                  AND IsDeleted = 0
                  AND
                  (
                      Status <> N'Draft'
                      OR DispatchStatus IN (N'Closed', N'Cancelled')
                  )
            ) THEN N'locked_status'
            WHEN NOT EXISTS
            (
                SELECT 1
                FROM CC.dbo.DispatchIncidents
                WHERE id = TRY_CONVERT(INT, :incidentId)
                  AND IsDeleted = 0
            ) THEN N'not_found'
            ELSE N'cancel_failed'
        END AS NVARCHAR(40)) AS status,
        TRY_CONVERT(INT, :incidentId) AS id
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS contents;
