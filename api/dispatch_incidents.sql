-- SQLPage JSON endpoint: list and summarize incidents from the rebuilt table.
-- Includes the latest ground-team incident report so it can be downloaded from
-- the completed dispatch list.

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
),
filtered AS
(
    SELECT
        i.id,
        i.IncidentNumber,
        i.EventDateTime,
        i.Event,
        i.UnitId,
        i.RegNo,
        i.Company,
        i.DispatchTeam,
        i.FleetCode,
        i.DriverName,
        i.DispatchReason,
        CAST(CASE
            WHEN i.TrackingUnitStatus = N'Not fitted with Pulsit Tracking'
             AND CHARINDEX(N'[VehicleHistoryUnavailable]', COALESCE(i.OperatorNotesText, N'')) > 0
             AND NULLIF(LTRIM(RTRIM(SUBSTRING(
                 i.OperatorNotesText,
                 CHARINDEX(N'[VehicleHistoryUnavailable]', i.OperatorNotesText) + LEN(N'[VehicleHistoryUnavailable]'),
                 501
             ))), N'') IS NOT NULL
                THEN 1 ELSE 0
        END AS bit) AS VehicleHistoryUnavailable,
        CASE
            WHEN CHARINDEX(N'[VehicleHistoryUnavailable]', COALESCE(i.OperatorNotesText, N'')) > 0
                THEN LTRIM(RTRIM(SUBSTRING(
                    i.OperatorNotesText,
                    CHARINDEX(N'[VehicleHistoryUnavailable]', i.OperatorNotesText) + LEN(N'[VehicleHistoryUnavailable]'),
                    501
                )))
            ELSE N''
        END AS VehicleHistoryUnavailableReason,
        i.UpdatedAt AS VehicleHistoryUnavailableAt,
        i.UpdatedBy AS VehicleHistoryUnavailableBy,
        i.Status,
        i.DispatchStatus,
        i.ClosureApprovalStatus,
        i.AssignedControlRoomAgent,
        CAST(NULL AS nvarchar(max)) AS AssignedTeams,
        i.ETA AS LatestETA,
        i.UpdatedAt AS LatestOperationalUpdate,
        i.SubmittedAt,
        i.SubmittedBy,
        COALESCE(
            NULLIF(LTRIM(RTRIM(CONCAT(submitter_info.Name, ' ', submitter_info.Surname))), ''),
            i.SubmittedBy
        ) AS SubmittedByDisplayName,
        i.zoho_ob,
        i.ApprovedAt,
        i.ApprovedBy,
        i.RejectedAt,
        i.RejectedBy,
        i.RejectionReason,
        i.CreatedAt,
        i.CreatedBy,
        i.UpdatedAt,
        i.UpdatedBy,
        CAST(
            CASE
                WHEN EXISTS (
                    SELECT 1
                    FROM Risk.dbo.unitinfo unit_row
                    WHERE NULLIF(LTRIM(RTRIM(i.RegNo)), N'') IS NOT NULL
                      AND UPPER(LTRIM(RTRIM(unit_row.reg_no))) = UPPER(LTRIM(RTRIM(i.RegNo)))
                      AND LOWER(LTRIM(RTRIM(COALESCE(unit_row.ctrltype, N'')))) <> N'lmu ir'
                )
                AND EXISTS (
                    SELECT 1
                    FROM Risk.dbo.vehicleinfo vehicle_row
                    WHERE NULLIF(LTRIM(RTRIM(i.RegNo)), N'') IS NOT NULL
                      AND UPPER(LTRIM(RTRIM(vehicle_row.reg_no))) = UPPER(LTRIM(RTRIM(i.RegNo)))
                )
                THEN 1 ELSE 0
            END AS bit
        ) AS MSTrackRegistrationExists,
        team_report.OriginalFileName AS TeamIncidentReportName,
        CASE
            WHEN LEFT(REPLACE(team_report.FilePath, '\', '/'), 1) = '/'
                THEN REPLACE(team_report.FilePath, '\', '/')
            WHEN team_report.FilePath IS NOT NULL
                THEN '/' + REPLACE(team_report.FilePath, '\', '/')
            ELSE NULL
        END AS TeamIncidentReportDownloadUrl
    FROM CC.dbo.DispatchIncidents i
    CROSS JOIN auth a
    OUTER APPLY
    (
        SELECT TOP (1) u.Name, u.Surname
        FROM Jobcard.dbo.User_info u
        WHERE u.Username = i.SubmittedBy
    ) submitter_info
    OUTER APPLY
    (
        SELECT TOP (1)
            dispatch_file.OriginalFileName,
            dispatch_file.FilePath
        FROM CC.dbo.DispatchIncidentFiles dispatch_file
        WHERE dispatch_file.dispatch_id = i.id
          AND dispatch_file.IsDeleted = 0
          AND dispatch_file.FileType = N'TeamIncidentReport'
        ORDER BY dispatch_file.UploadedAt DESC, dispatch_file.id DESC
    ) team_report
    WHERE i.IsDeleted = 0
      AND (a.completedOnly = 0 OR (i.Status = N'Approved' AND i.DispatchStatus <> N'Cancelled' AND i.IsDeleted = 0))
      AND (NULLIF($status, '') IS NULL OR i.Status = $status)
      AND (NULLIF($dispatchStatus, '') IS NULL OR i.DispatchStatus = $dispatchStatus)
      AND (NULLIF($closureApprovalStatus, '') IS NULL OR i.ClosureApprovalStatus = $closureApprovalStatus)
      AND
      (
          NULLIF($view, '') IS NULL
          OR ($view = 'active'
              AND i.DispatchStatus NOT IN ('Closed', 'Cancelled')
              AND i.Status NOT IN ('PendingApproval', 'Approved', 'Rejected'))
          OR ($view = 'closure-pending' AND i.ClosureApprovalStatus = 'Pending')
          OR ($view = 'closed' AND i.DispatchStatus = 'Closed')
          OR ($view = 'cancelled' AND i.DispatchStatus = 'Cancelled')
      )
      AND
      (
          NULLIF($search, '') IS NULL
          OR i.IncidentNumber LIKE '%' + $search + '%'
          OR i.UnitId LIKE '%' + $search + '%'
          OR i.RegNo LIKE '%' + $search + '%'
          OR i.Company LIKE '%' + $search + '%'
          OR i.Event LIKE '%' + $search + '%'
      )
      AND (NULLIF($scope, '') IS NULL OR $scope <> 'mine' OR i.CreatedBy = a.username)
)
SELECT
    JSON_QUERY(COALESCE((
        SELECT *
        FROM filtered
        ORDER BY CreatedAt DESC, id DESC
        FOR JSON PATH
    ), '[]')) AS incidents,
    JSON_QUERY((
        SELECT
            COALESCE(SUM(CASE
                WHEN i.DispatchStatus NOT IN ('Closed', 'Cancelled')
                 AND i.Status NOT IN ('PendingApproval', 'Approved', 'Rejected')
                    THEN 1 ELSE 0
            END), 0) AS draftCount,
            COALESCE(SUM(CASE
                WHEN i.Status IN ('PendingApproval', 'Rejected')
                 AND i.DispatchStatus NOT IN ('Closed', 'Cancelled')
                    THEN 1 ELSE 0
            END), 0) AS pendingCount,
            COALESCE(SUM(CASE WHEN i.Status = 'Approved' AND i.DispatchStatus <> 'Cancelled' THEN 1 ELSE 0 END), 0) AS approvedCount,
            COALESCE(SUM(CASE WHEN i.Status = 'Rejected' THEN 1 ELSE 0 END), 0) AS rejectedCount,
            COALESCE(SUM(CASE
                WHEN i.DispatchStatus NOT IN ('Closed', 'Cancelled')
                 AND i.Status NOT IN ('PendingApproval', 'Approved', 'Rejected')
                    THEN 1 ELSE 0
            END), 0) AS activeDispatchCount,
            COALESCE(SUM(CASE WHEN i.ClosureApprovalStatus = 'Pending' THEN 1 ELSE 0 END), 0) AS closurePendingCount,
            COALESCE(SUM(CASE WHEN i.DispatchStatus = 'Closed' THEN 1 ELSE 0 END), 0) AS closedDispatchCount,
            COALESCE((
                SELECT COUNT(*)
                FROM CC.dbo.DispatchIncidents cancelled_incident
                WHERE EXISTS (SELECT 1 FROM auth WHERE completedOnly = 0)
                  AND ((cancelled_incident.IsDeleted = 0 AND cancelled_incident.DispatchStatus = N'Cancelled')
                   OR (
                        cancelled_incident.IsDeleted = 1
                        AND EXISTS (
                            SELECT 1 FROM CC.dbo.DispatchAuditLog entry_audit
                            WHERE entry_audit.dispatch_id = cancelled_incident.id
                              AND entry_audit.AuditAction = N'Entry cancelled'
                        )
                   )
                  )
            ), 0) AS cancelledDispatchCount
        FROM CC.dbo.DispatchIncidents i
        WHERE i.IsDeleted = 0
          AND EXISTS (SELECT 1 FROM auth a WHERE a.completedOnly = 0 OR (i.Status = N'Approved' AND i.DispatchStatus <> N'Cancelled' AND i.IsDeleted = 0))
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    )) AS summary
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
