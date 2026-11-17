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

-- Public, read-only evidence endpoint for approved dispatch incidents.
-- Deliberately excludes contacts, communications, audit data, and internal files.

WITH input AS
(
    SELECT TRY_CONVERT(int, $dispatchId) AS id
),
incident AS
(
    SELECT i.*
    FROM CC.dbo.DispatchIncidents i
    CROSS JOIN input p
    WHERE i.id = p.id
      AND i.IsDeleted = 0
      AND i.Status = 'Approved'
)
SELECT
    'json' AS component,
    (
        SELECT
            JSON_QUERY((
                SELECT
                    i.id,
                    i.IncidentNumber,
                    i.zoho_ob,
                    i.RiskEventReference,
                    i.EventDateTime,
                    i.Event,
                    i.Status,
                    i.DispatchStatus,
                    i.Company,
                    i.FleetCode,
                    i.UnitId,
                    i.RegNo,
                    i.GeoLocation,
                    i.VehicleMake,
                    i.VehicleModel,
                    i.VehicleColour,
                    i.VehicleBranding,
                    i.TrailerRegistration1,
                    i.TrailerRegistration2,
                    i.TrailerType,
                    i.TrailerBranding,
                    i.DispatchTeam,
                    i.DispatchDateTime,
                    i.StandDownDateTime,
                    i.OBNumber,
                    i.VehicleRecovered,
                    i.RecoveryDateTime,
                    i.LoadRecovered,
                    i.VehicleKeyAvailable,
                    i.TrailersRecovered,
                    i.DriverOnScene,
                    i.TrackingUnitStatus
                FROM incident i
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
            )) AS incident,
            JSON_QUERY(COALESCE((
                SELECT TOP (1000)
                    photo.id,
                    photo.PhotoCategory,
                    photo.OriginalFileName,
                    photo.Notes,
                    photo.UploadedAt,
                    CASE
                        WHEN LEFT(REPLACE(photo.FilePath, '\', '/'), 1) = '/'
                            THEN REPLACE(photo.FilePath, '\', '/')
                        ELSE '/' + REPLACE(photo.FilePath, '\', '/')
                    END AS imageUrl
                FROM CC.dbo.DispatchIncidentPhotos photo
                WHERE photo.dispatch_id = (SELECT TOP (1) id FROM incident)
                  AND photo.IsDeleted = 0
                  AND LOWER(COALESCE(photo.MimeType, '')) IN
                      ('image/jpeg', 'image/png', 'image/webp')
                ORDER BY photo.UploadedAt ASC, photo.id ASC
                FOR JSON PATH
            ), '[]')) AS photos
        FROM input
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
