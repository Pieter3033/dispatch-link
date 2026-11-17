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

-- SQLPage 0.25-compatible endpoint for the rebuilt communication table.

UPDATE communication
SET
    DisplayOrder = COALESCE(TRY_CONVERT(int, NULLIF(:displayOrder, '')), communication.DisplayOrder),
    CommunicationDate = TRY_CONVERT(date, NULLIF(:communicationDate, '')),
    CommunicationTime = TRY_CONVERT(time(0), NULLIF(:communicationTime, '')),
    CommunicationType = NULLIF(:communicationType, ''),
    ControlRoomAgent = NULLIF(:controlRoomAgent, ''),
    ContactPerson = NULLIF(:contactPerson, ''),
    ContactNumber = NULLIF(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            LTRIM(RTRIM(:contactNumber)) COLLATE Latin1_General_100_BIN2,
            N' ', N''), NCHAR(160), N''), NCHAR(8239), N''),
            NCHAR(9), N''), NCHAR(10), N''), NCHAR(13), N''),
        ''
    ),
    EmailAddress = NULLIF(:emailAddress, ''),
    CommunicationNotes = NULLIF(:communicationNotes, ''),
    UpdatedAt = SYSDATETIME(),
    UpdatedBy = COALESCE(NULLIF((
        SELECT TOP (1) CAST(Username AS nvarchar(128))
        FROM Current_session
        WHERE session_id = sqlpage.cookie('session')
    ), ''), 'SQLPage')
FROM CC.dbo.DispatchCommunicationLog communication
INNER JOIN CC.dbo.DispatchIncidents incident ON incident.id = communication.DispatchID
WHERE communication.CommunicationLogID = TRY_CONVERT(int, NULLIF(:communicationId, ''))
  AND communication.DispatchID = TRY_CONVERT(int, :incidentId)
  AND communication.IsDeleted = 0
  AND incident.IsDeleted = 0
  AND incident.Status IN ('Draft', 'Rejected', 'PendingApproval')
  AND incident.DispatchStatus NOT IN ('Closed', 'Cancelled')
  AND TRY_CONVERT(date, NULLIF(:communicationDate, '')) IS NOT NULL
  AND TRY_CONVERT(time(0), NULLIF(:communicationTime, '')) IS NOT NULL
  AND NULLIF(:communicationType, '') IN
      ('Call Made', 'Call Received', 'Email Sent', 'Email Received', 'SMS Sent',
       'WhatsApp Sent', 'WhatsApp Received', 'Radio', 'Internal Note', 'Customer Update', 'Technician Update')
  AND NULLIF(:controlRoomAgent, '') IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM Current_session
      WHERE session_id = sqlpage.cookie('session')
  );

