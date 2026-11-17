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

-- SQLPage 0.25-compatible endpoint for a manually dated dispatch handover.
-- Handover history is stored as protected Note entries with a HANDOVER prefix.

INSERT INTO CC.dbo.DispatchIncidentTimeline
(
    DispatchID,
    EventDateTime,
    EventType,
    EntryText,
    CreatedBy,
    UpdatedBy
)
SELECT
    incident.id,
    TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:handoverDateTime, ''), 'T', ' '), 120),
    N'Note',
    N'HANDOVER:' + LTRIM(RTRIM(target_user.Username)),
    operator_session.Username,
    operator_session.Username
FROM CC.dbo.DispatchIncidents incident
CROSS APPLY (
    SELECT TOP (1) LTRIM(RTRIM(CAST(cs.Username AS nvarchar(128)))) AS Username
    FROM Current_session cs
    WHERE cs.session_id = sqlpage.cookie('session')
) operator_session
INNER JOIN Jobcard.dbo.User_info target_user
    ON LTRIM(RTRIM(target_user.Username)) = LTRIM(RTRIM(NULLIF(:targetOperatorUsername, '')))
   AND (
       TRY_CONVERT(int, target_user.Usertype) IN (7, 8, 14)
       OR (TRY_CONVERT(int, target_user.Usertype) = 1 AND COALESCE(target_user.Helpdesk, 0) = 1)
   )
   AND LOWER(LTRIM(RTRIM(target_user.Username))) <> N'eta_callcentre'
   AND UPPER(COALESCE(
       NULLIF(LTRIM(RTRIM(CONCAT(target_user.Name, N' ', target_user.Surname))), N''),
       LTRIM(RTRIM(target_user.Username))
   )) NOT IN (N'CC CC', N'Approver1 ESCALATION', N'TEST TEST', N'EXAMPLE ESCALATION')
WHERE incident.id = TRY_CONVERT(int, :incidentId)
  AND ISNULL(incident.IsDeleted, 0) = 0
  AND incident.DispatchStatus NOT IN (N'Closed', N'Cancelled')
  AND TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:handoverDateTime, ''), 'T', ' '), 120)
      BETWEEN CONVERT(datetime2(0), incident.CreatedAt) AND DATEADD(minute, 5, SYSDATETIME())
  AND LOWER(COALESCE((
      SELECT TOP (1)
          NULLIF(LTRIM(RTRIM(SUBSTRING(previous_entry.EntryText, LEN(N'HANDOVER:') + 1, 128))), N'')
      FROM CC.dbo.DispatchIncidentTimeline previous_entry
      WHERE previous_entry.DispatchID = incident.id
        AND previous_entry.IsDeleted = 0
        AND previous_entry.EventType = N'Note'
        AND previous_entry.EntryText LIKE N'HANDOVER:%'
        AND previous_entry.EventDateTime <= TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:handoverDateTime, ''), 'T', ' '), 120)
      ORDER BY previous_entry.EventDateTime DESC, previous_entry.TimelineEntryID DESC
  ), incident.CreatedBy, N'')) <> LOWER(LTRIM(RTRIM(target_user.Username)));

UPDATE incident
SET AssignedControlRoomAgent = COALESCE(
        NULLIF(LTRIM(RTRIM(CONCAT(target_user.Name, N' ', target_user.Surname))), N''),
        LTRIM(RTRIM(target_user.Username))
    ),
    UpdatedAt = SYSDATETIME(),
    UpdatedBy = operator_session.Username
FROM CC.dbo.DispatchIncidents incident
CROSS APPLY (
    SELECT TOP (1) LTRIM(RTRIM(CAST(cs.Username AS nvarchar(128)))) AS Username
    FROM Current_session cs
    WHERE cs.session_id = sqlpage.cookie('session')
) operator_session
INNER JOIN Jobcard.dbo.User_info target_user
    ON LTRIM(RTRIM(target_user.Username)) = LTRIM(RTRIM(NULLIF(:targetOperatorUsername, '')))
