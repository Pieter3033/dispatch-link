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

-- SQLPage 0.25-compatible create/update endpoint for incident timeline entries.

UPDATE timeline_entry
SET
    EventDateTime = TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:eventDateTime, ''), 'T', ' '), 120),
    EventType = NULLIF(:eventType, ''),
    EntryText = NULLIF(:entryText, ''),
    UpdatedAt = SYSDATETIME(),
    UpdatedBy = COALESCE(NULLIF((
        SELECT TOP (1) CAST(Username AS nvarchar(128))
        FROM Current_session
        WHERE session_id = sqlpage.cookie('session')
    ), ''), 'SQLPage')
FROM CC.dbo.DispatchIncidentTimeline timeline_entry
INNER JOIN CC.dbo.DispatchIncidents incident ON incident.id = timeline_entry.DispatchID
WHERE timeline_entry.TimelineEntryID = TRY_CONVERT(int, NULLIF(:timelineEntryId, ''))
  AND timeline_entry.DispatchID = TRY_CONVERT(int, :incidentId)
  AND timeline_entry.IsDeleted = 0
  AND incident.IsDeleted = 0
  AND incident.Status IN ('Draft', 'Rejected', 'PendingApproval')
  AND incident.DispatchStatus NOT IN ('Closed', 'Cancelled')
  AND TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:eventDateTime, ''), 'T', ' '), 120) IS NOT NULL
  AND NULLIF(:eventType, '') IN
      ('Alert', 'Client', 'Dispatch', 'Arrival', 'Search', 'Call', 'Confirmed', 'StandDown', 'Note')
  AND NULLIF(:entryText, '') IS NOT NULL
  AND
  (
      timeline_entry.EventDateTime <> TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:eventDateTime, ''), 'T', ' '), 120)
      OR timeline_entry.EventType <> NULLIF(:eventType, '')
      OR timeline_entry.EntryText <> NULLIF(:entryText, '')
  )
  AND EXISTS (
      SELECT 1 FROM Current_session
      WHERE session_id = sqlpage.cookie('session')
  );

INSERT INTO CC.dbo.DispatchIncidentTimeline
(
    DispatchID, EventDateTime, EventType, EntryText, CreatedBy, UpdatedBy
)
SELECT
    incident.id,
    TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:eventDateTime, ''), 'T', ' '), 120),
    NULLIF(:eventType, ''),
    NULLIF(:entryText, ''),
    COALESCE(NULLIF((
        SELECT TOP (1) CAST(Username AS nvarchar(128))
        FROM Current_session
        WHERE session_id = sqlpage.cookie('session')
    ), ''), 'SQLPage'),
    COALESCE(NULLIF((
        SELECT TOP (1) CAST(Username AS nvarchar(128))
        FROM Current_session
        WHERE session_id = sqlpage.cookie('session')
    ), ''), 'SQLPage')
FROM CC.dbo.DispatchIncidents incident
WHERE NULLIF(:timelineEntryId, '') IS NULL
  AND incident.id = TRY_CONVERT(int, :incidentId)
  AND incident.IsDeleted = 0
  AND incident.Status IN ('Draft', 'Rejected', 'PendingApproval')
  AND incident.DispatchStatus NOT IN ('Closed', 'Cancelled')
  AND TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:eventDateTime, ''), 'T', ' '), 120) IS NOT NULL
  AND NULLIF(:eventType, '') IN
      ('Alert', 'Client', 'Dispatch', 'Arrival', 'Search', 'Call', 'Confirmed', 'StandDown', 'Note')
  AND NULLIF(:entryText, '') IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM Current_session
      WHERE session_id = sqlpage.cookie('session')
  );

