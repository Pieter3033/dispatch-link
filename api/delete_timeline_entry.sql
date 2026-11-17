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

-- SQLPage 0.25-compatible soft-delete endpoint for timeline entries.

UPDATE timeline_entry
SET
    IsDeleted = 1,
    DeletedAt = SYSDATETIME(),
    DeletedBy = COALESCE(NULLIF((
        SELECT TOP (1) CAST(Username AS nvarchar(128))
        FROM Current_session
        WHERE session_id = sqlpage.cookie('session')
    ), ''), 'SQLPage'),
    UpdatedAt = SYSDATETIME(),
    UpdatedBy = COALESCE(NULLIF((
        SELECT TOP (1) CAST(Username AS nvarchar(128))
        FROM Current_session
        WHERE session_id = sqlpage.cookie('session')
    ), ''), 'SQLPage')
FROM CC.dbo.DispatchIncidentTimeline timeline_entry
INNER JOIN CC.dbo.DispatchIncidents incident ON incident.id = timeline_entry.DispatchID
WHERE timeline_entry.TimelineEntryID = TRY_CONVERT(int, :timelineEntryId)
  AND timeline_entry.DispatchID = TRY_CONVERT(int, :incidentId)
  AND timeline_entry.IsDeleted = 0
  AND incident.IsDeleted = 0
  AND incident.Status IN ('Draft', 'Rejected', 'PendingApproval')
  AND incident.DispatchStatus NOT IN ('Closed', 'Cancelled')
  AND EXISTS (
      SELECT 1 FROM Current_session
      WHERE session_id = sqlpage.cookie('session')
  );

INSERT INTO CC.dbo.DispatchAuditLog
(
    dispatch_id,
    AuditAction,
    FieldName,
    OldValue,
    OldStatus,
    NewStatus,
    AuditMessage,
    AuditUsername,
    CreatedAt
)
SELECT
    incident.id,
    N'Timeline event deleted',
    N'Incident Timeline',
    CONVERT(nvarchar(16), timeline_entry.EventDateTime, 126)
        + N' | ' + timeline_entry.EventType
        + N' | ' + timeline_entry.EntryText,
    incident.Status,
    incident.Status,
    N'Incident timeline event deleted.',
    COALESCE(NULLIF((
        SELECT TOP (1) CAST(Username AS nvarchar(128))
        FROM Current_session
        WHERE session_id = sqlpage.cookie('session')
    ), ''), 'SQLPage'),
    SYSDATETIME()
FROM CC.dbo.DispatchIncidentTimeline timeline_entry
INNER JOIN CC.dbo.DispatchIncidents incident ON incident.id = timeline_entry.DispatchID
WHERE timeline_entry.TimelineEntryID = TRY_CONVERT(int, :timelineEntryId)
  AND timeline_entry.DispatchID = TRY_CONVERT(int, :incidentId)
  AND timeline_entry.IsDeleted = 1
  AND timeline_entry.DeletedAt >= DATEADD(second, -5, SYSDATETIME())
  AND NOT EXISTS
  (
      SELECT 1
      FROM CC.dbo.DispatchAuditLog audit_entry
      WHERE audit_entry.dispatch_id = incident.id
        AND audit_entry.AuditAction = N'Timeline event deleted'
        AND audit_entry.FieldName = N'Incident Timeline'
        AND audit_entry.CreatedAt >= timeline_entry.DeletedAt
  )
  AND EXISTS (
      SELECT 1 FROM Current_session
      WHERE session_id = sqlpage.cookie('session')
  );

SELECT
    'json' AS component,
    (
        SELECT
            CAST(CASE
                WHEN NOT EXISTS (
                    SELECT 1 FROM Current_session
                    WHERE session_id = sqlpage.cookie('session')
                ) THEN 'unauthorized'
                WHEN TRY_CONVERT(int, :incidentId) IS NULL
                  OR TRY_CONVERT(int, :timelineEntryId) IS NULL THEN 'validation_error'
                WHEN NOT EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE id = TRY_CONVERT(int, :incidentId) AND IsDeleted = 0
                ) THEN 'not_found'
                WHEN EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidentTimeline
                    WHERE TimelineEntryID = TRY_CONVERT(int, :timelineEntryId)
                      AND DispatchID = TRY_CONVERT(int, :incidentId)
                      AND IsDeleted = 0
                ) THEN 'delete_failed'
                ELSE 'ok'
            END AS nvarchar(40)) AS status
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