-- A retry of the same create at the same row position must reuse its record.
-- Different positions still permit intentionally identical communications.
WITH requested AS
(
    SELECT
        TRY_CONVERT(int, NULLIF(:displayOrder, '')) AS DisplayOrder,
        TRY_CONVERT(date, NULLIF(:communicationDate, '')) AS CommunicationDate,
        TRY_CONVERT(time(0), NULLIF(:communicationTime, '')) AS CommunicationTime,
        NULLIF(:communicationType, '') AS CommunicationType,
        NULLIF(:controlRoomAgent, '') AS ControlRoomAgent,
        NULLIF(:contactPerson, '') AS ContactPerson,
        NULLIF(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            LTRIM(RTRIM(:contactNumber)) COLLATE Latin1_General_100_BIN2,
            N' ', N''), NCHAR(160), N''), NCHAR(8239), N''),
            NCHAR(9), N''), NCHAR(10), N''), NCHAR(13), N''), '') AS ContactNumber,
        NULLIF(:emailAddress, '') AS EmailAddress,
        NULLIF(:communicationNotes, '') AS CommunicationNotes
)
INSERT INTO CC.dbo.DispatchCommunicationLog
(
    DispatchID, DisplayOrder, CommunicationDate, CommunicationTime, CommunicationType,
    ControlRoomAgent, ContactPerson, ContactNumber, EmailAddress,
    CommunicationNotes, CreatedBy, UpdatedBy
)
SELECT
    incident.id,
    COALESCE(
        TRY_CONVERT(int, NULLIF(:displayOrder, '')),
        (SELECT COALESCE(MAX(existing.DisplayOrder), 0) + 1
         FROM CC.dbo.DispatchCommunicationLog existing
         WHERE existing.DispatchID = incident.id AND existing.IsDeleted = 0)
    ),
    TRY_CONVERT(date, NULLIF(:communicationDate, '')),
    TRY_CONVERT(time(0), NULLIF(:communicationTime, '')),
    NULLIF(:communicationType, ''),
    NULLIF(:controlRoomAgent, ''),
    NULLIF(:contactPerson, ''),
    NULLIF(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            LTRIM(RTRIM(:contactNumber)) COLLATE Latin1_General_100_BIN2,
            N' ', N''), NCHAR(160), N''), NCHAR(8239), N''),
            NCHAR(9), N''), NCHAR(10), N''), NCHAR(13), N''),
        ''
    ),
    NULLIF(:emailAddress, ''),
    NULLIF(:communicationNotes, ''),
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
CROSS JOIN requested
WHERE NULLIF(:communicationId, '') IS NULL
  AND incident.id = TRY_CONVERT(int, :incidentId)
  AND incident.IsDeleted = 0
  AND incident.Status IN ('Draft', 'Rejected', 'PendingApproval')
  AND incident.DispatchStatus NOT IN ('Closed', 'Cancelled')
  AND TRY_CONVERT(date, NULLIF(:communicationDate, '')) IS NOT NULL
  AND TRY_CONVERT(time(0), NULLIF(:communicationTime, '')) IS NOT NULL
  AND NULLIF(:communicationType, '') IN
      ('Call Made', 'Call Received', 'Email Sent', 'Email Received', 'SMS Sent',
       'WhatsApp Sent', 'WhatsApp Received', 'Radio', 'Internal Note', 'Customer Update', 'Technician Update')
  AND NULLIF(:controlRoomAgent, '') IS NOT NULL
  AND NOT EXISTS
  (
      -- Range locks last for this INSERT statement's transaction, preventing
      -- two requests from both observing the same row position as absent.
      SELECT 1
      FROM CC.dbo.DispatchCommunicationLog existing WITH (UPDLOCK, HOLDLOCK)
      WHERE existing.DispatchID = incident.id
        AND existing.IsDeleted = 0
        AND requested.DisplayOrder IS NOT NULL
        AND existing.DisplayOrder = requested.DisplayOrder
        AND existing.CommunicationDate = requested.CommunicationDate
        AND existing.CommunicationTime = requested.CommunicationTime
        AND existing.CommunicationType COLLATE Latin1_General_100_BIN2 = requested.CommunicationType COLLATE Latin1_General_100_BIN2
        AND existing.ControlRoomAgent COLLATE Latin1_General_100_BIN2 = requested.ControlRoomAgent COLLATE Latin1_General_100_BIN2
        AND COALESCE(existing.ContactPerson, N'') COLLATE Latin1_General_100_BIN2 = COALESCE(requested.ContactPerson, N'') COLLATE Latin1_General_100_BIN2
        AND COALESCE(existing.ContactNumber, N'') COLLATE Latin1_General_100_BIN2 = COALESCE(requested.ContactNumber, N'') COLLATE Latin1_General_100_BIN2
        AND COALESCE(existing.EmailAddress, N'') COLLATE Latin1_General_100_BIN2 = COALESCE(requested.EmailAddress, N'') COLLATE Latin1_General_100_BIN2
        AND COALESCE(existing.CommunicationNotes, N'') COLLATE Latin1_General_100_BIN2 = COALESCE(requested.CommunicationNotes, N'') COLLATE Latin1_General_100_BIN2
  )
  AND EXISTS (
      SELECT 1 FROM Current_session
      WHERE session_id = sqlpage.cookie('session')
  );

