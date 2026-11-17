-- SQLPage JSON endpoint: incident detail and rebuilt related collections.

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
input AS
(
    SELECT TRY_CAST($dispatchId AS int) AS id
),
incident AS
(
    SELECT i.*
    FROM CC.dbo.DispatchIncidents i
    CROSS JOIN input p
    CROSS JOIN auth a
    WHERE i.id = p.id
      AND i.IsDeleted = 0
      AND (a.completedOnly = 0 OR (i.Status = N'Approved' AND i.DispatchStatus <> N'Cancelled' AND i.IsDeleted = 0))
)
SELECT
    JSON_QUERY((
        SELECT
            i.id,
            i.IncidentNumber,
            i.SaveRequestId,
            i.RiskEventReference,
            i.EventDateTime,
            i.Event,
            i.UnitId,
            i.RegNo,
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
            CAST(CASE
                WHEN EXISTS (
                    SELECT 1 FROM Risk.dbo.unitinfo unit_row
                    WHERE NULLIF(LTRIM(RTRIM(i.RegNo)), N'') IS NOT NULL
                      AND UPPER(LTRIM(RTRIM(unit_row.reg_no))) = UPPER(LTRIM(RTRIM(i.RegNo)))
                      AND LOWER(LTRIM(RTRIM(COALESCE(unit_row.ctrltype, N'')))) <> N'lmu ir'
                )
                AND EXISTS (
                    SELECT 1 FROM Risk.dbo.vehicleinfo vehicle_row
                    WHERE NULLIF(LTRIM(RTRIM(i.RegNo)), N'') IS NOT NULL
                      AND UPPER(LTRIM(RTRIM(vehicle_row.reg_no))) = UPPER(LTRIM(RTRIM(i.RegNo)))
                )
                THEN 1 ELSE 0
            END AS bit) AS MSTrackRegistrationExists,
            i.Company,
            i.FleetCode,
            CASE
                WHEN i.Latitude IS NULL AND i.Status IN ('PendingApproval', 'Approved') THEN N'N/A'
                ELSE CONVERT(nvarchar(50), i.Latitude)
            END AS Latitude,
            CASE
                WHEN i.Longitude IS NULL AND i.Status IN ('PendingApproval', 'Approved') THEN N'N/A'
                ELSE CONVERT(nvarchar(50), i.Longitude)
            END AS Longitude,
            i.GeoLocation,
            i.DriverName,
            i.DriverContactNumber,
            i.GroundTeamDetails,
            i.DispatchReason,
            i.ActualDispatchReason,
            i.PositiveVESA,
            i.DispatchCaptureVersion,
            CASE
                WHEN CHARINDEX(N'[VehicleHistoryUnavailable]', COALESCE(i.OperatorNotesText, N'')) > 0
                    THEN RTRIM(LEFT(i.OperatorNotesText, CHARINDEX(N'[VehicleHistoryUnavailable]', i.OperatorNotesText) - 1))
                ELSE i.OperatorNotesText
            END AS OperatorNotesText,
            CASE
                WHEN CHARINDEX(N'[VehicleHistoryUnavailable]', COALESCE(i.OperatorNotesText, N'')) > 0
                    THEN RTRIM(LEFT(i.OperatorNotesText, CHARINDEX(N'[VehicleHistoryUnavailable]', i.OperatorNotesText) - 1))
                ELSE i.OperatorNotesText
            END AS operatorNotesText,
            i.ZohoAccount AS zoho_account,
            i.TrailerRegistration1,
            i.TrailerRegistration2,
            JSON_QUERY(COALESCE(i.AdditionalAssetsJson, N'[]')) AS additionalAssets,
            i.Status,
            i.DispatchStatus,
            i.ClosureApprovalStatus,
            i.AssignedControlRoomAgent,
            i.SubmittedAt,
            i.SubmittedBy,
            i.ApprovedAt,
            i.ApprovedBy,
            i.RejectedAt,
            i.RejectedBy,
            i.RejectionReason,
            i.ApprovalComments,
            i.PdfPath AS pdfpath,
            i.ZohoUpdate AS zoho_update,
            i.ZohoId AS zoho_id,
            i.zoho_ob,
            i.CreatedAt,
            i.CreatedBy,
            COALESCE(
                NULLIF(LTRIM(RTRIM(CONCAT(creator_info.Name, ' ', creator_info.Surname))), ''),
                i.CreatedBy
            ) AS CreatedByDisplayName,
            i.UpdatedAt,
            i.UpdatedBy,
            JSON_QUERY((
                SELECT
                    i.TrailerApplicable AS trailerApplicable,
                    i.ETA AS eta,
                    i.IncidentNotesHtml AS incidentNotesHtml,
                    i.StockApplicable AS stockApplicable,
                    i.NoVisibleDamages AS noVisibleDamages,
                    COALESCE(i.DamageNotes, N'') AS damageNotes,
                    COALESCE(i.VehicleMake, N'') AS vehicleMake,
                    COALESCE(i.VehicleModel, N'') AS vehicleModel,
                    COALESCE(i.VehicleColour, N'') AS vehicleColour,
                    COALESCE(i.VehicleBranding, N'') AS vehicleBranding,
                    COALESCE(i.TrailerType, N'') AS trailerType,
                    COALESCE(i.TrailerBranding, N'') AS trailerBranding,
                    COALESCE(i.ClientName, N'') AS clientName,
                    COALESCE(i.ClientContactNumber, N'') AS clientContactNumber,
                    COALESCE(i.ClientPO, N'') AS clientPo,
                    COALESCE(i.DLNumber, N'') AS dlNumber,
                    COALESCE(i.StockNumberWrc, N'') AS stockNumberWrc,
                    COALESCE(i.DispatchTeam, N'') AS dispatchTeam,
                    CONVERT(varchar(16), i.DispatchDateTime, 126) AS dispatchDateTime,
                    COALESCE(i.OBNumber, N'') AS obNumber,
                    CONVERT(varchar(16), i.StandDownDateTime, 126) AS standDownDateTime,
                    COALESCE(i.VehicleRecovered, N'') AS vehicleRecovered,
                    CONVERT(varchar(16), i.RecoveryDateTime, 126) AS recoveryDateTime,
                    COALESCE(i.LoadRecovered, N'') AS loadRecovered,
                    COALESCE(i.VehicleKeyAvailable, N'') AS vehicleKeyAvailable,
                    COALESCE(i.TrailersRecovered, N'') AS trailersRecovered,
                    COALESCE(i.DriverOnScene, N'') AS driverOnScene,
                    COALESCE(i.TrackingUnitStatus, N'') AS trackingUnitStatus
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
            )) AS dispatchMeta
        FROM incident i
        OUTER APPLY (
            SELECT TOP (1) user_row.Name, user_row.Surname
            FROM Jobcard.dbo.User_info user_row
            WHERE user_row.Username = i.CreatedBy
        ) creator_info
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    )) AS incident,
    JSON_QUERY(COALESCE((
        SELECT TOP (1000)
            photo.id,
            photo.dispatch_id,
            photo.PhotoCategory,
            CONVERT(nvarchar(36), photo.AssetKey) AS AssetKey,
            photo.OriginalFileName,
            photo.StoredFileName,
            photo.FilePath,
            photo.MimeType,
            photo.Bytes,
            photo.Notes,
            photo.UploadedAt,
            photo.UploadedBy,
            photo.CreatedAt,
            photo.CreatedBy,
            CASE
                WHEN LEFT(REPLACE(photo.FilePath, '\', '/'), 1) = '/'
                    THEN REPLACE(photo.FilePath, '\', '/')
                ELSE '/' + REPLACE(photo.FilePath, '\', '/')
            END AS downloadUrl
        FROM CC.dbo.DispatchIncidentPhotos photo
        WHERE photo.dispatch_id = (SELECT TOP (1) id FROM incident)
          AND photo.IsDeleted = 0
          AND (photo.AssetKey IS NULL OR EXISTS (
              SELECT 1 FROM incident owner
              CROSS APPLY OPENJSON(COALESCE(owner.AdditionalAssetsJson, N'[]')) asset
              WHERE TRY_CONVERT(uniqueidentifier, JSON_VALUE(asset.value, '$.key')) = photo.AssetKey
          ))
        ORDER BY photo.UploadedAt DESC, photo.id DESC
        FOR JSON PATH
    ), '[]')) AS photos,
    JSON_QUERY(COALESCE((
        SELECT TOP (1000)
            dispatch_file.id,
            dispatch_file.dispatch_id,
            dispatch_file.FileType,
            dispatch_file.OriginalFileName,
            dispatch_file.StoredFileName,
            dispatch_file.FilePath,
            dispatch_file.MimeType,
            dispatch_file.Bytes,
            dispatch_file.UploadedAt,
            dispatch_file.UploadedBy,
            dispatch_file.CreatedAt,
            dispatch_file.CreatedBy,
            CASE
                WHEN LEFT(REPLACE(dispatch_file.FilePath, '\', '/'), 1) = '/'
                    THEN REPLACE(dispatch_file.FilePath, '\', '/')
                ELSE '/' + REPLACE(dispatch_file.FilePath, '\', '/')
            END AS downloadUrl
        FROM CC.dbo.DispatchIncidentFiles dispatch_file
        WHERE dispatch_file.dispatch_id = (SELECT TOP (1) id FROM incident)
          AND dispatch_file.IsDeleted = 0
        ORDER BY dispatch_file.UploadedAt DESC, dispatch_file.id DESC
        FOR JSON PATH
    ), '[]')) AS files,
    JSON_QUERY(COALESCE((
        SELECT TOP (500)
            communication.CommunicationLogID,
            communication.CommunicationLogID AS id,
            communication.DispatchID,
            communication.DisplayOrder,
            CONVERT(char(10), communication.CommunicationDate, 23) AS CommunicationDate,
            CONVERT(char(5), communication.CommunicationTime, 108) AS CommunicationTime,
            communication.CommunicationType,
            communication.ControlRoomAgent,
            communication.ContactPerson,
            communication.ContactNumber,
            communication.EmailAddress,
            communication.CommunicationNotes,
            communication.CreatedAt,
            communication.CreatedBy,
            communication.UpdatedAt,
            communication.UpdatedBy
        FROM CC.dbo.DispatchCommunicationLog communication
        WHERE communication.DispatchID = (SELECT TOP (1) id FROM incident)
          AND communication.IsDeleted = 0
        ORDER BY
            CASE WHEN communication.DisplayOrder > 0 THEN communication.DisplayOrder ELSE 2147483647 END ASC,
            communication.CommunicationDate ASC,
            communication.CommunicationTime ASC,
            communication.CommunicationLogID ASC
        FOR JSON PATH
    ), '[]')) AS communications,
    JSON_QUERY(COALESCE((
        SELECT TOP (500)
            timeline_entry.TimelineEntryID,
            timeline_entry.TimelineEntryID AS id,
            timeline_entry.DispatchID,
            CONVERT(varchar(16), timeline_entry.EventDateTime, 126) AS EventDateTime,
            timeline_entry.EventType,
            timeline_entry.EntryText,
            timeline_entry.CreatedAt,
            timeline_entry.CreatedBy,
            timeline_entry.UpdatedAt,
            timeline_entry.UpdatedBy
        FROM CC.dbo.DispatchIncidentTimeline timeline_entry
        WHERE timeline_entry.DispatchID = (SELECT TOP (1) id FROM incident)
          AND timeline_entry.IsDeleted = 0
          AND NOT (
              timeline_entry.EventType = 'Note'
              AND timeline_entry.EntryText LIKE 'HANDOVER:%'
          )
        ORDER BY timeline_entry.EventDateTime ASC, timeline_entry.TimelineEntryID ASC
        FOR JSON PATH
    ), '[]')) AS timeline,
    JSON_QUERY(COALESCE((
        SELECT TOP (500)
            timeline_entry.TimelineEntryID,
            timeline_entry.TimelineEntryID AS id,
            CONVERT(varchar(16), timeline_entry.EventDateTime, 126) AS HandoverDateTime,
            target_info.Username AS TargetOperatorUsername,
            COALESCE(
                NULLIF(LTRIM(RTRIM(CONCAT(target_info.Name, ' ', target_info.Surname))), ''),
                target_info.Username
            ) AS TargetOperatorDisplayName,
            timeline_entry.CreatedAt,
            timeline_entry.CreatedBy,
            COALESCE(
                NULLIF(LTRIM(RTRIM(CONCAT(recorder_info.Name, ' ', recorder_info.Surname))), ''),
                timeline_entry.CreatedBy
            ) AS RecordedByDisplayName
        FROM CC.dbo.DispatchIncidentTimeline timeline_entry
        CROSS APPLY (
            SELECT NULLIF(
                LTRIM(RTRIM(SUBSTRING(timeline_entry.EntryText, LEN('HANDOVER:') + 1, 128))),
                ''
            ) AS target_username
        ) parsed_handover
        OUTER APPLY (
            SELECT TOP (1) user_row.Username, user_row.Name, user_row.Surname
            FROM Jobcard.dbo.User_info user_row
            WHERE user_row.Username = parsed_handover.target_username
        ) target_info
        OUTER APPLY (
            SELECT TOP (1) user_row.Name, user_row.Surname
            FROM Jobcard.dbo.User_info user_row
            WHERE user_row.Username = timeline_entry.CreatedBy
        ) recorder_info
        WHERE timeline_entry.DispatchID = (SELECT TOP (1) id FROM incident)
          AND timeline_entry.IsDeleted = 0
          AND timeline_entry.EventType = 'Note'
          AND timeline_entry.EntryText LIKE 'HANDOVER:%'
        ORDER BY timeline_entry.EventDateTime ASC, timeline_entry.TimelineEntryID ASC
        FOR JSON PATH
    ), '[]')) AS handovers,
    JSON_QUERY('[]') AS assignments,
    JSON_QUERY('[]') AS closureReviews,
    JSON_QUERY('[]') AS managerComments,
    JSON_QUERY('[]') AS audit,
    JSON_QUERY((
        SELECT
            CAST(0 AS bit) AS isValid,
            JSON_QUERY('[]') AS missingFields,
            JSON_QUERY('[]') AS missingPhotos,
            COALESCE((SELECT TOP (1) OperatorNotesText FROM incident), N'') AS noteText,
            JSON_QUERY((
                SELECT
                    (
                        SELECT COUNT(*)
                        FROM CC.dbo.DispatchIncidentPhotos photo
                        WHERE photo.dispatch_id = (SELECT TOP (1) id FROM incident)
                          AND photo.IsDeleted = 0
                          AND (photo.AssetKey IS NULL OR EXISTS (
                              SELECT 1 FROM incident owner
                              CROSS APPLY OPENJSON(COALESCE(owner.AdditionalAssetsJson, N'[]')) asset
                              WHERE TRY_CONVERT(uniqueidentifier, JSON_VALUE(asset.value, '$.key')) = photo.AssetKey
                          ))
                    ) AS photoCount,
                    (
                        SELECT COUNT(*)
                        FROM CC.dbo.DispatchIncidentFiles dispatch_file
                        WHERE dispatch_file.dispatch_id = (SELECT TOP (1) id FROM incident)
                          AND dispatch_file.IsDeleted = 0
                    ) AS fileCount
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
            )) AS uploads
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    )) AS validation
WHERE EXISTS (SELECT 1 FROM incident)
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
