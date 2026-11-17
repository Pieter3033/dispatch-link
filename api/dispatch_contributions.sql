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

-- Read-only contribution summary. Retains the source workbook counting rules.
-- Permission is resolved from the authenticated session, never from request parameters.
WITH cookie_user AS
(
    SELECT TOP (1)
        NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS NVARCHAR(200)))), '') AS username
    FROM Current_session current_session
    WHERE current_session.session_id = sqlpage.cookie('session')
),
cookie_identity AS
(
    SELECT
        cookie_user.username,
        LOWER(
            CASE
                WHEN cookie_parts.login_name IS NULL THEN NULL
                WHEN CHARINDEX('@', cookie_parts.login_name) > 0 THEN LEFT(cookie_parts.login_name, CHARINDEX('@', cookie_parts.login_name) - 1)
                ELSE cookie_parts.login_name
            END
        ) AS canonical_username
    FROM cookie_user
    CROSS APPLY
    (
        SELECT
            CASE
                WHEN cookie_user.username IS NULL THEN NULL
                WHEN CHARINDEX('\', cookie_user.username) > 0 THEN RIGHT(cookie_user.username, CHARINDEX('\', REVERSE(cookie_user.username)) - 1)
                WHEN CHARINDEX('/', cookie_user.username) > 0 THEN RIGHT(cookie_user.username, CHARINDEX('/', REVERSE(cookie_user.username)) - 1)
                ELSE cookie_user.username
            END AS login_name
    ) cookie_parts
),
resolved_user AS
(
    SELECT TOP (1)
        user_info.Seqno,
        user_info.Username,
        user_info.Name,
        user_info.Surname,
        user_info.Usertype,
        user_info.Helpdesk,
        user_info.DispatchTeamCode
    FROM cookie_identity
    JOIN Jobcard.dbo.User_info user_info
        ON cookie_identity.username IS NOT NULL
    CROSS APPLY
    (
        SELECT NULLIF(LTRIM(RTRIM(CAST(user_info.Username AS NVARCHAR(200)))), '') AS username
    ) db_user
    CROSS APPLY
    (
        SELECT
            CASE
                WHEN db_user.username IS NULL THEN NULL
                WHEN CHARINDEX('\', db_user.username) > 0 THEN RIGHT(db_user.username, CHARINDEX('\', REVERSE(db_user.username)) - 1)
                WHEN CHARINDEX('/', db_user.username) > 0 THEN RIGHT(db_user.username, CHARINDEX('/', REVERSE(db_user.username)) - 1)
                ELSE db_user.username
            END AS login_name
    ) db_parts
    CROSS APPLY
    (
        SELECT LOWER(
            CASE
                WHEN db_parts.login_name IS NULL THEN NULL
                WHEN CHARINDEX('@', db_parts.login_name) > 0 THEN LEFT(db_parts.login_name, CHARINDEX('@', db_parts.login_name) - 1)
                ELSE db_parts.login_name
            END
        ) AS canonical_username
    ) db_canonical
    WHERE db_user.username = cookie_identity.username
       OR LOWER(db_user.username) = cookie_identity.canonical_username
       OR db_canonical.canonical_username = cookie_identity.canonical_username
    ORDER BY
        CASE
            WHEN db_user.username = cookie_identity.username THEN 0
            WHEN LOWER(db_user.username) = cookie_identity.canonical_username THEN 1
            WHEN db_canonical.canonical_username = cookie_identity.canonical_username THEN 2
            ELSE 3
        END,
        user_info.Seqno
),
access_check AS (
  SELECT CASE WHEN EXISTS (SELECT 1 FROM resolved_user WHERE TRY_CONVERT(int, Usertype) = 7)
    THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS accessAllowed
),
raw_params AS (
  SELECT NULLIF(LTRIM(RTRIM(CAST($date_from AS nvarchar(40)))), '') AS date_from,
         NULLIF(LTRIM(RTRIM(CAST($date_to AS nvarchar(40)))), '') AS date_to,
         CASE WHEN CAST($all_dates AS nvarchar(10)) = '1' THEN 1 ELSE 0 END AS allDates
),
params AS (
  SELECT CASE WHEN date_from IS NULL AND date_to IS NULL AND allDates = 0
           THEN DATEADD(hour, -24, clock.windowEnd) ELSE parsed.dateFrom END AS dateFrom,
    CASE WHEN date_from IS NULL AND date_to IS NULL AND allDates = 0 THEN DATEADD(second, 1, clock.windowEnd)
         WHEN CONVERT(date, parsed.dateTo) = CONVERT(date, '99991231', 112) THEN NULL
         WHEN LEN(date_to) = 10 THEN DATEADD(day, 1, parsed.dateTo)
         ELSE DATEADD(second, 1, parsed.dateTo) END AS dateToExclusive,
    CASE WHEN (date_from IS NOT NULL AND parsed.dateFrom IS NULL)
           OR (date_to IS NOT NULL AND parsed.dateTo IS NULL)
           OR parsed.dateFrom > parsed.dateTo
           OR CONVERT(date, parsed.dateTo) = CONVERT(date, '99991231', 112)
      THEN CAST(0 AS bit) ELSE CAST(1 AS bit) END AS valid
  FROM raw_params
  -- datetime-local browsers omit zero seconds; accept their minute precision too.
  CROSS APPLY (SELECT TRY_CONVERT(datetime2(0), CASE WHEN LEN(date_from) = 16 THEN date_from + ':00' ELSE date_from END, 126) AS dateFrom,
                      TRY_CONVERT(datetime2(0), CASE WHEN LEN(date_to) = 16 THEN date_to + ':00' ELSE date_to END, 126) AS dateTo) parsed
  CROSS JOIN (SELECT CAST(SYSDATETIME() AS datetime2(0)) AS windowEnd) clock
),
dispatch_scope AS (
  SELECT incident.* FROM CC.dbo.DispatchIncidents incident
  CROSS JOIN access_check CROSS JOIN params
  WHERE accessAllowed = 1 AND params.valid = 1 AND ISNULL(incident.IsDeleted, 0) = 0
    AND (params.dateFrom IS NULL OR incident.EventDateTime >= params.dateFrom)
    AND (params.dateToExclusive IS NULL OR incident.EventDateTime < params.dateToExclusive)
),
opened_dispatch_scope AS (
  -- Opening a dispatch is its creation, independent of the incident event date.
  SELECT incident.id, incident.CreatedBy FROM CC.dbo.DispatchIncidents incident
  CROSS JOIN access_check CROSS JOIN params
  WHERE accessAllowed = 1 AND params.valid = 1 AND ISNULL(incident.IsDeleted, 0) = 0
    AND (params.dateFrom IS NULL OR incident.CreatedAt >= params.dateFrom)
    AND (params.dateToExclusive IS NULL OR incident.CreatedAt < params.dateToExclusive)
),
contribution_events AS
    (
      SELECT
        incident.id AS DispatchId,
        incident.CreatedAt AS ActionAt,
        incident.CreatedBy AS Username,
        N'Incident created' AS ContributionType,
        N'Incident' AS ContributionGroup,
        N'DispatchIncidents' AS SourceTable,
        CAST(incident.id AS nvarchar(50)) AS SourceId,
        N'Dispatch entry created.' AS ActionDetail
      FROM dispatch_scope incident

      UNION ALL

      SELECT
        audit.dispatch_id,
        audit.CreatedAt,
        audit.AuditUsername,
        audit.AuditAction,
        CASE
          WHEN audit.AuditAction = N'Draft field changed' THEN N'Field changes'
          WHEN audit.AuditAction LIKE N'Timeline%' THEN N'Timeline'
          WHEN audit.AuditAction LIKE N'Communication%' THEN N'Communication'
          WHEN audit.AuditAction IN
          (
            N'Workflow status changed', N'Submitted for approval', N'Approved', N'Rejected',
            N'Dispatch cancelled', N'Bulk dispatch cancellation', N'Entry cancelled',
            N'Dispatch recovered', N'Closure requested', N'Closure approved', N'Closure rejected',
            N'Ground-team assignment saved', N'Ground-team assignment deleted',
            N'Operational details saved', N'Team incident report uploaded'
          ) THEN N'Workflow and operations'
          ELSE N'Other audit activity'
        END,
        N'DispatchAuditLog',
        CAST(audit.id AS nvarchar(50)),
        CONCAT(
          audit.AuditAction,
          CASE WHEN NULLIF(LTRIM(RTRIM(audit.FieldName)), N'') IS NOT NULL
            THEN N': ' + audit.FieldName ELSE N'' END
        )
      FROM CC.dbo.DispatchAuditLog audit
      INNER JOIN dispatch_scope incident ON incident.id = audit.dispatch_id
      WHERE audit.AuditAction NOT IN (N'Incident created', N'Timeline event added', N'File uploaded')

      UNION ALL

      SELECT
        communication.DispatchID,
        communication.CreatedAt,
        communication.CreatedBy,
        N'Communication logged',
        N'Communication',
        N'DispatchCommunicationLog',
        CAST(communication.CommunicationLogID AS nvarchar(50)),
        CONCAT(communication.CommunicationType, N' logged')
      FROM CC.dbo.DispatchCommunicationLog communication
      INNER JOIN dispatch_scope incident ON incident.id = communication.DispatchID
      WHERE ISNULL(communication.IsDeleted, 0) = 0

      UNION ALL

      SELECT
        timeline.DispatchID,
        timeline.CreatedAt,
        timeline.CreatedBy,
        N'Timeline event added',
        N'Timeline',
        N'DispatchIncidentTimeline',
        CAST(timeline.TimelineEntryID AS nvarchar(50)),
        CONCAT(timeline.EventType, N' timeline event')
      FROM CC.dbo.DispatchIncidentTimeline timeline
      INNER JOIN dispatch_scope incident ON incident.id = timeline.DispatchID
      WHERE ISNULL(timeline.IsDeleted, 0) = 0

      UNION ALL

      SELECT
        photo.dispatch_id,
        photo.UploadedAt,
        photo.UploadedBy,
        N'Photo uploaded',
        N'Evidence uploads',
        N'DispatchIncidentPhotos',
        CAST(photo.id AS nvarchar(50)),
        CONCAT(photo.PhotoCategory, N' photo uploaded')
      FROM CC.dbo.DispatchIncidentPhotos photo
      INNER JOIN dispatch_scope incident ON incident.id = photo.dispatch_id
      WHERE ISNULL(photo.IsDeleted, 0) = 0

      UNION ALL

      SELECT
        file_entry.dispatch_id,
        file_entry.UploadedAt,
        file_entry.UploadedBy,
        N'File uploaded',
        N'Evidence uploads',
        N'DispatchIncidentFiles',
        CAST(file_entry.id AS nvarchar(50)),
        CONCAT(file_entry.FileType, N' file uploaded')
      FROM CC.dbo.DispatchIncidentFiles file_entry
      INNER JOIN dispatch_scope incident ON incident.id = file_entry.dispatch_id
      WHERE ISNULL(file_entry.IsDeleted, 0) = 0

      UNION ALL

      SELECT
        eta_request.DispatchIncidentId,
        eta_request.CreatedAt,
        eta_request.CreatedBy,
        N'ETA request created',
        N'ETA activity',
        N'DispatchEtaRequests',
        CAST(eta_request.EtaRequestId AS nvarchar(50)),
        CONCAT(N'ETA request ', eta_request.RequestNumber, N' created')
      FROM CC.dbo.DispatchEtaRequests eta_request
      INNER JOIN dispatch_scope incident ON incident.id = eta_request.DispatchIncidentId
      WHERE eta_request.DispatchIncidentId IS NOT NULL

      UNION ALL

      SELECT
        eta_request.DispatchIncidentId,
        eta_request.SelectedAt,
        eta_request.SelectedBy,
        N'ETA response selected',
        N'ETA activity',
        N'DispatchEtaRequests',
        CAST(eta_request.EtaRequestId AS nvarchar(50)),
        N'Ground-team ETA response selected'
      FROM CC.dbo.DispatchEtaRequests eta_request
      INNER JOIN dispatch_scope incident ON incident.id = eta_request.DispatchIncidentId
      WHERE eta_request.DispatchIncidentId IS NOT NULL
        AND eta_request.SelectedAt IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(eta_request.SelectedBy)), N'') IS NOT NULL

      UNION ALL

      SELECT
        eta_request.DispatchIncidentId,
        eta_response.RespondedAt,
        eta_response.RespondedBy,
        N'ETA response submitted',
        N'ETA activity',
        N'DispatchEtaResponses',
        CAST(eta_response.EtaResponseId AS nvarchar(50)),
        N'Ground-team ETA response submitted'
      FROM CC.dbo.DispatchEtaResponses eta_response
      INNER JOIN CC.dbo.DispatchEtaRequests eta_request ON eta_request.EtaRequestId = eta_response.EtaRequestId
      INNER JOIN dispatch_scope incident ON incident.id = eta_request.DispatchIncidentId
      WHERE eta_request.DispatchIncidentId IS NOT NULL
        AND eta_response.RespondedAt IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(eta_response.RespondedBy)), N'') IS NOT NULL
    ),
