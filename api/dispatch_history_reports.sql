-- Latest uploaded history report for each dispatch. Loaded separately so the
-- core incident list remains compatible with databases built in stages.

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
)
SELECT
    JSON_QUERY(COALESCE((
        SELECT
            incident.id AS dispatchId,
            history_file.id AS fileId,
            history_file.FileType,
            history_file.OriginalFileName,
            history_file.UploadedAt,
            CASE
                WHEN LEFT(REPLACE(history_file.FilePath, '\', '/'), 1) = '/'
                    THEN REPLACE(history_file.FilePath, '\', '/')
                ELSE '/' + REPLACE(history_file.FilePath, '\', '/')
            END AS downloadUrl
        FROM CC.dbo.DispatchIncidents incident
        CROSS JOIN auth
        CROSS APPLY
        (
            SELECT TOP (1) dispatch_file.*
            FROM CC.dbo.DispatchIncidentFiles dispatch_file
            WHERE dispatch_file.dispatch_id = incident.id
              AND dispatch_file.IsDeleted = 0
              AND dispatch_file.FileType IN ('HistoryExcel', 'HistoryPdf')
            ORDER BY dispatch_file.UploadedAt DESC, dispatch_file.id DESC
        ) history_file
        WHERE incident.IsDeleted = 0
          AND incident.Status = 'Approved'
          AND (auth.completedOnly = 0 OR incident.DispatchStatus <> N'Cancelled')
        FOR JSON PATH
    ), '[]')) AS reports
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
