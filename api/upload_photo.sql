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

-- SQLPage 0.25-compatible image upload endpoint for the rebuilt photo table.
-- The image is persisted below the SQLPage web root and its metadata is stored
-- in CC.dbo.DispatchIncidentPhotos.

INSERT INTO CC.dbo.DispatchIncidentPhotos
(
    dispatch_id,
    AssetKey,
    PhotoCategory,
    OriginalFileName,
    StoredFileName,
    FilePath,
    MimeType,
    Bytes,
    Notes,
    UploadedAt,
    UploadedBy,
    CreatedBy,
    UpdatedBy
)
SELECT
    incident.id,
    TRY_CONVERT(uniqueidentifier, NULLIF(:assetKey, '')),
    :photoCategory,
    sqlpage.uploaded_file_name('file'),
    sqlpage.uploaded_file_name('file'),
    sqlpage.persist_uploaded_file(
        'file',
        'dispatch_link/uploads/photos',
        'jpg,jpeg,png,webp'
    ),
    sqlpage.uploaded_file_mime_type('file'),
    NULL,
    NULLIF(:notes, ''),
    SYSDATETIME(),
    COALESCE(NULLIF((
        SELECT TOP (1) CAST(Username AS nvarchar(128))
        FROM Current_session
        WHERE session_id = sqlpage.cookie('session')
    ), ''), 'SQLPage'),
    COALESCE(NULLIF((
        SELECT TOP (1) CAST(Username AS nvarchar(128))
        FROM Current_session
        WHERE session_id = sqlpage.cookie('session')
    ), ''), 'SQLPage'),
    COALESCE(NULLIF((
        SELECT TOP (1) CAST(Username AS nvarchar(128))
        FROM Current_session
        WHERE session_id = sqlpage.cookie('session')
    ), ''), 'SQLPage')
FROM CC.dbo.DispatchIncidents incident
WHERE incident.id = TRY_CONVERT(int, :incidentId)
  AND incident.IsDeleted = 0
  AND incident.Status IN ('Draft', 'Rejected', 'PendingApproval')
  AND incident.DispatchStatus NOT IN ('Closed', 'Cancelled')
  AND :photoCategory IN
      ('LicenseDisk', 'FrontVehicleWithReg', 'BackVehicleWithReg',
       'VehicleSides', 'TrailersWithReg', 'Stock', 'Damages', 'Dashboard',
       'VehicleKeys', 'Odometer', 'Driver', 'DriverLicenseOrId')
  AND (
      NULLIF(:assetKey, '') IS NULL
      OR EXISTS (
          SELECT 1 FROM OPENJSON(COALESCE(incident.AdditionalAssetsJson, N'[]')) asset
          WHERE TRY_CONVERT(uniqueidentifier, JSON_VALUE(asset.value, '$.key')) = TRY_CONVERT(uniqueidentifier, :assetKey)
      )
  )
  AND NULLIF(sqlpage.uploaded_file_name('file'), '') IS NOT NULL
  AND LOWER(COALESCE(sqlpage.uploaded_file_mime_type('file'), '')) IN
      ('image/jpeg', 'image/png', 'image/webp')
  AND EXISTS (
      SELECT 1 FROM Current_session
      WHERE session_id = sqlpage.cookie('session')
  );

