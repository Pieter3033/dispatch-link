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

-- SQLPage 0.25-compatible submit-for-approval endpoint.
-- Approval queue membership is represented by DispatchIncidents.Status;
-- no legacy DispatchApprovals table is required.

UPDATE incident
SET
    Status = 'PendingApproval',
    SubmittedBy = COALESCE(NULLIF((
        SELECT TOP (1) CAST(Username AS nvarchar(128))
        FROM Current_session
        WHERE session_id = sqlpage.cookie('session')
    ), ''), 'SQLPage'),
    SubmittedAt = SYSDATETIME(),
    UpdatedBy = COALESCE(NULLIF((
        SELECT TOP (1) CAST(Username AS nvarchar(128))
        FROM Current_session
        WHERE session_id = sqlpage.cookie('session')
    ), ''), 'SQLPage'),
    UpdatedAt = SYSDATETIME(),
    ZohoUpdate = 0
FROM CC.dbo.DispatchIncidents incident
WHERE incident.id = TRY_CONVERT(int, :incidentId)
  AND incident.IsDeleted = 0
  AND incident.Status IN ('Draft', 'Rejected')
  AND incident.DispatchStatus NOT IN ('Closed', 'Cancelled')
  -- SQLPage is the final authority. Browser validation alone is insufficient:
  -- a stale client or unsaved form values must never submit an incomplete row.
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
  -- The existing decimal columns store the supported N/A choice as NULL. The
  -- explicit request flags distinguish that choice from an omitted coordinate.
  AND (
      incident.Latitude BETWEEN -90 AND 90
      OR (incident.Latitude IS NULL AND LOWER(COALESCE(:latitudeNotAvailable, '')) IN ('1', 'true', 'yes', 'on'))
  )
  AND (
      incident.Longitude BETWEEN -180 AND 180
      OR (incident.Longitude IS NULL AND LOWER(COALESCE(:longitudeNotAvailable, '')) IN ('1', 'true', 'yes', 'on'))
  )
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
  AND (
      incident.DriverOnScene <> 'Yes'
      OR (
          NULLIF(LTRIM(RTRIM(incident.DriverName)), '') IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(incident.DriverContactNumber)), '') IS NOT NULL
      )
  )
  AND (
      incident.VehicleRecovered <> 'Yes'
      OR (
          NULLIF(LTRIM(RTRIM(incident.VehicleMake)), '') IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(incident.VehicleModel)), '') IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(incident.VehicleColour)), '') IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(incident.VehicleBranding)), '') IS NOT NULL
      )
  )
  AND (
      incident.TrailersRecovered <> 'Yes'
      OR (
          NULLIF(LTRIM(RTRIM(incident.TrailerRegistration1)), '') IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(incident.TrailerType)), '') IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(incident.TrailerBranding)), '') IS NOT NULL
      )
  )
  AND (
      ISNULL(incident.VehicleRecovered, '') <> 'Yes'
      OR (
          incident.RecoveryDateTime IS NOT NULL
          AND EXISTS (
              SELECT 1 FROM CC.dbo.DispatchIncidentPhotos photo
              WHERE photo.dispatch_id = incident.id
                AND photo.IsDeleted = 0 AND photo.PhotoCategory = 'LicenseDisk'
          )
          AND EXISTS (
              SELECT 1 FROM CC.dbo.DispatchIncidentPhotos photo
              WHERE photo.dispatch_id = incident.id
                AND photo.IsDeleted = 0 AND photo.PhotoCategory = 'FrontVehicleWithReg'
          )
          AND EXISTS (
              SELECT 1 FROM CC.dbo.DispatchIncidentPhotos photo
              WHERE photo.dispatch_id = incident.id
                AND photo.IsDeleted = 0 AND photo.PhotoCategory = 'BackVehicleWithReg'
          )
          AND EXISTS (
              SELECT 1 FROM CC.dbo.DispatchIncidentPhotos photo
              WHERE photo.dispatch_id = incident.id
                AND photo.IsDeleted = 0 AND photo.PhotoCategory = 'VehicleSides'
          )
          AND EXISTS (
              SELECT 1 FROM CC.dbo.DispatchIncidentPhotos photo
              WHERE photo.dispatch_id = incident.id
                AND photo.IsDeleted = 0 AND photo.PhotoCategory = 'Dashboard'
          )
      )
  )
  AND (
      ISNULL(incident.VehicleKeyAvailable, '') <> 'Yes'
      OR EXISTS (
          SELECT 1 FROM CC.dbo.DispatchIncidentPhotos photo
          WHERE photo.dispatch_id = incident.id
            AND photo.IsDeleted = 0 AND photo.PhotoCategory = 'VehicleKeys'
      )
  )
  AND (
      ISNULL(incident.TrailersRecovered, '') <> 'Yes'
      OR EXISTS (
          SELECT 1 FROM CC.dbo.DispatchIncidentPhotos photo
          WHERE photo.dispatch_id = incident.id
            AND photo.IsDeleted = 0 AND photo.PhotoCategory = 'TrailersWithReg'
      )
  )
  AND (
      ISNULL(incident.DriverOnScene, '') <> 'Yes'
      OR (
          EXISTS (
              SELECT 1 FROM CC.dbo.DispatchIncidentPhotos photo
              WHERE photo.dispatch_id = incident.id
                AND photo.IsDeleted = 0 AND photo.PhotoCategory = 'Driver'
          )
          AND EXISTS (
              SELECT 1 FROM CC.dbo.DispatchIncidentPhotos photo
              WHERE photo.dispatch_id = incident.id
                AND photo.IsDeleted = 0 AND photo.PhotoCategory = 'DriverLicenseOrId'
          )
      )
  )
  AND EXISTS (
      SELECT 1 FROM Current_session
      WHERE session_id = sqlpage.cookie('session')
  );

