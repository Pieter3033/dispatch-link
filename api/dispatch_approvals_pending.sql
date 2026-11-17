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

-- SQLPage JSON endpoint: pending approvals for approvers.

WITH auth AS
(
    SELECT TOP (1) CAST(Username AS nvarchar(128)) AS username
    FROM Current_session
    WHERE session_id = sqlpage.cookie('session')
)
SELECT
    JSON_QUERY(COALESCE((
        SELECT
            i.id,
            i.IncidentNumber,
            i.EventDateTime,
            i.Event,
            i.UnitId,
            i.RegNo,
            i.Company,
            i.DispatchTeam,
            i.Status,
            i.SubmittedAt,
            i.SubmittedBy,
            i.CreatedAt,
            i.CreatedBy,
            COALESCE(
                NULLIF(LTRIM(RTRIM(CONCAT(user_info.Name, ' ', user_info.Surname))), ''),
                i.CreatedBy
            ) AS CreatedByDisplayName,
            latest_handover.TargetOperatorUsername AS LastHandoverToUsername,
            COALESCE(
                NULLIF(LTRIM(RTRIM(CONCAT(handover_user_info.Name, ' ', handover_user_info.Surname))), ''),
                latest_handover.TargetOperatorUsername
            ) AS LastHandoverToDisplayName,
            i.UpdatedAt,
            i.UpdatedBy
        FROM CC.dbo.DispatchIncidents i
        CROSS JOIN auth a
        OUTER APPLY
        (
            SELECT TOP (1) u.Name, u.Surname
            FROM Jobcard.dbo.User_info u
            WHERE u.Username = i.CreatedBy
        ) user_info
        OUTER APPLY
        (
            SELECT TOP (1)
                NULLIF(LTRIM(RTRIM(SUBSTRING(handover.EntryText, LEN('HANDOVER:') + 1, 128))), '') AS TargetOperatorUsername
            FROM CC.dbo.DispatchIncidentTimeline handover
            WHERE handover.DispatchID = i.id
              AND handover.IsDeleted = 0
              AND handover.EventType = 'Note'
              AND handover.EntryText LIKE 'HANDOVER:%'
              AND NULLIF(LTRIM(RTRIM(SUBSTRING(handover.EntryText, LEN('HANDOVER:') + 1, 128))), '') IS NOT NULL
            ORDER BY handover.EventDateTime DESC, handover.TimelineEntryID DESC
        ) latest_handover
        OUTER APPLY
        (
            SELECT TOP (1) u.Name, u.Surname
            FROM Jobcard.dbo.User_info u
            WHERE u.Username = latest_handover.TargetOperatorUsername
        ) handover_user_info
        WHERE ISNULL(i.isdeleted, 0) = 0
          AND i.Status IN ('PendingApproval', 'Rejected')
          AND i.DispatchStatus NOT IN ('Closed', 'Cancelled')
          -- Temporary presentation mode: every authenticated user can see the
          -- approval queue. Role-based filtering will be reinstated later.
        ORDER BY i.SubmittedAt DESC, i.id DESC
        FOR JSON PATH
    ), '[]')) AS incidents
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