-- A category is a single replaceable photo slot. Keep the newest successful
-- upload active and soft-delete every older photo in that slot so reports do
-- not include superseded images.
UPDATE older_photo
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
FROM CC.dbo.DispatchIncidentPhotos older_photo
CROSS APPLY (
    SELECT TOP (1)
        newest_photo.id,
        newest_photo.OriginalFileName,
        newest_photo.MimeType,
        newest_photo.UploadedAt,
        newest_photo.UploadedBy
    FROM CC.dbo.DispatchIncidentPhotos newest_photo
    WHERE newest_photo.dispatch_id = older_photo.dispatch_id
      AND newest_photo.PhotoCategory = older_photo.PhotoCategory
      AND (newest_photo.AssetKey = older_photo.AssetKey OR (newest_photo.AssetKey IS NULL AND older_photo.AssetKey IS NULL))
      AND newest_photo.IsDeleted = 0
    ORDER BY newest_photo.id DESC
) replacement
WHERE older_photo.dispatch_id = TRY_CONVERT(int, :incidentId)
  AND older_photo.PhotoCategory = :photoCategory
  AND (older_photo.AssetKey = TRY_CONVERT(uniqueidentifier, NULLIF(:assetKey, ''))
       OR (older_photo.AssetKey IS NULL AND NULLIF(:assetKey, '') IS NULL))
  AND older_photo.IsDeleted = 0
  AND older_photo.id <> replacement.id
  AND replacement.OriginalFileName = sqlpage.uploaded_file_name('file')
  AND LOWER(COALESCE(replacement.MimeType, '')) =
      LOWER(COALESCE(sqlpage.uploaded_file_mime_type('file'), ''))
  AND replacement.UploadedAt >= DATEADD(minute, -1, SYSDATETIME())
  AND replacement.UploadedBy = COALESCE(NULLIF((
      SELECT TOP (1) CAST(Username AS nvarchar(128))
      FROM Current_session
      WHERE session_id = sqlpage.cookie('session')
  ), ''), 'SQLPage')
  AND EXISTS (
      SELECT 1
      FROM CC.dbo.DispatchIncidents incident
      WHERE incident.id = TRY_CONVERT(int, :incidentId)
        AND incident.IsDeleted = 0
        AND incident.Status IN ('Draft', 'Rejected', 'PendingApproval')
        AND incident.DispatchStatus NOT IN ('Closed', 'Cancelled')
  )
  AND :photoCategory IN
      ('LicenseDisk', 'FrontVehicleWithReg', 'BackVehicleWithReg',
       'VehicleSides', 'TrailersWithReg', 'Stock', 'Damages', 'Dashboard',
       'VehicleKeys', 'Odometer', 'Driver', 'DriverLicenseOrId')
  AND NULLIF(sqlpage.uploaded_file_name('file'), '') IS NOT NULL
  AND LOWER(COALESCE(sqlpage.uploaded_file_mime_type('file'), '')) IN
      ('image/jpeg', 'image/png', 'image/webp')
  AND EXISTS (
      SELECT 1
      FROM Current_session
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
                WHEN TRY_CONVERT(int, :incidentId) IS NULL THEN 'validation_error'
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
                WHEN :photoCategory NOT IN
                    ('LicenseDisk', 'FrontVehicleWithReg', 'BackVehicleWithReg',
                     'VehicleSides', 'TrailersWithReg', 'Stock', 'Damages', 'Dashboard',
                     'VehicleKeys', 'Odometer', 'Driver', 'DriverLicenseOrId')
                    THEN 'invalid_photo_category'
                WHEN NULLIF(:assetKey, '') IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidents incident
                    CROSS APPLY OPENJSON(COALESCE(incident.AdditionalAssetsJson, N'[]')) asset
                    WHERE incident.id = TRY_CONVERT(int, :incidentId)
                      AND TRY_CONVERT(uniqueidentifier, JSON_VALUE(asset.value, '$.key')) = TRY_CONVERT(uniqueidentifier, :assetKey)
                ) THEN 'invalid_asset'
                WHEN NULLIF(sqlpage.uploaded_file_name('file'), '') IS NULL THEN 'missing_file'
                WHEN LOWER(COALESCE(sqlpage.uploaded_file_mime_type('file'), '')) NOT IN
                    ('image/jpeg', 'image/png', 'image/webp') THEN 'invalid_file_type'
                ELSE 'ok'
            END AS nvarchar(40)) AS status,
            CAST(CASE
                WHEN :photoCategory NOT IN
                    ('LicenseDisk', 'FrontVehicleWithReg', 'BackVehicleWithReg',
                     'VehicleSides', 'TrailersWithReg', 'Stock', 'Damages', 'Dashboard',
                     'VehicleKeys', 'Odometer', 'Driver', 'DriverLicenseOrId')
                    THEN 'The selected photo category is invalid.'
                WHEN NULLIF(:assetKey, '') IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidents incident
                    CROSS APPLY OPENJSON(COALESCE(incident.AdditionalAssetsJson, N'[]')) asset
                    WHERE incident.id = TRY_CONVERT(int, :incidentId)
                      AND TRY_CONVERT(uniqueidentifier, JSON_VALUE(asset.value, '$.key')) = TRY_CONVERT(uniqueidentifier, :assetKey)
                ) THEN 'Save this asset before uploading its photos.'
                WHEN NULLIF(sqlpage.uploaded_file_name('file'), '') IS NULL
                    THEN 'Select an image before uploading.'
                WHEN LOWER(COALESCE(sqlpage.uploaded_file_mime_type('file'), '')) NOT IN
                    ('image/jpeg', 'image/png', 'image/webp')
                    THEN 'Photo must be a JPG, JPEG, PNG, or WEBP image.'
                ELSE NULL
            END AS nvarchar(500)) AS message
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
