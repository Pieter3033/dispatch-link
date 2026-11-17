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

-- SQLPage 0.25-compatible approval endpoint.
-- SQLPage prepares each statement independently, so request values and auth
-- checks are intentionally repeated instead of being stored in T-SQL variables.

UPDATE incident
SET Status = 'Approved',
    ApprovedBy = COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    ApprovedAt = SYSDATETIME(),
    ApprovalComments = NULLIF(:approvalComments, ''),
    UpdatedBy = COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    UpdatedAt = SYSDATETIME(),
    ZohoUpdate = 0
FROM CC.dbo.DispatchIncidents incident
WHERE incident.id = TRY_CONVERT(int, :incidentId)
  AND ISNULL(incident.IsDeleted, 0) = 0
  AND incident.Status = 'PendingApproval'
  AND incident.DispatchStatus NOT IN ('Closed', 'Cancelled')
  AND NULLIF(LTRIM(RTRIM(:approvalComments)), '') IS NOT NULL
  -- Recheck the saved row at approval time as a second safety boundary.
  AND incident.EventDateTime IS NOT NULL
  AND NULLIF(LTRIM(RTRIM(incident.Event)), '') IS NOT NULL
  AND TRY_CONVERT(decimal(18, 6), incident.ETA) > 0
  AND NULLIF(LTRIM(RTRIM(incident.DispatchReason)), '') IS NOT NULL
  -- Existing dispatches keep a NULL version and remain exempt.
  AND (
      incident.DispatchCaptureVersion IS NULL
      OR (
          NULLIF(LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(REPLACE(incident.ActualDispatchReason COLLATE Latin1_General_100_BIN2, CHAR(9), N' '), CHAR(10), N' '), CHAR(13), N' '), NCHAR(160), N' '))), N'') IS NOT NULL
          AND DATALENGTH(incident.ActualDispatchReason) <= 2000
          AND incident.PositiveVESA COLLATE Latin1_General_100_BIN2 IN (N'Hijacked', N'Stolen', N'No')
      )
  )
  AND NULLIF(LTRIM(RTRIM(incident.RegNo)), '') IS NOT NULL
  AND NULLIF(LTRIM(RTRIM(incident.UnitId)), '') IS NOT NULL
  AND NULLIF(LTRIM(RTRIM(incident.Company)), '') IS NOT NULL
  AND NULLIF(LTRIM(RTRIM(incident.ZohoAccount)), '') IS NOT NULL
  AND NULLIF(LTRIM(RTRIM(incident.GeoLocation)), '') IS NOT NULL
  AND (incident.Latitude IS NULL OR incident.Latitude BETWEEN -90 AND 90)
  AND (incident.Longitude IS NULL OR incident.Longitude BETWEEN -180 AND 180)
  AND NULLIF(LTRIM(RTRIM(incident.ClientName)), '') IS NOT NULL
  AND NULLIF(LTRIM(RTRIM(incident.ClientContactNumber)), '') IS NOT NULL
  AND NULLIF(LTRIM(RTRIM(incident.DispatchTeam)), '') IS NOT NULL
  AND incident.DispatchDateTime IS NOT NULL
  AND NULLIF(LTRIM(RTRIM(incident.OBNumber)), '') IS NOT NULL
  AND incident.StandDownDateTime IS NOT NULL
  AND incident.VehicleRecovered IN ('Yes', 'No', 'Recovery Cancelled', 'N/A')
  AND incident.LoadRecovered IN ('Yes', 'No', 'N/A', 'Partial Recovery')
  AND incident.VehicleKeyAvailable IN ('Yes', 'No', 'N/A')
  AND incident.TrailersRecovered IN ('Yes', 'No', 'N/A')
  AND incident.DriverOnScene IN ('Yes', 'No', 'N/A')
  AND NULLIF(LTRIM(RTRIM(incident.TrackingUnitStatus)), '') IS NOT NULL
  AND (
      (
          EXISTS (
              SELECT 1 FROM Risk.dbo.unitinfo unit_row
              WHERE UPPER(LTRIM(RTRIM(unit_row.reg_no))) = UPPER(LTRIM(RTRIM(incident.RegNo)))
                AND LOWER(LTRIM(RTRIM(COALESCE(unit_row.ctrltype, N'')))) <> N'lmu ir'
          )
          AND EXISTS (
              SELECT 1 FROM Risk.dbo.vehicleinfo vehicle_row
              WHERE UPPER(LTRIM(RTRIM(vehicle_row.reg_no))) = UPPER(LTRIM(RTRIM(incident.RegNo)))
          )
      )
      OR (
          EXISTS (
              SELECT 1 FROM CC.dbo.DispatchIncidentFiles history_excel
              WHERE history_excel.dispatch_id = incident.id
                AND history_excel.IsDeleted = 0
                AND history_excel.FileType = N'HistoryExcel'
          )
          AND EXISTS (
              SELECT 1 FROM CC.dbo.DispatchIncidentFiles history_pdf
              WHERE history_pdf.dispatch_id = incident.id
                AND history_pdf.IsDeleted = 0
                AND history_pdf.FileType = N'HistoryPdf'
          )
      )
      OR (
          incident.TrackingUnitStatus = N'Not fitted with Pulsit Tracking'
          AND CHARINDEX(N'[VehicleHistoryUnavailable]', COALESCE(incident.OperatorNotesText, N'')) > 0
          AND NULLIF(LTRIM(RTRIM(SUBSTRING(
              incident.OperatorNotesText,
              CHARINDEX(N'[VehicleHistoryUnavailable]', incident.OperatorNotesText) + LEN(N'[VehicleHistoryUnavailable]'),
              501
          ))), N'') IS NOT NULL
      )
  )
  AND (incident.DriverOnScene <> 'Yes' OR (
      NULLIF(LTRIM(RTRIM(incident.DriverName)), '') IS NOT NULL
      AND NULLIF(LTRIM(RTRIM(incident.DriverContactNumber)), '') IS NOT NULL
  ))
  AND (incident.VehicleRecovered <> 'Yes' OR (
      incident.RecoveryDateTime IS NOT NULL
      AND NULLIF(LTRIM(RTRIM(incident.VehicleMake)), '') IS NOT NULL
      AND NULLIF(LTRIM(RTRIM(incident.VehicleModel)), '') IS NOT NULL
      AND NULLIF(LTRIM(RTRIM(incident.VehicleColour)), '') IS NOT NULL
      AND NULLIF(LTRIM(RTRIM(incident.VehicleBranding)), '') IS NOT NULL
  ))
  AND (incident.TrailersRecovered <> 'Yes' OR (
      NULLIF(LTRIM(RTRIM(incident.TrailerRegistration1)), '') IS NOT NULL
      AND NULLIF(LTRIM(RTRIM(incident.TrailerType)), '') IS NOT NULL
      AND NULLIF(LTRIM(RTRIM(incident.TrailerBranding)), '') IS NOT NULL
  ))
  AND NOT EXISTS (
      SELECT required.category
      FROM (VALUES
          ('LicenseDisk', CASE WHEN incident.VehicleRecovered = 'Yes' THEN 1 ELSE 0 END),
          ('FrontVehicleWithReg', CASE WHEN incident.VehicleRecovered = 'Yes' THEN 1 ELSE 0 END),
          ('BackVehicleWithReg', CASE WHEN incident.VehicleRecovered = 'Yes' THEN 1 ELSE 0 END),
          ('VehicleSides', CASE WHEN incident.VehicleRecovered = 'Yes' THEN 1 ELSE 0 END),
          ('Dashboard', CASE WHEN incident.VehicleRecovered = 'Yes' THEN 1 ELSE 0 END),
          ('VehicleKeys', CASE WHEN incident.VehicleKeyAvailable = 'Yes' THEN 1 ELSE 0 END),
          ('TrailersWithReg', CASE WHEN incident.TrailersRecovered = 'Yes' THEN 1 ELSE 0 END),
          ('Driver', CASE WHEN incident.DriverOnScene = 'Yes' THEN 1 ELSE 0 END),
          ('DriverLicenseOrId', CASE WHEN incident.DriverOnScene = 'Yes' THEN 1 ELSE 0 END)
      ) required(category, is_required)
      WHERE required.is_required = 1
        AND NOT EXISTS (
            SELECT 1
            FROM CC.dbo.DispatchIncidentPhotos photo
            WHERE photo.dispatch_id = incident.id
              AND photo.IsDeleted = 0
              AND photo.PhotoCategory = required.category
        )
  )
  AND EXISTS (
      SELECT 1
      FROM Current_session current_session
      CROSS APPLY (SELECT NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS nvarchar(200)))), '') AS username) session_raw
      CROSS APPLY (SELECT RIGHT(REPLACE(session_raw.username, '/', '\'), CHARINDEX('\', REVERSE(REPLACE(session_raw.username, '/', '\')) + '\') - 1) AS login_name) session_login
      CROSS JOIN Jobcard.dbo.User_info user_info
      CROSS APPLY (SELECT NULLIF(LTRIM(RTRIM(CAST(user_info.Username AS nvarchar(200)))), '') AS username) user_raw
      CROSS APPLY (SELECT RIGHT(REPLACE(user_raw.username, '/', '\'), CHARINDEX('\', REVERSE(REPLACE(user_raw.username, '/', '\')) + '\') - 1) AS login_name) user_login
      WHERE current_session.session_id = sqlpage.cookie('session')
        AND TRY_CONVERT(int, user_info.Usertype) = 7
        AND LOWER(LEFT(user_login.login_name, CHARINDEX('@', user_login.login_name + '@') - 1))
            = LOWER(LEFT(session_login.login_name, CHARINDEX('@', session_login.login_name + '@') - 1))
  );

INSERT INTO CC.dbo.DispatchAuditLog
    (dispatch_id, AuditAction, OldStatus, NewStatus, AuditMessage, AuditUsername, CreatedAt)
SELECT incident.id,
       N'Approved',
       N'PendingApproval',
       N'Approved',
       COALESCE(NULLIF(:approvalComments, ''), N''),
       COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
       SYSDATETIME()
FROM CC.dbo.DispatchIncidents incident
WHERE incident.id = TRY_CONVERT(int, :incidentId)
  AND incident.Status = 'Approved'
  AND incident.ApprovedBy = COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage')
  AND incident.ApprovedAt >= DATEADD(second, -5, SYSDATETIME())
  AND NOT EXISTS (
      SELECT 1 FROM CC.dbo.DispatchAuditLog audit_entry
      WHERE audit_entry.dispatch_id = incident.id
        AND audit_entry.AuditAction = N'Approved'
        AND audit_entry.CreatedAt >= incident.ApprovedAt
  );

SELECT 'json' AS component,
       (
           SELECT CASE
               WHEN NOT EXISTS (
                   SELECT 1 FROM Current_session
                   WHERE session_id = sqlpage.cookie('session')
               ) THEN 'unauthorized'
               WHEN NOT EXISTS (
                   SELECT 1
                   FROM Current_session current_session
                   CROSS APPLY (SELECT NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS nvarchar(200)))), '') AS username) session_raw
                   CROSS APPLY (SELECT RIGHT(REPLACE(session_raw.username, '/', '\'), CHARINDEX('\', REVERSE(REPLACE(session_raw.username, '/', '\')) + '\') - 1) AS login_name) session_login
                   CROSS JOIN Jobcard.dbo.User_info user_info
                   CROSS APPLY (SELECT NULLIF(LTRIM(RTRIM(CAST(user_info.Username AS nvarchar(200)))), '') AS username) user_raw
                   CROSS APPLY (SELECT RIGHT(REPLACE(user_raw.username, '/', '\'), CHARINDEX('\', REVERSE(REPLACE(user_raw.username, '/', '\')) + '\') - 1) AS login_name) user_login
                   WHERE current_session.session_id = sqlpage.cookie('session')
                     AND TRY_CONVERT(int, user_info.Usertype) = 7
                     AND LOWER(LEFT(user_login.login_name, CHARINDEX('@', user_login.login_name + '@') - 1))
                         = LOWER(LEFT(session_login.login_name, CHARINDEX('@', session_login.login_name + '@') - 1))
               ) THEN 'forbidden'
               WHEN TRY_CONVERT(int, :incidentId) IS NULL THEN 'validation_error'
               WHEN NOT EXISTS (
                   SELECT 1 FROM CC.dbo.DispatchIncidents
                   WHERE id = TRY_CONVERT(int, :incidentId)
                     AND ISNULL(IsDeleted, 0) = 0
               ) THEN 'not_found'
               WHEN EXISTS (
                   SELECT 1 FROM CC.dbo.DispatchAuditLog
                   WHERE dispatch_id = TRY_CONVERT(int, :incidentId)
                     AND AuditAction = N'Approved'
                     AND AuditUsername = COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage')
                     AND CreatedAt >= DATEADD(second, -5, SYSDATETIME())
               ) THEN 'ok'
               WHEN EXISTS (
                   SELECT 1 FROM CC.dbo.DispatchIncidents
                   WHERE id = TRY_CONVERT(int, :incidentId)
                     AND ISNULL(IsDeleted, 0) = 0
                     AND Status = 'PendingApproval'
               ) THEN 'validation_error'
               ELSE 'locked_status'
           END AS status,
           TRY_CONVERT(int, :incidentId) AS id,
           CASE
               WHEN EXISTS (
                   SELECT 1 FROM CC.dbo.DispatchIncidents
                   WHERE id = TRY_CONVERT(int, :incidentId)
                     AND ISNULL(IsDeleted, 0) = 0
                     AND Status = 'PendingApproval'
               ) THEN 'Complete all compulsory dispatch fields and evidence before approving.'
               ELSE NULL
           END AS message
           FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
       ) AS contents;