INSERT INTO CC.dbo.DispatchAuditLog
(
    dispatch_id,
    AuditAction,
    OldStatus,
    NewStatus,
    AuditMessage,
    AuditUsername,
    CreatedAt
)
SELECT
    incident.id,
    N'Submitted for approval',
    N'Draft/Rejected',
    N'PendingApproval',
    N'Incident submitted for approval.',
    COALESCE(NULLIF((
        SELECT TOP (1) CAST(Username AS nvarchar(128))
        FROM Current_session
        WHERE session_id = sqlpage.cookie('session')
    ), ''), 'SQLPage'),
    SYSDATETIME()
FROM CC.dbo.DispatchIncidents incident
WHERE incident.id = TRY_CONVERT(int, :incidentId)
  AND incident.IsDeleted = 0
  AND incident.Status = 'PendingApproval'
  AND incident.SubmittedAt >= DATEADD(second, -5, SYSDATETIME())
  AND EXISTS (
      SELECT 1 FROM Current_session
      WHERE session_id = sqlpage.cookie('session')
  )
  AND NOT EXISTS (
      SELECT 1
      FROM CC.dbo.DispatchAuditLog audit_entry
      WHERE audit_entry.dispatch_id = incident.id
        AND audit_entry.AuditAction = N'Submitted for approval'
        AND audit_entry.NewStatus = N'PendingApproval'
        AND audit_entry.CreatedAt >= incident.SubmittedAt
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
                WHEN TRY_CONVERT(int, :incidentId) IS NULL THEN 'validation_error'
                WHEN NOT EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE id = TRY_CONVERT(int, :incidentId)
                      AND IsDeleted = 0
                ) THEN 'not_found'
                -- A valid submission has already changed status above. If the
                -- row is still editable here, one or more compulsory checks
                -- prevented the update.
                WHEN EXISTS (
                    SELECT 1
                    FROM CC.dbo.DispatchIncidents incident
                    WHERE incident.id = TRY_CONVERT(int, :incidentId)
                      AND incident.IsDeleted = 0
                      AND incident.Status IN ('Draft', 'Rejected')
                      AND incident.DispatchStatus NOT IN ('Closed', 'Cancelled')
                ) THEN 'validation_error'
                WHEN EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE id = TRY_CONVERT(int, :incidentId)
                      AND IsDeleted = 0
                      AND Status = 'PendingApproval'
                ) THEN 'ok'
                ELSE 'locked_status'
            END AS nvarchar(40)) AS status,
            CAST(CASE
                WHEN EXISTS (
                    SELECT 1 FROM Current_session
                    WHERE session_id = sqlpage.cookie('session')
                ) AND EXISTS (
                    SELECT 1
                    FROM CC.dbo.DispatchIncidents incident
                    WHERE incident.id = TRY_CONVERT(int, :incidentId)
                      AND incident.IsDeleted = 0
                      AND incident.Status IN ('Draft', 'Rejected')
                      AND incident.DispatchStatus NOT IN ('Closed', 'Cancelled')
                ) THEN 'Complete all compulsory dispatch fields and evidence before submitting.'
                WHEN EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE id = TRY_CONVERT(int, :incidentId)
                      AND IsDeleted = 0
                      AND Status = 'PendingApproval'
                ) THEN 'Dispatch submitted for approval.'
                ELSE NULL
            END AS nvarchar(500)) AS message,
            TRY_CONVERT(int, :incidentId) AS id
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
-- Compatibility endpoint for databases without the additional-assets schema.
-- Keep core submission behavior aligned with ../submit_incident.sql.
