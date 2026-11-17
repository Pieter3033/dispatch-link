-- Optional Phase 2 incident data. Loaded separately so the core dispatch page
-- remains compatible with local databases that have not applied Phase 2 yet.

WITH auth AS
(
    SELECT TOP (1) CAST(s.Username AS nvarchar(128)) AS username, 0 AS completedOnly
    FROM Jobcard.dbo.Current_session s
    JOIN Jobcard.dbo.User_info u ON u.Username = s.Username AND u.Usertype <> 15
    WHERE s.session_id = sqlpage.cookie('session')
      AND NOT EXISTS (SELECT 1 FROM Jobcard.dbo.Current_session rs
    JOIN Jobcard.dbo.User_info ru ON ru.Username = rs.Username
    WHERE rs.session_id = sqlpage.cookie('session') AND ru.Usertype = 15)
    UNION ALL
    SELECT CAST(r.Username AS nvarchar(128)), 1 FROM (SELECT reader_user.Username, reader_user.Seqno, reader_user.Name, reader_user.Surname,
        reader_user.Usertype, reader_user.Helpdesk, reader_user.DispatchTeamCode
    FROM Jobcard.dbo.Current_session reader_session
    JOIN Jobcard.dbo.User_info reader_user ON reader_user.Username = reader_session.Username
    WHERE reader_session.session_id = sqlpage.cookie('session') AND reader_user.Usertype = 15) r
    WHERE EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidents i
        WHERE i.id = TRY_CONVERT(int, $dispatchId) AND i.Status = N'Approved' AND i.DispatchStatus <> N'Cancelled' AND i.IsDeleted = 0)
),
input AS
(
    SELECT TRY_CAST($dispatchId AS int) AS id
)
SELECT
    JSON_QUERY(COALESCE((
        SELECT assignment.id, assignment.SequenceNo, assignment.AssignedTeam,
               assignment.ETA, assignment.DispatchedAt, assignment.OBNumber,
               assignment.TeamOnSceneAt, assignment.StoodDownAt,
               assignment.CreatedBy, assignment.CreatedAt,
               assignment.UpdatedBy, assignment.UpdatedAt
        FROM CC.dbo.DispatchAssignments assignment
        CROSS JOIN auth
        CROSS JOIN input
        WHERE assignment.dispatch_id = input.id
        ORDER BY assignment.SequenceNo
        FOR JSON PATH
    ), '[]')) AS assignments,
    JSON_QUERY(COALESCE((
        SELECT review.id, review.id AS ClosureReviewId, review.RequestSequence,
               review.ReviewStatus, review.ReviewStatus AS Decision,
               review.ClosingComments, review.RequestedBy, review.RequestedAt,
               review.ReviewedBy, review.ReviewedAt,
               review.ManagerComments, review.RejectionReason
        FROM CC.dbo.DispatchClosureReviews review
        CROSS JOIN auth
        CROSS JOIN input
        WHERE review.dispatch_id = input.id
        ORDER BY review.RequestSequence DESC, review.id DESC
        FOR JSON PATH
    ), '[]')) AS closureReviews,
    JSON_QUERY(COALESCE((
        SELECT comment.id, comment.closure_review_id AS ClosureReviewId,
               comment.CommentText, comment.CommentBy, comment.CommentedAt
        FROM CC.dbo.DispatchManagerComments comment
        CROSS JOIN auth
        CROSS JOIN input
        WHERE comment.dispatch_id = input.id
        ORDER BY comment.CommentedAt DESC, comment.id DESC
        FOR JSON PATH
    ), '[]')) AS managerComments
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