WITH requested AS
(
    SELECT
        TRY_CONVERT(int, NULLIF(:displayOrder, '')) AS DisplayOrder,
        TRY_CONVERT(date, NULLIF(:communicationDate, '')) AS CommunicationDate,
        TRY_CONVERT(time(0), NULLIF(:communicationTime, '')) AS CommunicationTime,
        NULLIF(:communicationType, '') AS CommunicationType,
        NULLIF(:controlRoomAgent, '') AS ControlRoomAgent,
        NULLIF(:contactPerson, '') AS ContactPerson,
        NULLIF(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            LTRIM(RTRIM(:contactNumber)) COLLATE Latin1_General_100_BIN2,
            N' ', N''), NCHAR(160), N''), NCHAR(8239), N''),
            NCHAR(9), N''), NCHAR(10), N''), NCHAR(13), N''), '') AS ContactNumber,
        NULLIF(:emailAddress, '') AS EmailAddress,
        NULLIF(:communicationNotes, '') AS CommunicationNotes
),
saved AS
(
    SELECT TOP (1) communication.CommunicationLogID
    FROM CC.dbo.DispatchCommunicationLog communication
    INNER JOIN CC.dbo.DispatchIncidents incident ON incident.id = communication.DispatchID
    CROSS JOIN requested
    WHERE communication.DispatchID = TRY_CONVERT(int, :incidentId)
      AND communication.IsDeleted = 0
      AND incident.IsDeleted = 0
      AND incident.Status IN ('Draft', 'Rejected', 'PendingApproval')
      AND incident.DispatchStatus NOT IN ('Closed', 'Cancelled')
      AND EXISTS (SELECT 1 FROM Current_session WHERE session_id = sqlpage.cookie('session'))
      AND
      (
          communication.CommunicationLogID = TRY_CONVERT(int, NULLIF(:communicationId, ''))
          OR
          (
              NULLIF(:communicationId, '') IS NULL
              AND (requested.DisplayOrder IS NULL OR communication.DisplayOrder = requested.DisplayOrder)
              AND communication.CommunicationDate = requested.CommunicationDate
              AND communication.CommunicationTime = requested.CommunicationTime
              AND communication.CommunicationType COLLATE Latin1_General_100_BIN2 = requested.CommunicationType COLLATE Latin1_General_100_BIN2
              AND communication.ControlRoomAgent COLLATE Latin1_General_100_BIN2 = requested.ControlRoomAgent COLLATE Latin1_General_100_BIN2
              AND COALESCE(communication.ContactPerson, N'') COLLATE Latin1_General_100_BIN2 = COALESCE(requested.ContactPerson, N'') COLLATE Latin1_General_100_BIN2
              AND COALESCE(communication.ContactNumber, N'') COLLATE Latin1_General_100_BIN2 = COALESCE(requested.ContactNumber, N'') COLLATE Latin1_General_100_BIN2
              AND COALESCE(communication.EmailAddress, N'') COLLATE Latin1_General_100_BIN2 = COALESCE(requested.EmailAddress, N'') COLLATE Latin1_General_100_BIN2
              AND COALESCE(communication.CommunicationNotes, N'') COLLATE Latin1_General_100_BIN2 = COALESCE(requested.CommunicationNotes, N'') COLLATE Latin1_General_100_BIN2
          )
      )
    ORDER BY communication.CommunicationLogID DESC
)
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
                    WHERE id = TRY_CONVERT(int, :incidentId)
                      AND IsDeleted = 0
                ) THEN 'not_found'
                WHEN NOT EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE id = TRY_CONVERT(int, :incidentId)
                      AND IsDeleted = 0
                      AND Status IN ('Draft', 'Rejected', 'PendingApproval')
                      AND DispatchStatus NOT IN ('Closed', 'Cancelled')
                ) THEN 'locked_status'
                WHEN TRY_CONVERT(date, NULLIF(:communicationDate, '')) IS NULL THEN 'validation_error'
                WHEN TRY_CONVERT(time(0), NULLIF(:communicationTime, '')) IS NULL THEN 'validation_error'
                WHEN NULLIF(:communicationType, '') NOT IN
                    ('Call Made', 'Call Received', 'Email Sent', 'Email Received', 'SMS Sent',
                     'WhatsApp Sent', 'WhatsApp Received', 'Radio', 'Internal Note', 'Customer Update', 'Technician Update')
                    THEN 'validation_error'
                WHEN NULLIF(:controlRoomAgent, '') IS NULL THEN 'validation_error'
                WHEN NULLIF(:communicationId, '') IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchCommunicationLog
                    WHERE CommunicationLogID = TRY_CONVERT(int, :communicationId)
                      AND DispatchID = TRY_CONVERT(int, :incidentId)
                      AND IsDeleted = 0
                ) THEN 'communication_not_found'
                WHEN NOT EXISTS (SELECT 1 FROM saved) THEN 'save_failed'
                ELSE 'ok'
            END AS nvarchar(40)) AS status,
            CAST(CASE
                WHEN TRY_CONVERT(date, NULLIF(:communicationDate, '')) IS NULL THEN 'Communication date is required and must be valid.'
                WHEN TRY_CONVERT(time(0), NULLIF(:communicationTime, '')) IS NULL THEN 'Communication time is required and must be valid.'
                WHEN NULLIF(:communicationType, '') NOT IN
                    ('Call Made', 'Call Received', 'Email Sent', 'Email Received', 'SMS Sent',
                     'WhatsApp Sent', 'WhatsApp Received', 'Radio', 'Internal Note', 'Customer Update', 'Technician Update')
                    THEN 'Communication Type is required and must be valid.'
                WHEN NULLIF(:controlRoomAgent, '') IS NULL THEN 'Control Room Agent is required.'
                ELSE NULL
            END AS nvarchar(500)) AS message,
            (SELECT CommunicationLogID FROM saved) AS communicationId
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
