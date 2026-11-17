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

-- SQLPage 0.25-compatible soft-delete endpoint for communication rows.

UPDATE communication
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
FROM CC.dbo.DispatchCommunicationLog communication
INNER JOIN CC.dbo.DispatchIncidents incident ON incident.id = communication.DispatchID
WHERE communication.CommunicationLogID = TRY_CONVERT(int, :communicationId)
  AND communication.DispatchID = TRY_CONVERT(int, :incidentId)
  AND communication.IsDeleted = 0
  AND incident.IsDeleted = 0
  AND incident.Status IN ('Draft', 'Rejected', 'PendingApproval')
  AND incident.DispatchStatus NOT IN ('Closed', 'Cancelled')
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
                  OR TRY_CONVERT(int, :communicationId) IS NULL THEN 'validation_error'
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
                WHEN EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchCommunicationLog
                    WHERE CommunicationLogID = TRY_CONVERT(int, :communicationId)
                      AND DispatchID = TRY_CONVERT(int, :incidentId)
                      AND IsDeleted = 0
                ) THEN 'delete_failed'
                ELSE 'ok'
            END AS nvarchar(40)) AS status
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