WHERE incident.id = TRY_CONVERT(int, :incidentId)
  AND EXISTS (
      SELECT 1
      FROM CC.dbo.DispatchIncidentTimeline saved_entry
      WHERE saved_entry.DispatchID = incident.id
        AND saved_entry.IsDeleted = 0
        AND saved_entry.EventType = N'Note'
        AND saved_entry.EntryText = N'HANDOVER:' + LTRIM(RTRIM(NULLIF(:targetOperatorUsername, '')))
        AND saved_entry.EventDateTime = TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:handoverDateTime, ''), 'T', ' '), 120)
        AND saved_entry.CreatedBy = operator_session.Username
        AND saved_entry.CreatedAt >= DATEADD(second, -10, SYSDATETIME())
        AND saved_entry.EventDateTime = (
            SELECT MAX(candidate.EventDateTime)
            FROM CC.dbo.DispatchIncidentTimeline candidate
            WHERE candidate.DispatchID = incident.id
              AND candidate.IsDeleted = 0
              AND candidate.EventType = N'Note'
              AND candidate.EntryText LIKE N'HANDOVER:%'
        )
        AND saved_entry.TimelineEntryID = (
            SELECT MAX(candidate.TimelineEntryID)
            FROM CC.dbo.DispatchIncidentTimeline candidate
            WHERE candidate.DispatchID = incident.id
              AND candidate.IsDeleted = 0
              AND candidate.EventType = N'Note'
              AND candidate.EntryText LIKE N'HANDOVER:%'
              AND candidate.EventDateTime = saved_entry.EventDateTime
        )
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
                WHEN TRY_CONVERT(int, :incidentId) IS NULL THEN N'validation_error'
                WHEN NOT EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE id = TRY_CONVERT(int, :incidentId) AND ISNULL(IsDeleted, 0) = 0
                ) THEN N'not_found'
                WHEN EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE id = TRY_CONVERT(int, :incidentId)
                      AND DispatchStatus IN (N'Closed', N'Cancelled')
                ) THEN N'locked_status'
                WHEN TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:handoverDateTime, ''), 'T', ' '), 120) IS NULL
                    THEN N'invalid_handover_datetime'
                WHEN NOT EXISTS (
                    SELECT 1
                    FROM CC.dbo.DispatchIncidents
                    WHERE id = TRY_CONVERT(int, :incidentId)
                      AND TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:handoverDateTime, ''), 'T', ' '), 120)
                          BETWEEN CONVERT(datetime2(0), CreatedAt) AND DATEADD(minute, 5, SYSDATETIME())
                ) THEN N'invalid_handover_range'
                WHEN NOT EXISTS (
                    SELECT 1 FROM Jobcard.dbo.User_info target_user
                    WHERE LTRIM(RTRIM(target_user.Username)) = LTRIM(RTRIM(NULLIF(:targetOperatorUsername, '')))
                      AND (
                          TRY_CONVERT(int, target_user.Usertype) IN (7, 8, 14)
                          OR (TRY_CONVERT(int, target_user.Usertype) = 1 AND COALESCE(target_user.Helpdesk, 0) = 1)
                      )
                      AND LOWER(LTRIM(RTRIM(target_user.Username))) <> N'eta_callcentre'
                ) THEN N'invalid_target_operator'
                WHEN EXISTS (
                    SELECT 1
                    FROM CC.dbo.DispatchIncidentTimeline saved_entry
                    WHERE saved_entry.DispatchID = TRY_CONVERT(int, :incidentId)
                      AND saved_entry.IsDeleted = 0
                      AND saved_entry.EventType = N'Note'
                      AND saved_entry.EntryText = N'HANDOVER:' + LTRIM(RTRIM(NULLIF(:targetOperatorUsername, '')))
                      AND saved_entry.EventDateTime = TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:handoverDateTime, ''), 'T', ' '), 120)
                      AND saved_entry.CreatedBy = (
                          SELECT TOP (1) LTRIM(RTRIM(CAST(cs.Username AS nvarchar(128))))
                          FROM Current_session cs
                          WHERE cs.session_id = sqlpage.cookie('session')
                      )
                      AND saved_entry.CreatedAt >= DATEADD(second, -10, SYSDATETIME())
                ) THEN N'ok'
                ELSE N'same_operator'
            END AS nvarchar(40)) AS [status],
            CAST(CASE
                WHEN NOT EXISTS (SELECT 1 FROM Current_session WHERE session_id = sqlpage.cookie('session'))
                    THEN N'An authenticated operator is required.'
                WHEN TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:handoverDateTime, ''), 'T', ' '), 120) IS NULL
                    THEN N'Enter the handover date and time.'
                WHEN EXISTS (
                    SELECT 1
                    FROM CC.dbo.DispatchIncidentTimeline saved_entry
                    WHERE saved_entry.DispatchID = TRY_CONVERT(int, :incidentId)
                      AND saved_entry.EntryText = N'HANDOVER:' + LTRIM(RTRIM(NULLIF(:targetOperatorUsername, '')))
                      AND saved_entry.EventDateTime = TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:handoverDateTime, ''), 'T', ' '), 120)
                      AND saved_entry.CreatedAt >= DATEADD(second, -10, SYSDATETIME())
                ) THEN N'Dispatch handover recorded.'
                ELSE N'The handover could not be recorded. Check the operator and date/time.'
            END AS nvarchar(500)) AS [message]
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