excluded_team_accounts AS (
  -- Exclude every ETA/dispatch-team account, including inactive teams and future accounts.
  SELECT DISTINCT CASE WHEN CHARINDEX('@', team_login.login_name) > 0
    THEN LEFT(team_login.login_name, CHARINDEX('@', team_login.login_name) - 1)
    ELSE team_login.login_name END AS canonical_username
  FROM Jobcard.dbo.User_info team_user
  CROSS APPLY (SELECT LOWER(LTRIM(RTRIM(CAST(team_user.Username AS nvarchar(200))))) AS username) team_account
  CROSS APPLY (SELECT CASE
    WHEN CHARINDEX('\', team_account.username) > 0 THEN RIGHT(team_account.username, CHARINDEX('\', REVERSE(team_account.username)) - 1)
    WHEN CHARINDEX('/', team_account.username) > 0 THEN RIGHT(team_account.username, CHARINDEX('/', REVERSE(team_account.username)) - 1)
    ELSE team_account.username END AS login_name) team_login
  WHERE TRY_CONVERT(int, team_user.Usertype) = 11
),
account_identities AS (
  -- Normalize once so both report sheets use identical account exclusions.
  SELECT event.Username, account.canonical_username
  FROM (
    SELECT Username FROM contribution_events
    UNION
    SELECT CreatedBy FROM opened_dispatch_scope
  ) event
  CROSS APPLY (SELECT LOWER(LTRIM(RTRIM(event.Username))) AS username) trimmed
  CROSS APPLY (SELECT CASE
    WHEN CHARINDEX('\', trimmed.username) > 0 THEN RIGHT(trimmed.username, CHARINDEX('\', REVERSE(trimmed.username)) - 1)
    WHEN CHARINDEX('/', trimmed.username) > 0 THEN RIGHT(trimmed.username, CHARINDEX('/', REVERSE(trimmed.username)) - 1)
    ELSE trimmed.username END AS login_name) login
  CROSS APPLY (SELECT CASE WHEN CHARINDEX('@', login.login_name) > 0
    THEN LEFT(login.login_name, CHARINDEX('@', login.login_name) - 1) ELSE login.login_name END AS canonical_username) account
  WHERE NULLIF(trimmed.username, '') IS NOT NULL
    -- Original report exclusions, plus the additional accounts requested for this dashboard.
    AND account.canonical_username NOT IN
      (N'approver3.user', N'example.user', N'fixture-operator', N'cctest', N'dispatchtest', N'eta_callcentre', N'cc',
       N'approver1.user', N'example.user', N'eta_panc_test',
       N'Example Operator - authorized test data', N'Example Operator (requested via codex)')
    AND NOT EXISTS (
      SELECT 1 FROM excluded_team_accounts team_account
      WHERE team_account.canonical_username = account.canonical_username
    )
),
normalized_events AS (
  SELECT event.*, account.canonical_username
  FROM contribution_events event
  JOIN account_identities account ON account.Username = event.Username
),
opened_dispatch_totals AS (
  SELECT account.canonical_username, COUNT(*) AS dispatches
  FROM opened_dispatch_scope incident
  JOIN account_identities account ON account.Username = incident.CreatedBy
  GROUP BY account.canonical_username
),
operator_profiles AS (
  SELECT account.canonical_username,
    COALESCE(NULLIF(LTRIM(RTRIM(person.Name)), ''), account.canonical_username) AS name,
    COALESCE(LTRIM(RTRIM(person.Surname)), '') AS surname
  FROM (SELECT DISTINCT canonical_username FROM account_identities) account
  OUTER APPLY (
    SELECT TOP (1) user_info.Name, user_info.Surname
    FROM Jobcard.dbo.User_info user_info
    CROSS APPLY (SELECT LOWER(LTRIM(RTRIM(CAST(user_info.Username AS nvarchar(200))))) AS username) db_user
    CROSS APPLY (SELECT CASE
      WHEN CHARINDEX('\', db_user.username) > 0 THEN RIGHT(db_user.username, CHARINDEX('\', REVERSE(db_user.username)) - 1)
      WHEN CHARINDEX('/', db_user.username) > 0 THEN RIGHT(db_user.username, CHARINDEX('/', REVERSE(db_user.username)) - 1)
      ELSE db_user.username END AS login_name) db_login
    WHERE (CASE WHEN CHARINDEX('@', db_login.login_name) > 0
      THEN LEFT(db_login.login_name, CHARINDEX('@', db_login.login_name) - 1) ELSE db_login.login_name END) = account.canonical_username
    ORDER BY CASE WHEN NULLIF(LTRIM(RTRIM(user_info.Name)), '') IS NOT NULL THEN 0 ELSE 1 END, user_info.Seqno
  ) person
),
totals AS (
  SELECT (SELECT COUNT(*) FROM dispatch_scope) AS dispatches, COUNT(*) AS actions,
    (SELECT COALESCE(SUM(dispatches), 0) FROM opened_dispatch_totals) AS openedDispatches,
    COUNT(DISTINCT canonical_username) AS contributors FROM normalized_events
),
contributor_totals AS (
  SELECT canonical_username, COUNT(*) AS actions, COUNT(DISTINCT DispatchId) AS dispatches,
    SUM(CASE WHEN ContributionGroup = N'Communication' THEN 1 ELSE 0 END) AS communication,
    SUM(CASE WHEN ContributionGroup = N'Field changes' THEN 1 ELSE 0 END) AS fieldChanges,
    SUM(CASE WHEN ContributionGroup = N'Timeline' THEN 1 ELSE 0 END) AS timeline,
    SUM(CASE WHEN ContributionGroup = N'Evidence uploads' THEN 1 ELSE 0 END) AS evidence,
    SUM(CASE WHEN ContributionGroup NOT IN (N'Communication', N'Field changes', N'Timeline', N'Evidence uploads') THEN 1 ELSE 0 END) AS other
  FROM normalized_events GROUP BY canonical_username
),
account_lists AS (
  SELECT canonical_username, STRING_AGG(CAST(username AS nvarchar(max)), N'; ') WITHIN GROUP (ORDER BY username) AS accounts
  FROM (SELECT DISTINCT canonical_username, LTRIM(RTRIM(Username)) AS username FROM normalized_events) accounts
  GROUP BY canonical_username
)
SELECT 'json' AS component, (
  SELECT access_check.accessAllowed, params.valid AS filtersValid,
    CONVERT(nvarchar(19), SYSDATETIME(), 126) AS generatedAt,
    JSON_QUERY((SELECT dispatches, actions, contributors, openedDispatches FROM totals FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)) AS metrics,
    JSON_QUERY(COALESCE((
      SELECT person.name, person.surname, account_lists.accounts,
        contributor.actions, contributor.dispatches,
        CAST(CASE WHEN totals.actions = 0 THEN 0 ELSE contributor.actions * 1.0 / totals.actions END AS decimal(18,10)) AS actionShare,
        CAST(CASE WHEN totals.dispatches = 0 THEN 0 ELSE contributor.dispatches * 1.0 / totals.dispatches END AS decimal(18,10)) AS dispatchShare,
        contributor.communication, contributor.fieldChanges, contributor.timeline, contributor.evidence, contributor.other
      FROM contributor_totals contributor
      CROSS JOIN totals
      JOIN account_lists ON account_lists.canonical_username = contributor.canonical_username
      JOIN operator_profiles person ON person.canonical_username = contributor.canonical_username
      ORDER BY contributor.actions DESC, name, surname, contributor.canonical_username
      FOR JSON PATH
    ), N'[]')) AS contributors,
    JSON_QUERY(COALESCE((
      SELECT person.name, person.surname, opened.dispatches
      FROM opened_dispatch_totals opened
      JOIN operator_profiles person ON person.canonical_username = opened.canonical_username
      ORDER BY opened.dispatches DESC, person.name, person.surname, opened.canonical_username
      FOR JSON PATH
    ), N'[]')) AS openedDispatches
  FROM access_check CROSS JOIN params FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS contents;
