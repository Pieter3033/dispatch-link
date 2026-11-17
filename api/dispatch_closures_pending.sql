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

-- SQLPage JSON endpoint: manager queue of pending closure requests.

WITH auth AS (
    SELECT TOP (1) NULLIF(LTRIM(RTRIM(CAST(Username AS NVARCHAR(128)))), '') AS username
    FROM Current_session
    WHERE session_id = sqlpage.cookie('session')
)
SELECT
    CASE
        WHEN NOT EXISTS (SELECT 1 FROM auth) THEN 'unauthorized'
        WHEN NOT EXISTS (SELECT 1 FROM auth WHERE username IN ('Approver1','Approver2','Approver3')) THEN 'forbidden'
        ELSE 'ok'
    END AS status,
    JSON_QUERY(COALESCE((
        SELECT
            review.id AS ClosureReviewId,
            review.RequestSequence,
            review.ClosingComments,
            review.RequestedBy,
            review.RequestedAt,
            incident.id,
            incident.IncidentNumber,
            incident.EventDateTime,
            incident.Event,
            incident.UnitId,
            incident.RegNo,
            incident.Company,
            incident.DispatchStatus,
            incident.ClosureApprovalStatus,
            incident.AssignedControlRoomAgent,
            incident.SummaryOfIncident
        FROM CC.dbo.DispatchClosureReviews review
        JOIN CC.dbo.DispatchIncidents incident ON incident.id = review.dispatch_id
        CROSS JOIN auth
        WHERE review.ReviewStatus = 'Pending'
          AND ISNULL(incident.isdeleted, 0) = 0
          AND auth.username IN ('Approver1','Approver2','Approver3')
        ORDER BY review.RequestedAt, review.id
        FOR JSON PATH
    ), '[]')) AS incidents
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