INSERT INTO CC.dbo.DispatchAuditLog
(
    dispatch_id,
    AuditAction,
    FieldName,
    NewValue,
    OldStatus,
    NewStatus,
    AuditMessage,
    AuditUsername,
    CreatedAt
)
SELECT
    incident.id,
    CASE WHEN NULLIF(:timelineEntryId, '') IS NULL
         THEN N'Timeline event added'
         ELSE N'Timeline event updated'
    END,
    N'Incident Timeline',
    CONVERT(nvarchar(16), TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:eventDateTime, ''), 'T', ' '), 120), 126)
        + N' | ' + NULLIF(:eventType, '')
        + N' | ' + NULLIF(:entryText, ''),
    incident.Status,
    incident.Status,
    CASE WHEN NULLIF(:timelineEntryId, '') IS NULL
         THEN N'Incident timeline event added.'
         ELSE N'Incident timeline event updated.'
    END,
    COALESCE(NULLIF((
        SELECT TOP (1) CAST(Username AS nvarchar(128))
        FROM Current_session
        WHERE session_id = sqlpage.cookie('session')
    ), ''), 'SQLPage'),
    SYSDATETIME()
FROM CC.dbo.DispatchIncidents incident
WHERE incident.id = TRY_CONVERT(int, :incidentId)
  AND incident.IsDeleted = 0
  AND incident.Status IN ('Draft', 'Rejected', 'PendingApproval')
  AND incident.DispatchStatus NOT IN ('Closed', 'Cancelled')
  AND TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:eventDateTime, ''), 'T', ' '), 120) IS NOT NULL
  AND NULLIF(:eventType, '') IN
      ('Alert', 'Client', 'Dispatch', 'Arrival', 'Search', 'Call', 'Confirmed', 'StandDown', 'Note')
  AND NULLIF(:entryText, '') IS NOT NULL
  AND
  (
      NULLIF(:timelineEntryId, '') IS NULL
      OR EXISTS
      (
          SELECT 1
          FROM CC.dbo.DispatchIncidentTimeline timeline_entry
          WHERE timeline_entry.TimelineEntryID = TRY_CONVERT(int, :timelineEntryId)
            AND timeline_entry.DispatchID = incident.id
            AND timeline_entry.IsDeleted = 0
            AND timeline_entry.UpdatedAt >= DATEADD(second, -5, SYSDATETIME())
            AND NOT EXISTS
            (
                SELECT 1
                FROM CC.dbo.DispatchAuditLog audit_entry
                WHERE audit_entry.dispatch_id = incident.id
                  AND audit_entry.AuditAction = N'Timeline event updated'
                  AND audit_entry.FieldName = N'Incident Timeline'
                  AND audit_entry.CreatedAt >= timeline_entry.UpdatedAt
            )
      )
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
                WHEN TRY_CONVERT(int, :incidentId) IS NULL THEN 'validation_error'
                WHEN NOT EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE id = TRY_CONVERT(int, :incidentId) AND IsDeleted = 0
                ) THEN 'not_found'
                WHEN NOT EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE id = TRY_CONVERT(int, :incidentId)
                      AND IsDeleted = 0
                      AND Status IN ('Draft', 'Rejected', 'PendingApproval')
                      AND DispatchStatus NOT IN ('Closed', 'Cancelled')
                ) THEN 'locked_status'
                WHEN TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:eventDateTime, ''), 'T', ' '), 120) IS NULL THEN 'validation_error'
                WHEN NULLIF(:eventType, '') NOT IN
                    ('Alert', 'Client', 'Dispatch', 'Arrival', 'Search', 'Call', 'Confirmed', 'StandDown', 'Note')
                    THEN 'validation_error'
                WHEN NULLIF(:entryText, '') IS NULL THEN 'validation_error'
                WHEN NULLIF(:timelineEntryId, '') IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidentTimeline
                    WHERE TimelineEntryID = TRY_CONVERT(int, :timelineEntryId)
                      AND DispatchID = TRY_CONVERT(int, :incidentId)
                      AND IsDeleted = 0
                ) THEN 'timeline_entry_not_found'
                ELSE 'ok'
            END AS nvarchar(40)) AS status,
            CAST(CASE
                WHEN TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:eventDateTime, ''), 'T', ' '), 120) IS NULL
                    THEN 'Timeline date and time are required and must be valid.'
                WHEN NULLIF(:eventType, '') NOT IN
                    ('Alert', 'Client', 'Dispatch', 'Arrival', 'Search', 'Call', 'Confirmed', 'StandDown', 'Note')
                    THEN 'Select a valid timeline icon/event.'
                WHEN NULLIF(:entryText, '') IS NULL THEN 'Timeline description is required.'
                ELSE NULL
            END AS nvarchar(500)) AS message
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
