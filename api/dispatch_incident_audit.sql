-- SQLPage JSON endpoint: audit entries are loaded separately so a missing
-- rebuild migration cannot prevent the core dispatch record from opening.

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
        SELECT TOP (200)
            audit.id,
            audit.AuditAction,
            audit.FieldName,
            audit.OldValue,
            audit.NewValue,
            audit.OldStatus,
            audit.NewStatus,
            audit.AuditMessage,
            audit.AuditUsername,
            audit.CreatedAt
        FROM CC.dbo.DispatchAuditLog audit
        CROSS JOIN auth
        CROSS JOIN input
        WHERE audit.dispatch_id = input.id
        ORDER BY audit.CreatedAt DESC, audit.id DESC
        FOR JSON PATH
    ), '[]')) AS audit
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
